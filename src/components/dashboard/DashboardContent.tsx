import { getDailyStats, getWeeklyStats, getReadingStreak } from '@/lib/data-processor';
import { getHealthDailyStats } from '@/lib/health-processor';
import ActivityChart from '@/components/dashboard/ActivityChart';
import AppsList from '@/components/dashboard/AppsList';
import RecentActivity from '@/components/dashboard/RecentActivity';
import LocationCard from '@/components/dashboard/LocationCard';
import WeeklyGrid from '@/components/dashboard/WeeklyGrid';
import KpiCard from '@/components/dashboard/KpiCard';
import FadeIn from '@/components/dashboard/FadeIn';
import SleepCard from '@/components/health/SleepCard';
import WorkoutCard from '@/components/health/WorkoutCard';
import { BookOpen, Clock, MonitorSmartphone, Zap, Gamepad2, Moon, Footprints, Heart, Scale } from 'lucide-react';

type DashboardContentProps = {
  date?: string;
};

export default async function DashboardContent({ date }: DashboardContentProps) {
  // Fetch data in parallel for better performance
  const [stats, weeklyStats, health] = await Promise.all([
    getDailyStats(date),
    getWeeklyStats(),
    getHealthDailyStats(date),
  ]);

  const todayStr = weeklyStats.find(d => d.totalMinutes > 0)?.date;
  const pastDays = weeklyStats.filter(d => d.date !== (date ?? todayStr) && d.totalMinutes > 0);
  const avgScreenTime = pastDays.length > 0
    ? pastDays.reduce((s, d) => s + d.totalMinutes, 0) / pastDays.length
    : null;

  const readingStreak = await getReadingStreak(stats.readingMinutes > 0);

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
  const streakText = readingStreak > 1 ? `Racha: ${readingStreak} días seguidos` : null;

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

  const booksSubtext = (
    <>
      {streakText && (
        <p className="text-amber-400/80 text-xs font-medium mb-2">{streakText}</p>
      )}
      {booksContent}
    </>
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
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-6 mb-8 md:mb-12">
        <KpiCard
          title="Tiempo Pantalla"
          value={formatDuration(stats.screenTimeMinutes)}
          icon={<MonitorSmartphone className="text-orange-400 w-4 h-4 md:w-6 md:h-6" />}
          subtext={date ? "Combinado" : "Total Hoy"}
          avgMinutes={avgScreenTime ?? undefined}
          currentMinutes={stats.screenTimeMinutes}
        />
        <KpiCard
          title="Sueño"
          value={stats.sleepMinutes > 0 ? formatDuration(stats.sleepMinutes) : '—'}
          icon={<Moon className="text-indigo-400 w-4 h-4 md:w-6 md:h-6" />}
          subtext={stats.sleepMinutes > 0 ? 'horas dormidas' : 'Sin datos'}
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
          subtext={booksSubtext}
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

      {/* Health Section */}
      <section className="mt-10 mb-8">
        <h3 className="text-gray-500 text-xs font-medium uppercase tracking-wider mb-4">Salud</h3>

        {/* Health KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4">
          {health.steps > 0 && (
            <KpiCard
              title="Pasos"
              value={health.steps >= 1000 ? `${(health.steps / 1000).toFixed(1)}k` : `${health.steps}`}
              icon={<Footprints className="text-emerald-400 w-4 h-4 md:w-5 md:h-5" />}
              subtext={`${Math.round((health.steps / 8000) * 100)}% de meta`}
            />
          )}
          {health.heartRate.avg > 0 && (
            <KpiCard
              title="Frec. Cardíaca"
              value={`${health.heartRate.avg}`}
              icon={<Heart className="text-rose-400 w-4 h-4 md:w-5 md:h-5" />}
              subtext={health.heartRate.timeline.length > 0 ? `bpm prom · reposo ${health.heartRate.resting || '—'}` : 'bpm en reposo'}
            />
          )}
          {health.caloriesBurned > 0 && (
            <KpiCard
              title="Calorías"
              value={`${health.caloriesBurned}`}
              icon={<Zap className="text-orange-400 w-4 h-4 md:w-5 md:h-5" />}
              subtext="kcal quemadas"
            />
          )}
          <KpiCard
            title="Peso"
            value={health.weight.current !== null ? `${health.weight.current} kg` : '—'}
            icon={<Scale className="text-purple-400 w-4 h-4 md:w-5 md:h-5" />}
            subtext={
              health.weight.current === null
                ? 'Sin datos'
                : health.weight.delta !== null
                ? `${health.weight.delta > 0 ? '+' : ''}${health.weight.delta} kg esta semana`
                : health.weight.bodyFat !== null
                ? `${health.weight.bodyFat}% grasa`
                : 'Sin cambio reciente'
            }
          />
        </div>

        {/* Sleep + Workouts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SleepCard sleep={health.sleep} />
          <WorkoutCard workouts={health.workouts} />
        </div>
      </section>

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
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
