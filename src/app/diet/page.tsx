import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { getDietDayStats } from '@/lib/diet-processor';
import DietContent from '@/components/diet/DietContent';
import DietDateNavigator from '@/components/diet/DietDateNavigator';
import AuthButton from '@/components/diet/AuthButton';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { es } from 'date-fns/locale';

const TIMEZONE = 'America/Santiago';

export const dynamic = 'force-dynamic';

function DietSkeleton() {
  return (
    <div className="space-y-6">
      {/* Summary row skeleton */}
      <div className="bg-gray-900/30 border border-gray-800/50 rounded-2xl p-6 flex flex-col md:flex-row gap-6 md:gap-10 items-center md:items-start">
        {/* Calorie ring */}
        <div className="shrink-0 flex flex-col items-center gap-3">
          <div className="w-40 h-40 rounded-full bg-gray-800/60 animate-pulse" />
          <div className="w-24 h-3.5 bg-gray-800/60 rounded-full animate-pulse" />
        </div>
        {/* Macro bars */}
        <div className="flex-1 min-w-[200px] space-y-4 w-full">
          <div className="w-16 h-3 bg-gray-800/60 rounded-full animate-pulse" />
          {[80, 65, 55, 40].map((w, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex justify-between">
                <div className="h-3 bg-gray-800/60 rounded-full animate-pulse" style={{ width: `${w * 0.5}px` }} />
                <div className="h-3 w-16 bg-gray-800/60 rounded-full animate-pulse" />
              </div>
              <div className="h-1.5 bg-gray-800/60 rounded-full animate-pulse" />
            </div>
          ))}
        </div>
        {/* Secondary stats */}
        <div className="flex flex-row md:flex-col gap-3 shrink-0">
          {[0, 1].map((i) => (
            <div key={i} className="w-20 h-12 bg-gray-800/60 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>

      {/* Meal section skeletons */}
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="border border-gray-800/50 rounded-xl bg-gray-900/20 animate-pulse"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-gray-800 rounded" />
              <div className="h-3.5 bg-gray-800 rounded-full" style={{ width: `${60 + i * 8}px` }} />
            </div>
            <div className="w-16 h-6 bg-gray-800 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

async function DietData({ date, isOwner }: { date?: string; isOwner: boolean }) {
  const data = await getDietDayStats(date);
  return <DietContent data={data} isOwner={isOwner} />;
}

export default async function DietPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const targetDate = params.date;

  const cookieStore = await cookies();
  const isOwner = cookieStore.get('admin_token')?.value === process.env.ADMIN_SECRET;

  const displayDate = targetDate
    ? format(new Date(targetDate + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })
    : format(toZonedTime(new Date(), TIMEZONE), "EEEE d 'de' MMMM", { locale: es });

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-12 font-sans selection:bg-blue-500/30 flex flex-col">
      <header className="mb-8 md:mb-12 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-800 pb-6 gap-4">
        <div className="w-full md:w-auto">
          <Link href="/" className="text-sm text-blue-400 hover:text-blue-300 transition-colors mb-4 inline-flex items-center gap-1">
            <span className="text-lg">←</span> Volver al Dashboard
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">
            Registro de Dieta
          </h1>
          <p className="text-gray-500 text-sm mt-1 capitalize">{displayDate}</p>
        </div>
        <div className="flex items-center gap-4">
          <AuthButton isOwner={isOwner} />
          <DietDateNavigator />
        </div>
      </header>

      <Suspense key={targetDate} fallback={<DietSkeleton />}>
        <DietData date={targetDate} isOwner={isOwner} />
      </Suspense>
    </main>
  );
}
