/**
 * Colector bancario. Corre en la máquina del usuario, nunca en la nube.
 *
 * Tres razones, cualquiera de ellas suficiente: necesita un Chrome real con ventana, la clave
 * dinámica exige un humano en el teclado, y una clave bancaria en una variable de entorno de
 * un proveedor cloud es legible por cualquiera con acceso al panel. Las Edge Functions de
 * Supabase además no pueden lanzar un navegador: son un sandbox Deno sin binario de Chrome.
 *
 * Las credenciales se piden por stdin en cada ejecución y no se guardan en ningún lado. No es
 * incomodidad gratuita: como la clave dinámica ya obliga a que estés presente, guardar la
 * clave no habilitaría nada desatendido — solo crearía un objetivo de robo permanente.
 *
 * Uso:
 *   npm run sync-banks -- --bank=bchile                  # dry run, no envía nada
 *   npm run sync-banks -- --bank=bchile --confirm
 *   npm run sync-banks -- --bank=bchile --from=2026-09-01 --to=2026-09-26 --confirm
 *   npm run sync-banks -- --bank=bchile --complete --confirm   # habilita reconciliación
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline';

import bchile from './vendor/open-banking-chile/src/banks/bchile.js';
import type {
  AccountBalance, BankMovement, CreditCardBalance, ScrapeResult,
} from './vendor/open-banking-chile/src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LAST_RUN = join(HERE, '.last-run.json');
const TZ = 'America/Santiago';

/**
 * Lee de .env.local SOLO estas variables, y nada más.
 *
 * Deliberadamente no se usa dotenv: cargar el archivo completo metería
 * SUPABASE_SERVICE_ROLE_KEY en el entorno de un proceso que maneja claves bancarias y que
 * ejecuta código de scraping de terceros. Este proceso no necesita acceso a la base —
 * escribe a través de /api/track/bank — así que no debe tener con qué.
 */
const ALLOWED_ENV = ['BANK_INGEST_TOKEN', 'FNA_BASE_URL', 'CHROME_PATH'] as const;

function loadEnv() {
  for (const candidate of [join(process.cwd(), '.env.local'), join(HERE, '..', '.env.local')]) {
    if (!existsSync(candidate)) continue;
    // El BOM y los CRLF no son paranoia: en Windows, `>>` de PowerShell 5 escribe UTF-16 y
    // el .env.local de esa copia ya tiene BOM. Sin limpiarlos, la primera variable del archivo
    // no calzaría el regex y el fallo sería "falta BANK_INGEST_TOKEN" sin ninguna pista.
    const raw = readFileSync(candidate, 'utf8').replace(/^\uFEFF/, '');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, key, rawValue] = m;
      if (!(ALLOWED_ENV as readonly string[]).includes(key)) continue;
      if (process.env[key]) continue; // lo que ya viene del entorno gana
      process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
    }
    return;
  }
}

loadEnv();

// Los bancos bloquean la cuenta tras intentos fallidos de login, y un selector roto se le
// parece bastante desde su lado. El upstream recomienda máximo una corrida por hora.
const MIN_MINUTES_BETWEEN_RUNS = 30;

const SCRAPERS = { bchile } as const;
type BankId = keyof typeof SCRAPERS;

// ─── Argumentos ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

// Dry run es el default y --confirm es obligatorio para enviar, igual que prune-metrics.ts.
const confirm = args.includes('--confirm');
const headful = args.includes('--headful');
const screenshots = args.includes('--screenshots');
const complete = args.includes('--complete');

// ─── Fechas, sin dependencias ────────────────────────────────────────────────────────

/** Hoy en Santiago, como yyyy-MM-dd. en-CA formatea ISO, así que no hace falta date-fns. */
function todayInSantiago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function daysAgo(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── Redacción ───────────────────────────────────────────────────────────────────────

const RUT_RE = /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/g;

/**
 * Todo lo que sale por consola pasa por acá.
 *
 * El objeto de opciones del scraper contiene `rut` y `password`, así que un
 * console.log(options) o un JSON.stringify de un error que lo envuelva filtraría las dos
 * cosas. El RUT importa aparte porque es identificador nacional y credencial de login.
 */
function redact(s: string, secrets: string[]): string {
  let out = s;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
  }
  return out.replace(RUT_RE, '[rut]').replace(/\d{6,}/g, '[redacted]');
}

// ─── Credenciales ────────────────────────────────────────────────────────────────────

function ask(question: string, hidden: boolean): Promise<string> {
  process.stdout.write(question);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // Silencia el eco por completo: la pregunta ya se imprimió arriba a mano.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
  }
  return new Promise(resolve => {
    rl.question('', answer => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

// ─── Límite de frecuencia ────────────────────────────────────────────────────────────

type LastRuns = Record<string, string>;

function readLastRuns(): LastRuns {
  if (!existsSync(LAST_RUN)) return {};
  try { return JSON.parse(readFileSync(LAST_RUN, 'utf8')) as LastRuns; } catch { return {}; }
}

function assertRateLimit(bank: BankId) {
  const last = readLastRuns()[bank];
  if (!last) return;
  const minutes = (Date.now() - new Date(last).getTime()) / 60_000;
  if (minutes < MIN_MINUTES_BETWEEN_RUNS) {
    const wait = Math.ceil(MIN_MINUTES_BETWEEN_RUNS - minutes);
    console.error(
      `La última corrida de ${bank} fue hace ${Math.floor(minutes)} min. Espera ${wait} min.\n` +
      `  Los bancos bloquean la cuenta tras logins repetidos, y no vale la pena el riesgo.`,
    );
    process.exit(1);
  }
}

function recordRun(bank: BankId) {
  writeFileSync(LAST_RUN, JSON.stringify({ ...readLastRuns(), [bank]: new Date().toISOString() }, null, 2));
}

// ─── Mapeo al contrato de la app ─────────────────────────────────────────────────────
//
// Cada colector adapta su fuente al payload de src/lib/bank-types.ts. Lo que NO se hace acá
// es decidir identidad, fechas ni deduplicación: eso vive en el servidor, en un solo lugar,
// para que una fuente nueva (Cloud Run, una API oficial) no tenga que replicarlo.

const MASK_RE = /\*{2,4}\d{3,4}/;

const extractMask = (label?: string): string | null => label?.match(MASK_RE)?.[0] ?? null;

function accountKind(label: string): 'checking' | 'savings' | 'line_of_credit' {
  if (/ahorro/i.test(label)) return 'savings';
  if (/l[íi]nea/i.test(label)) return 'line_of_credit';
  return 'checking';
}

const movement = (m: BankMovement) => ({
  date: m.date,
  description: m.description,
  amount: m.amount,
  balance: m.balance ?? null,
  source: m.source,
  owner: m.owner ?? null,
  card: extractMask(m.card ?? undefined),
  installments: m.installments ?? null,
  totalAmount: m.totalAmount ?? null,
});

function mapAccount(a: AccountBalance, win: { from: string; to: string; complete: boolean }) {
  const label = a.label ?? 'Cuenta';
  return {
    kind: accountKind(label),
    label,
    mask: extractMask(label),
    currency: 'CLP' as const,
    balance: a.balance ?? null,
    window: win,
    movements: a.movements.map(movement),
  };
}

function mapCard(c: CreditCardBalance, win: { from: string; to: string; complete: boolean }) {
  const movements = (c.movements ?? []).map(movement);
  return {
    kind: 'credit_card' as const,
    label: c.label,
    mask: extractMask(c.label),
    currency: 'CLP' as const,
    balance: null,
    window: win,
    movements,
    credit: {
      nationalUsed: c.national?.used ?? null,
      nationalAvailable: c.national?.available ?? null,
      nationalTotal: c.national?.total ?? null,
      internationalUsed: c.international?.used ?? null,
      internationalAvailable: c.international?.available ?? null,
      internationalTotal: c.international?.total ?? null,
      internationalCurrency: (c.international?.currency as 'USD' | 'EUR' | undefined) ?? null,
      billingPeriod: c.billingPeriod ?? null,
      nextBillingDate: c.nextBillingDate ?? null,
      nextDueDate: c.nextDueDate ?? null,
      periodExpenses: c.periodExpenses ?? null,
      statementBillingDate: c.lastStatement?.billingDate ?? null,
      statementBilledAmount: c.lastStatement?.billedAmount ?? null,
      statementDueDate: c.lastStatement?.dueDate ?? null,
      statementMinimum: c.lastStatement?.minimumPayment ?? null,
    },
    // El banco entrega los no facturados como un listado completo en una sola llamada, así
    // que ese conjunto es autoritativo y habilita el reemplazo del anterior. Es lo que evita
    // que un movimiento deje un duplicado al pasar de no facturado a facturado.
    unbilledAuthoritative: movements.some(m => m.source === 'credit_card_unbilled'),
  };
}

// ─── Resumen redactado ───────────────────────────────────────────────────────────────

function printSummary(payload: ReturnType<typeof buildPayload>, secrets: string[]) {
  console.log(`\nBanco: ${payload.bank}   cuentas: ${payload.accounts.length}`);
  for (const a of payload.accounts) {
    const dates = a.movements.map(m => m.date).sort();
    const range = dates.length ? `${dates[0]} … ${dates[dates.length - 1]}` : 'sin movimientos';
    const total = a.movements.reduce((s, m) => s + m.amount, 0);
    console.log(
      `  ${a.kind.padEnd(14)} ${(a.mask ?? '—').padEnd(9)} ` +
      `${String(a.movements.length).padStart(4)} mov  ${range}`,
    );
    console.log(
      `${' '.repeat(4)}saldo=${a.balance ?? '—'}  neto=${total.toFixed(0)}  ` +
      `ventana=${a.window.from}..${a.window.to} complete=${a.window.complete}`,
    );
    console.log(`${' '.repeat(4)}${redact(a.label, secrets)}`);
  }
}

function buildPayload(bank: BankId, result: ScrapeResult, win: { from: string; to: string; complete: boolean }) {
  return {
    bank,
    scrapedAt: new Date().toISOString(),
    success: result.success,
    error: result.error ?? null,
    accounts: [
      ...(result.accounts ?? []).map(a => mapAccount(a, win)),
      ...(result.creditCards ?? []).map(c => mapCard(c, win)),
    ],
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────────────

async function main() {
  const bank = (getArg('bank') ?? '') as BankId;
  if (!SCRAPERS[bank]) {
    console.error(`Uso: --bank=<${Object.keys(SCRAPERS).join('|')}> [--from=yyyy-MM-dd] [--to=yyyy-MM-dd]`);
    console.error('     [--complete] [--confirm] [--headful] [--screenshots]');
    process.exit(1);
  }

  const today = todayInSantiago();
  const to = getArg('to') ?? today;
  const from = getArg('from') ?? daysAgo(to, 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    console.error('Las fechas deben ser yyyy-MM-dd.');
    process.exit(1);
  }
  if (from > to) {
    console.error('--from no puede ser posterior a --to.');
    process.exit(1);
  }

  assertRateLimit(bank);

  // `complete` es opt-in y por default false, porque el scraper no expone si agotó la
  // paginación del banco. Declarar una ventana completa habilita la reconciliación, y
  // reconciliar sobre una ventana truncada marcaría como desaparecida historia que sí
  // existe. Solo pásalo cuando hayas comparado el conteo con lo que muestra el banco.
  const win = { from, to, complete };
  if (complete) {
    console.log('⚠  --complete: la ventana se declara completa y el servidor va a reconciliar.');
  }

  const url = process.env.FNA_BASE_URL ?? 'http://localhost:3000';
  const token = process.env.BANK_INGEST_TOKEN;
  if (confirm && !token) {
    console.error('Falta BANK_INGEST_TOKEN en el entorno para poder enviar.');
    process.exit(1);
  }

  const rut = await ask('RUT (12345678-9): ', false);
  const password = await ask('Clave de internet: ', true);
  const secrets = [password, rut];
  if (!rut || !password) {
    console.error('RUT y clave son obligatorios.');
    process.exit(1);
  }

  console.log(`\nConectando con ${SCRAPERS[bank].name}…`);
  console.log('Si el banco pide clave dinámica, apruébala en tu app cuando aparezca.\n');

  recordRun(bank);

  let result: ScrapeResult;
  try {
    result = await SCRAPERS[bank].scrape({
      rut,
      password,
      chromePath: getArg('chrome') ?? process.env.CHROME_PATH,
      saveScreenshots: screenshots,
      headful,
      onProgress: step => console.log(`  ${redact(step, secrets)}`),
    });
  } catch (e) {
    // El error del scraper puede envolver el objeto de opciones, que contiene la clave.
    console.error(`\nEl scraper falló: ${redact(e instanceof Error ? e.message : String(e), secrets)}`);
    process.exit(1);
  }

  const payload = buildPayload(bank, result, win);

  if (!result.success) {
    console.error(`\nEl scrape no tuvo éxito: ${redact(result.error ?? 'sin detalle', secrets)}`);
    if (!confirm) process.exit(1);
    // Con --confirm se envía igual: registrar la corrida fallida es justamente lo que permite
    // que /gastos muestre "falló hace 2 horas" en vez de quedarse callado.
  } else {
    printSummary(payload, secrets);
  }

  if (!confirm) {
    console.log('\n[DRY RUN — no se envió nada]  Agrega --confirm para escribir en la base.');
    return;
  }

  const res = await fetch(`${url}/api/track/bank`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`\nLa ingesta falló (${res.status}): ${text.slice(0, 800)}`);
    process.exit(1);
  }
  console.log(`\n${text}`);
}

main().catch(e => {
  // Sin `secrets` en alcance acá, así que se redacta lo genérico y nada más.
  console.error('Error fatal:', redact(e instanceof Error ? e.message : String(e), []));
  process.exit(1);
});
