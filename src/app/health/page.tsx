import { Suspense } from 'react';
import Link from 'next/link';
import { getHealthDailyStats, getHealthWeeklyTrend } from '@/lib/health-processor';
import KpiCard from '@/components/dashboard/KpiCard';
import HeartRateChart from '@/components/health/HeartRateChart';
import StressChart from '@/components/health/StressChart';
import SleepCard from '@/components/health/SleepCard';
import WeightChart from '@/components/health/WeightChart';
import WorkoutCard from '@/components/health/WorkoutCard';
import WeeklyHealthGrid from '@/components/health/WeeklyHealthGrid';
import HealthDateNavigator from '@/components/health/HealthDateNavigator';
import FadeIn from '@/components/dashboard/FadeIn';
import HealthLoading from './loading';
import { Heart, Footprints, Flame, Moon, Scale } from 'lucide-react';

export const dynamic = 'force-dynamic';

function formatSteps(steps: number) {
  if (steps >= 1000) return `${(steps / 1000).toFixed(1)}k`;
  return `${steps}`;
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const dateStr = params.date;

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-12 font-sans selection:bg-rose-500/30 flex flex-col">
      <header className="mb-8 md:mb-12 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-800 pb-6 gap-4">
        <div>
          <Link
            href="/"
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors mb-3 inline-flex items-center gap-1"
          >
            <span className="text-base">←</span> Dashboard
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-r from-rose-400 to-pink-400 bg-clip-text text-transparent">
            Salud
          </h1>
          <p className="text-gray-500 text-sm mt-1">Biometría y actividad física</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/history"
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors px-3 py-2 border border-gray-800 rounded-lg"
          >
            Historial
          </Link>
          <HealthDateNavigator />
        </div>
      </header>

      <Suspense key={dateStr} fallback={<HealthLoading />}>
        <HealthContent date={dateStr} />
      </Suspense>
    </main>
  );
}

async function HealthContent({ date }: { date?: string }) {
  const [stats, weeklyTrend] = await Promise.all([
    getHealthDailyStats(date),
    getHealthWeeklyTrend(),
  ]);

  const STEPS_GOAL = 8000;
  const stepsPercent = STEPS_GOAL > 0 ? Math.round((stats.steps / STEPS_GOAL) * 100) : 0;
  const sleepScore = stats.sleep?.score ?? null;

  return (
    <FadeIn>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-6 mb-8 md:mb-10">
        <KpiCard
          title="Pasos"
          value={formatSteps(stats.steps)}
          icon={<Footprints className="text-emerald-400 w-4 h-4 md:w-6 md:h-6" />}
          subtext={
            stats.steps > 0 ? (
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <span>{stepsPercent}% de {(STEPS_GOAL / 1000).toFixed(0)}k meta</span>
                </div>
                <div className="h-1 w-full bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500/70 rounded-full"
                    style={{ width: `${Math.min(100, stepsPercent)}%` }}
                  />
                </div>
              </div>
            ) : 'Sin datos'
          }
          isLongText
        />
        <KpiCard
          title="Calorías"
          value={stats.caloriesBurned > 0 ? `${stats.caloriesBurned}` : '—'}
          icon={<Flame className="text-orange-400 w-4 h-4 md:w-6 md:h-6" />}
          subtext={stats.caloriesBurned > 0 ? 'kcal quemadas' : 'Sin datos'}
        />
        <KpiCard
          title="Frec. Cardíaca"
          value={stats.heartRate.avg > 0 ? `${stats.heartRate.avg}` : '—'}
          icon={<Heart className="text-rose-400 w-4 h-4 md:w-6 md:h-6" />}
          subtext={
            stats.heartRate.avg > 0 ? (
              stats.heartRate.timeline.length > 0 ? (
                <span>bpm prom · reposo {stats.heartRate.resting > 0 ? `${stats.heartRate.resting}` : '—'}</span>
              ) : (
                <span>bpm en reposo</span>
              )
            ) : 'Sin datos'
          }
        />
        <KpiCard
          title="Sueño"
          value={stats.sleep ? formatDuration(stats.sleep.totalMinutes) : '—'}
          icon={<Moon className="text-indigo-400 w-4 h-4 md:w-6 md:h-6" />}
          subtext={
            stats.sleep ? (
              <span>
                {sleepScore !== null && sleepScore > 0 ? `Calidad ${sleepScore}% · ` : ''}
                {stats.sleep.deepMinutes > 0
                  ? `Profundo ${formatDuration(stats.sleep.deepMinutes)}`
                  : `${formatDuration(stats.sleep.totalMinutes)} nocturno`}
                {stats.sleep.naps.length > 0
                  ? ` · ${stats.sleep.naps.length} siesta${stats.sleep.naps.length > 1 ? 's' : ''}`
                  : ''}
              </span>
            ) : 'Sin datos'
          }
        />
        <KpiCard
          title="Peso"
          value={stats.weight.current !== null ? `${stats.weight.current} kg` : '—'}
          icon={<Scale className="text-purple-400 w-4 h-4 md:w-6 md:h-6" />}
          subtext={
            stats.weight.current !== null ? (
              stats.weight.delta !== null ? (
                <span className={stats.weight.delta < 0 ? 'text-emerald-400' : stats.weight.delta > 0 ? 'text-orange-400' : ''}>
                  {stats.weight.delta > 0 ? '+' : ''}{stats.weight.delta} kg esta semana
                </span>
              ) : (
                stats.weight.bodyFat !== null ? `${stats.weight.bodyFat}% grasa` : 'Sin cambio reciente'
              )
            ) : 'Sin datos'
          }
        />
      </div>

      {/* Heart Rate Chart */}
      <section className="mb-6 md:mb-8">
        <HeartRateChart timeline={stats.heartRate.timeline} resting={stats.heartRate.resting} />
      </section>

      {/* Stress + Sleep */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-6 md:mb-8">
        <StressChart timeline={stats.stress.timeline} avg={stats.stress.avg} />
        <SleepCard sleep={stats.sleep} />
      </div>

      {/* Weight + Workouts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-10 md:mb-12">
        <WeightChart
          current={stats.weight.current}
          delta={stats.weight.delta}
          bodyFat={stats.weight.bodyFat}
          history={stats.weight.history}
        />
        <WorkoutCard workouts={stats.workouts} />
      </div>

      {/* Weekly grid */}
      <section>
        <WeeklyHealthGrid days={weeklyTrend} />
      </section>
    </FadeIn>
  );
}
