'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { DietDayStats } from '@/lib/diet-processor';
import CalorieRing from './CalorieRing';
import MacroBars from './MacroBar';
import MealSection from './MealSection';
import FadeIn from '@/components/dashboard/FadeIn';

const MEALS = ['desayuno', 'almuerzo', 'once', 'cena', 'snack'] as const;

interface DietContentProps {
  data: DietDayStats;
  isOwner: boolean;
}

export default function DietContent({ data, isOwner }: DietContentProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [sectionsVisible, setSectionsVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSectionsVisible(true), 120);
    return () => clearTimeout(t);
  }, []);

  const refresh = () => startTransition(() => router.refresh());

  const handleGoalSave = async (kcal: number) => {
    await fetch('/api/diet/goals', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calories: kcal }),
    });
    refresh();
  };

  const handleMacroGoalSave = async (macros: { protein_g: number; carbs_g: number; fat_g: number; fiber_g: number }) => {
    await fetch('/api/diet/goals', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calories: data.goal.calories, ...macros }),
    });
    refresh();
  };

  return (
    <FadeIn>
      <div className="space-y-8">
        {/* Summary row */}
        <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-center md:items-start bg-gray-900/30 border border-gray-800/50 rounded-2xl p-6">
          <CalorieRing consumed={data.totals.calories} goal={data.goal.calories} onGoalSave={isOwner ? handleGoalSave : undefined} />
          <MacroBars consumed={data.totals} goal={data.goal} calories={data.goal.calories} onGoalSave={isOwner ? handleMacroGoalSave : undefined} />
          {/* Secondary stats */}
          <div
            className="flex flex-row md:flex-col flex-wrap gap-3 shrink-0"
            style={{
              opacity: sectionsVisible ? 1 : 0,
              transform: sectionsVisible ? 'translateY(0)' : 'translateY(6px)',
              transition: 'opacity 0.5s ease 0.4s, transform 0.5s ease 0.4s',
            }}
          >
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

        {/* Meal sections — staggered */}
        <div className="space-y-3">
          {MEALS.map((meal, i) => (
            <div
              key={meal}
              style={{
                opacity: sectionsVisible ? 1 : 0,
                transform: sectionsVisible ? 'translateY(0)' : 'translateY(10px)',
                transition: `opacity 0.4s ease ${i * 60}ms, transform 0.4s ease ${i * 60}ms`,
              }}
            >
              <MealSection
                meal={meal}
                entries={data.meals[meal] ?? []}
                date={data.date}
                isOwner={isOwner}
                onRefresh={refresh}
              />
            </div>
          ))}
        </div>
      </div>
    </FadeIn>
  );
}
