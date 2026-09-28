'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil } from 'lucide-react';
import { money } from './format';
import { cn } from '@/lib/utils';

/**
 * Anotar el saldo de una cuenta.
 *
 * Existe porque hay saldos que no se pueden leer —el de MercadoPago no sale por API y en su web
 * va dentro del HTML— pero su valor no es ser un reemplazo del scraper. Cada anotacion es el
 * punto desde el que se calcula el saldo de los dias siguientes, y al anotar de nuevo la
 * diferencia contra lo calculado mide si el feed de movimientos esta completo.
 */
export default function BalanceAnchor({
  accountId,
  currency,
  compact,
}: {
  accountId: string;
  currency: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  async function save() {
    setError('');
    const res = await fetch('/api/gastos/balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, balance: value }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Error desconocido' }));
      setError(body.error ?? 'No se pudo guardar');
      return;
    }
    setOpen(false);
    setValue('');
    start(() => router.refresh());
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400 transition-colors',
          compact && 'mt-1',
        )}
      >
        <Pencil className="w-3 h-3" />
        anotar saldo
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1.5">
        <input
          autoFocus
          inputMode="numeric"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder={`saldo en ${currency}`}
          className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-gray-500"
        />
        <button
          onClick={() => void save()}
          disabled={pending || value.trim() === ''}
          className="px-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          <Check className="w-3.5 h-3.5 text-gray-300" />
        </button>
      </div>
      <p className="text-[10px] text-gray-600">
        Se acepta {money(1234567, currency)} o 1234567.
      </p>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
