
import { Suspense } from 'react';
import HistoryView from '@/components/history/HistoryView';
import { getHistoryData, PeriodType } from '@/lib/history-processor';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

// A loading skeleton component matching the new layout
function HistorySkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      {/* Header Skeleton */}
      <div className="flex justify-between items-center">
        <div className="h-10 w-64 bg-gray-800 rounded-lg"></div>
        <div className="h-10 w-32 bg-gray-800 rounded-lg hidden md:block"></div>
      </div>

      {/* Chart Skeleton */}
      <div className="w-full h-[400px] bg-gray-900/50 border border-gray-800 rounded-xl relative overflow-hidden">
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-gray-800/20 to-transparent"></div>
      </div>

      {/* Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 h-[400px] flex flex-col gap-4">
            <div className="h-6 w-3/4 bg-gray-800 rounded"></div>
            <div className="h-4 w-1/2 bg-gray-800 rounded"></div>
            <div className="grid grid-cols-2 gap-4 mt-4">
               <div className="h-16 bg-gray-800 rounded-lg"></div>
               <div className="h-16 bg-gray-800 rounded-lg"></div>
            </div>
            <div className="space-y-2 mt-auto">
               <div className="h-8 bg-gray-800 rounded"></div>
               <div className="h-8 bg-gray-800 rounded"></div>
               <div className="h-8 bg-gray-800 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string }>;
}) {
  const params = await searchParams;
  const period = (params.period || 'weekly') as PeriodType;
  const dateStr = params.date; // If undefined, processor defaults to today

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-12 font-sans selection:bg-blue-500/30 flex flex-col">
       <header className="mb-8 md:mb-12 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-800 pb-6 gap-4">
        <div className="w-full">
          <Link href="/" className="text-sm text-blue-400 hover:text-blue-300 transition-colors mb-4 inline-flex items-center gap-1">
            <span className="text-lg">←</span> Volver al Dashboard
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-r from-green-400 to-teal-400 bg-clip-text text-transparent">
            Historial de Datos
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Análisis de tendencias a largo plazo.
          </p>
        </div>
      </header>

      <Suspense key={`${period}-${dateStr}`} fallback={<HistorySkeleton />}>
        <HistoryData period={period} dateStr={dateStr} />
      </Suspense>
    </main>
  );
}

async function HistoryData({ period, dateStr }: { period: PeriodType, dateStr?: string }) {
  const data = await getHistoryData(period, dateStr);
  return <HistoryView data={data} />;
}
