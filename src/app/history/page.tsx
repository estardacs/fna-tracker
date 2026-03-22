
import { Suspense } from 'react';
import HistoryView from '@/components/history/HistoryView';
import { getHistoryData, PeriodType } from '@/lib/history-processor';
import Link from 'next/link';

async function triggerSummarize() {
  const secret = process.env.SUMMARIZER_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!secret || !supabaseUrl || !anonKey) return;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/summarize-daily`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${anonKey}`,
        'X-Secret': secret,
      },
      signal: AbortSignal.timeout(25_000),
    });
    console.log('[history] summarize-daily:', res.status);
  } catch (e: any) {
    console.warn('[history] summarize-daily failed:', e.message);
  }
}

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
      <header className="mb-8 md:mb-12 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-800 pb-6 gap-6">
        <Link href="/" className="w-full md:w-auto group">
          <div className="flex items-center justify-between md:justify-start gap-3 mb-2">
            <div className="p-1.5 rounded-xl bg-gradient-to-br from-violet-500/15 to-indigo-500/15 border border-violet-500/20 flex-shrink-0 group-hover:border-violet-500/40 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 md:w-9 md:h-9 text-violet-400" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-[length:200%_auto] bg-gradient-to-r from-violet-400 via-purple-400 to-indigo-400 bg-clip-text text-transparent animate-gradient leading-none">
                Historial de Datos
              </h1>
              <p className="text-[10px] tracking-[0.25em] text-gray-600 uppercase mt-1 group-hover:text-gray-500 transition-colors">
                Patrones · Tendencias · Progreso
              </p>
            </div>
          </div>
        </Link>
      </header>

      <Suspense key={`${period}-${dateStr}`} fallback={<HistorySkeleton />}>
        <HistoryData period={period} dateStr={dateStr} />
      </Suspense>
    </main>
  );
}

async function HistoryData({ period, dateStr }: { period: PeriodType, dateStr?: string }) {
  // Trigger daily summarization before reading data so history is always up to date.
  // Calls the Supabase Edge Function directly — secret never exposed to the client.
  // Silently proceeds if not configured or if the call fails.
  await triggerSummarize();

  const data = await getHistoryData(period, dateStr);
  return <HistoryView data={data} />;
}
