'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RealtimeRefresher() {
  const router = useRouter();

  useEffect(() => {
    // Configurar un intervalo de actualización automática (Polling)
    // Se ejecuta cada 5 segundos.
    // Al usar router.refresh(), Next.js re-ejecuta los Server Components (fetch de DB)
    // sin recargar toda la página (mantiene el scroll y estado visual).
    const intervalId = setInterval(() => {
      router.refresh();
    }, 5 * 1000); // 5 segundos

    return () => {
      clearInterval(intervalId);
    };
  }, [router]);

  return null; // Componente invisible
}
