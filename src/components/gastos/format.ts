/** Formato de plata para la UI. Los montos se guardan en numeric(14,2) porque las tarjetas
 *  reportan cupos internacionales en USD con centavos, pero en CLP no se muestran decimales. */
export function money(amount: number | null, currency = 'CLP'): string {
  if (amount === null) return '—';
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'CLP' ? 0 : 2,
  }).format(amount);
}

/** "hace 2 horas". Con clave dinámica de por medio, "hace 3 días" es un estado normal. */
export function relativeTime(iso: string | null): string {
  if (!iso) return 'nunca';
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return 'hace instantes';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  const days = Math.round(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

export function shortDate(isoDay: string): string {
  const [y, m, d] = isoDay.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

export const BANK_NAMES: Record<string, string> = {
  bchile: 'Banco de Chile',
  edwards: 'Banco Edwards',
  santander: 'Santander',
  falabella: 'Banco Falabella',
  bice: 'Banco BICE',
  scotiabank: 'Scotiabank',
  bci: 'BCI',
  itau: 'Itaú',
  bestado: 'BancoEstado',
  cencosud: 'Cencosud',
  bancosecurity: 'Banco Security',
  mercadopago: 'MercadoPago',
};

export const KIND_LABELS: Record<string, string> = {
  checking: 'Cuenta corriente',
  savings: 'Cuenta de ahorro',
  credit_card: 'Tarjeta de crédito',
  line_of_credit: 'Línea de crédito',
  wallet: 'Billetera',
};
