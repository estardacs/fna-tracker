'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

export default function RealtimeRefresher() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Realtime: refresca cuando llega un nuevo registro de métricas
    // (requiere habilitar Realtime en la tabla metrics desde Supabase dashboard)
    const channel = supabase
      .channel('metrics-inserts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'metrics' },
        () => router.refresh()
      )
      .subscribe();

    // Fallback: polling cada 5 minutos por si Realtime no está habilitado
    const fallback = setInterval(() => router.refresh(), 5 * 60 * 1000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(fallback);
    };
  }, [router]);

  return null;
}
