'use client';

import { useState, useEffect } from 'react';

export default function SantiagoClock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        timeZone: 'America/Santiago',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      };
      setTime(new Intl.DateTimeFormat('es-CL', options).format(now));
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!time) return null;

  return (
    <div className="flex items-center gap-2 text-xs font-mono text-gray-500 bg-gray-900/30 px-2 py-1 rounded border border-gray-800/50">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
      CLST: <span className="text-gray-300 font-semibold">{time}</span>
    </div>
  );
}
