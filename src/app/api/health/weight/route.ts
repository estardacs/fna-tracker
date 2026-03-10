import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { toZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

const TIMEZONE = 'America/Santiago';

function todayStr() {
  return format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');
}

/** GET /api/health/weight?date=yyyy-MM-dd — devuelve el último peso conocido <= fecha */
export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get('date') ?? todayStr();

  const { data, error } = await supabase
    .from('health_weight_log')
    .select('id, date, weight_kg, body_fat_percent, muscle_mass_kg, created_at')
    .lte('date', dateParam)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}

/** POST /api/health/weight — registra peso para hoy (o fecha dada) */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { weight_kg, body_fat_percent, muscle_mass_kg, date } = body;

  if (!weight_kg || isNaN(Number(weight_kg))) {
    return NextResponse.json({ error: 'weight_kg inválido' }, { status: 400 });
  }

  const entryDate = date ?? todayStr();

  const { data, error } = await supabase
    .from('health_weight_log')
    .insert({
      date: entryDate,
      weight_kg: Number(weight_kg),
      body_fat_percent: body_fat_percent ? Number(body_fat_percent) : null,
      muscle_mass_kg: muscle_mass_kg ? Number(muscle_mass_kg) : null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entry: data });
}
