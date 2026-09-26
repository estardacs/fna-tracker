import Link from 'next/link';
import { Beef } from 'lucide-react';
import type { DietWeekDay } from '@/lib/diet-processor';

/** Mirrors dashboard/WeeklyGrid, but for calories and protein.
 *
 *  A Server Component on purpose: it only renders links, and the original computes
 *  "today" from the browser's clock, which drifts from the Santiago day boundary the rest
 *  of the app uses. Here the dates arrive already resolved server-side. */
export default function DietWeeklyGrid({ days, goal }: { days: DietWeekDay[]; goal: number }) {
  return (
    <div className="w-full">
      <h3 className="text-gray-400 text-sm mb-4 font-medium uppercase tracking-wider">Últimos 7 Días</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {days.map((day) => {
          const isEmpty = day.calories === 0;

          return (
            <Link
              key={day.date}
              href={`/diet?date=${day.date}`}
              className={`bg-gray-900/50 p-4 rounded-xl border border-gray-800 flex flex-col items-center justify-center gap-2 transition-colors hover:border-gray-700 hover:scale-[1.02] cursor-pointer ${
                isEmpty ? 'opacity-50' : ''
              }`}
            >
              <span className="text-gray-500 text-xs font-medium uppercase">{day.dayName}</span>

              {/* A day with nothing logged shows a dash, never a 0 that could be mistaken
                  for "ate nothing". */}
              <span className={`text-2xl font-bold tracking-tight ${isEmpty ? 'text-gray-600' : calorieColor(day.calories, goal)}`}>
                {isEmpty ? '-' : day.calories}
              </span>

              <div className="mt-1 h-4 flex items-center gap-1">
                {!isEmpty && (
                  <>
                    <Beef className="w-3 h-3 text-blue-400" />
                    <span className="text-[10px] text-blue-400 font-mono">{day.proteinG}g</span>
                  </>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Amber under 80% of the target, green through 110%, red above. Today is still
 *  accumulating, so its card reads amber for most of the day — that is expected. */
function calorieColor(calories: number, goal: number) {
  if (!goal) return 'text-white';
  const ratio = calories / goal;
  if (ratio < 0.8) return 'text-amber-400';
  if (ratio <= 1.1) return 'text-emerald-400';
  return 'text-red-400';
}
