import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const { data, error } = await supabase
    .from('food_items')
    .select('*')
    .ilike('name', `%${q}%`)
    .order('name', { ascending: true })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, brand, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, serving_size_g, serving_label } = body;

  if (!name || calories == null) {
    return NextResponse.json({ error: 'name y calories son requeridos' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('food_items')
    .insert({ name, brand, calories, protein_g: protein_g ?? 0, carbs_g: carbs_g ?? 0, fat_g: fat_g ?? 0, fiber_g: fiber_g ?? 0, sodium_mg: sodium_mg ?? 0, sugar_g: sugar_g ?? 0, serving_size_g, serving_label })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item: data });
}
