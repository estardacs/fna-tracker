'use client';

import { cn } from '@/lib/utils';

interface CalorieRingProps {
  consumed: number;
  goal: number;
}

export default function CalorieRing({ consumed, goal }: CalorieRingProps) {
  const pct = goal > 0 ? Math.min(consumed / goal, 1.2) : 0;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dash = Math.min(pct, 1) * circumference;
  const remaining = goal - consumed;

  const color =
    consumed > goal
      ? '#ef4444'    // red — over goal
      : consumed >= goal * 0.9
      ? '#f97316'    // orange — 90%+
      : '#22c55e';   // green — under

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-40 h-40">
        <svg className="rotate-[-90deg]" viewBox="0 0 120 120" width="160" height="160">
          {/* Track */}
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#1f2937" strokeWidth="10" />
          {/* Progress */}
          <circle
            cx="60" cy="60" r={radius}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeDasharray={`${dash} ${circumference}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.5s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-2xl font-bold font-mono', consumed > goal ? 'text-red-400' : 'text-white')}>
            {remaining > 0 ? remaining.toFixed(0) : `+${Math.abs(remaining).toFixed(0)}`}
          </span>
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">
            {remaining > 0 ? 'restantes' : 'extra'}
          </span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-sm text-gray-400">
          <span className="text-white font-semibold font-mono">{consumed.toFixed(0)}</span>
          {' / '}
          <span className="font-mono">{goal}</span>
          {' kcal'}
        </div>
      </div>
    </div>
  );
}
