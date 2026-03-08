import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { grams_consumed } = await req.json();
  if (!grams_consumed || grams_consumed <= 0) {
    return NextResponse.json({ error: 'grams_consumed inválido' }, { status: 400 });
  }

  // Fetch the log entry to get the food_item_id
  const { data: entry, error: fetchErr } = await supabase
    .from('diet_log')
    .select('food_item_id')
    .eq('id', id)
    .single();
  if (fetchErr || !entry) return NextResponse.json({ error: 'Entrada no encontrada' }, { status: 404 });

  // Fetch food item macros per 100g
  const { data: food, error: foodErr } = await supabase
    .from('food_items')
    .select('calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g,fiber_per_100g,sodium_per_100g')
    .eq('id', entry.food_item_id)
    .single();
  if (foodErr || !food) return NextResponse.json({ error: 'Alimento no encontrado' }, { status: 404 });

  const f = grams_consumed / 100;
  const { error } = await supabase.from('diet_log').update({
    grams_consumed,
    calories:   Math.round(food.calories_per_100g  * f * 10) / 10,
    protein_g:  Math.round(food.protein_per_100g   * f * 10) / 10,
    carbs_g:    Math.round(food.carbs_per_100g     * f * 10) / 10,
    fat_g:      Math.round(food.fat_per_100g       * f * 10) / 10,
    fiber_g:    Math.round((food.fiber_per_100g ?? 0) * f * 10) / 10,
    sodium_mg:  Math.round((food.sodium_per_100g  ?? 0) * f * 10) / 10,
  }).eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { error } = await supabase.from('diet_log').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
