'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { DietDayStats } from '@/lib/diet-processor';
import CalorieRing from './CalorieRing';
import MacroBars from './MacroBar';
import MealSection from './MealSection';

const MEALS = ['desayuno', 'almuerzo', 'once', 'cena', 'snack'] as const;

interface DietContentProps {
  data: DietDayStats;
}

export default function DietContent({ data }: DietContentProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const refresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className="space-y-8">
      {/* Summary row */}
      <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-center md:items-start bg-gray-900/30 border border-gray-800/50 rounded-2xl p-6">
        <CalorieRing consumed={data.totals.calories} goal={data.goal.calories} />
        <MacroBars consumed={data.totals} goal={data.goal} />
        {/* Secondary stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-1 text-center md:text-left shrink-0">
          {data.totals.fiber_g > 0 && (
            <div className="bg-gray-900/40 border border-gray-800/40 rounded-lg px-4 py-2">
              <div className="text-[10px] text-gray-600 uppercase tracking-wide">Fibra</div>
              <div className="text-sm font-mono text-green-400">{data.totals.fiber_g.toFixed(1)}g</div>
            </div>
          )}
          {data.totals.sodium_mg > 0 && (
            <div className="bg-gray-900/40 border border-gray-800/40 rounded-lg px-4 py-2">
              <div className="text-[10px] text-gray-600 uppercase tracking-wide">Sodio</div>
              <div className="text-sm font-mono text-orange-400">{data.totals.sodium_mg.toFixed(0)}mg</div>
            </div>
          )}
        </div>
      </div>

      {/* Meal sections */}
      <div className="space-y-3">
        {MEALS.map((meal) => (
          <MealSection
            key={meal}
            meal={meal}
            entries={data.meals[meal] ?? []}
            date={data.date}
            onRefresh={refresh}
          />
        ))}
      </div>
    </div>
  );
}
