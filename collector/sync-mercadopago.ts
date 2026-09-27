/**
 * Colector de MercadoPago. Sin navegador, sin clave dinámica, sin credenciales bancarias.
 *
 * Es el único de los tres que podría correr desatendido en la nube: solo habla HTTPS contra
 * api.mercadopago.com con un token, así que no necesita Chrome ni un humano aprobando nada.
 *
 * Funciona en dos pasos porque el reporte solo no alcanza. La columna DESCRIPTION existe pero
 * MercadoPago la deja vacía en todas las filas, así que el reporte da el libro mayor —fecha,
 * monto, tipo, id del pago— y el comercio sale de GET /v1/payments/{SOURCE_ID}. Son ~3 filas
 * por día, de modo que una llamada por fila es barata.
 *
 *   npm run sync-mp                    # dry run de los últimos 30 días
 *   npm run sync-mp -- --days=90
 *   npm run sync-mp -- --confirm
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'https://api.mercadopago.com';
const TZ = 'America/Santiago';

const ALLOWED_ENV = ['MP_ACCESS_TOKEN', 'BANK_INGEST_TOKEN', 'FNA_BASE_URL'] as const;

function loadEnv() {
  for (const candidate of [join(process.cwd(), '.env.local'), join(HERE, '..', '.env.local')]) {
    if (!existsSync(candidate)) continue;
    const raw = readFileSync(candidate, 'utf8').replace(/^﻿/, '');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, key, value] = m;
      if (!(ALLOWED_ENV as readonly string[]).includes(key)) continue;
      if (!process.env[key]) process.env[key] = value.trim().replace(/^["']|["']$/g, '');
    }
    return;
  }
}
loadEnv();

// ─── Argumentos ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const KNOWN_FLAGS = ['--confirm', '--complete'];
const KNOWN_OPTS = ['--days', '--from', '--to'];

const unknown = args.filter(a =>
  !KNOWN_FLAGS.includes(a) && !(a.includes('=') && KNOWN_OPTS.includes(a.split('=')[0])));
if (unknown.length) {
  console.error(`Bandera desconocida: ${unknown.join(', ')}`);
  console.error(`Válidas: ${[...KNOWN_OPTS.map(o => o + '=…'), ...KNOWN_FLAGS].join(' ')}`);
  process.exit(1);
}

const getArg = (n: string) => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const confirm = args.includes('--confirm');
const complete = args.includes('--complete');
const days = Number(getArg('days') ?? 30);

const token = process.env.MP_ACCESS_TOKEN;
if (!token) {
  console.error('Falta MP_ACCESS_TOKEN en .env.local.');
  process.exit(1);
}
if (token.startsWith('TEST-')) {
  console.error('Ese token es de prueba (TEST-); no devuelve datos reales.');
  process.exit(1);
}

// ─── Cliente ─────────────────────────────────────────────────────────────────────────

const mp = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

const explain = async (r: Response) =>
  `HTTP ${r.status} ${r.statusText} — ${(await r.text().catch(() => '')).slice(0, 200)}`;

/**
 * Columnas comprobadas una por una contra la API. Una clave inválida hace fallar el POST con
 * 400 y `cause: []`, sin decir cuál, así que esta lista no se toca a ciegas.
 */
const COLUMNS = [
  'TRANSACTION_DATE', 'SOURCE_ID', 'EXTERNAL_REFERENCE', 'TRANSACTION_TYPE',
  'TRANSACTION_AMOUNT', 'TRANSACTION_CURRENCY', 'SETTLEMENT_NET_AMOUNT',
  'DESCRIPTION', 'PAYMENT_METHOD', 'PAYMENT_METHOD_TYPE', 'SETTLEMENT_DATE',
  'ORDER_ID', 'SITE', 'METADATA', 'USER_ID', 'FEE_AMOUNT', 'REAL_AMOUNT',
  'MONEY_RELEASE_DATE',
];

async function ensureConfig(): Promise<void> {
  const current = await mp('/v1/account/settlement_report/config');
  const body = JSON.stringify({
    file_name_prefix: 'fna-tracker',
    include_withdraw: true,          // los retiros son plata saliendo
    display_timezone: 'GMT-03',      // así TRANSACTION_DATE ya viene en hora de Santiago
    header_language: 'es',
    columns: COLUMNS.map(key => ({ key })),
    // Obligatorio, pero declararlo NO activa la generación automática: eso es POST /schedule.
    frequency: { hour: 0, type: 'monthly', value: 1 },
  });
  const res = await mp('/v1/account/settlement_report/config', {
    method: current.ok ? 'PUT' : 'POST',
    body,
  });
  if (!res.ok && res.status !== 201) throw new Error(`No se pudo configurar el reporte: ${await explain(res)}`);
}

interface ReportItem { file_name?: string; status?: string; date_created?: string }

async function generateReport(from: Date, to: Date): Promise<string> {
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const postedAt = Date.now();

  const create = await mp('/v1/account/settlement_report', {
    method: 'POST',
    body: JSON.stringify({ begin_date: iso(from), end_date: iso(to) }),
  });
  if (create.status !== 202) throw new Error(`No se pudo pedir el reporte: ${await explain(create)}`);

  // La lista acumula reportes de corridas anteriores, y `file_name` llega vacío mientras el
  // estado es `pending`. Tomar el último del arreglo bajaba uno viejo, generado con otras
  // columnas, así que se filtra por fecha de creación posterior al pedido.
  for (let attempt = 1; attempt <= 40; attempt++) {
    await new Promise(r => setTimeout(r, 6000));
    const list = await mp('/v1/account/settlement_report/list');
    if (!list.ok) continue;

    const items = await list.json().catch(() => []) as ReportItem[];
    const fresh = items
      .filter(i => {
        const t = Date.parse(String(i.date_created ?? ''));
        return Number.isFinite(t) && t >= postedAt - 120_000;
      })
      .sort((a, b) => Date.parse(String(a.date_created)) - Date.parse(String(b.date_created)));

    const last = fresh[fresh.length - 1];
    if (last?.file_name) {
      process.stdout.write(`  reporte listo tras ${attempt * 6}s\n`);
      return last.file_name;
    }
    if (attempt % 5 === 0) process.stdout.write(`  esperando… ${attempt * 6}s\n`);
  }
  throw new Error('El reporte no quedó listo en 4 minutos.');
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return { headers: [], rows: [] };
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (l: string) => l.split(sep).map(c => c.replace(/^"|"$/g, '').trim());
  return { headers: split(lines[0]), rows: lines.slice(1).map(split) };
}

/** El detalle del pago, que es de donde sale el comercio. Cachea por id y nunca tumba la
 *  corrida: si falla, el movimiento queda con su descripción genérica. */
const detailCache = new Map<string, string>();

async function describePayment(sourceId: string, fallback: string): Promise<string> {
  if (!sourceId) return fallback;
  const cached = detailCache.get(sourceId);
  if (cached !== undefined) return cached;

  let text = fallback;
  try {
    const res = await mp(`/v1/payments/${sourceId}`);
    if (res.ok) {
      const p = await res.json() as Record<string, unknown>;
      const candidates = [p.description, p.statement_descriptor]
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
      if (candidates[0]) text = candidates[0].trim();
    }
  } catch { /* la descripción es un lujo, no una razón para fallar */ }

  detailCache.set(sourceId, text);
  return text;
}

// ─── Main ────────────────────────────────────────────────────────────────────────────

function todayInSantiago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function main() {
  const to = getArg('to') ? new Date(`${getArg('to')}T23:59:59Z`) : new Date();
  const from = getArg('from')
    ? new Date(`${getArg('from')}T00:00:00Z`)
    : new Date(to.getTime() - days * 86_400_000);

  console.log(`MercadoPago — ${from.toISOString().slice(0, 10)} … ${to.toISOString().slice(0, 10)}\n`);

  await ensureConfig();
  const fileName = await generateReport(from, to);

  const dl = await mp(`/v1/account/settlement_report/${fileName}`);
  if (!dl.ok) throw new Error(`No se pudo descargar: ${await explain(dl)}`);

  const { headers, rows } = parseCsv(await dl.text());
  const col = (n: string) => headers.indexOf(n);
  const [iDate, iAmount, iType, iSource, iMethod, iCurrency] =
    ['TRANSACTION_DATE', 'TRANSACTION_AMOUNT', 'TRANSACTION_TYPE', 'SOURCE_ID', 'PAYMENT_METHOD', 'TRANSACTION_CURRENCY']
      .map(col);

  if (iDate < 0 || iAmount < 0) throw new Error(`El CSV no trae las columnas esperadas: ${headers.join(', ')}`);

  console.log(`  ${rows.length} fila(s); pidiendo descripciones…`);

  const movements = [];
  for (const r of rows) {
    const amount = Number(String(r[iAmount]).replace(',', '.'));
    if (!Number.isFinite(amount) || amount === 0) continue;

    // display_timezone=GMT-03 hace que la fecha ya venga en hora de Santiago, así que basta
    // tomar los primeros 10 caracteres. Convertir con Date la movería de día.
    const iso = String(r[iDate]).slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) continue;

    const generic = [r[iType], r[iMethod]].filter(Boolean).join(' · ') || 'MercadoPago';
    const description = await describePayment(String(r[iSource] ?? ''), generic);

    movements.push({
      date: `${m[3]}-${m[2]}-${m[1]}`,
      description,
      amount,
      balance: null,
      source: 'account' as const,
    });
  }

  const dates = movements.map(mv => mv.date.replace(/^(\d{2})-(\d{2})-(\d{4})$/, '$3-$2-$1')).sort();
  const currency = (rows[0]?.[iCurrency] ?? 'CLP') as 'CLP';

  const payload = {
    bank: 'mercadopago' as const,
    scrapedAt: new Date().toISOString(),
    success: true,
    accounts: [{
      kind: 'wallet' as const,
      label: 'MercadoPago',
      mask: null,
      currency,
      balance: null,
      window: {
        from: dates[0] ?? todayInSantiago(),
        to: dates[dates.length - 1] ?? todayInSantiago(),
        complete,
      },
      movements,
    }],
  };

  const cargos = movements.filter(mv => mv.amount < 0).reduce((s, mv) => s + mv.amount, 0);
  const abonos = movements.filter(mv => mv.amount > 0).reduce((s, mv) => s + mv.amount, 0);
  const conTexto = movements.filter(mv => !mv.description.includes(' · ')).length;

  console.log(`\n  ${movements.length} movimiento(s)  ${dates[0]} … ${dates[dates.length - 1]}`);
  console.log(`  cargos=${cargos.toFixed(0)}  abonos=${abonos.toFixed(0)}`);
  console.log(`  con descripción del comercio: ${conTexto}/${movements.length}`);
  console.log(`  ventana complete=${complete}`);

  if (!confirm) {
    console.log('\n[DRY RUN — no se envió nada]  Agrega --confirm para escribir en la base.');
    return;
  }

  const ingestToken = process.env.BANK_INGEST_TOKEN;
  if (!ingestToken) { console.error('Falta BANK_INGEST_TOKEN para enviar.'); process.exit(1); }

  const url = process.env.FNA_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${url}/api/track/bank`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ingestToken}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) { console.error(`\nLa ingesta falló (${res.status}): ${text.slice(0, 600)}`); process.exit(1); }
  console.log(`\n${text}`);
}

main().catch(e => {
  console.error('Error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
