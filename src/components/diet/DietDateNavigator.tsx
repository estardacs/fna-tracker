'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { format, addDays, subDays, parseISO, isSameDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { es } from 'date-fns/locale';

const TIMEZONE = 'America/Santiago';

export default function DietDateNavigator() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const dateParam = searchParams.get('date');
  const nowSantiago = toZonedTime(new Date(), TIMEZONE);
  const currentDate = dateParam ? parseISO(dateParam + 'T12:00:00') : nowSantiago;
  const isToday = isSameDay(currentDate, nowSantiago);

  const navigate = (direction: 'prev' | 'next') => {
    const newDate = direction === 'prev' ? subDays(currentDate, 1) : addDays(currentDate, 1);
    router.push(`/diet?date=${format(newDate, 'yyyy-MM-dd')}`);
  };

  const goToToday = () => router.push('/diet');

  return (
    <div className="flex items-center gap-2 bg-gray-900/50 p-1 rounded-lg border border-gray-800">
      <button
        onClick={() => navigate('prev')}
        className="p-2 hover:bg-gray-800 rounded-md text-gray-400 hover:text-white transition-colors cursor-pointer"
        title="Día anterior"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <button
        onClick={goToToday}
        className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800 rounded-md transition-colors min-w-[140px] justify-center cursor-pointer"
        title={isToday ? 'Hoy' : 'Volver a Hoy'}
      >
        <Calendar className="w-3.5 h-3.5 text-orange-400" />
        <span className="text-sm font-medium text-gray-200 capitalize">
          {isToday ? 'Hoy' : format(currentDate, 'EEEE d', { locale: es })}
        </span>
      </button>

      <button
        onClick={() => navigate('next')}
        className="p-2 hover:bg-gray-800 rounded-md text-gray-400 hover:text-white transition-colors cursor-pointer"
        title="Día siguiente"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
