import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { date, meal, food_item_id, grams_consumed } = body;

  if (!date || !meal || !food_item_id || grams_consumed == null) {
    return NextResponse.json(
      { error: 'date, meal, food_item_id y grams_consumed son requeridos' },
      { status: 400 }
    );
  }

  const grams = Number(grams_consumed);
  if (isNaN(grams) || grams <= 0) {
    return NextResponse.json({ error: 'grams_consumed debe ser un número positivo' }, { status: 400 });
  }

  const { data: food, error: foodErr } = await supabase
    .from('food_items')
    .select('calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g, sodium_per_100g, sugar_per_100g, use_count')
    .eq('id', food_item_id)
    .single();

  if (foodErr || !food) {
    return NextResponse.json({ error: 'Alimento no encontrado' }, { status: 404 });
  }

  const factor = grams / 100;
  const macros = {
    calories:  Math.round(Number(food.calories_per_100g)  * factor * 10) / 10,
    protein_g: Math.round(Number(food.protein_per_100g)   * factor * 10) / 10,
    carbs_g:   Math.round(Number(food.carbs_per_100g)     * factor * 10) / 10,
    fat_g:     Math.round(Number(food.fat_per_100g)       * factor * 10) / 10,
    fiber_g:   Math.round(Number(food.fiber_per_100g  ?? 0) * factor * 10) / 10,
    sodium_mg: Math.round(Number(food.sodium_per_100g ?? 0) * factor * 10) / 10,
    sugar_g:   Math.round(Number(food.sugar_per_100g  ?? 0) * factor * 10) / 10,
  };

  // Insert log entry
  const { data, error } = await supabase
    .from('diet_log')
    .insert({
      date,
      meal,
      food_item_id,
      grams_consumed: grams,
      quantity: grams,  // keep for backward compat
      ...macros,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Increment use_count (non-blocking)
  supabase
    .from('food_items')
    .update({ use_count: (food.use_count ?? 0) + 1 })
    .eq('id', food_item_id)
    .then(() => {});

  return NextResponse.json({ ok: true, entry: data });
}
