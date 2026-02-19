import { getDailyStats, getWeeklyStats } from '@/lib/data-processor';
import ActivityChart from '@/components/dashboard/ActivityChart';
import AppsList from '@/components/dashboard/AppsList';
import RecentActivity from '@/components/dashboard/RecentActivity';
import LocationCard from '@/components/dashboard/LocationCard';
import WeeklyGrid from '@/components/dashboard/WeeklyGrid';
import KpiCard from '@/components/dashboard/KpiCard';
import FadeIn from '@/components/dashboard/FadeIn';
import { BookOpen, Clock, MonitorSmartphone, Zap, Gamepad2 } from 'lucide-react';

type DashboardContentProps = {
  date?: string;
};

export default async function DashboardContent({ date }: DashboardContentProps) {
  // Fetch data in parallel for better performance
  const [stats, weeklyStats] = await Promise.all([
    getDailyStats(date),
    getWeeklyStats()
  ]);

  // Empty State
  if (stats.screenTimeMinutes === 0 && stats.pcTotalMinutes === 0 && stats.mobileTotalMinutes === 0) {
    return (
      <FadeIn>
        <div className="flex flex-col items-center justify-center py-24 bg-gray-900/30 border border-dashed border-gray-800 rounded-xl text-center mb-12">
            <div className="w-20 h-20 bg-gray-800/50 rounded-full flex items-center justify-center mb-6 text-4xl shadow-inner">
                💤
            </div>
            <h3 className="text-xl font-medium text-gray-300 mb-2">Sin actividad registrada</h3>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
                No se encontraron datos de PC, móvil o lectura para esta fecha.
            </p>
        </div>
        <section className="mt-12 mb-6">
            <WeeklyGrid days={weeklyStats} />
        </section>
      </FadeIn>
    );
  }

  // Formatear la lista de libros (Lista con bullets y tiempo real)
  const booksContent = stats.booksReadToday.length > 0 ? (
    <ul className="list-disc list-inside space-y-3 mt-3 text-gray-300">
      {stats.booksReadToday.map((b, idx) => (
        <li key={idx} className="text-xs md:text-sm leading-relaxed border-b border-gray-800/50 pb-2 last:border-0">
          <span className="font-medium text-gray-100">{b.title}</span>
          <div className="flex gap-3 mt-1 ml-5 text-[10px] md:text-xs text-gray-500 font-mono">
            <span className="bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded">
              {b.percent}%
            </span>
            <span className="bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">
              {formatDuration(b.timeSpentSec / 60)} 
            </span>
          </div>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-gray-500 text-sm mt-2 italic">Sin lectura registrada</p>
  );

  const gamesContent = stats.gamesPlayedToday.length > 0 ? (
    <ul className="list-disc list-inside space-y-3 mt-3 text-gray-300">
      {stats.gamesPlayedToday.map((g, idx) => (
        <li key={idx} className="text-xs md:text-sm leading-relaxed border-b border-gray-800/50 pb-2 last:border-0">
          <span className="font-medium text-gray-100">{g.title}</span>
          <div className="flex gap-3 mt-1 ml-5 text-[10px] md:text-xs text-gray-500 font-mono">
            <span className="bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded">
              {formatDuration(g.timeSpentSec / 60)} 
            </span>
          </div>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-gray-500 text-sm mt-2 italic">Sin juegos hoy</p>
  );

  return (
    <FadeIn>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-6 mb-8 md:mb-12">
        <KpiCard 
          title="Tiempo Pantalla" 
          value={formatDuration(stats.screenTimeMinutes)} 
          icon={<MonitorSmartphone className="text-orange-400 w-4 h-4 md:w-6 md:h-6" />}
          subtext={date ? "Combinado" : "Total Hoy"}
        />
        <KpiCard 
          title="Tiempo en PC" 
          value={formatDuration(stats.pcTotalMinutes)} 
          icon={<Zap className="text-blue-400 w-4 h-4 md:w-6 md:h-6" />}
          subtext={date ? "En esa fecha" : "Hoy"}
        />
        <KpiCard 
          title="Tiempo en Móvil" 
          value={formatDuration(stats.mobileTotalMinutes)} 
          icon={<Clock className="text-emerald-400 w-4 h-4 md:w-6 md:h-6" />}
          subtext={date ? "En esa fecha" : "Hoy"}
        />
        <KpiCard 
          title="Lectura" 
          value={formatDuration(stats.readingMinutes)} 
          icon={<BookOpen className="text-purple-400 w-4 h-4 md:w-6 md:h-6" />}
          subtext={booksContent}
          isLongText
        />
        <KpiCard 
          title="Juegos" 
          value={formatDuration(stats.gamingMinutes)} 
          icon={<Gamepad2 className="text-indigo-400 w-4 h-4 md:w-6 md:h-6" />}
          subtext={gamesContent}
          isLongText
        />
      </div>

      {/* Main Chart */}
      <section className="mb-8 md:mb-12">
        <ActivityChart data={stats.activityTimeline} />
      </section>

      {/* Detailed Lists & Logs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <AppsList title="Historial PC" apps={stats.pcAppHistory} type="pc" />
        <AppsList title="Historial Móvil" apps={stats.topMobileApps} type="mobile" />
        <LocationCard 
          officeMinutes={stats.locationStats.officeMinutes} 
          homeMinutes={stats.locationStats.homeMinutes}
          outsideMinutes={stats.locationStats.outsideMinutes}
          lastStatus={stats.lastPcStatus}
          lastMobileStatus={stats.lastMobileStatus}
          breakdown={stats.locationBreakdown}
          screenTimeTotal={stats.screenTimeMinutes}
        />
        <RecentActivity events={stats.recentEvents} />
      </div>

      {/* Weekly Summary */}
      <section className="mt-12 mb-6">
        <WeeklyGrid days={weeklyStats} />
      </section>
    </FadeIn>
  );
}

function formatDuration(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.floor(totalMinutes % 60);
  const s = Math.round((totalMinutes % 1) * 60);
  
  const hh = h.toString().padStart(2, '0');
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  
  return `${hh}:${mm}:${ss}`;
}
