
'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

export default function HistoryButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(() => {
      router.push('/history');
    });
  };

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className={cn(
        "group relative inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-lg hover:bg-blue-500/20 hover:border-blue-500/40 transition-all duration-300 cursor-pointer",
        isPending && "opacity-70 cursor-wait"
      )}
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
      </span>
      <span>{isPending ? 'Cargando...' : 'Ver Historial'}</span>
      
      {/* Tooltip hint - shown on hover */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-max px-2 py-1 bg-gray-900 border border-gray-800 text-xs text-gray-400 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
        Estadísticas a largo plazo
      </div>
    </button>
  );
}
