'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Scale, Loader2 } from 'lucide-react';
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
}

export default function WeightWidget({ weight, date }: WeightWidgetProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(weight?.kg.toFixed(1) ?? '');
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  const save = async () => {
    const kg = parseFloat(input);
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

  const stale = weight && weight.daysAgo > 0;
  const delta = weight?.kg
    ? null  // delta vs semana pasada lo puede añadir el caller
    : null;

  return (
    <div
      className="bg-gray-900/50 p-4 md:p-6 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors group h-full cursor-pointer"
      onClick={() => { if (!editing) { setInput(weight?.kg.toFixed(1) ?? ''); setEditing(true); } }}
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-3 md:mb-4">
        <span className="text-gray-400 text-[10px] md:text-sm font-medium uppercase tracking-wider">Peso</span>
        <div className="p-1.5 md:p-2 bg-gray-800/50 rounded-lg group-hover:bg-gray-800 transition-colors">
          <Scale className="text-purple-400 w-4 h-4 md:w-5 md:h-5" />
        </div>
      </div>

      {/* Value */}
      {editing ? (
        <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-baseline gap-1.5">
            <input
              type="number"
              step="0.1"
              min="30"
              max="300"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="w-24 bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-2xl md:text-3xl font-bold text-gray-100 tracking-tight focus:outline-none focus:border-purple-500 font-mono"
              autoFocus
            />
            <span className="text-sm text-gray-500">kg</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              Guardar
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded-lg transition-colors cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <span className={cn(
            'text-2xl md:text-4xl font-bold tracking-tight mb-1',
            stale ? 'text-gray-500' : 'text-gray-100'
          )}>
            {weight ? `${weight.kg.toFixed(1)} kg` : '—'}
          </span>
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
