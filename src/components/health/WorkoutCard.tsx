import { Activity, Mountain, Waves, PersonStanding, Footprints, Bike, Dumbbell, Flower2, Flame, Heart } from 'lucide-react';
import { type ReactNode } from 'react';

type Workout = {
  type: string;
  displayName: string;
  durationMinutes: number;
  caloriesBurned: number;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  distanceKm: number | null;
};

type Props = { workouts: Workout[] };

function getWorkoutIcon(type: string): ReactNode {
  const t = type.toLowerCase();
  if (t.includes('climb') || t.includes('boulder')) return <Mountain className="w-5 h-5" />;
  if (t.includes('swim')) return <Waves className="w-5 h-5" />;
  if (t.includes('run')) return <PersonStanding className="w-5 h-5" />;
  if (t.includes('walk') || t.includes('hik')) return <Footprints className="w-5 h-5" />;
  if (t.includes('cycl') || t.includes('bik')) return <Bike className="w-5 h-5" />;
  if (t.includes('strength') || t.includes('weight')) return <Dumbbell className="w-5 h-5" />;
  if (t.includes('yoga') || t.includes('pilates')) return <Flower2 className="w-5 h-5" />;
  return <Activity className="w-5 h-5" />;
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export default function WorkoutCard({ workouts }: Props) {
  if (workouts.length === 0) {
    return (
      <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4 flex items-center justify-center min-h-[120px]">
        <p className="text-gray-600 text-sm italic">Sin entrenamientos hoy</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
      <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-3">Entrenamientos</h3>
      <div className="flex flex-col gap-3">
        {workouts.map((w, i) => (
          <div key={i} className="flex items-center gap-3 bg-black/20 rounded-lg p-3 border border-gray-800/50">
            <div className="p-2 bg-gray-800/50 rounded-lg text-emerald-400 shrink-0">
              {getWorkoutIcon(w.type)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-200 truncate">{w.displayName}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                <span className="text-[10px] text-gray-500 font-mono">{formatDuration(w.durationMinutes)}</span>
                {w.caloriesBurned > 0 && (
                  <span className="text-[10px] text-gray-500 font-mono flex items-center gap-0.5">
                    <Flame className="w-2.5 h-2.5 text-orange-400" />{w.caloriesBurned} kcal
                  </span>
                )}
                {w.avgHeartRate && (
                  <span className="text-[10px] text-gray-500 font-mono flex items-center gap-0.5">
                    <Heart className="w-2.5 h-2.5 text-rose-400" />{w.avgHeartRate} bpm
                  </span>
                )}
                {w.distanceKm && (
                  <span className="text-[10px] text-gray-500 font-mono">{w.distanceKm} km</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
