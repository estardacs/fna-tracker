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
  ReferenceLine,
} from 'recharts';

type Props = {
  timeline: { time: string; bpm: number }[];
  resting: number;
};

export default function HeartRateChart({ timeline, resting }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return <div className="h-[220px] w-full bg-gray-900/50 rounded-xl border border-gray-800 animate-pulse" />;
  }

  if (timeline.length === 0) {
    return (
      <div className="h-[220px] w-full bg-gray-900/50 rounded-xl border border-gray-800 flex items-center justify-center text-gray-500 text-sm italic">
        Sin datos de frecuencia cardíaca
      </div>
    );
  }

  // Sample timeline to max 120 points for performance
  const step = Math.max(1, Math.floor(timeline.length / 120));
  const data = timeline.filter((_, i) => i % step === 0);

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider">Frecuencia Cardíaca</h3>
        {resting > 0 && (
          <span className="text-[10px] text-gray-500 font-mono bg-gray-800/50 px-2 py-0.5 rounded">
            Reposo: {resting} bpm
          </span>
        )}
      </div>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="hrGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
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
            <YAxis stroke="#6b7280" fontSize={9} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#f3f4f6', fontSize: '11px' }}
              formatter={(val: any) => [`${val} bpm`, 'HR']}
            />
            {/* Zones */}
            <ReferenceLine y={60} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.4} />
            <ReferenceLine y={100} stroke="#f97316" strokeDasharray="4 4" strokeOpacity={0.4} />
            <ReferenceLine y={140} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.4} />
            <Area
              type="monotone"
              dataKey="bpm"
              stroke="#f43f5e"
              strokeWidth={1.5}
              fillOpacity={1}
              fill="url(#hrGradient)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-4 mt-2 text-[9px] text-gray-600">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block" /> &lt;60 reposo</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-orange-500 inline-block" /> &gt;100 elevado</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500 inline-block" /> &gt;140 alto</span>
      </div>
    </div>
  );
}
