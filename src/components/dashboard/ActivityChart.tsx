'use client';

import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function ActivityChart({ data }: { data: any[] }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-[300px] w-full bg-gray-900/50 p-4 rounded-xl border border-gray-800 animate-pulse" />;
  }

  return (
    <div className="h-[320px] w-full bg-gray-900/50 p-4 rounded-xl border border-gray-800 relative">
      <h3 className="text-gray-400 text-sm mb-1 font-medium uppercase tracking-wider">Actividad por Hora (Minutos)</h3>
      
      {/* Custom Floating Legend */}
      <div className="absolute top-2 right-0 left-0 flex justify-center gap-6 text-xs z-10">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#3b82f6]"></span>
          <span className="text-gray-300">Computador</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]"></span>
          <span className="text-gray-300">Teléfono</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 50, left: -30, bottom: 30 }}>
          <defs>
            <linearGradient id="colorPc" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="colorMobile" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis dataKey="hour" stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6' }}
            itemStyle={{ color: '#e5e7eb' }}
          />
          <Area 
            type="monotone" 
            dataKey="pc" 
            name="Computador"
            stroke="#3b82f6" 
            strokeWidth={2}
            fillOpacity={1} 
            fill="url(#colorPc)" 
          />
          <Area 
            type="monotone" 
            dataKey="mobile" 
            name="Teléfono"
            stroke="#10b981" 
            strokeWidth={2}
            fillOpacity={1} 
            fill="url(#colorMobile)" 
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
