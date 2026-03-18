import { Suspense } from 'react';
import { cookies } from 'next/headers';
import DateNavigator from '@/components/dashboard/DateNavigator';
import SantiagoClock from '@/components/dashboard/SantiagoClock';
import RealtimeRefresher from '@/components/dashboard/RealtimeRefresher';
import DashboardContent from '@/components/dashboard/DashboardContent';
import DashboardSkeleton from '@/components/dashboard/DashboardSkeleton';

import HistoryButton from '@/components/history/HistoryButton';
import DietButton from '@/components/diet/DietButton';

export const dynamic = 'force-dynamic'; // No caching, real-time data

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const targetDate = params.date;

  const cookieStore = await cookies();
  const isOwner = cookieStore.get('admin_token')?.value === process.env.ADMIN_SECRET;

  return (
    <main className="min-h-screen bg-black text-white p-4 sm:p-6 md:p-12 font-sans selection:bg-blue-500/30 flex flex-col">
      <RealtimeRefresher />
      
      {/* Header */}
      <header className="mb-8 md:mb-12 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-800 pb-6 gap-6">
        <div className="w-full md:w-auto">
          <div className="flex items-center justify-between md:justify-start gap-3 mb-2">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Fña Tracker
            </h1>
          </div>
        </div>
        
        <div className="flex flex-col items-stretch md:items-end gap-3 w-full md:w-auto">
          <div className="flex items-center justify-between md:justify-end gap-2">
            <DietButton />
            <HistoryButton />
            <DateNavigator />
          </div>
        </div>
      </header>

      {/* Main Content with Skeleton Loading */}
      <Suspense key={targetDate} fallback={<DashboardSkeleton />}>
        <DashboardContent date={targetDate} isOwner={isOwner} />
      </Suspense>

    </main>
  );
}
