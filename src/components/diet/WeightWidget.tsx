'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Scale, Check, X, Loader2, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WeightEntry {
  kg: number;
  date: string;
  daysAgo: number;
  bodyFatPct: number | null;
}

interface WeightWidgetProps {
  weight: WeightEntry | null;
  date: string;
  isOwner?: boolean;
}

export default function WeightWidget({ weight, date, isOwner = false }: WeightWidgetProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(weight?.kg.toFixed(1) ?? '');
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setInput(weight?.kg.toFixed(1) ?? '');
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 10);
    }
  }, [editing, weight?.kg]);

  const save = async () => {
    const kg = parseFloat(input.replace(',', '.'));
    if (isNaN(kg) || kg <= 0) { setEditing(false); return; }
    setSaving(true);
    try {
      await fetch('/api/health/weight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight_kg: kg, date }),
      });
      setEditing(false);
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => { setEditing(false); };

  const stale = weight && weight.daysAgo > 0;

  return (
    <div
      className={cn(
        'bg-gray-900/50 p-4 md:p-6 rounded-xl border transition-colors group h-full',
        editing
          ? 'border-purple-500/50 cursor-default'
          : 'border-gray-800 hover:border-gray-700 cursor-pointer'
      )}
      onClick={() => { if (!editing && isOwner) setEditing(true); }}
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-3 md:mb-4">
        <span className="text-gray-400 text-[10px] md:text-sm font-medium uppercase tracking-wider">Peso</span>
        <div className={cn(
          'p-1.5 md:p-2 rounded-lg transition-colors',
          editing ? 'bg-purple-500/20' : 'bg-gray-800/50 group-hover:bg-gray-800'
        )}>
          <Scale className={cn('w-4 h-4 md:w-5 md:h-5', editing ? 'text-purple-400' : 'text-purple-400')} />
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
          {/* Input row — styled like the value, no browser spinners */}
          <div className="flex items-baseline gap-2">
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') cancel();
              }}
              className={cn(
                'bg-transparent border-b-2 border-purple-500 text-2xl md:text-4xl font-bold',
                'tracking-tight text-gray-100 font-mono focus:outline-none',
                'w-28 pb-0.5 transition-colors',
                // Hide browser number spinners universally
                '[appearance:textfield]',
                '[&::-webkit-outer-spin-button]:appearance-none',
                '[&::-webkit-inner-spin-button]:appearance-none',
              )}
            />
            <span className="text-sm md:text-base text-gray-500 font-mono">kg</span>
          </div>

          {/* Action buttons — icon only, compact */}
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center justify-center w-8 h-8 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg transition-colors cursor-pointer shrink-0"
              title="Guardar (Enter)"
            >
              {saving
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Check className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={cancel}
              className="flex items-center justify-center w-8 h-8 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 rounded-lg transition-colors cursor-pointer shrink-0"
              title="Cancelar (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] text-gray-600 ml-1">Enter para guardar</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="flex items-baseline gap-2 mb-1">
            <span className={cn(
              'text-2xl md:text-4xl font-bold tracking-tight font-mono',
              stale ? 'text-gray-500' : 'text-gray-100'
            )}>
              {weight ? weight.kg.toFixed(1) : '—'}
            </span>
            {weight && (
              <span className={cn('text-sm', stale ? 'text-gray-600' : 'text-gray-500')}>kg</span>
            )}
            {/* Edit hint on hover — solo owner */}
            {isOwner && <Pencil className="w-3 h-3 text-gray-700 group-hover:text-gray-500 transition-colors ml-auto shrink-0 mb-0.5" />}
          </div>
          <div className="text-xs md:text-sm text-gray-500">
            {!weight && 'Toca para registrar'}
            {weight && !stale && (weight.bodyFatPct ? `${weight.bodyFatPct}% grasa` : 'registrado hoy')}
            {stale && `hace ${weight.daysAgo}d · toca para actualizar`}
          </div>
        </div>
      )}
    </div>
  );
}
