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

import bchile from './vendor/open-banking-chile/src/banks/bchile.js';
import santander from './vendor/open-banking-chile/src/banks/santander.js';
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

/**
 * Lo que de verdad bloquea una cuenta bancaria son los INTENTOS FALLIDOS, no la frecuencia.
 *
 * Banco de Chile bloquea la Clave Internet al tercer intento fallido, y Santander usa el mismo
 * estandar de 3. Es un contador de contrasenas equivocadas, no de logins exitosos: mandando
 * siempre la clave correcta, no hay numero de corridas que se acerque a ese umbral.
 *
 * La version anterior de esto esperaba 30 minutos entre corridas CUALESQUIERA, citando el
 * README de upstream — que lo afirma en prosa, sin fuente, con un "puede", y sin una sola linea
 * de codigo que lo implemente. Hacia esperar por un riesgo inexistente y no cubria el real.
 *
 * Ahora son dos guardas distintas:
 *   - Dos logins fallidos seguidos frenan el banco. Se corta en 2 para dejar el tercer intento
 *     —el que bloquea— en tus manos y no en las de un selector roto.
 *   - Un minimo corto entre corridas, solo para atajar un bucle accidental. No pretende evadir
 *     la deteccion de bots: Akamai Bot Manager y BioCatch puntuan la sesion por huella y
 *     comportamiento, no por cada cuanto corres.
 */
const MIN_MINUTES_BETWEEN_RUNS = 5;
const MAX_CONSECUTIVE_LOGIN_FAILURES = 2;

/** Mensajes con los que el scraper reporta que el banco rechazo las credenciales. */
const LOGIN_FAILURE_PATTERNS = [
  'Error del banco',
  'No se encontró campo de clave',
  'No se encontró campo de RUT',
  'Timeout esperando aprobación de 2FA',
];

const isLoginFailure = (error: string) => LOGIN_FAILURE_PATTERNS.some(p => error.includes(p));

/**
 * `edwards` está vendorizado pero NO registrado, a propósito.
 *
 * Edwards es una marca de Banco de Chile y, en esta cuenta, el mismo producto: `bchile` reporta
 * "Found 1 products" y Edwards muestra una sola cuenta. Como son bancos distintos para el
 * esquema, sus `external_key` difieren y correr los dos crearía DOS cuentas con los mismos
 * movimientos duplicados — y nada los deduplicaría, porque la identidad se deriva por banco.
 *
 * `bchile` además domina: 35 movimientos desde el 13-08 contra 20 desde el 01-09, y entrega la
 * máscara real de la cuenta, que Edwards no da. De paso, el saldo de $50.000 que leyó Edwards
 * confirma que el 0 de `bchile` era falso.
 *
 * Para reactivarlo —por ejemplo si el portal de Banco de Chile se rompe— basta agregarlo acá y
 * decidir primero qué hacer con la cuenta duplicada.
 */
const SCRAPERS = { bchile, santander } as const;
type BankId = keyof typeof SCRAPERS;

// ─── Argumentos ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

/**
 * Toda bandera desconocida es un error, y se detecta ANTES de pedir credenciales.
 *
 * Ignorarla en silencio es lo que hacía antes, y el costo real quedó claro: escribir
 * `--comfirm` en vez de `--confirm` gastaba un login completo contra el banco, 30 minutos de
 * throttle, y terminaba en un dry run que parecía una corrida normal. Con una bandera de por
 * medio entre "no escribir nada" y "escribir en la base", adivinar la intención no corresponde.
 */
const KNOWN_FLAGS = ['--complete', '--confirm', '--headful', '--screenshots', '--debug', '--manual'];
const KNOWN_OPTS = ['--bank', '--from', '--to', '--chrome'];

function assertKnownArgs() {
  const unknown = args.filter(a => {
    if (KNOWN_FLAGS.includes(a)) return false;
    const name = a.split('=')[0];
    return !(a.includes('=') && KNOWN_OPTS.includes(name));
  });
  if (unknown.length === 0) return;

  for (const bad of unknown) {
    // Sugerencia por distancia de edición simple: casi siempre es una letra cambiada.
    const name = bad.split('=')[0];
    const near = [...KNOWN_FLAGS, ...KNOWN_OPTS].find(k => {
      if (Math.abs(k.length - name.length) > 1) return false;
      let diff = 0;
      for (let i = 0; i < Math.max(k.length, name.length); i++) if (k[i] !== name[i]) diff++;
      return diff <= 2;
    });
    console.error(`Bandera desconocida: ${bad}${near ? `  ¿quisiste decir ${near}?` : ''}`);
  }
  console.error(`\nValidas: ${[...KNOWN_OPTS.map(o => o + '=…'), ...KNOWN_FLAGS].join(' ')}`);
  process.exit(1);
}

assertKnownArgs();

// Dry run es el default y --confirm es obligatorio para enviar, igual que prune-metrics.ts.
const confirm = args.includes('--confirm');
const headful = args.includes('--headful');
const screenshots = args.includes('--screenshots');
const complete = args.includes('--complete');
const debug = args.includes('--debug');
/**
 * Navegación a mano. El scraper inicia sesión y te entrega el navegador; tú llegas a la pantalla
 * de movimientos y el interceptor captura la respuesta del banco. Sirve cuando los selectores
 * del portal están desactualizados —que es lo primero que envejece en un scraper— pero sus
 * endpoints siguen funcionando. Implica ventana visible, obviamente.
 */
const manual = args.includes('--manual');

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

/**
 * Lectura de credenciales sin readline.
 *
 * readline en modo terminal manda códigos de cursor (`\x1b[1G`, `\x1b[0J`) DIRECTO al stream,
 * no a través de `_writeToOutput`, así que limpia la línea y se come el prompt que uno acaba
 * de imprimir: el usuario termina escribiendo su clave a ciegas. Encima, crear una interfaz
 * por pregunta pierde líneas por lectura adelantada. Ninguno de los dos problemas existe
 * leyendo el stream a mano, y es poco código.
 *
 * Dos caminos explícitos: terminal real en modo raw, o entrada redirigida leída por líneas
 * —esto último para poder probar todo el flujo sin teclear nada.
 */
async function ask(question: string, hidden: boolean): Promise<string> {
  process.stdout.write(question);
  const answer = process.stdin.isTTY ? await readFromTty(hidden) : await readFromPipe();
  return answer.trim();
}

function readFromTty(hidden: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let buf = '';

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stdout.write('\n');
          return resolve(buf);
        }
        if (ch === '\u0003') {              // Ctrl+C: en modo raw hay que manejarlo a mano
          cleanup();
          process.stdout.write('\n');
          return reject(new Error('Cancelado.'));
        }
        if (ch === '\u007f' || ch === '\b') {
          if (buf.length) {
            buf = buf.slice(0, -1);
            if (!hidden) process.stdout.write('\b \b');
          }
          continue;
        }
        if (ch < ' ') continue;             // el resto de los controles se ignora
        buf += ch;
        // La clave no se eco NUNCA, ni como asteriscos: el largo también es información.
        if (!hidden) process.stdout.write(ch);
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  });
}

// La entrada redirigida se lee completa una vez y se reparte por líneas. Esperar el EOF acá
// es correcto: si viene de una tubería, ya está todo disponible.
let pipedLines: string[] | null = null;
let pipedIndex = 0;

async function readFromPipe(): Promise<string> {
  if (!pipedLines) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    pipedLines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
  }
  if (pipedIndex >= pipedLines.length) {
    // Sin esto la promesa quedaría colgada y el proceso terminaría con código 0 sin hacer
    // nada: un fallo que parece que el programa nunca corrió.
    throw new Error('La entrada se agotó antes de responder todas las preguntas.');
  }
  const line = pipedLines[pipedIndex++];
  process.stdout.write('\n');
  return line;
}

// ─── Límite de frecuencia ────────────────────────────────────────────────────────────

interface RunRecord { at: string; loginFailures: number }
type LastRuns = Record<string, RunRecord>;

function readLastRuns(): LastRuns {
  if (!existsSync(LAST_RUN)) return {};
  try {
    const raw = JSON.parse(readFileSync(LAST_RUN, 'utf8')) as Record<string, unknown>;
    const out: LastRuns = {};
    for (const [bank, value] of Object.entries(raw)) {
      // El formato viejo guardaba solo la marca de tiempo como string.
      if (typeof value === 'string') out[bank] = { at: value, loginFailures: 0 };
      else if (value && typeof value === 'object') out[bank] = value as RunRecord;
    }
    return out;
  } catch { return {}; }
}

function writeLastRuns(runs: LastRuns) {
  writeFileSync(LAST_RUN, JSON.stringify(runs, null, 2));
}

function assertRateLimit(bank: BankId) {
  const last = readLastRuns()[bank];
  if (!last) return;

  // La guarda que importa: el banco bloquea al tercer intento fallido.
  if (last.loginFailures >= MAX_CONSECUTIVE_LOGIN_FAILURES) {
    console.error(
      `${bank}: ${last.loginFailures} intentos de login fallidos seguidos.\n` +
      `  El banco bloquea la clave al tercero, asi que este se detiene antes.\n` +
      `  Entra por el sitio del banco a mano para confirmar que tu clave sigue buena;\n` +
      `  despues borra collector/.last-run.json para reiniciar el contador.`,
    );
    process.exit(1);
  }

  const minutes = (Date.now() - new Date(last.at).getTime()) / 60_000;
  if (minutes < MIN_MINUTES_BETWEEN_RUNS) {
    console.error(
      `La ultima corrida de ${bank} fue hace ${Math.floor(minutes)} min. ` +
      `Espera ${Math.ceil(MIN_MINUTES_BETWEEN_RUNS - minutes)} min.`,
    );
    process.exit(1);
  }
}

function recordRun(bank: BankId) {
  const runs = readLastRuns();
  runs[bank] = { at: new Date().toISOString(), loginFailures: runs[bank]?.loginFailures ?? 0 };
  writeLastRuns(runs);
}

/** Suma o reinicia el contador de fallos de login segun como termino la corrida. */
function recordOutcome(bank: BankId, error: string | null) {
  const runs = readLastRuns();
  const previous = runs[bank]?.loginFailures ?? 0;
  const failures = error && isLoginFailure(error) ? previous + 1 : 0;
  runs[bank] = { at: runs[bank]?.at ?? new Date().toISOString(), loginFailures: failures };
  writeLastRuns(runs);

  if (failures > 0) {
    console.log(`  (login fallido ${failures} de ${MAX_CONSECUTIVE_LOGIN_FAILURES + 1} antes del bloqueo del banco)`);
  }
}

/**
 * Deshace el registro de la corrida.
 *
 * `recordRun` se llama ANTES del scrape, a propósito: si el proceso muere a mitad de camino,
 * el registro ya está escrito y un reintento inmediato queda frenado. Pero eso castiga los
 * fallos que nunca tocaron el banco —sobre todo "no se encontró Chrome"—, dejando 30 minutos
 * de espera por cero intentos de login. Lo que el límite protege son los logins fallidos, y
 * esos solo existen después de que el navegador arranca.
 *
 * Los mensajes que se buscan acá vienen de nuestra propia copia de browser.ts, así que
 * comparar texto es aceptable: no dependen de lo que devuelva el banco.
 */
const PRE_BANK_FAILURES = [
  'No se encontró Chrome',
  'Failed to launch the browser',
  'requiere modo headful',
];

function unrecordRun(bank: BankId, error: string) {
  if (!PRE_BANK_FAILURES.some(f => error.includes(f))) return;
  const runs = readLastRuns();
  delete runs[bank];
  writeLastRuns(runs);
  console.log('  (el navegador nunca arrancó, así que esto no cuenta para el límite de 30 min)');
}

// ─── Mapeo al contrato de la app ─────────────────────────────────────────────────────
//
// Cada colector adapta su fuente al payload de src/lib/bank-types.ts. Lo que NO se hace acá
// es decidir identidad, fechas ni deduplicación: eso vive en el servidor, en un solo lugar,
// para que una fuente nueva (Cloud Run, una API oficial) no tenga que replicarlo.

const MASK_RE = /\*{2,4}\d{3,4}/;

/**
 * Los montos del banco llegan como STRING, aunque la interfaz del scraper los declare
 * `number`: la cartola de Banco de Chile manda `"monto":"50000"` y `"saldo":"0"`.
 * TypeScript no valida en runtime, así que el string viaja intacto hasta el payload y el zod
 * de la ruta rechaza el lote entero con "expected number, received string".
 *
 * `Math.abs("50000")` funciona por coerción y por eso el monto sí salía bien, pero
 * `Math.abs("1.234.567")` da NaN: el punto es separador de miles en Chile. Acá se normaliza
 * explícitamente —punto = miles, coma = decimales— en vez de depender de la coerción.
 *
 * Devuelve null en vez de 0 ante algo no parseable: un 0 inventado se confunde con un monto
 * real de cero, y en el caso del saldo sería un dato falso.
 */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;

  const cleaned = v.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * La máscara de una cuenta o tarjeta, y el label ya enmascarado.
 *
 * Banco de Chile entrega la máscara hecha ("Cuenta Fan ****1089"), pero Santander entrega el
 * número COMPLETO: "Cuenta Corriente 0 001 00 92731 4". Eso no se guarda. No es un PAN de
 * tarjeta, pero un número de cuenta completo en una columna de texto es justo el tipo de dato
 * que este diseño evita, y no aporta nada: para identidad bastan los últimos cuatro dígitos,
 * que además se mantienen estables si el banco reformatea el texto.
 *
 * Devuelve el label con el número ya reemplazado por la máscara, para que el número crudo no
 * llegue nunca al payload ni a la consola.
 */
function maskAccountLabel(raw?: string): { label: string; mask: string | null } {
  const label = (raw ?? '').trim();
  if (!label) return { label: 'Cuenta', mask: null };

  // Ya viene enmascarado por el banco.
  const existing = label.match(MASK_RE)?.[0];
  if (existing) return { label, mask: existing };

  // Un número de cuenta, posiblemente con espacios, puntos o guiones: "0 001 00 92731 4".
  const numeric = label.match(/[\d][\d\s.-]{5,}/)?.[0];
  if (!numeric) return { label, mask: null };

  const digits = numeric.replace(/\D/g, '');
  if (digits.length < 4) return { label: label.replace(numeric, '').trim(), mask: null };

  const mask = `****${digits.slice(-4)}`;
  return { label: label.replace(numeric, mask).replace(/\s+/g, ' ').trim(), mask };
}

const extractMask = (label?: string): string | null => label?.match(MASK_RE)?.[0] ?? null;

function accountKind(label: string): 'checking' | 'savings' | 'line_of_credit' {
  if (/ahorro/i.test(label)) return 'savings';
  if (/l[íi]nea/i.test(label)) return 'line_of_credit';
  return 'checking';
}

const movement = (m: BankMovement) => ({
  date: m.date,
  description: m.description,
  // `?? 0` solo para el monto: si no se pudo leer, el movimiento existe y la ruta lo va a
  // rechazar por el zod, que es lo correcto — mejor un lote rechazado que un monto inventado.
  amount: toNumber(m.amount) ?? Number.NaN,
  balance: toNumber(m.balance),
  source: m.source,
  owner: m.owner ?? null,
  card: extractMask(m.card ?? undefined),
  installments: m.installments ?? null,
  totalAmount: m.totalAmount ?? null,
});

function mapAccount(a: AccountBalance, win: { from: string; to: string; complete: boolean }) {
  const { label, mask } = maskAccountLabel(a.label);
  return {
    kind: accountKind(label),
    label,
    mask,
    currency: 'CLP' as const,
    balance: toNumber(a.balance),
    window: win,
    movements: a.movements.map(movement),
  };
}

function mapCard(c: CreditCardBalance, win: { from: string; to: string; complete: boolean }) {
  const movements = (c.movements ?? []).map(movement);
  const { label, mask } = maskAccountLabel(c.label);
  return {
    kind: 'credit_card' as const,
    label,
    mask,
    currency: 'CLP' as const,
    balance: null,
    window: win,
    movements,
    credit: {
      nationalUsed: toNumber(c.national?.used),
      nationalAvailable: toNumber(c.national?.available),
      nationalTotal: toNumber(c.national?.total),
      internationalUsed: toNumber(c.international?.used),
      internationalAvailable: toNumber(c.international?.available),
      internationalTotal: toNumber(c.international?.total),
      internationalCurrency: (c.international?.currency as 'USD' | 'EUR' | undefined) ?? null,
      billingPeriod: c.billingPeriod ?? null,
      nextBillingDate: c.nextBillingDate ?? null,
      nextDueDate: c.nextDueDate ?? null,
      periodExpenses: toNumber(c.periodExpenses),
      statementBillingDate: c.lastStatement?.billingDate ?? null,
      statementBilledAmount: toNumber(c.lastStatement?.billedAmount),
      statementDueDate: c.lastStatement?.dueDate ?? null,
      statementMinimum: toNumber(c.lastStatement?.minimumPayment),
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
  // Si ninguna cuenta trae saldo, decirlo explícitamente: un "—" repetido en cada línea no
  // distingue "el banco no lo entregó" de "se leyó y se perdió en el camino".
  if (payload.accounts.length > 0 && payload.accounts.every(a => a.balance === null)) {
    console.log('  (ninguna cuenta trae saldo; con --debug el log dice si el banco lo entregó)');
  }
  for (const a of payload.accounts) {
    // dd-mm-yyyy ordenado como texto da un rango sin sentido ("01-09 … 31-08"), porque compara
    // el día antes del mes. Se ordena por la forma ISO.
    const dates = a.movements
      .map(m => m.date.replace(/^(\d{2})-(\d{2})-(\d{4})$/, '$3-$2-$1'))
      .sort();
    const range = dates.length ? `${dates[0]} … ${dates[dates.length - 1]}` : 'sin movimientos';
    // El neto solo no dice nada: en una cuenta de paso, cargos y abonos se cancelan y da 0,
    // que se confunde con "no se leyó ningún monto". Separados, la diferencia es obvia.
    const cargos = a.movements.filter(m => m.amount < 0).reduce((s, m) => s + m.amount, 0);
    const abonos = a.movements.filter(m => m.amount > 0).reduce((s, m) => s + m.amount, 0);
    const total = cargos + abonos;
    // Un monto en cero casi nunca es real: es la señal de que el banco renombró un campo del
    // API y el parser lo leyó como ausente. Vale la pena que salte a la vista.
    const zeros = a.movements.filter(m => !m.amount || Number.isNaN(m.amount)).length;
    console.log(
      `  ${a.kind.padEnd(14)} ${(a.mask ?? '—').padEnd(9)} ` +
      `${String(a.movements.length).padStart(4)} mov  ${range}`,
    );
    console.log(
      `${' '.repeat(4)}saldo=${a.balance ?? '—'}  ` +
      `cargos=${cargos.toFixed(0)}  abonos=${abonos.toFixed(0)}  neto=${total.toFixed(0)}`,
    );
    console.log(
      `${' '.repeat(4)}ventana=${a.window.from}..${a.window.to} complete=${a.window.complete}`,
    );
    if (zeros) {
      console.log(`${' '.repeat(4)}⚠  ${zeros} de ${a.movements.length} movimientos con monto 0 — revisa con --debug`);
    }
    console.log(`${' '.repeat(4)}${redact(a.label, secrets)}`);
  }
}

const toIso = (ddmmyyyy: string) => ddmmyyyy.replace(/^(\d{2})-(\d{2})-(\d{4})$/, '$3-$2-$1');

/**
 * La ventana que cubre una cuenta, cuando no se pidió un rango explícito.
 *
 * El scraper de Banco de Chile no acepta fechas: pide la cartola y pagina hasta donde el banco
 * le deje, así que el rango que realmente cubrió es el de los datos que trajo. Declarar una
 * ventana fija de 30 días atrás era mentir en la dirección peligrosa: la primera corrida trajo
 * movimientos desde el 13-08 con una ventana que empezaba el 27-08, y la ruta habría descartado
 * doce días de historia real por caer "fuera de la ventana declarada".
 *
 * `complete` sigue en false salvo que se pase --complete: cubrir un rango no es lo mismo que
 * haber agotado la paginación del banco, y solo lo segundo justifica reconciliar.
 */
function deriveWindow(
  movements: Array<{ date: string }>,
  requested: { from: string; to: string; complete: boolean },
  explicit: boolean,
): { from: string; to: string; complete: boolean } {
  if (explicit || movements.length === 0) return requested;
  const dates = movements.map(m => toIso(m.date)).sort();
  return { from: dates[0], to: dates[dates.length - 1], complete: requested.complete };
}

function buildPayload(
  bank: BankId,
  result: ScrapeResult,
  win: { from: string; to: string; complete: boolean },
  explicit: boolean,
) {
  const accounts = (result.accounts ?? []).map(a => {
    const mapped = mapAccount(a, win);
    return { ...mapped, window: deriveWindow(mapped.movements, win, explicit) };
  });
  const cards = (result.creditCards ?? []).map(c => {
    const mapped = mapCard(c, win);
    return { ...mapped, window: deriveWindow(mapped.movements, win, explicit) };
  });

  return {
    bank,
    scrapedAt: new Date().toISOString(),
    success: result.success,
    error: result.error ?? null,
    accounts: [...accounts, ...cards],
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────────────

async function main() {
  const bank = (getArg('bank') ?? '') as BankId;
  if (!SCRAPERS[bank]) {
    console.error(`Uso: --bank=<${Object.keys(SCRAPERS).join('|')}> [--from=yyyy-MM-dd] [--to=yyyy-MM-dd]`);
    console.error('     [--complete] [--confirm] [--headful] [--screenshots] [--debug]');
    console.error('     [--manual]  inicia sesión y te entrega el navegador para navegar tú');
    process.exit(1);
  }

  const today = todayInSantiago();
  const explicitRange = getArg('from') !== undefined || getArg('to') !== undefined;
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
      headful: headful || manual,
      onProgress: step => console.log(`  ${redact(step, secrets)}`),
      ...(manual ? {
        onPause: async (message: string) => {
          console.log(`\n  ${message}`);
          await ask('  Cuando estés listo, presiona Enter: ', false);
        },
      } : {}),
    });
  } catch (e) {
    // El error del scraper puede envolver el objeto de opciones, que contiene la clave.
    const msg = redact(e instanceof Error ? e.message : String(e), secrets);
    console.error(`\nEl scraper falló: ${msg}`);
    recordOutcome(bank, msg);
    unrecordRun(bank, msg);
    process.exit(1);
  }

  const payload = buildPayload(bank, result, win, explicitRange);

  if (!result.success) {
    const failure = redact(result.error ?? 'sin detalle', secrets);
    console.error(`\nEl scrape no tuvo éxito: ${failure}`);
    recordOutcome(bank, failure);
    unrecordRun(bank, failure);
    if (!confirm) process.exit(1);
    // Con --confirm se envía igual: registrar la corrida fallida es justamente lo que permite
    // que /gastos muestre "falló hace 2 horas" en vez de quedarse callado.
  } else {
    // Login exitoso: el contador vuelve a cero.
    recordOutcome(bank, null);
    printSummary(payload, secrets);
  }

  if (debug && result.debug) {
    // Redactado, pero igual puede contener descripciones de movimientos y saldos: es para
    // mirar en pantalla, no para pegar en ninguna parte.
    console.log('\n─── debug del scraper ───');
    console.log(redact(result.debug, secrets));
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
