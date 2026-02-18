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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 mb-12">
        <KpiCard 
          title="Tiempo en Pantalla" 
          value={formatDuration(stats.screenTimeMinutes)} 
          icon={<MonitorSmartphone className="text-orange-400" />}
          subtext={date ? "Combinado" : "Total Hoy"}
        />
        <KpiCard 
          title="Tiempo en PC" 
          value={formatDuration(stats.pcTotalMinutes)} 
          icon={<Zap className="text-blue-400" />}
          subtext={date ? "En esa fecha" : "Hoy"}
        />
        <KpiCard 
          title="Tiempo en Móvil" 
          value={formatDuration(stats.mobileTotalMinutes)} 
          icon={<Clock className="text-emerald-400" />}
          subtext={date ? "En esa fecha" : "Hoy"}
        />
        <KpiCard 
          title="Lectura" 
          value={formatDuration(stats.readingMinutes)} 
          icon={<BookOpen className="text-purple-400" />}
          subtext={booksContent}
          isLongText
        />
        <KpiCard 
          title="Juegos" 
          value={formatDuration(stats.gamingMinutes)} 
          icon={<Gamepad2 className="text-indigo-400" />}
          subtext={gamesContent}
          isLongText
        />
      </div>

      {/* Main Chart */}
      <section className="mb-12">
        <ActivityChart data={stats.activityTimeline} />
      </section>

      {/* Detailed Lists & Logs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
