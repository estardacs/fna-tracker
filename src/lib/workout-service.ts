/**
 * Workout logging, independent of how it is invoked — the MCP route is a thin wrapper.
 *
 * Calories use the *corrected* MET. A standard MET assumes a resting uptake of
 * 3.5 ml O2/kg/min, which overstates rest for a heavier body; replacing it with the
 * person's own Mifflin-St Jeor BMR gives
 *
 *   gross = MET × (BMR / 24) × hours
 *   net   = (MET − 1) × (BMR / 24) × hours
 *
 * Only `net` is added to the day's expenditure: the resting part is already inside the
 * TDEE, so adding `gross` would count it twice. BMI is reported as context, never used as a
 * factor — two people with the same BMI and different heights burn different amounts.
 *
 * Rows go into health_workouts next to Health Connect's, so the dashboard shows them with
 * no UI changes. `calories_burned` holds the gross figure, like a watch would report.
 *
 * Both figures are FROZEN when the row is written, using the weight in force on the
 * workout's date. They are never recomputed on read: otherwise every weigh-in would rewrite
 * the exercise, and the deficit, of every past day.
 */
import { supabase } from '@/lib/supabase';
import { parseISO, addSeconds } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { getBodyProfile, todayInSantiago } from '@/lib/diet-service';

const TIMEZONE = 'America/Santiago';

export const INTENSITIES = ['low', 'medium', 'high'] as const;
export type Intensity = (typeof INTENSITIES)[number];

/** [upper bound exclusive, MET]. Speed is km/h, except swimming, which is m/min. */
type SpeedBands = { unit: 'km/h' | 'm/min'; bands: [number, number][] };

type Activity = {
  label: string;
  met: Record<Intensity, number> | null;
  speed?: SpeedBands;
};

// Values from the Compendium of Physical Activities (Ainsworth et al.).
export const ACTIVITIES = {
  walking: {
    label: 'Caminata',
    met: { low: 2.8, medium: 3.5, high: 5.0 },
    speed: { unit: 'km/h', bands: [[3.6, 2.8], [4.3, 3.0], [5.3, 3.5], [6.0, 4.3], [6.8, 5.0], [Infinity, 7.0]] },
  },
  running: {
    label: 'Running',
    met: { low: 6.0, medium: 8.3, high: 11.0 },
    speed: {
      unit: 'km/h',
      bands: [[7.2, 6.0], [8.2, 8.3], [9.0, 9.0], [10.2, 9.8], [11.0, 10.5], [11.7, 11.0], [12.5, 11.5], [13.3, 11.8], [14.1, 12.3], [15.3, 12.8], [Infinity, 14.5]],
    },
  },
  cycling: {
    label: 'Ciclismo',
    met: { low: 4.0, medium: 6.8, high: 10.0 },
    speed: { unit: 'km/h', bands: [[16, 4.0], [19.3, 6.8], [22.5, 8.0], [25.7, 10.0], [30.6, 12.0], [Infinity, 15.8]] },
  },
  swimming: {
    label: 'Natación',
    // Freestyle: slow / ~46 m/min / ~69 m/min. Average pace includes rests between laps.
    met: { low: 5.8, medium: 8.3, high: 10.0 },
    speed: { unit: 'm/min', bands: [[35, 5.8], [57, 8.3], [Infinity, 10.0]] },
  },
  strength_training: { label: 'Pesas', met: { low: 3.5, medium: 5.0, high: 6.0 } },
  hiking: { label: 'Trekking', met: { low: 5.3, medium: 6.0, high: 7.8 } },
  climbing: { label: 'Escalada', met: { low: 5.0, medium: 7.5, high: 8.0 } },
  yoga: { label: 'Yoga', met: { low: 2.5, medium: 3.0, high: 4.0 } },
  football: { label: 'Fútbol', met: { low: 7.0, medium: 8.0, high: 10.0 } },
  basketball: { label: 'Básquetbol', met: { low: 4.5, medium: 6.5, high: 8.0 } },
  tennis: { label: 'Tenis', met: { low: 6.0, medium: 7.3, high: 8.0 } },
  // No table: the caller must supply a MET, and the row records that it did.
  other: { label: 'Otro', met: null },
} satisfies Record<string, Activity>;

export type ActivityKey = keyof typeof ACTIVITIES;
export const ACTIVITY_KEYS = Object.keys(ACTIVITIES) as [ActivityKey, ...ActivityKey[]];

const round = (n: number) => Math.round(n);

function metFromSpeed(speed: SpeedBands, distanceM: number, durationMin: number) {
  const value = speed.unit === 'm/min' ? distanceM / durationMin : distanceM / 1000 / (durationMin / 60);
  const met = speed.bands.find(([upper]) => value < upper)![1];
  return { met, pace: `${Math.round(value * 10) / 10} ${speed.unit}` };
}

/**
 * Distance, when given, decides the MET: speed is measured, intensity is perceived. When
 * the two disagree the result says so instead of silently picking one.
 */
function resolveMet(input: {
  activity: ActivityKey;
  intensity: Intensity;
  durationMin: number;
  distanceM?: number;
  met?: number;
}) {
  const activity: Activity = ACTIVITIES[input.activity];

  if (!activity.met) {
    if (!input.met) throw new Error(`Para "${input.activity}" hay que indicar el MET explícitamente.`);
    return { met: input.met, basis: 'client' as const, note: null };
  }
  if (input.met) {
    throw new Error(`"${input.activity}" tiene MET tabulado; el parámetro met solo se acepta con activity="other".`);
  }

  const byIntensity = activity.met[input.intensity];
  if (!activity.speed || !input.distanceM) {
    return { met: byIntensity, basis: 'intensity' as const, note: null };
  }

  const { met, pace } = metFromSpeed(activity.speed, input.distanceM, input.durationMin);
  const note =
    met === byIntensity
      ? null
      : `El ritmo (${pace}) corresponde a MET ${met}; la intensidad "${input.intensity}" habría dado ${byIntensity}. Se usó el ritmo.`;
  return { met, basis: 'speed' as const, note, pace };
}

function kcal(met: number, bmr: number, hours: number) {
  const perHour = bmr / 24;
  return { gross: round(met * perHour * hours), net: round(Math.max(0, met - 1) * perHour * hours) };
}

function dayBounds(date: string) {
  return {
    start: fromZonedTime(parseISO(`${date}T00:00:00`), TIMEZONE).toISOString(),
    end: fromZonedTime(parseISO(`${date}T23:59:59`), TIMEZONE).toISOString(),
  };
}

/**
 * start_time is NOT NULL and UNIQUE (Health Connect upserts on it). Without a given hour the
 * workout is placed at noon, and any collision moves it forward a second at a time.
 */
async function freeStartTime(date: string, hhmm?: string) {
  let start = fromZonedTime(parseISO(`${date}T${hhmm ?? '12:00'}:00`), TIMEZONE);
  const { start: from, end: to } = dayBounds(date);
  const { data, error } = await supabase
    .from('health_workouts')
    .select('start_time')
    .gte('start_time', from)
    .lte('start_time', to);
  if (error) throw new Error(`No se pudieron leer los entrenamientos: ${error.message}`);

  const taken = new Set((data ?? []).map(r => new Date(r.start_time).getTime()));
  while (taken.has(start.getTime())) start = addSeconds(start, 1);
  return start;
}

// ---------------------------------------------------------------- logging

export async function logWorkout(input: {
  date?: string;
  activity: ActivityKey;
  durationMin: number;
  intensity: Intensity;
  distanceM?: number;
  startTime?: string;
  met?: number;
  notes?: string;
}) {
  if (!(input.durationMin > 0)) throw new Error('La duración debe ser un número positivo.');
  const date = input.date ?? todayInSantiago();

  const [profile, start] = await Promise.all([getBodyProfile(date), freeStartTime(date, input.startTime)]);
  const resolved = resolveMet(input);
  const { gross, net } = kcal(resolved.met, profile.bmr, input.durationMin / 60);
  const durationSeconds = Math.round(input.durationMin * 60);

  const { data, error } = await supabase
    .from('health_workouts')
    .insert({
      activity_type: input.activity,
      start_time: start.toISOString(),
      end_time: addSeconds(start, durationSeconds).toISOString(),
      duration_seconds: durationSeconds,
      distance_meters: input.distanceM ?? null,
      calories_burned: gross,
      net_calories: net,
      source: 'manual',
      intensity: input.intensity,
      met: resolved.met,
      notes: input.notes ?? null,
      metadata: {
        met_basis: resolved.basis,
        ...(resolved.basis === 'client' && { met_source: 'client' }),
        ...(!input.startTime && { time_estimated: true }),
        bmr: round(profile.bmr),
        weight_kg: profile.weightKg,
      },
    })
    .select('id')
    .single();

  if (error) throw new Error(`No se pudo registrar el entrenamiento: ${error.message}`);

  return {
    id: data.id,
    date,
    activity: ACTIVITIES[input.activity].label,
    duration_min: input.durationMin,
    intensity: input.intensity,
    met: resolved.met,
    met_basis: resolved.basis,
    ...(resolved.note && { note: resolved.note }),
    calories_gross: gross,
    calories_net: net,
    body: { weight_kg: profile.weightKg, bmr: round(profile.bmr), bmi: profile.bmi },
  };
}

export async function deleteWorkout(id: number) {
  const { data, error } = await supabase
    .from('health_workouts')
    .delete()
    .eq('id', id)
    .eq('source', 'manual')
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`No se pudo borrar el entrenamiento ${id}: ${error.message}`);
  if (!data) throw new Error(`No existe un entrenamiento manual con id ${id}. Los de Health Connect no se borran.`);
  return { id };
}

// ---------------------------------------------------------------- reading

type WorkoutRow = {
  id: number;
  activity_type: string;
  start_time: string;
  duration_seconds: number | null;
  distance_meters: number | null;
  calories_burned: number | null;
  net_calories: number | null;
  source: string;
  intensity: string | null;
  met: number | null;
  notes: string | null;
};

/**
 * Frozen calories for a row that arrives without them (a Health Connect sync). A reported
 * gross is kept; a missing one uses the activity's medium MET. The BMR is the one in force
 * on the workout's date, so re-sending the same workout always yields the same numbers.
 */
export async function freezeWorkoutCalories(row: {
  activity_type: string;
  start_time: string;
  duration_seconds?: number | null;
  calories_burned?: number | null;
  met?: number | null;
}) {
  const { bmr } = await getBodyProfile(santiagoDate(row.start_time));
  const hours = (row.duration_seconds ?? 0) / 3600;
  const rest = (bmr / 24) * hours;
  const reported = Number(row.calories_burned) || 0;
  const met = Number(row.met) || ACTIVITIES[row.activity_type as ActivityKey]?.met?.medium || 4.0;
  const gross = reported > 0 ? reported : round(met * rest);
  return {
    calories_burned: gross,
    net_calories: round(Math.max(0, gross - rest)),
    met: reported > 0 ? (row.met ?? null) : met,
    estimated: reported === 0,
    bmr: round(bmr),
  };
}

/** Stored figures win; only a row that predates freezing is computed, at its own date. */
async function rowKcal(row: WorkoutRow) {
  if (row.net_calories !== null && row.calories_burned !== null) {
    return { gross: Number(row.calories_burned), net: Number(row.net_calories) };
  }
  const frozen = await freezeWorkoutCalories(row);
  return { gross: frozen.calories_burned, net: frozen.net_calories };
}

async function fetchWorkouts(from: string, to: string) {
  const { data, error } = await supabase
    .from('health_workouts')
    .select('id, activity_type, start_time, duration_seconds, distance_meters, calories_burned, net_calories, source, intensity, met, notes')
    .gte('start_time', dayBounds(from).start)
    .lte('start_time', dayBounds(to).end)
    .order('start_time', { ascending: true });
  if (error) throw new Error(`No se pudieron leer los entrenamientos: ${error.message}`);
  return (data ?? []) as WorkoutRow[];
}

function santiagoDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

export async function listWorkouts(date: string) {
  const rows = await fetchWorkouts(date, date);
  const workouts = await Promise.all(rows.map(async r => ({
    id: r.id,
    activity: ACTIVITIES[r.activity_type as ActivityKey]?.label ?? r.activity_type,
    source: r.source,
    duration_min: Math.round((r.duration_seconds ?? 0) / 60),
    distance_m: r.distance_meters === null ? null : Number(r.distance_meters),
    intensity: r.intensity,
    met: r.met === null ? null : Number(r.met),
    ...(await rowKcal(r)),
    notes: r.notes,
  })));

  return {
    date,
    gross: workouts.reduce((s, w) => s + w.gross, 0),
    net: workouts.reduce((s, w) => s + w.net, 0),
    workouts,
  };
}

/** Net exercise kcal per Santiago date, for deficit maths. */
export async function getNetExerciseByDate(from: string, to: string) {
  const byDate = new Map<string, number>();
  for (const row of await fetchWorkouts(from, to)) {
    const day = santiagoDate(row.start_time);
    byDate.set(day, (byDate.get(day) ?? 0) + (await rowKcal(row)).net);
  }
  return byDate;
}
