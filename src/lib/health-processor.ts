import { supabase } from '@/lib/supabase';
import { format, startOfWeek, addDays, subDays, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

const TIMEZONE = 'America/Santiago';

// MET values (Ainsworth Compendium) — used when calories_burned is not reported by device
const WORKOUT_MET: Record<string, number> = {
  climbing: 7.5,
  indoor_climbing: 7.5,
  bouldering: 8.3,
  swimming: 5.8,
  running: 8.0,
  walking: 3.5,
  cycling: 7.5,
  biking: 7.5,
  strength_training: 3.5,
  weightlifting: 3.5,
  yoga: 2.5,
  hiking: 5.3,
  basketball: 6.5,
  football: 7.0,
  soccer: 7.0,
  tennis: 7.3,
  boxing: 12.8,
  dancing: 4.8,
  pilates: 3.0,
  martial_arts: 5.3,
};

// Estimate calories using Keytel formula (HR-based) or MET fallback
function estimateCalories(
  durationSeconds: number,
  activityType: string,
  weightKg: number,
  avgHeartRate?: number | null
): number {
  const hours = durationSeconds / 3600;
  if (avgHeartRate && avgHeartRate > 0) {
    // Keytel et al. (male formula): kcal/min = (-55.0969 + 0.6309×HR + 0.1988×weight + 0.2017×30) / 4.184
    // Using 30 as age estimate since we don't store it
    const kcalPerMin = (-55.0969 + 0.6309 * avgHeartRate + 0.1988 * weightKg + 0.2017 * 30) / 4.184;
    return Math.max(0, Math.round(kcalPerMin * (durationSeconds / 60)));
  }
  const met = WORKOUT_MET[activityType?.toLowerCase()] ?? 4.0;
  return Math.round(met * weightKg * hours);
}

const WORKOUT_DISPLAY_NAMES: Record<string, string> = {
  climbing: 'Escalada',
  indoor_climbing: 'Escalada Indoor',
  bouldering: 'Boulder',
  swimming: 'Natación',
  running: 'Running',
  walking: 'Caminata',
  cycling: 'Ciclismo',
  biking: 'Ciclismo',
  strength_training: 'Pesas',
  weightlifting: 'Pesas',
  yoga: 'Yoga',
  hiking: 'Senderismo',
  basketball: 'Básquetbol',
  football: 'Fútbol',
  soccer: 'Fútbol',
  tennis: 'Tenis',
  boxing: 'Boxeo',
  dancing: 'Baile',
  pilates: 'Pilates',
  martial_arts: 'Artes Marciales',
};

export type WorkoutEntry = {
  type: string;
  displayName: string;
  durationMinutes: number;
  caloriesBurned: number;
  caloriesEstimated: boolean; // true = calculado, false = reportado por dispositivo
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  distanceKm: number | null;
  dateStr: string; // Santiago date of the workout
};

export type HealthDailyStats = {
  steps: number;
  caloriesBurned: number;
  distanceKm: number;
  activeMinutes: number;
  heartRate: {
    avg: number;
    resting: number;
    min: number;
    max: number;
    timeline: { time: string; bpm: number }[];
  };
  stress: {
    avg: number;
    timeline: { time: string; level: number }[];
  };
  sleep: {
    totalMinutes: number;
    deepMinutes: number;
    lightMinutes: number;
    remMinutes: number;
    awakeMinutes: number;
    score: number;
    sleepStart: string;
    sleepEnd: string;
    phases: { start: string; end: string; phase: 'deep' | 'light' | 'rem' | 'awake' }[];
    naps: { start: string; end: string; durationMinutes: number }[];
  } | null;
  weight: {
    current: number | null;
    date: string | null;
    previousWeek: number | null;
    delta: number | null;
    bodyFat: number | null;
    history: { date: string; weight: number }[];
  };
  workouts: WorkoutEntry[];
};

export type HealthWeekDay = {
  date: string;
  dayName: string;
  steps: number;
  sleepMinutes: number;
  hasWorkout: boolean;
  isFuture: boolean;
};

export async function getHealthDailyStats(dateStr?: string): Promise<HealthDailyStats> {
  const now = new Date();
  const zonedNow = toZonedTime(now, TIMEZONE);
  const resolvedDateStr = dateStr || format(zonedNow, 'yyyy-MM-dd');

  // Convert Santiago day boundaries to UTC for TIMESTAMPTZ queries
  const startUtc = fromZonedTime(parseISO(resolvedDateStr + 'T00:00:00'), TIMEZONE);
  const endUtc = fromZonedTime(parseISO(resolvedDateStr + 'T23:59:59'), TIMEZONE);
  const startIso = startUtc.toISOString();
  const endIso = endUtc.toISOString();

  const [metricsRes, workoutsRes, sleepRes, latestWeightRes, weightHistoryRes] = await Promise.all([
    supabase
      .from('health_daily_metrics')
      .select('*')
      .eq('date', resolvedDateStr)
      .maybeSingle(),
    supabase
      .from('health_workouts')
      .select('*')
      .gte('start_time', startIso)
      .lte('start_time', endIso),
    supabase
      .from('health_sleep_sessions')
      .select('*')
      .eq('date', resolvedDateStr)
      .order('duration_minutes', { ascending: false }),
    supabase
      .from('health_weight_log')
      .select('weight_kg, body_fat_percent, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('health_weight_log')
      .select('weight_kg, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  const m = metricsRes.data;
  const allSleepSessions: any[] = sleepRes.data || [];
  // Sueño principal = el más largo (≥ 60 min). Siestas = el resto.
  const sleep = allSleepSessions.find((s) => (s.duration_minutes || 0) >= 60) || null;
  const naps = allSleepSessions.filter((s) => s !== sleep && (s.duration_minutes || 0) > 0);
  const latestWeight = latestWeightRes.data;
  const weightHistory: { weight_kg: number; created_at: string }[] = weightHistoryRes.data || [];

  // HR stats from timeline
  const hrTimeline: { time: string; bpm: number }[] = m?.heart_rate_timeline || [];
  const hrValues = hrTimeline.map((p) => p.bpm).filter((v) => v > 0);
  const hrAvgFromTimeline = hrValues.length > 0 ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : 0;
  // Fallback: si no hay timeline, usar resting_heart_rate como indicador principal
  const hrAvg = hrAvgFromTimeline > 0 ? hrAvgFromTimeline : (m?.resting_heart_rate || 0);
  const hrMin = hrValues.length > 0 ? Math.min(...hrValues) : 0;
  const hrMax = hrValues.length > 0 ? Math.max(...hrValues) : 0;

  // Stress stats from timeline
  const stressTimeline: { time: string; level: number }[] = m?.stress_timeline || [];
  const stressValues = stressTimeline.map((p) => p.level).filter((v) => v >= 0);
  const stressAvg =
    stressValues.length > 0
      ? Math.round(stressValues.reduce((a, b) => a + b, 0) / stressValues.length)
      : 0;

  // Weight delta vs ~7 days ago
  let previousWeekWeight: number | null = null;
  if (latestWeight && weightHistory.length > 1) {
    const cutoff = subDays(new Date(latestWeight.created_at), 6);
    const older = weightHistory.find((w) => new Date(w.created_at) <= cutoff);
    if (older) previousWeekWeight = older.weight_kg;
  }
  const weightDelta =
    latestWeight && previousWeekWeight !== null
      ? Math.round((latestWeight.weight_kg - previousWeekWeight) * 10) / 10
      : null;

  // Workouts — if none for the requested date, fall back to the most recent within 14 days
  const weightKg = latestWeight?.weight_kg ?? 70;
  const mapWorkout = (w: any): WorkoutEntry => {
    const reported = w.calories_burned ?? 0;
    const caloriesBurned = reported > 0
      ? reported
      : estimateCalories(w.duration_seconds || 0, w.activity_type, weightKg, w.avg_heart_rate);
    return {
      type: w.activity_type || '',
      displayName:
        WORKOUT_DISPLAY_NAMES[(w.activity_type || '').toLowerCase()] ||
        w.activity_type ||
        'Entrenamiento',
      durationMinutes: w.duration_seconds ? Math.round(w.duration_seconds / 60) : 0,
      caloriesBurned,
      caloriesEstimated: reported === 0,
      avgHeartRate: w.avg_heart_rate || null,
      maxHeartRate: w.max_heart_rate || null,
      distanceKm: w.distance_meters ? Math.round(w.distance_meters / 100) / 10 : null,
      dateStr: format(toZonedTime(new Date(w.start_time), TIMEZONE), 'yyyy-MM-dd'),
    };
  };

  let workouts: WorkoutEntry[] = (workoutsRes.data || []).map(mapWorkout);


  return {
    steps: m?.step_count || 0,
    caloriesBurned: m?.calories_burned || 0,
    distanceKm: m?.distance_meters ? Math.round((m.distance_meters / 1000) * 10) / 10 : 0,
    activeMinutes: m?.active_minutes || 0,
    heartRate: {
      avg: hrAvg,
      resting: m?.resting_heart_rate || 0,
      min: hrMin,
      max: hrMax,
      timeline: hrTimeline,
    },
    stress: {
      avg: stressAvg,
      timeline: stressTimeline,
    },
    sleep: sleep
      ? {
          totalMinutes: sleep.duration_minutes || 0,
          deepMinutes: sleep.minutes_deep || 0,
          lightMinutes: sleep.minutes_light || 0,
          remMinutes: sleep.minutes_rem || 0,
          awakeMinutes: sleep.minutes_awake || 0,
          score: sleep.efficiency_score || 0,
          sleepStart: sleep.start_time,
          sleepEnd: sleep.end_time,
          phases: sleep.sleep_stages_timeline || [],
          naps: naps.map((n) => ({
            start: n.start_time,
            end: n.end_time,
            durationMinutes: n.duration_minutes || 0,
          })),
        }
      : null,
    weight: {
      current: latestWeight?.weight_kg ?? null,
      date: latestWeight
        ? format(toZonedTime(new Date(latestWeight.created_at), TIMEZONE), 'yyyy-MM-dd')
        : null,
      previousWeek: previousWeekWeight,
      delta: weightDelta,
      bodyFat: latestWeight?.body_fat_percent ?? null,
      history: [...weightHistory]
        .reverse()
        .map((w) => ({
          date: format(toZonedTime(new Date(w.created_at), TIMEZONE), 'yyyy-MM-dd'),
          weight: w.weight_kg,
        })),
    },
    workouts,
  };
}

export async function getHealthWeeklyTrend(): Promise<HealthWeekDay[]> {
  const now = new Date();
  const zonedNow = toZonedTime(now, TIMEZONE);
  const todayStr = format(zonedNow, 'yyyy-MM-dd');
  const startOfCurrentWeek = startOfWeek(zonedNow, { weekStartsOn: 1 });

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(startOfCurrentWeek, i);
    const dateStr = format(d, 'yyyy-MM-dd');
    return {
      date: dateStr,
      dayName: format(d, 'EEE', { locale: es }),
      isFuture: dateStr > todayStr,
    };
  });

  const pastDateStrs = weekDates.filter((d) => !d.isFuture).map((d) => d.date);

  if (pastDateStrs.length === 0) {
    return weekDates.map((d) => ({ ...d, steps: 0, sleepMinutes: 0, hasWorkout: false }));
  }

  // UTC boundaries for the whole week (for workouts query)
  const weekStartUtc = fromZonedTime(
    parseISO(pastDateStrs[0] + 'T00:00:00'),
    TIMEZONE
  ).toISOString();
  const weekEndUtc = fromZonedTime(
    parseISO(pastDateStrs[pastDateStrs.length - 1] + 'T23:59:59'),
    TIMEZONE
  ).toISOString();

  const [metricsRes, workoutsRes, sleepRes] = await Promise.all([
    supabase
      .from('health_daily_metrics')
      .select('date, step_count')
      .in('date', pastDateStrs),
    supabase
      .from('health_workouts')
      .select('start_time')
      .gte('start_time', weekStartUtc)
      .lte('start_time', weekEndUtc),
    supabase
      .from('health_sleep_sessions')
      .select('date, duration_minutes')
      .in('date', pastDateStrs),
  ]);

  const metricsMap = new Map(
    (metricsRes.data || []).map((r: any) => [r.date, r])
  );
  const sleepMap = new Map(
    (sleepRes.data || []).map((r: any) => [r.date, r])
  );
  const workoutDates = new Set(
    (workoutsRes.data || []).map((w: any) =>
      format(toZonedTime(new Date(w.start_time), TIMEZONE), 'yyyy-MM-dd')
    )
  );

  return weekDates.map(({ date, dayName, isFuture }) => {
    const m = metricsMap.get(date);
    const s = sleepMap.get(date);
    return {
      date,
      dayName,
      steps: m?.step_count || 0,
      sleepMinutes: s?.duration_minutes || 0,
      hasWorkout: workoutDates.has(date),
      isFuture,
    };
  });
}
