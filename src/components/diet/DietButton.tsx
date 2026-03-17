'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

export default function DietButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(() => {
      router.push('/diet');
    });
  };

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className={cn(
        "group relative inline-flex items-center justify-center gap-2 w-36 py-2 text-sm font-medium text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded-lg hover:bg-orange-500/20 hover:border-orange-500/40 transition-all duration-300 cursor-pointer",
        isPending && "opacity-70 cursor-wait"
      )}
    >
      {!isPending && <span>🍽</span>}
      <span>{isPending ? 'Cargando...' : 'Dieta'}</span>
    </button>
  );
}
