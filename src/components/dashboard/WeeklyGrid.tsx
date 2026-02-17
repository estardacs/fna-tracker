'use client';

import { Monitor, Smartphone, Scale } from 'lucide-react';

type DayStat = {
  date: string;
  dayName: string;
  totalMinutes: number;
  primaryDevice: 'pc' | 'mobile' | 'balanced';
};

export default function WeeklyGrid({ days }: { days: DayStat[] }) {
  return (
    <div className="w-full">
      <h3 className="text-gray-400 text-sm mb-4 font-medium uppercase tracking-wider">Resumen Semanal</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {days.map((day) => {
          const isEmpty = day.totalMinutes === 0;
          return (
            <div 
              key={day.date} 
              className={`bg-gray-900/50 p-4 rounded-xl border border-gray-800 flex flex-col items-center justify-center gap-2 transition-colors ${isEmpty ? 'opacity-50' : 'hover:border-gray-700'}`}
            >
              <span className="text-gray-500 text-xs font-medium uppercase">{day.dayName}</span>
              <span className="text-2xl font-bold text-white tracking-tight">
                {isEmpty ? '-' : formatHours(day.totalMinutes)}
              </span>
              <div className="mt-1 h-4">
                {!isEmpty && (
                  <>
                    {day.primaryDevice === 'pc' && <Monitor className="w-4 h-4 text-blue-500" />}
                    {day.primaryDevice === 'mobile' && <Smartphone className="w-4 h-4 text-emerald-500" />}
                    {day.primaryDevice === 'balanced' && <Scale className="w-4 h-4 text-purple-500" />}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}
