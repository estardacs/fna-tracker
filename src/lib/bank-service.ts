/**
 * Toda la lógica de datos bancarios. Es el único módulo de src/ que importa
 * supabase-admin, y por lo tanto el único que puede leer o escribir las tablas bank_*.
 *
 * Acá vive lo que ningún colector decide: identidad de cuenta, parseo de fechas,
 * deduplicación y reconciliación. Un colector es un tubo que adapta su fuente al payload de
 * bank-types.ts; si esa lógica viviera del lado del colector, habría que replicarla en cada
 * fuente nueva y mantener un segundo lugar que conoce el esquema.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  ACCOUNT_KINDS, BANKS, CURRENCIES, MOVEMENT_SOURCES,
  type BankSyncPayload, type BankSyncResult, type PayloadAccount, type PayloadMovement,
} from '@/lib/bank-types';

// ─── Validación del payload ──────────────────────────────────────────────────────────
//
// Acá sí se usa zod, a diferencia del resto de las rutas del proyecto que hacen chequeos de
// presencia a mano. La razón es el lote: un solo campo malo tiene que rechazar el payload
// COMPLETO antes de escribir nada, porque una fecha mal leída envenena el dedup_key de forma
// permanente y no hay cómo distinguirla después de una transacción legítima.

// Solo máscaras. Si un cambio en el scraper empezara a emitir el número completo de tarjeta,
// el payload se rechaza acá, antes de la CHECK de la base.
const maskSchema = z.string().regex(/^\*{2,4}\d{3,4}$/, 'la máscara debe ser tipo ****1234');

const movementSchema = z.object({
  date: z.string(),
  description: z.string(),
  amount: z.number().finite(),
  balance: z.number().finite().nullish(),
  source: z.enum(MOVEMENT_SOURCES),
  owner: z.enum(['titular', 'adicional']).nullish(),
  card: maskSchema.nullish(),
  installments: z.string().nullish(),
  totalAmount: z.number().finite().nullish(),
});

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'se espera yyyy-MM-dd');

const accountSchema = z.object({
  kind: z.enum(ACCOUNT_KINDS),
  label: z.string().min(1),
  mask: maskSchema.nullish(),
  currency: z.enum(CURRENCIES).default('CLP'),
  balance: z.number().finite().nullish(),
  window: z.object({ from: isoDay, to: isoDay, complete: z.boolean() }),
  movements: z.array(movementSchema),
  credit: z.object({
    nationalUsed: z.number().finite().nullish(),
    nationalAvailable: z.number().finite().nullish(),
    nationalTotal: z.number().finite().nullish(),
    internationalUsed: z.number().finite().nullish(),
    internationalAvailable: z.number().finite().nullish(),
    internationalTotal: z.number().finite().nullish(),
    internationalCurrency: z.enum(['USD', 'EUR']).nullish(),
    billingPeriod: z.string().nullish(),
    nextBillingDate: z.string().nullish(),
    nextDueDate: z.string().nullish(),
    periodExpenses: z.number().finite().nullish(),
    statementBillingDate: z.string().nullish(),
    statementBilledAmount: z.number().finite().nullish(),
    statementDueDate: z.string().nullish(),
    statementMinimum: z.number().finite().nullish(),
  }).nullish(),
  unbilledAuthoritative: z.boolean().optional(),
});

export const payloadSchema = z.object({
  bank: z.enum(BANKS),
  scrapedAt: z.string(),
  success: z.boolean(),
  error: z.string().nullish(),
  accounts: z.array(accountSchema),
});

// ─── Fechas ──────────────────────────────────────────────────────────────────────────

const DDMMYYYY = /^(\d{2})-(\d{2})-(\d{4})$/;

/**
 * dd-mm-yyyy → yyyy-MM-dd, o lanza.
 *
 * El regex por sí solo acepta 31-02-2026, así que hace falta el round-trip. Y el mediodía
 * UTC en la construcción no es decorativo: con `new Date('2026-09-26')` obtendrías medianoche
 * UTC, que en Santiago es el día anterior a las 21:00 — un off-by-one en cada fila.
 * La columna es `date` justamente para que la zona horaria no participe.
 */
export function toIsoDate(raw: string): string {
  const m = DDMMYYYY.exec(raw.trim());
  if (!m) throw new Error(`fecha inválida: "${raw}" (se espera dd-mm-yyyy)`);
  const [, d, mo, y] = m;
  const dt = new Date(`${y}-${mo}-${d}T12:00:00Z`);
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCDate() !== Number(d) ||
    dt.getUTCMonth() + 1 !== Number(mo) ||
    dt.getUTCFullYear() !== Number(y)
  ) {
    throw new Error(`fecha inexistente: "${raw}"`);
  }
  return `${y}-${mo}-${d}`;
}

/** Igual que toIsoDate pero tolerante: los campos de facturación de las tarjetas son
 *  opcionales y un banco que deja de entregar uno no debería voltear el lote entero. */
function toIsoDateOrNull(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try { return toIsoDate(raw); } catch { return null; }
}

// ─── Identidad y deduplicación ───────────────────────────────────────────────────────

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Normalización mínima: trim, colapsar espacios, mayúsculas, quitar acentos.
 *
 * Deliberadamente NO se quitan sufijos de sucursal ni prefijos tipo "COMPRA EN". Normalizar
 * de más fusiona transacciones genuinamente distintas, y eso es irrecuperable: la fila
 * perdida no deja rastro. Un falso split, en cambio, se ve en la lista y se corrige. La
 * descripción cruda se guarda en su propia columna para poder revisar esta decisión después
 * sin volver al banco.
 */
export function normalizeDescription(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Identidad estable de una cuenta.
 *
 * Se prefiere la máscara sobre el label porque el banco cambia el texto sin avisar
 * ("Cuenta Corriente" → "Cta Corriente"), y con el label como identidad cada renombre
 * crearía una cuenta nueva y dejaría la anterior huérfana con toda su historia.
 */
export function buildExternalKey(bank: string, kind: string, mask?: string | null, label?: string): string {
  return mask
    ? sha256([bank, kind, mask].join('|'))
    : sha256([bank, kind, normalizeDescription(label ?? '')].join('|'));
}

/**
 * La clave de deduplicación: sha256 del subconjunto ESTABLE de un movimiento.
 *
 * Quedan fuera a propósito:
 *   source        — muta, de credit_card_unbilled a credit_card_billed
 *   balance        — muta, el banco re-renderiza el saldo corriente
 *   totalAmount    — derivable de las cuotas, y el banco lo reformatea
 *
 * `owner` queda DENTRO: titular vs adicional es estable por movimiento y es justo lo que
 * distingue dos cargos idénticos hechos por dos tarjetahabientes distintos el mismo día.
 */
export function buildDedupKey(
  accountId: string,
  postedDate: string,
  m: Pick<PayloadMovement, 'amount' | 'description' | 'card' | 'installments' | 'owner'>,
): string {
  return sha256([
    accountId,
    postedDate,
    m.amount.toFixed(2),
    normalizeDescription(m.description),
    m.card ?? '',
    m.installments ?? '',
    m.owner ?? '',
  ].join('|'));
}

// ─── Sanitización de errores ─────────────────────────────────────────────────────────

const RUT_RE = /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/g;

/**
 * Lo que se guarda en bank_sync_runs.error.
 *
 * El RUT es identificador nacional Y credencial de login, así que se elimina primero y de
 * forma específica; después cualquier corrida larga de dígitos (números de cuenta, tarjetas)
 * se tapa por si acaso. Nunca entra acá el debug log ni el screenshot del scraper.
 */
export function sanitizeError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw
    .replace(RUT_RE, '[rut]')
    .replace(/\d{6,}/g, '[redacted]')
    .slice(0, 500);
}

/** Comparación de tokens en tiempo constante, tolerante a largos distintos. */
export function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(sha256(given), 'hex');
  const b = Buffer.from(sha256(expected), 'hex');
  return timingSafeEqual(a, b);
}

// ─── Lectura paginada ────────────────────────────────────────────────────────────────

/**
 * PostgREST corta toda respuesta en 1000 filas y `.limit(10000)` no sube ese techo: es
 * `db-max-rows`, una configuración del servidor, y aplica también a service_role. Una
 * ventana de 90 días puede pasar las 1000 transacciones fácilmente, así que leer de una sola
 * query daría una reconciliación construida sobre datos truncados.
 *
 * El `.order('id')` como desempate es obligatorio: sin él, filas que comparten `posted_date`
 * se saltan o se duplican al cruzar el borde de una página.
 */
const PAGE = 1000;

interface ExistingTx {
  id: string;
  posted_date: string;
  dedup_key: string;
  occurrence: number;
  source: string;
  missing_since: string | null;
}

async function fetchExistingWindow(
  accountId: string, from: string, to: string,
): Promise<ExistingTx[]> {
  const out: ExistingTx[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('bank_transactions')
      .select('id, posted_date, dedup_key, occurrence, source, missing_since')
      .eq('account_id', accountId)
      .gte('posted_date', from)
      .lte('posted_date', to)
      .order('posted_date')
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`No se pudieron leer los movimientos existentes: ${error.message}`);
    out.push(...(data as ExistingTx[]));
    if (!data || data.length < PAGE) return out;
  }
}

// ─── Ingesta ─────────────────────────────────────────────────────────────────────────

const UPSERT_CHUNK = 500;

/** Punto de entrada único de /api/track/bank. */
export async function ingestBankSync(rawPayload: unknown): Promise<BankSyncResult> {
  const payload: BankSyncPayload = payloadSchema.parse(rawPayload) as BankSyncPayload;

  const { data: run, error: runErr } = await supabaseAdmin
    .from('bank_sync_runs')
    .insert({ bank: payload.bank, status: 'running' })
    .select('id')
    .single();
  if (runErr || !run) throw new Error(`No se pudo abrir la corrida: ${runErr?.message}`);
  const runId = run.id as string;

  // Un scrape fallido es un estado normal, no una excepción: se registra la corrida y no se
  // toca ninguna transacción ni ningún saldo. Es lo que hace que /gastos pueda mostrar
  // "falló hace 2 horas" en vez de una página en blanco.
  if (!payload.success) {
    await closeRun(runId, {
      status: 'failed',
      accountsSeen: 0, txInserted: 0, txUpdated: 0, txMissing: 0,
      error: sanitizeError(payload.error) ?? 'El scraper no reportó éxito.',
      raw: null,
    });
    return {
      runId, status: 'failed', accountsSeen: 0,
      txInserted: 0, txUpdated: 0, txMissing: 0,
      warnings: [],
    };
  }

  const totals = { inserted: 0, updated: 0, missing: 0 };
  const warnings: string[] = [];

  try {
    for (const account of payload.accounts) {
      const accountId = await resolveAccount(payload.bank, account);
      await writeSnapshot(accountId, runId, account);
      const res = await syncMovements(accountId, runId, account);
      totals.inserted += res.inserted;
      totals.updated += res.updated;
      totals.missing += res.missing;
      warnings.push(...res.warnings);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await closeRun(runId, {
      status: 'failed',
      accountsSeen: payload.accounts.length,
      txInserted: totals.inserted, txUpdated: totals.updated, txMissing: totals.missing,
      error: sanitizeError(msg),
      raw: null,
    });
    throw e;
  }

  // 'partial' cuando alguna cuenta no pudo declarar su ventana completa. No es un error: es
  // información que la UI muestra para que sepas que esa ventana no se reconcilió.
  const anyIncomplete = payload.accounts.some(a => !a.window.complete);
  const status = anyIncomplete ? 'partial' : 'ok';

  await closeRun(runId, {
    status,
    accountsSeen: payload.accounts.length,
    txInserted: totals.inserted, txUpdated: totals.updated, txMissing: totals.missing,
    error: null,
    // El ScrapeResult sin screenshot ni debug — ambos pueden contener saldos y el nombre del
    // titular. Solo se guarda la forma estructural, ya validada.
    raw: { bank: payload.bank, scrapedAt: payload.scrapedAt, accounts: payload.accounts.length },
  });

  return {
    runId, status,
    accountsSeen: payload.accounts.length,
    txInserted: totals.inserted, txUpdated: totals.updated, txMissing: totals.missing,
    warnings,
  };
}

async function closeRun(runId: string, f: {
  status: 'ok' | 'partial' | 'failed';
  accountsSeen: number; txInserted: number; txUpdated: number; txMissing: number;
  error: string | null; raw: unknown;
}) {
  const { error } = await supabaseAdmin.from('bank_sync_runs').update({
    finished_at: new Date().toISOString(),
    status: f.status,
    accounts_seen: f.accountsSeen,
    tx_inserted: f.txInserted,
    tx_updated: f.txUpdated,
    tx_missing: f.txMissing,
    error: f.error,
    raw_result: f.raw,
  }).eq('id', runId);
  if (error) console.error('[gastos] no se pudo cerrar la corrida:', error.message);
}

/** Busca o crea la cuenta por su identidad derivada, y refresca los campos mutables. */
async function resolveAccount(bank: string, a: PayloadAccount): Promise<string> {
  const externalKey = buildExternalKey(bank, a.kind, a.mask, a.label);

  const { data, error } = await supabaseAdmin
    .from('bank_accounts')
    .upsert({
      bank, kind: a.kind, label: a.label, mask: a.mask ?? null,
      currency: a.currency ?? 'CLP', external_key: externalKey,
      active: true, updated_at: new Date().toISOString(),
    }, { onConflict: 'bank,external_key' })
    .select('id')
    .single();

  if (error || !data) throw new Error(`No se pudo resolver la cuenta "${a.label}": ${error?.message}`);
  return data.id as string;
}

async function writeSnapshot(accountId: string, runId: string, a: PayloadAccount) {
  const c = a.credit ?? {};
  const { error } = await supabaseAdmin.from('bank_balance_snapshots').insert({
    account_id: accountId,
    sync_run_id: runId,
    balance: a.balance ?? null,
    currency: a.currency ?? 'CLP',
    nat_used: c.nationalUsed ?? null,
    nat_available: c.nationalAvailable ?? null,
    nat_total: c.nationalTotal ?? null,
    intl_used: c.internationalUsed ?? null,
    intl_available: c.internationalAvailable ?? null,
    intl_total: c.internationalTotal ?? null,
    intl_currency: c.internationalCurrency ?? null,
    billing_period: c.billingPeriod ?? null,
    next_billing_date: toIsoDateOrNull(c.nextBillingDate),
    next_due_date: toIsoDateOrNull(c.nextDueDate),
    period_expenses: c.periodExpenses ?? null,
    stmt_billing_date: toIsoDateOrNull(c.statementBillingDate),
    stmt_billed_amount: c.statementBilledAmount ?? null,
    stmt_due_date: toIsoDateOrNull(c.statementDueDate),
    stmt_minimum: c.statementMinimum ?? null,
    raw: a.credit ?? null,
  });
  if (error) throw new Error(`No se pudo guardar el saldo de "${a.label}": ${error.message}`);
}

interface SyncCounts { inserted: number; updated: number; missing: number; warnings: string[] }

async function syncMovements(
  accountId: string, runId: string, a: PayloadAccount,
): Promise<SyncCounts> {
  const warnings: string[] = [];
  const { from, to, complete } = a.window;

  // Las fechas se parsean TODAS antes de escribir cualquier cosa. Si una sola falla, el lote
  // completo se cae: una fecha mal leída produce un dedup_key que nunca más va a calzar, y
  // esa fila queda duplicada para siempre en cada sincronización futura.
  const parsed = a.movements.map(m => ({ m, postedDate: toIsoDate(m.date) }));

  const outside = parsed.filter(p => p.postedDate < from || p.postedDate > to);
  if (outside.length) {
    // Nunca se escribe fuera de la ventana declarada: es lo que mantiene acotado el alcance
    // de la reconciliación.
    warnings.push(`${outside.length} movimiento(s) fuera de la ventana declarada, ignorados`);
  }
  const inWindow = parsed.filter(p => p.postedDate >= from && p.postedDate <= to);

  const existing = await fetchExistingWindow(accountId, from, to);
  const existingIds = new Set(existing.map(e => `${e.posted_date}|${e.dedup_key}|${e.occurrence}`));

  // ── Modo A: reemplazo autoritativo de lo no facturado ──
  //
  // Lo no facturado muta y no tiene valor histórico, así que se retira el conjunto anterior
  // antes de escribir el nuevo. Esto es lo que resuelve limpio el paso no facturado →
  // facturado: cuando el movimiento se factura llega con otro dedup_key, pero su copia no
  // facturada ya fue retirada, así que no queda duplicado. Sin esto habría que emparejar
  // pending con settled a mano, que es una heurística que falla con propinas y ajustes.
  //
  // Nota: esto NO exige `complete`. Lo no facturado es autoritativo por su propia naturaleza
  // —el banco lo entrega como un listado completo en una sola llamada, no paginado— y es
  // independiente de la ventana de fechas de los movimientos ya asentados. Además el riesgo
  // se autocorrige: si un scrape parcial retirara filas que siguen existiendo en el banco, la
  // próxima sincronización las vuelve a insertar y les limpia `missing_since`.
  // El sello se guarda para poder contar después, tras el upsert, cuántas de las retiradas
  // quedaron realmente fuera. Casi todas vuelven en el mismo payload: sin ese recuento,
  // `tx_missing` mostraría un retiro en cada corrida y la UI diría que desapareció algo que
  // sigue perfectamente ahí.
  const unbilledStamp = new Date().toISOString();
  let retiredUnbilled = 0;
  if (a.kind === 'credit_card' && a.unbilledAuthoritative) {
    const { data, error } = await supabaseAdmin
      .from('bank_transactions')
      .update({ missing_since: unbilledStamp, updated_at: unbilledStamp })
      .eq('account_id', accountId)
      .eq('source', 'credit_card_unbilled')
      .is('missing_since', null)
      .select('id');
    if (error) throw new Error(`No se pudo retirar lo no facturado: ${error.message}`);
    retiredUnbilled = data?.length ?? 0;
  }

  // ── Agrupar por día y asignar occurrence ──
  //
  // Dos cafés idénticos el mismo día son dos filas legítimas. El banco no da id, así que la
  // única forma de distinguirlas es contarlas: la n-ésima aparición de una tupla idéntica es
  // la occurrence n. El orden del payload solo decide cuál de dos filas indistinguibles se
  // numera 1 y cuál 2, lo que no cambia el conjunto resultante; lo que importa es el conteo.
  //
  // Se separa en dos caminos en vez de un solo upsert, y la razón es concreta: el upsert de
  // supabase-js se traduce a ON CONFLICT DO UPDATE SET <todas las columnas del payload>, sin
  // forma de excluir ninguna. Con un único upsert, `first_seen_run` se sobreescribiría en
  // cada sincronización y se perdería para siempre el registro de cuándo viste el movimiento
  // por primera vez.
  //
  // Cuál es cuál ya lo sabemos por `existingIds`, así que no cuesta una query extra.
  const newRows: Record<string, unknown>[] = [];
  const touchRows: Record<string, unknown>[] = [];
  const stampNow = new Date().toISOString();
  const seen = new Map<string, number>();

  for (const { m, postedDate } of inWindow) {
    const dedupKey = buildDedupKey(accountId, postedDate, m);
    const groupKey = `${postedDate}|${dedupKey}`;
    const occurrence = (seen.get(groupKey) ?? 0) + 1;
    seen.set(groupKey, occurrence);

    const identity = {
      account_id: accountId,
      posted_date: postedDate,
      dedup_key: dedupKey,
      occurrence,
    };

    // Solo lo mutable. `amount`, `currency`, `owner`, `card` e `installments` son parte de la
    // clave (o se derivan de ella), y `first_seen_run` es historia que no se toca.
    const mutable = {
      source: m.source,              // no facturado → facturado
      balance_after: m.balance ?? null, // el banco re-renderiza el saldo corriente
      description: m.description,    // mismo dedup_key, pero puede cambiar el formato
      raw: m,
      missing_since: null,           // si estaba marcada y reapareció, se limpia
      last_seen_run: runId,
      updated_at: stampNow,
    };

    // Columnas que la clave ya fija (o que son estables por cuenta). Van igual en los dos
    // caminos, y no porque haga falta actualizarlas: Postgres valida los NOT NULL sobre la
    // tupla propuesta ANTES de detectar el conflicto, así que un upsert que omita `amount`
    // falla con "null value in column amount" incluso cuando la fila ya existe y el
    // ON CONFLICT iba a hacer UPDATE. Sobreescribirlas es inocuo: `amount`, `owner`, `card`
    // e `installments` son parte del dedup_key, así que por construcción son idénticas.
    const keyed = {
      amount: m.amount,
      currency: a.currency ?? 'CLP',
      owner: m.owner ?? null,
      card: m.card ?? null,
      installments: m.installments ?? null,
    };

    if (existingIds.has(`${postedDate}|${dedupKey}|${occurrence}`)) {
      // La única columna que se excluye de verdad. `first_seen_run` es el registro de cuándo
      // viste el movimiento por primera vez, y un upsert completo lo sobreescribiría en cada
      // sincronización.
      touchRows.push({ ...identity, ...keyed, ...mutable });
    } else {
      newRows.push({ ...identity, ...keyed, ...mutable, first_seen_run: runId });
    }
  }

  const inserted = newRows.length;
  const updated = touchRows.length;

  // Ambos van por upsert con el mismo conflict target; la única diferencia es
  // `first_seen_run`.
  for (const [rows, what] of [[newRows, 'nuevos'], [touchRows, 'existentes']] as const) {
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const { error } = await supabaseAdmin
        .from('bank_transactions')
        .upsert(rows.slice(i, i + UPSERT_CHUNK), {
          onConflict: 'account_id,posted_date,dedup_key,occurrence',
          // Explícito: con true, el paso no facturado → facturado se saltaría en silencio,
          // que es precisamente lo que esta cláusula existe para capturar.
          ignoreDuplicates: false,
        });
      if (error) throw new Error(`No se pudieron escribir los movimientos ${what}: ${error.message}`);
    }
  }

  // Recuento neto del modo A: las que el payload volvió a traer ya tienen missing_since en
  // NULL otra vez, así que solo quedan marcadas las que de verdad dejaron de existir.
  if (retiredUnbilled > 0) {
    const { count, error } = await supabaseAdmin
      .from('bank_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('source', 'credit_card_unbilled')
      .eq('missing_since', unbilledStamp);
    if (error) throw new Error(`No se pudo contar lo retirado: ${error.message}`);
    retiredUnbilled = count ?? 0;
  }

  // ── Reconciliación ──
  //
  // Solo cuando la ventana se declara completa. Con `complete: false` el colector no pudo
  // verificar que trajo todo, y marcar como desaparecido lo que simplemente no alcanzó a
  // leer sería borrar historia real — el peor modo de falla de todo este sistema.
  let missing = retiredUnbilled;
  if (complete) {
    const payloadIds = new Set(
      [...newRows, ...touchRows].map(r => `${r.posted_date}|${r.dedup_key}|${r.occurrence}`),
    );
    const gone = existing.filter(
      e => !e.missing_since && !payloadIds.has(`${e.posted_date}|${e.dedup_key}|${e.occurrence}`),
    );
    if (gone.length) {
      const stamp = new Date().toISOString();
      for (let i = 0; i < gone.length; i += UPSERT_CHUNK) {
        const ids = gone.slice(i, i + UPSERT_CHUNK).map(g => g.id);
        const { error } = await supabaseAdmin
          .from('bank_transactions')
          .update({ missing_since: stamp, updated_at: stamp })
          .in('id', ids);
        if (error) throw new Error(`No se pudo marcar lo desaparecido: ${error.message}`);
      }
      missing += gone.length;
    }
  } else {
    warnings.push(`ventana ${from}..${to} declarada incompleta: no se reconcilió nada`);
  }

  return { inserted, updated, missing, warnings };
}

// ─── Lectura para /gastos ─────────────────────────────────────────────────────────────

export interface SyncStatus {
  bank: string;
  status: 'running' | 'ok' | 'partial' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  accountsSeen: number;
  txInserted: number;
  txUpdated: number;
  txMissing: number;
  error: string | null;
}

export interface AccountView {
  id: string;
  bank: string;
  kind: string;
  label: string;
  mask: string | null;
  currency: string;
  balance: number | null;
  capturedAt: string | null;
  natUsed: number | null;
  natAvailable: number | null;
  natTotal: number | null;
  nextDueDate: string | null;
  periodExpenses: number | null;
}

export interface TransactionView {
  id: string;
  accountId: string;
  accountLabel: string;
  postedDate: string;
  amount: number;
  currency: string;
  description: string;
  source: string;
  card: string | null;
  installments: string | null;
}

export interface GastosOverview {
  syncs: SyncStatus[];
  accounts: AccountView[];
  transactions: TransactionView[];
}

/**
 * Todo lo que /gastos necesita, en tres consultas.
 *
 * Se llama SOLO desde el servidor y solo dentro de la rama autenticada de la página: una
 * visita sin la cookie de admin no debe llegar a consultar la base.
 */
export async function getGastosOverview(txLimit = 50): Promise<GastosOverview> {
  const [runsRes, accountsRes] = await Promise.all([
    // Pocos bancos, así que se traen las últimas corridas y se reduce a la más reciente por
    // banco en memoria, en vez de una consulta por banco.
    supabaseAdmin
      .from('bank_sync_runs')
      .select('bank, status, started_at, finished_at, accounts_seen, tx_inserted, tx_updated, tx_missing, error')
      .order('started_at', { ascending: false })
      .limit(60),
    supabaseAdmin
      .from('bank_accounts')
      .select('id, bank, kind, label, mask, currency')
      .eq('active', true)
      .order('bank')
      .order('label'),
  ]);

  if (runsRes.error) throw new Error(`No se pudieron leer las sincronizaciones: ${runsRes.error.message}`);
  if (accountsRes.error) throw new Error(`No se pudieron leer las cuentas: ${accountsRes.error.message}`);

  const seenBanks = new Set<string>();
  const syncs: SyncStatus[] = [];
  for (const r of runsRes.data ?? []) {
    if (seenBanks.has(r.bank)) continue;
    seenBanks.add(r.bank);
    syncs.push({
      bank: r.bank,
      status: r.status,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      accountsSeen: r.accounts_seen,
      txInserted: r.tx_inserted,
      txUpdated: r.tx_updated,
      txMissing: r.tx_missing,
      error: r.error,
    });
  }

  const accountRows = accountsRes.data ?? [];
  if (!accountRows.length) return { syncs, accounts: [], transactions: [] };

  const accountIds = accountRows.map(a => a.id);

  const [snapsRes, txRes] = await Promise.all([
    // Un snapshot por cuenta por corrida, así que se trae una tanda reciente y se toma el
    // primero de cada cuenta. Acotado y suficiente para "saldo actual".
    supabaseAdmin
      .from('bank_balance_snapshots')
      .select('account_id, captured_at, balance, nat_used, nat_available, nat_total, next_due_date, period_expenses')
      .in('account_id', accountIds)
      .order('captured_at', { ascending: false })
      .limit(400),
    supabaseAdmin
      .from('bank_transactions')
      .select('id, account_id, posted_date, amount, currency, description, source, card, installments')
      // Las filas retiradas no se muestran. No se borran nunca, solo se marcan.
      .is('missing_since', null)
      .order('posted_date', { ascending: false })
      .order('id')
      .limit(txLimit),
  ]);

  if (snapsRes.error) throw new Error(`No se pudieron leer los saldos: ${snapsRes.error.message}`);
  if (txRes.error) throw new Error(`No se pudieron leer los movimientos: ${txRes.error.message}`);

  const latest = new Map<string, NonNullable<typeof snapsRes.data>[number]>();
  for (const s of snapsRes.data ?? []) {
    if (!latest.has(s.account_id)) latest.set(s.account_id, s);
  }

  const accounts: AccountView[] = accountRows.map(a => {
    const s = latest.get(a.id);
    return {
      id: a.id, bank: a.bank, kind: a.kind, label: a.label, mask: a.mask, currency: a.currency,
      balance: s?.balance ?? null,
      capturedAt: s?.captured_at ?? null,
      natUsed: s?.nat_used ?? null,
      natAvailable: s?.nat_available ?? null,
      natTotal: s?.nat_total ?? null,
      nextDueDate: s?.next_due_date ?? null,
      periodExpenses: s?.period_expenses ?? null,
    };
  });

  const labels = new Map(accountRows.map(a => [a.id, a.mask ? `${a.label}` : a.label]));

  const transactions: TransactionView[] = (txRes.data ?? []).map(t => ({
    id: t.id,
    accountId: t.account_id,
    accountLabel: labels.get(t.account_id) ?? '—',
    postedDate: t.posted_date,
    amount: Number(t.amount),
    currency: t.currency,
    description: t.description,
    source: t.source,
    card: t.card,
    installments: t.installments,
  }));

  return { syncs, accounts, transactions };
}
