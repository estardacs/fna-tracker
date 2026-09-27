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

/** Candidatas: las del CSV de ejemplo de la documentación más algunas plausibles para gasto. */
const COLUMNS = (process.env.MP_COLUMNS ?? [
  'TRANSACTION_DATE', 'SOURCE_ID', 'EXTERNAL_REFERENCE', 'TRANSACTION_TYPE',
  'TRANSACTION_AMOUNT', 'TRANSACTION_CURRENCY', 'SETTLEMENT_NET_AMOUNT',
  'DESCRIPTION', 'PAYMENT_METHOD', 'PAYMENT_METHOD_TYPE', 'SETTLEMENT_DATE',
  'ORDER_ID', 'SITE', 'METADATA', 'USER_ID', 'FEE_AMOUNT', 'REAL_AMOUNT',
  'MONEY_RELEASE_DATE',
].join(',')).split(',');

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

  // 1. La configuración. Una cuenta que nunca generó un reporte no la tiene, y sin ella el
  //    POST del reporte también responde 404 — el segundo error es consecuencia del primero.
  let cfg = await mp('/v1/account/settlement_report/config');
  {
    const exists = cfg.ok;
    console.log(`1. config → ${exists ? 'existe, actualizando columnas' : 'no existe, creándola'}`);
    const created = await mp('/v1/account/settlement_report/config', {
      method: exists ? 'PUT' : 'POST',
      body: JSON.stringify({
        file_name_prefix: 'fna-tracker',
        // Los retiros son plata saliendo: sin esto el reporte omitiría justo parte del gasto.
        include_withdraw: true,
        display_timezone: 'GMT-03',
        header_language: 'es',
        // La API los exige. Las claves salen del CSV de ejemplo de la documentación; si alguna
        // no existe, el 400 la nombra y se ajusta.
        // Sin una columna descriptiva, una fila es "SETTLEMENT -12990" sin comercio, inútil
        // como registro de gasto. Se piden todas las candidatas del CSV de ejemplo más algunas
        // plausibles: si alguna no existe, el 400 la nombra y se descarta.
        columns: COLUMNS.map((key) => ({ key })),
        // Obligatorio, pero declararlo NO activa la generación automática: eso se prende
        // aparte con POST /schedule, que no tocamos.
        frequency: { hour: 0, type: 'monthly', value: 1 },
      }),
    });
    console.log(`   ${exists ? 'actualizar' : 'crear'} config → ${created.ok || created.status === 201 ? `${created.status} ok` : await explain(created)}`);
    cfg = await mp('/v1/account/settlement_report/config');
  }
  console.log(`1. config → ${cfg.ok ? 'ok' : await explain(cfg)}`);
  if (cfg.ok) {
    const json = await cfg.json().catch(() => null) as Record<string, unknown> | null;
    if (json) console.log(`   campos: ${Object.keys(json).join(', ')}`);
  }

  // 2. Pedir el reporte. Es asíncrono: 202 significa aceptado, no listo.
  // Se recuerda el instante del pedido: la lista acumula reportes de corridas anteriores, y
  // tomar el último del arreglo devolvía uno viejo, generado con otras columnas.
  const postedAt = Date.now();
  const create = await mp('/v1/account/settlement_report', {
    method: 'POST',
    body: JSON.stringify({ begin_date: iso(begin), end_date: iso(end) }),
  });
  console.log(`2. crear → ${create.status === 202 ? '202 aceptado' : await explain(create)}`);
  if (create.status === 404) {
    console.log('   404 acá suele significar que la cuenta no tiene el reporte habilitado.');
  }
  if (create.status === 203) {
    console.log('   203: la llamada estaba bien formada pero el reporte no se creó. Reintentar.');
  }

  // 3. Esperar a que aparezca en la lista. Sin sleep en bucle cerrado: 5 intentos espaciados.
  let fileName: string | null = null;
  for (let attempt = 1; attempt <= 40; attempt++) {
    await new Promise(r => setTimeout(r, 6000));
    const list = await mp('/v1/account/settlement_report/list');
    if (!list.ok) { console.log(`3. lista → ${await explain(list)}`); break; }
    const items = await list.json().catch(() => []) as Array<{ file_name?: string; begin_date?: string }>;
    if (Array.isArray(items) && items.length > 0) {
      // `file_name` existe como clave desde el principio pero llega vacío mientras el reporte
      // se genera: la señal de que está listo es que tenga valor, no que el item exista.
      // El más reciente POR FECHA DE CREACIÓN, y solo si es posterior al pedido.
      const fresh = (items as Array<Record<string, unknown>>)
        .filter(i => {
          const t = Date.parse(String(i.date_created ?? ''));
          return Number.isFinite(t) && t >= postedAt - 120_000;
        })
        .sort((a, b) => Date.parse(String(a.date_created)) - Date.parse(String(b.date_created)));

      const last = (fresh[fresh.length - 1] ?? {}) as Record<string, unknown>;
      const name = typeof last.file_name === 'string' && last.file_name ? last.file_name : null;
      const status = String(last.status ?? 'sin reporte nuevo aún');

      if (name) {
        fileName = name;
        console.log(`3. lista → listo tras ${attempt * 6}s (status=${status})`);
        break;
      }
      console.log(`   intento ${attempt}: ${items.length} reporte(s), status=${status}, aún sin archivo`);
    }
    if (attempt === 40) console.log("3. lista → vacía después de 4 min");
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
  // Sin descripción una fila es "SETTLEMENT -12990" sin comercio. Se mide CUÁNTAS la traen y
  // cuántas distintas hay; el contenido no se imprime.
  const idxDesc = col('DESCRIPTION');
  if (idxDesc >= 0) {
    const conTexto = rows.filter(r => (r[idxDesc] ?? '').trim() !== '');
    const distintas = new Set(conTexto.map(r => r[idxDesc])).size;
    console.log(`\n   DESCRIPTION: ${conTexto.length}/${rows.length} filas con texto, ${distintas} valores distintos`);
  } else {
    console.log('\n   DESCRIPTION: la columna no vino en el CSV');
  }

  // Si el reporte no describe, queda pedir el detalle del pago por SOURCE_ID. Esta comprobación
  // usa UNA fila y reporta qué campos trae y cuáles vienen con texto — nunca el contenido.
  const idxSource = col('SOURCE_ID');
  if (idxDesc >= 0 && idxSource >= 0) {
    const sinTexto = rows.every(r => (r[idxDesc] ?? '').trim() === '');
    const sample = rows.find(r => (r[idxSource] ?? '').trim() !== '')?.[idxSource];
    if (sinTexto && sample) {
      const det = await mp(`/v1/payments/${sample}`);
      if (!det.ok) {
        console.log(`\n   /v1/payments/{id} → ${await explain(det)}`);
      } else {
        const pago = await det.json().catch(() => null) as Record<string, unknown> | null;
        if (pago) {
          const conTexto = ['description', 'statement_descriptor', 'operation_type', 'payment_type_id']
            .filter(k => typeof pago[k] === 'string' && (pago[k] as string).trim() !== '');
          console.log(`\n   /v1/payments/{id} → ok, ${Object.keys(pago).length} campos`);
          console.log(`   campos con texto útil: ${conTexto.join(', ') || 'ninguno de los esperados'}`);
          const ordenNombre = (pago.order as Record<string, unknown> | undefined)?.id ? 'sí' : 'no';
          console.log(`   trae objeto order: ${ordenNombre}`);
        }
      }
    }
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
