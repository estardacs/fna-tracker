'use client';

import Link from 'next/link';
import { Footprints, Moon, Dumbbell } from 'lucide-react';
import { type HealthWeekDay } from '@/lib/health-processor';

const STEPS_GOAL = 8000;

function formatSteps(steps: number) {
  if (steps >= 1000) return `${(steps / 1000).toFixed(1)}k`;
  return `${steps}`;
}

function stepsColor(steps: number) {
  if (steps === 0) return 'text-gray-600';
  const pct = steps / STEPS_GOAL;
  if (pct >= 1) return 'text-emerald-400';
  if (pct >= 0.6) return 'text-yellow-400';
  return 'text-orange-400';
}

export default function WeeklyHealthGrid({ days }: { days: HealthWeekDay[] }) {
  return (
    <div className="w-full">
      <h3 className="text-gray-400 text-sm mb-4 font-medium uppercase tracking-wider">Semana</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {days.map((day) => {
          const isEmpty = day.isFuture || (day.steps === 0 && day.sleepMinutes === 0 && !day.hasWorkout);
          const sleepH = day.sleepMinutes > 0 ? Math.round(day.sleepMinutes / 60 * 10) / 10 : null;

          const card = (
            <div className={`bg-gray-900/50 p-3 rounded-xl border border-gray-800 flex flex-col gap-1.5 transition-colors ${
              isEmpty ? 'opacity-40' : 'hover:border-gray-700 cursor-pointer'
            }`}>
              <span className="text-gray-500 text-xs font-medium uppercase">{day.dayName}</span>

              {/* Steps */}
              <div className="flex items-center gap-1">
                <Footprints className="w-3 h-3 text-gray-600 shrink-0" />
                <span className={`text-sm font-bold ${stepsColor(day.steps)}`}>
                  {day.steps > 0 ? formatSteps(day.steps) : '—'}
                </span>
              </div>

              {/* Sleep */}
              <div className="flex items-center gap-1">
                <Moon className="w-3 h-3 text-gray-600 shrink-0" />
                <span className="text-xs text-gray-400">
                  {sleepH !== null ? `${sleepH}h` : '—'}
                </span>
              </div>

              {/* Workout indicator */}
              {day.hasWorkout && (
                <div className="flex items-center gap-1 mt-0.5">
                  <Dumbbell className="w-3 h-3 text-emerald-500" />
                </div>
              )}

              {/* Steps progress bar */}
              {day.steps > 0 && (
                <div className="h-0.5 w-full bg-gray-800 rounded-full overflow-hidden mt-1">
                  <div
                    className="h-full bg-emerald-500/60 rounded-full"
                    style={{ width: `${Math.min(100, (day.steps / STEPS_GOAL) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          );

          return isEmpty ? (
            <div key={day.date}>{card}</div>
          ) : (
            <Link key={day.date} href={`/health?date=${day.date}`}>
              {card}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
