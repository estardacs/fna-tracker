'use client';

import { useState, useRef } from 'react';
import { ChevronDown, Plus, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DietLogEntry } from '@/lib/diet-processor';
import AddFoodModal from './AddFoodModal';

const MEAL_LABELS: Record<string, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Almuerzo',
  once: 'Once',
  cena: 'Cena',
  snack: 'Snack',
};

interface MealSectionProps {
  meal: string;
  entries: DietLogEntry[];
  date: string;
  isOwner: boolean;
  onRefresh: () => void;
}

function GramsBadge({ entry, onSaved }: { entry: DietLogEntry; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(entry.grams_consumed ?? ''));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = () => {
    setValue(String(entry.grams_consumed ?? ''));
    setEditing(true);
    setTimeout(() => { inputRef.current?.select(); }, 0);
  };

  const commit = async () => {
    const grams = parseFloat(value.replace(',', '.'));
    if (!grams || grams <= 0 || grams === entry.grams_consumed) { setEditing(false); return; }
    setSaving(true);
    try {
      await fetch(`/api/diet/log/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grams_consumed: grams }),
      });
      onSaved();
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (saving) return <Loader2 className="w-3 h-3 animate-spin text-gray-600" />;

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="w-16 bg-gray-800 border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white font-mono text-center focus:outline-none"
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={open}
      title="Editar cantidad"
      className="text-xs text-gray-500 font-mono hover:text-gray-200 hover:bg-gray-800 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
    >
      {entry.grams_consumed}g
    </button>
  );
}

function MacroCell({ label, value, labelClass, valueClass }: { label: string; value: string; labelClass: string; valueClass: string }) {
  return (
    <div className="flex flex-col items-center w-14 shrink-0">
      <span className={cn('text-[10px] font-medium uppercase tracking-wide', labelClass)}>{label}</span>
      <span className={cn('text-sm font-mono tabular-nums', valueClass)}>{value}</span>
    </div>
  );
}

export default function MealSection({ meal, entries, date, isOwner, onRefresh }: MealSectionProps) {
  const [open, setOpen] = useState(entries.length > 0);
  const [showModal, setShowModal] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const totalCal   = entries.reduce((s, e) => s + e.calories,  0);
  const totalProt  = entries.reduce((s, e) => s + e.protein_g, 0);
  const totalCarbs = entries.reduce((s, e) => s + e.carbs_g,   0);
  const totalFat   = entries.reduce((s, e) => s + e.fat_g,     0);

  const deleteEntry = async (id: string) => {
    setDeleting(id);
    try {
      await fetch(`/api/diet/log/${id}`, { method: 'DELETE' });
      onRefresh();
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <div className="border border-gray-800/60 rounded-xl overflow-hidden bg-gray-900/20">

        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-900/40 transition-colors select-none"
          onClick={() => setOpen((v) => !v)}
        >
          <div className="flex items-center gap-3">
            <ChevronDown className={cn('w-4 h-4 text-gray-500 transition-transform duration-300', open && 'rotate-180')} />
            <span className="text-base font-semibold text-gray-100">{MEAL_LABELS[meal] ?? meal}</span>
            {entries.length > 0 && (
              <span className="text-xs text-gray-600 font-mono">{entries.length}</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {totalCal > 0 && (
              <div className="hidden sm:flex items-center gap-4 text-xs font-mono">
                <span className="text-blue-400">{totalProt.toFixed(0)}g <span className="text-blue-400/40">P</span></span>
                <span className="text-amber-400">{totalCarbs.toFixed(0)}g <span className="text-amber-400/40">C</span></span>
                <span className="text-pink-400">{totalFat.toFixed(0)}g <span className="text-pink-400/40">G</span></span>
                <span className="text-gray-300 font-semibold text-sm">{totalCal.toFixed(0)} <span className="text-gray-600 font-normal text-xs">kcal</span></span>
              </div>
            )}
            {isOwner && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowModal(true); }}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Agregar
              </button>
            )}
          </div>
        </div>

        {/* Collapsible body */}
        <div className={cn('grid transition-[grid-template-rows] duration-300 ease-in-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
          <div className="overflow-hidden">
            <div className="border-t border-gray-800/40">
              {entries.length === 0 ? (
                <p className="px-5 py-5 text-sm text-gray-600 text-center">Sin registros — toca Agregar</p>
              ) : (
                <ul className="divide-y divide-gray-800/30">
                  {entries.map((entry, i) => (
                    <li
                      key={entry.id}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-900/40 group"
                      style={{ animation: open ? `fadeIn 0.2s ease-out ${i * 35}ms both` : 'none' }}
                    >
                      {/* Name + grams — grows to fill space */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 truncate">{entry.name}</p>
                        {entry.grams_consumed != null && isOwner && (
                          <GramsBadge entry={entry} onSaved={onRefresh} />
                        )}
                        {entry.grams_consumed != null && !isOwner && (
                          <span className="text-xs text-gray-600 font-mono">{entry.grams_consumed}g</span>
                        )}
                      </div>

                      {/* Macros */}
                      <div className="hidden sm:flex items-center gap-2">
                        <MacroCell label="P" value={`${entry.protein_g.toFixed(1)}g`} labelClass="text-blue-400/50"  valueClass="text-blue-400" />
                        <MacroCell label="C" value={`${entry.carbs_g.toFixed(1)}g`}   labelClass="text-amber-400/50" valueClass="text-amber-400" />
                        <MacroCell label="G" value={`${entry.fat_g.toFixed(1)}g`}     labelClass="text-pink-400/50"  valueClass="text-pink-400" />
                      </div>

                      {/* Kcal */}
                      <div className="text-right shrink-0 w-16">
                        <p className="text-base font-mono font-semibold text-gray-200 tabular-nums leading-tight">{entry.calories.toFixed(0)}</p>
                        <p className="text-[10px] text-gray-600">kcal</p>
                      </div>

                      {/* Delete — solo owner */}
                      {isOwner ? (
                        <button
                          onClick={() => deleteEntry(entry.id)}
                          disabled={deleting === entry.id}
                          className="p-1.5 rounded-lg text-gray-700 hover:text-red-400 hover:bg-red-500/15 transition-all cursor-pointer opacity-0 group-hover:opacity-100 shrink-0"
                        >
                          {deleting === entry.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Trash2 className="w-4 h-4" />}
                        </button>
                      ) : (
                        <div className="w-7 shrink-0" />
                      )}
                    </li>
                  ))}

                  {/* Totals footer */}
                  {entries.length > 1 && (
                    <li className="flex items-center gap-4 px-5 py-3 bg-gray-900/50 border-t border-gray-800/60">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-gray-600 uppercase tracking-wider font-medium">Total</span>
                      </div>
                      <div className="hidden sm:flex items-center gap-2">
                        <div className="flex flex-col items-center w-14">
                          <span className="text-sm font-mono text-blue-400/60 tabular-nums">{totalProt.toFixed(1)}g</span>
                        </div>
                        <div className="flex flex-col items-center w-14">
                          <span className="text-sm font-mono text-amber-400/60 tabular-nums">{totalCarbs.toFixed(1)}g</span>
                        </div>
                        <div className="flex flex-col items-center w-14">
                          <span className="text-sm font-mono text-pink-400/60 tabular-nums">{totalFat.toFixed(1)}g</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 w-16">
                        <p className="text-base font-mono font-semibold text-gray-300 tabular-nums leading-tight">{totalCal.toFixed(0)}</p>
                        <p className="text-[10px] text-gray-600">kcal</p>
                      </div>
                      <div className="w-7 shrink-0" />
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <AddFoodModal
          meal={meal}
          date={date}
          onClose={() => setShowModal(false)}
          onAdded={onRefresh}
        />
      )}
    </>
  );
}
