'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2, Loader2 } from 'lucide-react';
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
  onRefresh: () => void;
}

export default function MealSection({ meal, entries, date, onRefresh }: MealSectionProps) {
  const [open, setOpen] = useState(entries.length > 0);
  const [showModal, setShowModal] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const totalCal = entries.reduce((s, e) => s + e.calories, 0);

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
          className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-900/40 transition-colors select-none"
          onClick={() => setOpen((v) => !v)}
        >
          <div className="flex items-center gap-3">
            <ChevronDown
              className={cn(
                'w-4 h-4 text-gray-600 transition-transform duration-300 ease-in-out',
                open && 'rotate-180'
              )}
            />
            <span className="text-sm font-medium text-gray-200">{MEAL_LABELS[meal] ?? meal}</span>
            {entries.length > 0 && (
              <span className="text-xs text-gray-600 font-mono">{entries.length}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {totalCal > 0 && (
              <span className="text-xs font-mono text-gray-400">{totalCal.toFixed(0)} kcal</span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setShowModal(true); }}
              className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-2 py-1 rounded-md transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" /> Agregar
            </button>
          </div>
        </div>

        {/* Collapsible body — grid trick for smooth height animation */}
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-300 ease-in-out',
            open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="overflow-hidden">
            <div className="border-t border-gray-800/40">
              {entries.length === 0 ? (
                <div className="px-4 py-4 text-xs text-gray-600 text-center">
                  Sin registros — toca Agregar
                </div>
              ) : (
                <ul className="divide-y divide-gray-800/30">
                  {entries.map((entry, i) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between px-4 py-3 hover:bg-gray-900/30 group"
                      style={{
                        animation: open ? `fadeIn 0.2s ease-out ${i * 35}ms both` : 'none',
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-200 truncate">{entry.name}</div>
                        <div className="flex gap-2 mt-0.5 flex-wrap">
                          {entry.grams_consumed != null && (
                            <span className="text-[10px] text-gray-600 font-mono">{entry.grams_consumed}g</span>
                          )}
                          <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">
                            P {entry.protein_g.toFixed(1)}g
                          </span>
                          <span className="text-[10px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded">
                            C {entry.carbs_g.toFixed(1)}g
                          </span>
                          <span className="text-[10px] bg-pink-500/10 text-pink-400 px-1.5 py-0.5 rounded">
                            G {entry.fat_g.toFixed(1)}g
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 ml-3 shrink-0">
                        <span className="text-xs font-mono text-gray-400">{entry.calories.toFixed(0)} kcal</span>
                        <button
                          onClick={() => deleteEntry(entry.id)}
                          disabled={deleting === entry.id}
                          className={cn(
                            'p-1 hover:bg-red-500/20 rounded text-gray-600 hover:text-red-400 transition-all cursor-pointer',
                            'opacity-0 group-hover:opacity-100'
                          )}
                        >
                          {deleting === entry.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </li>
                  ))}
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
