'use client';

import { useEffect, useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MacroBarProps {
  label: string;
  consumed: number;
  goal: number;
  unit?: string;
  colorClass: string;
  delay?: number;
}

function Bar({ label, consumed, goal, unit = 'g', colorClass, delay = 0 }: MacroBarProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  const pct = goal > 0 ? Math.min((consumed / goal) * 100, 100) : 0;
  const over = goal > 0 && consumed > goal;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className={cn('font-mono', over ? 'text-red-400' : 'text-gray-300')}>
          {consumed.toFixed(1)}{unit}
          {goal > 0 && <span className="text-gray-600"> / {goal}{unit}</span>}
        </span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full', over ? 'bg-red-500' : colorClass)}
          style={{
            width: mounted ? `${pct}%` : '0%',
            transition: 'width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        />
      </div>
    </div>
  );
}

interface MacroBarsProps {
  consumed: { protein_g: number; carbs_g: number; fat_g: number; fiber_g: number };
  goal: { protein_g: number; carbs_g: number; fat_g: number; fiber_g: number };
  calories: number;
  onGoalSave?: (macros: { protein_g: number; carbs_g: number; fat_g: number; fiber_g: number }) => Promise<void>;
}

export default function MacroBars({ consumed, goal, calories, onGoalSave }: MacroBarsProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    protein_g: goal.protein_g,
    carbs_g: goal.carbs_g,
    fat_g: goal.fat_g,
    fiber_g: goal.fiber_g,
  });

  const handleSave = async () => {
    if (!onGoalSave) return;
    setSaving(true);
    await onGoalSave(draft);
    setSaving(false);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft({ protein_g: goal.protein_g, carbs_g: goal.carbs_g, fat_g: goal.fat_g, fiber_g: goal.fiber_g });
    setEditing(false);
  };

  if (editing) {
    const macros = [
      { key: 'protein_g' as const, label: 'Proteína',      color: 'text-blue-400' },
      { key: 'carbs_g'   as const, label: 'Carbohidratos', color: 'text-amber-400' },
      { key: 'fat_g'     as const, label: 'Grasas',        color: 'text-pink-400' },
      { key: 'fiber_g'   as const, label: 'Fibra',         color: 'text-green-400' },
    ];
    return (
      <div className="space-y-3 flex-1 min-w-[200px]">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Objetivos Macros</h3>
          <div className="flex gap-1">
            <button onClick={handleSave} disabled={saving} className="p-1 rounded hover:bg-gray-800 text-green-400 cursor-pointer">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleCancel} className="p-1 rounded hover:bg-gray-800 text-gray-500 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {macros.map(({ key, label, color }) => (
          <div key={key} className="flex items-center justify-between gap-2">
            <span className={cn('text-xs w-28 shrink-0', color)}>{label}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                value={draft[key]}
                onChange={(e) => setDraft(d => ({ ...d, [key]: Number(e.target.value) }))}
                className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs font-mono text-gray-200 focus:outline-none focus:border-gray-500 text-right"
              />
              <span className="text-[10px] text-gray-600">g</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3 flex-1 min-w-[200px]">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Macros</h3>
        {onGoalSave && (
          <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-gray-800 text-gray-600 hover:text-gray-400 transition-colors cursor-pointer">
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
      <Bar label="Proteína"      consumed={consumed.protein_g} goal={goal.protein_g} colorClass="bg-blue-500"  delay={150} />
      <Bar label="Carbohidratos" consumed={consumed.carbs_g}   goal={goal.carbs_g}   colorClass="bg-amber-500" delay={220} />
      <Bar label="Grasas"        consumed={consumed.fat_g}     goal={goal.fat_g}     colorClass="bg-pink-500"  delay={290} />
      <Bar label="Fibra"         consumed={consumed.fiber_g}   goal={goal.fiber_g}   colorClass="bg-green-500" delay={360} />
    </div>
  );
}
