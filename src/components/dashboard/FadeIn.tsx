'use client';

import { ReactNode, useEffect, useState } from 'react';

export default function FadeIn({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Pequeño delay para que el navegador registre el estado inicial antes de la transición
    const timer = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div 
      className={`transition-all duration-700 ease-out transform ${
        visible 
          ? 'opacity-100 translate-y-0 scale-100' 
          : 'opacity-0 translate-y-4 scale-[0.99]'
      }`}
    >
      {children}
    </div>
  );
}
