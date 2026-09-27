/**
 * Sonda de MercadoPago. No escribe nada en la base: responde UNA pregunta.
 *
 * ¿El reporte oficial "Todas las transacciones" contiene tus gastos, o solo cobros?
 *
 * La API de MercadoPago está diseñada para vendedores conciliando cobros: las columnas del
 * reporte son PAYMENT_METHOD, FEE_AMOUNT, SETTLEMENT_NET_AMOUNT, INSTALLMENTS, ORDER_ID. La
 * documentación no promete que las transferencias recibidas, las recargas, los pagos de
 * servicios ni las compras en Mercado Libre aparezcan ahí. Para una cuenta personal el reporte
 * podría venir casi vacío, y construir el colector antes de saberlo sería construir sobre una
 * suposición.
 *
 * Imprime un RESUMEN agregado: cuántas filas, qué tipos de transacción, rango de fechas y
 * totales. Nunca una transacción individual.
 *
 *   npm run probe-mp                 # últimos 30 días
 *   npm run probe-mp -- --days=90
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'https://api.mercadopago.com';

// Igual que el colector: solo las variables que esta sonda necesita, nunca el archivo completo.
const ALLOWED_ENV = ['MP_ACCESS_TOKEN'] as const;

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

const args = process.argv.slice(2);
const days = Number(args.find(a => a.startsWith('--days='))?.slice(7) ?? 30);

const token = process.env.MP_ACCESS_TOKEN;
if (!token) {
  console.error('Falta MP_ACCESS_TOKEN en .env.local.');
  console.error('  Se obtiene en mercadopago.cl/developers → Tus integraciones → tu aplicación');
  console.error('  → Credenciales de producción. Empieza con APP_USR-.');
  process.exit(1);
}
if (token.startsWith('TEST-')) {
  console.error('Ese token es de PRUEBA (TEST-). Los datos reales necesitan el de producción.');
  process.exit(1);
}

async function mp(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

/** Las respuestas de error de MP traen el motivo; vale imprimirlo, no lleva datos financieros. */
async function explain(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  return `HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ''}`;
}

/** CSV con separador configurable y comillas. Suficiente para contar y agrupar. */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (line: string) => line.split(sep).map(c => c.replace(/^"|"$/g, '').trim());
  return { headers: split(lines[0]), rows: lines.slice(1).map(split) };
}

async function main() {
  const end = new Date();
  const begin = new Date(end.getTime() - days * 86_400_000);
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

  console.log(`Sondeando MercadoPago, últimos ${days} días (${iso(begin)} … ${iso(end)})\n`);

  // 1. La configuración dice si la cuenta tiene el reporte habilitado.
  const cfg = await mp('/v1/account/settlement_report/config');
  console.log(`1. config → ${cfg.ok ? 'ok' : await explain(cfg)}`);
  if (cfg.ok) {
    const json = await cfg.json().catch(() => null) as Record<string, unknown> | null;
    if (json) console.log(`   campos: ${Object.keys(json).join(', ')}`);
  }

  // 2. Pedir el reporte. Es asíncrono: 202 significa aceptado, no listo.
  const create = await mp('/v1/account/settlement_report', {
    method: 'POST',
    body: JSON.stringify({ begin_date: iso(begin), end_date: iso(end) }),
  });
  console.log(`2. crear → ${create.status === 202 ? '202 aceptado' : await explain(create)}`);
  if (create.status === 203) {
    console.log('   203: la llamada estaba bien formada pero el reporte no se creó. Reintentar.');
  }

  // 3. Esperar a que aparezca en la lista. Sin sleep en bucle cerrado: 5 intentos espaciados.
  let fileName: string | null = null;
  for (let attempt = 1; attempt <= 10; attempt++) {
    await new Promise(r => setTimeout(r, 6000));
    const list = await mp('/v1/account/settlement_report/list');
    if (!list.ok) { console.log(`3. lista → ${await explain(list)}`); break; }
    const items = await list.json().catch(() => []) as Array<{ file_name?: string; begin_date?: string }>;
    if (Array.isArray(items) && items.length > 0) {
      fileName = items[items.length - 1]?.file_name ?? items[0]?.file_name ?? null;
      console.log(`3. lista → ${items.length} reporte(s), usando el más reciente`);
      break;
    }
    if (attempt === 10) console.log('3. lista → vacía después de 60s');
  }
  if (!fileName) { console.log('\nSin archivo que descargar. La sonda termina acá.'); return; }

  // 4. Descargar y resumir. Nunca se imprime una transacción individual.
  const dl = await mp(`/v1/account/settlement_report/${fileName}`);
  if (!dl.ok) { console.log(`4. descargar → ${await explain(dl)}`); return; }

  const { headers, rows } = parseCsv(await dl.text());
  console.log(`4. descargar → ok, ${rows.length} fila(s)\n`);
  console.log(`   columnas: ${headers.join(', ')}`);

  if (rows.length === 0) {
    console.log('\n   El reporte está VACÍO. Es la respuesta que importaba: para esta cuenta el');
    console.log('   reporte de liquidaciones no contiene movimientos, así que no sirve para gastos.');
    return;
  }

  const col = (name: string) => headers.indexOf(name);
  const idxType = col('TRANSACTION_TYPE');
  const idxAmount = col('TRANSACTION_AMOUNT');
  const idxDate = col('TRANSACTION_DATE');

  if (idxType >= 0) {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r[idxType] ?? '?', (counts.get(r[idxType] ?? '?') ?? 0) + 1);
    console.log(`\n   tipos de transacción:`);
    for (const [t, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(4)} × ${t}`);
  }
  if (idxDate >= 0) {
    const dates = rows.map(r => r[idxDate]).filter(Boolean).sort();
    console.log(`\n   rango: ${dates[0]} … ${dates[dates.length - 1]}`);
  }
  if (idxAmount >= 0) {
    const nums = rows.map(r => Number(String(r[idxAmount]).replace(',', '.'))).filter(n => Number.isFinite(n));
    const neg = nums.filter(n => n < 0).reduce((s, n) => s + n, 0);
    const pos = nums.filter(n => n > 0).reduce((s, n) => s + n, 0);
    console.log(`   montos: negativos=${neg.toFixed(0)}  positivos=${pos.toFixed(0)}`);
    console.log(`\n   Si los negativos son 0, este reporte solo trae cobros y no tus gastos.`);
  }
}

main().catch(e => {
  console.error('Error fatal:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
