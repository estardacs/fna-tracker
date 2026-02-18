import { Suspense } from 'react';
import DateNavigator from '@/components/dashboard/DateNavigator';
import SantiagoClock from '@/components/dashboard/SantiagoClock';
import RealtimeRefresher from '@/components/dashboard/RealtimeRefresher';
import DashboardContent from '@/components/dashboard/DashboardContent';
import DashboardSkeleton from '@/components/dashboard/DashboardSkeleton';

export const dynamic = 'force-dynamic'; // No caching, real-time data

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const targetDate = params.date;

  return (
    <main className="min-h-screen bg-black text-white p-6 md:p-12 font-sans selection:bg-blue-500/30 flex flex-col">
      <RealtimeRefresher />
      
      {/* Header */}
      <header className="mb-12 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-800 pb-6 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Fña Tracker
            </h1>
            <SantiagoClock />
          </div>
          <p className="text-gray-500 text-sm">
            Panel de Control Personal
          </p>
        </div>
        
        <div className="flex flex-col items-end gap-3 w-full md:w-auto">
          <div className="flex items-center gap-2 text-xs text-gray-600 bg-gray-900 px-3 py-1 rounded-full border border-gray-800">
            <div className={`w-2 h-2 rounded-full ${targetDate ? 'bg-yellow-500' : 'bg-green-500 animate-pulse'}`}></div>
            {targetDate ? 'VISTA HISTÓRICA' : 'SISTEMA ONLINE'}
          </div>
          <DateNavigator />
        </div>
      </header>

      {/* Main Content with Skeleton Loading */}
      <Suspense key={targetDate} fallback={<DashboardSkeleton />}>
        <DashboardContent date={targetDate} />
      </Suspense>

    </main>
  );
}
