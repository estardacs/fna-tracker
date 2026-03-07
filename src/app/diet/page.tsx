import { Suspense } from 'react';
import Link from 'next/link';
import { getDietDayStats } from '@/lib/diet-processor';
import DietContent from '@/components/diet/DietContent';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export const dynamic = 'force-dynamic';

function DietSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="bg-gray-900/30 border border-gray-800/50 rounded-2xl p-6 flex gap-6">
        <div className="w-40 h-40 rounded-full bg-gray-800 shrink-0" />
        <div className="flex-1 space-y-3 py-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-4 bg-gray-800 rounded-full" style={{ width: `${70 - i * 10}%` }} />
          ))}
        </div>
      </div>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-14 bg-gray-900/30 border border-gray-800/50 rounded-xl" />
      ))}
    </div>
  );
}

async function DietData({ date }: { date?: string }) {
  const data = await getDietDayStats(date);
  return <DietContent data={data} />;
}

export default async function DietPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const targetDate = params.date;

  const displayDate = targetDate
    ? format(new Date(targetDate + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })
    : format(new Date(), "EEEE d 'de' MMMM", { locale: es });

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-12 font-sans selection:bg-blue-500/30 flex flex-col">
      <header className="mb-8 md:mb-12 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-800 pb-6 gap-4">
        <div className="w-full">
          <Link href="/" className="text-sm text-blue-400 hover:text-blue-300 transition-colors mb-4 inline-flex items-center gap-1">
            <span className="text-lg">←</span> Volver al Dashboard
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">
            Registro de Dieta
          </h1>
          <p className="text-gray-500 text-sm mt-1 capitalize">{displayDate}</p>
        </div>
      </header>

      <Suspense key={targetDate} fallback={<DietSkeleton />}>
        <DietData date={targetDate} />
      </Suspense>
    </main>
  );
}
