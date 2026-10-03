import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { freezeWorkoutCalories } from '@/lib/workout-service';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const TIMEZONE = 'America/Santiago';
const SECRET = 'fna-tracker-upload-key';

/**
 * POST /api/track/health
 *
 * Endpoint unificado para ingesta de datos de salud desde MacroDroid.
 * Mismo secret que /api/track/wearable.
 *
 * Body: { secret, type, ...fields }
 *
 * type = 'daily_metrics'  → upsert en health_daily_metrics (por fecha Santiago)
 * type = 'sleep'          → insert en health_sleep_sessions
 * type = 'workout'        → insert en health_workouts
 * type = 'weight'         → insert en health_weight_log
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { secret, type, ...data } = body;

    if (secret !== SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!type) {
      return NextResponse.json({ error: 'Missing type' }, { status: 400 });
    }

    const todayStr = format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');

    switch (type) {
      case 'daily_metrics': {
        // Upsert: si ya existe un registro para hoy, actualiza solo los campos enviados
        const { error } = await supabase
          .from('health_daily_metrics')
          .upsert(
            { date: data.date || todayStr, ...data, updated_at: new Date().toISOString() },
            { onConflict: 'date' }
          );
        if (error) throw error;
        break;
      }

      case 'sleep': {
        // Upsert por (date, start_time) para evitar duplicados cuando WorkManager re-ejecuta
        // La fecha se deriva del end_time (hora de despertar en Santiago), no de hoy,
        // porque el sueño puede sincronizarse días después o a medianoche
        let sleepDate = data.date;
        if (!sleepDate && data.end_time) {
          sleepDate = format(toZonedTime(new Date(data.end_time), TIMEZONE), 'yyyy-MM-dd');
        }
        sleepDate = sleepDate || todayStr;
        const { error } = await supabase
          .from('health_sleep_sessions')
          .upsert(
            { date: sleepDate, ...data },
            { onConflict: 'date,start_time' }
          );
        if (error) throw error;
        break;
      }

      case 'workout': {
        // Calorías congeladas con el peso vigente en la fecha del entrenamiento: un pesaje
        // posterior no debe reescribirlas. Si faltan datos corporales, se guarda sin ellas.
        let frozen: Record<string, unknown> = {};
        let metadata = data.metadata || {};
        try {
          const f = await freezeWorkoutCalories(data);
          frozen = { calories_burned: f.calories_burned, net_calories: f.net_calories, met: f.met };
          metadata = { ...metadata, bmr: f.bmr, ...(f.estimated && { calories_estimated: true }) };
        } catch (e) {
          console.warn('No se pudieron congelar las calorías del entrenamiento:', e);
        }

        // Upsert por start_time para evitar duplicados cuando WorkManager re-ejecuta
        const { error } = await supabase
          .from('health_workouts')
          .upsert(
            { ...data, ...frozen, metadata },
            { onConflict: 'start_time' }
          );
        if (error) throw error;
        break;
      }

      case 'weight': {
        // Insert registro de peso
        const { error } = await supabase
          .from('health_weight_log')
          .insert({ weight_kg: data.weight_kg, body_fat_percent: data.body_fat_percent || null, muscle_mass_kg: data.muscle_mass_kg || null, bmi: data.bmi || null });
        if (error) throw error;
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
    }

    return NextResponse.json({ success: true, type, date: todayStr });
  } catch (err: any) {
    console.error('[health track] error:', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
