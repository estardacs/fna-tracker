'use client';

import { useEffect, useState } from 'react';
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
}

export default function MacroBars({ consumed, goal }: MacroBarsProps) {
  return (
    <div className="space-y-3 flex-1 min-w-[200px]">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Macros</h3>
      <Bar label="Proteína"      consumed={consumed.protein_g} goal={goal.protein_g} colorClass="bg-blue-500"  delay={150} />
      <Bar label="Carbohidratos" consumed={consumed.carbs_g}   goal={goal.carbs_g}   colorClass="bg-amber-500" delay={220} />
      <Bar label="Grasas"        consumed={consumed.fat_g}     goal={goal.fat_g}     colorClass="bg-pink-500"  delay={290} />
      <Bar label="Fibra"         consumed={consumed.fiber_g}   goal={goal.fiber_g}   colorClass="bg-green-500" delay={360} />
    </div>
  );
}
