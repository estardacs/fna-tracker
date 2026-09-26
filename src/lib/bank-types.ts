/**
 * El contrato entre un colector y /api/track/bank.
 *
 * Está duplicado a propósito: nada en src/ importa desde collector/, y nada en collector/
 * importa desde src/. El límite entre las dos mitades es la forma de este payload, no un
 * módulo compartido. Por eso mañana el colector puede pasar a correr en Cloud Run, o ser
 * reemplazado por un cliente de API oficial, sin tocar la app.
 *
 * Cada colector adapta su fuente a estas estructuras. Lo que NO hace ningún colector es
 * decidir identidad, fechas ni deduplicación: eso vive solo en src/lib/bank-service.ts.
 */

export const BANKS = [
  'falabella', 'bice', 'santander', 'edwards', 'scotiabank', 'bchile',
  'bci', 'itau', 'bestado', 'cencosud', 'bancosecurity', 'mercadopago',
] as const;
export type Bank = (typeof BANKS)[number];

export const ACCOUNT_KINDS = [
  'checking', 'savings', 'credit_card', 'line_of_credit', 'wallet',
] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const MOVEMENT_SOURCES = [
  'account', 'credit_card_unbilled', 'credit_card_billed',
] as const;
export type MovementSource = (typeof MOVEMENT_SOURCES)[number];

export const CURRENCIES = ['CLP', 'USD', 'UF'] as const;
export type Currency = (typeof CURRENCIES)[number];

/**
 * La ventana que el colector declara haber cubierto para una cuenta.
 *
 * `complete` es el campo más importante del payload entero. Es la diferencia entre "traje
 * todo lo que hay entre estas dos fechas" y "traje lo que alcancé". La ruta se niega a
 * marcar cualquier fila como desaparecida cuando es false, porque una ventana parcial más un
 * camino de borrado es exactamente cómo se destruye historia real: si el scraper solo
 * obtuvo la página 1, todo lo de la página 2 parecería haber dejado de existir.
 *
 * `from` y `to` son días completos en formato yyyy-MM-dd, hora de Santiago.
 */
export interface SyncWindow {
  from: string;
  to: string;
  complete: boolean;
}

/** Un movimiento, tal como lo entrega el banco. Las fechas vienen en dd-mm-yyyy porque así
 *  las emite el scraper; convertirlas es trabajo de la ruta, no del colector. */
export interface PayloadMovement {
  date: string;
  description: string;
  amount: number;
  balance?: number | null;
  source: MovementSource;
  owner?: 'titular' | 'adicional' | null;
  card?: string | null;
  installments?: string | null;
  totalAmount?: number | null;
}

/** Datos de cupo y facturación de una tarjeta de crédito. Todo opcional: los bancos
 *  entregan distintos subconjuntos y algunos no entregan nada. */
export interface PayloadCreditInfo {
  nationalUsed?: number | null;
  nationalAvailable?: number | null;
  nationalTotal?: number | null;
  internationalUsed?: number | null;
  internationalAvailable?: number | null;
  internationalTotal?: number | null;
  internationalCurrency?: 'USD' | 'EUR' | null;
  billingPeriod?: string | null;
  nextBillingDate?: string | null;
  nextDueDate?: string | null;
  periodExpenses?: number | null;
  statementBillingDate?: string | null;
  statementBilledAmount?: number | null;
  statementDueDate?: string | null;
  statementMinimum?: number | null;
}

export interface PayloadAccount {
  kind: AccountKind;
  /** Texto del banco, mutable. No se usa para identidad si hay `mask`. */
  label: string;
  /** Solo máscara, nunca el número completo: "****8335". */
  mask?: string | null;
  currency?: Currency;
  balance?: number | null;
  window: SyncWindow;
  movements: PayloadMovement[];
  credit?: PayloadCreditInfo | null;
  /**
   * true cuando el colector leyó el listado completo de no facturados de esta tarjeta.
   * Habilita el reemplazo autoritativo: lo no facturado muta y no tiene valor histórico,
   * así que se retira el conjunto anterior antes de escribir el nuevo. Sin esta señal, un
   * movimiento que pasa de no facturado a facturado dejaría un duplicado para siempre.
   */
  unbilledAuthoritative?: boolean;
}

export interface BankSyncPayload {
  bank: Bank;
  /** ISO. Cuándo terminó el scrape, según el colector. */
  scrapedAt: string;
  /** false cuando el scrape falló. La ruta entonces solo registra la corrida fallida y no
   *  toca ninguna transacción ni ningún saldo. */
  success: boolean;
  /** Mensaje de error del scraper. La ruta lo sanitiza antes de guardarlo. */
  error?: string | null;
  accounts: PayloadAccount[];
}

/** Lo que /api/track/bank responde. */
export interface BankSyncResult {
  runId: string;
  status: 'ok' | 'partial' | 'failed';
  accountsSeen: number;
  txInserted: number;
  txUpdated: number;
  txMissing: number;
  warnings: string[];
}
