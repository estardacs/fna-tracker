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
  const secret = process.env.ADMIN_SECRET;
  const isOwner = !!secret && cookieStore.get('admin_token')?.value === secret;

  const displayDate = targetDate
    ? format(new Date(targetDate + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })
    : format(toZonedTime(new Date(), TIMEZONE), "EEEE d 'de' MMMM", { locale: es });

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-12 font-sans selection:bg-blue-500/30 flex flex-col">
      <header className="mb-8 md:mb-12 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-800 pb-6 gap-6">
        <Link href="/" className="w-full md:w-auto group">
          <div className="flex items-center justify-between md:justify-start gap-3 mb-2">
            <div className="p-1.5 rounded-xl bg-gradient-to-br from-orange-500/15 to-rose-500/15 border border-orange-500/20 flex-shrink-0 group-hover:border-orange-500/40 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 md:w-9 md:h-9 text-orange-400" aria-hidden="true"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-[length:200%_auto] bg-gradient-to-r from-orange-400 via-rose-400 to-pink-400 bg-clip-text text-transparent animate-gradient leading-none">
                Registro de Dieta
              </h1>
              <p className="text-[10px] tracking-[0.25em] text-gray-600 uppercase mt-1 capitalize group-hover:text-gray-500 transition-colors">
                {displayDate}
              </p>
            </div>
          </div>
        </Link>
        <div className="flex items-center gap-4 w-full md:w-auto">
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
