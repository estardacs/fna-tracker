'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { format, addDays, subDays, parseISO, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';

export default function DateNavigator() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Obtener fecha actual de la URL o usar Hoy
  const dateParam = searchParams.get('date');
  const currentDate = dateParam ? parseISO(dateParam) : new Date();
  
  const isToday = isSameDay(currentDate, new Date());

  const navigate = (direction: 'prev' | 'next') => {
    const newDate = direction === 'prev' ? subDays(currentDate, 1) : addDays(currentDate, 1);
    const dateStr = format(newDate, 'yyyy-MM-dd');
    router.push(`/?date=${dateStr}`);
  };

  const goToToday = () => {
    router.push('/');
  };

  return (
    <div className="flex items-center gap-2 bg-gray-900/50 p-1 rounded-lg border border-gray-800">
      <button 
        onClick={() => navigate('prev')}
        className="p-2 hover:bg-gray-800 rounded-md text-gray-400 hover:text-white transition-colors"
        title="Día anterior"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <button 
        onClick={goToToday}
        className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800 rounded-md transition-colors min-w-[140px] justify-center"
        title="Volver a Hoy"
      >
        <Calendar className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-sm font-medium text-gray-200 capitalize">
          {isToday ? 'Hoy' : format(currentDate, 'EEEE d', { locale: es })}
        </span>
      </button>

      <button 
        onClick={() => navigate('next')}
        disabled={isToday} // No viajar al futuro
        className={`p-2 rounded-md transition-colors ${
          isToday 
            ? 'text-gray-700 cursor-not-allowed' 
            : 'hover:bg-gray-800 text-gray-400 hover:text-white'
        }`}
        title="Día siguiente"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
