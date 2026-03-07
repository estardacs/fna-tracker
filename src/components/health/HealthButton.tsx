'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function HealthButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => router.push('/health'))}
      disabled={isPending}
      className={cn(
        'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg hover:bg-rose-500/20 hover:border-rose-500/40 transition-all duration-300 cursor-pointer',
        isPending && 'opacity-70 cursor-wait'
      )}
    >
      <Heart className="w-3.5 h-3.5" />
      <span>{isPending ? 'Cargando...' : 'Salud'}</span>
    </button>
  );
}
