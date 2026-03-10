'use client';

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

type Props = {
  current: number | null;
  delta: number | null;
  bodyFat: number | null;
  history: { date: string; weight: number }[];
};

export default function WeightChart({ current, delta, bodyFat, history }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return <div className="h-[220px] w-full bg-gray-900/50 rounded-xl border border-gray-800 animate-pulse" />;
  }

  const hasHistory = history.length > 1;

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider">Peso</h3>
        {delta !== null && (
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded ${
              delta < 0
                ? 'bg-emerald-500/10 text-emerald-400'
                : delta > 0
                ? 'bg-orange-500/10 text-orange-400'
                : 'bg-gray-800 text-gray-500'
            }`}
          >
            {delta > 0 ? '+' : ''}{delta} kg vs sem. anterior
          </span>
        )}
      </div>

      {current !== null ? (
        <div className="mb-3 flex items-end gap-3">
          <span className="text-2xl font-bold text-gray-100 tracking-tight">{current} kg</span>
          {bodyFat !== null && (
            <span className="text-sm text-gray-500 mb-0.5">{bodyFat}% grasa</span>
          )}
        </div>
      ) : (
        <p className="text-gray-500 text-sm italic mb-3">Sin datos de peso</p>
      )}

      {hasHistory ? (
        <div className="h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} opacity={0.3} />
              <XAxis
                dataKey="date"
                stroke="#6b7280"
                fontSize={9}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                tickFormatter={(val) => format(parseISO(val), 'd MMM', { locale: es })}
              />
              <YAxis
                stroke="#6b7280"
                fontSize={9}
                tickLine={false}
                axisLine={false}
                domain={['auto', 'auto']}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#f3f4f6', fontSize: '11px' }}
                labelFormatter={(val) => format(parseISO(val), "d MMM yyyy", { locale: es })}
                formatter={(val: any) => [`${val} kg`, 'Peso']}
              />
              <Line
                type="monotone"
                dataKey="weight"
                stroke="#a78bfa"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, fill: '#a78bfa' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-[140px] flex items-center justify-center text-gray-600 text-xs italic">
          Se necesitan más registros para mostrar tendencia
        </div>
      )}
    </div>
  );
}
