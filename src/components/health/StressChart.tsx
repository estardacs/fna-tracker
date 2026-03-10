'use client';

import { useEffect, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type Props = {
  timeline: { time: string; level: number }[];
  avg: number;
};

function stressLabel(level: number) {
  if (level < 30) return 'Bajo';
  if (level < 60) return 'Moderado';
  if (level < 80) return 'Alto';
  return 'Muy alto';
}

function stressColor(level: number) {
  if (level < 30) return 'text-emerald-400';
  if (level < 60) return 'text-yellow-400';
  if (level < 80) return 'text-orange-400';
  return 'text-red-400';
}

export default function StressChart({ timeline, avg }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return <div className="h-[220px] w-full bg-gray-900/50 rounded-xl border border-gray-800 animate-pulse" />;
  }

  if (timeline.length === 0) {
    return (
      <div className="h-[220px] w-full bg-gray-900/50 rounded-xl border border-gray-800 flex items-center justify-center text-gray-500 text-sm italic">
        Sin datos de estrés
      </div>
    );
  }

  const step = Math.max(1, Math.floor(timeline.length / 120));
  const data = timeline.filter((_, i) => i % step === 0);

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider">Estrés</h3>
        {avg > 0 && (
          <span className={`text-[10px] font-mono bg-gray-800/50 px-2 py-0.5 rounded ${stressColor(avg)}`}>
            Prom: {avg} — {stressLabel(avg)}
          </span>
        )}
      </div>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="stressGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} opacity={0.3} />
            <XAxis
              dataKey="time"
              stroke="#6b7280"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              stroke="#6b7280"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#f3f4f6', fontSize: '11px' }}
              formatter={(val: any) => [`${val} — ${stressLabel(Number(val))}`, 'Estrés']}
            />
            <Area
              type="monotone"
              dataKey="level"
              stroke="#f59e0b"
              strokeWidth={1.5}
              fillOpacity={1}
              fill="url(#stressGradient)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
