import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// POST /api/diet/combos/log
// Body: { combo_id, date, meal, items: [{food_item_id, grams_consumed}] }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { combo_id, date, meal, items } = body;

  if (!combo_id || !date || !meal || !Array.isArray(items)) {
    return NextResponse.json({ error: 'combo_id, date, meal y items[] son requeridos' }, { status: 400 });
  }

  const foodIds = items.map((i: any) => i.food_item_id);
  const { data: foods, error: foodsErr } = await supabase
    .from('food_items')
    .select('id, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g, sodium_per_100g, sugar_per_100g, use_count')
    .in('id', foodIds);

  if (foodsErr) return NextResponse.json({ error: foodsErr.message }, { status: 500 });

  const foodMap = new Map((foods || []).map((f: any) => [f.id, f]));

  const logEntries = items.map((item: any) => {
    const food = foodMap.get(item.food_item_id);
    if (!food) return null;
    const factor = Number(item.grams_consumed) / 100;
    return {
      date,
      meal,
      food_item_id: item.food_item_id,
      grams_consumed: Number(item.grams_consumed),
      quantity: Number(item.grams_consumed),
      calories:  Math.round(Number(food.calories_per_100g) * factor * 10) / 10,
      protein_g: Math.round(Number(food.protein_per_100g)  * factor * 10) / 10,
      carbs_g:   Math.round(Number(food.carbs_per_100g)    * factor * 10) / 10,
      fat_g:     Math.round(Number(food.fat_per_100g)      * factor * 10) / 10,
      fiber_g:   Math.round(Number(food.fiber_per_100g  ?? 0) * factor * 10) / 10,
      sodium_mg: Math.round(Number(food.sodium_per_100g ?? 0) * factor * 10) / 10,
      sugar_g:   Math.round(Number(food.sugar_per_100g  ?? 0) * factor * 10) / 10,
    };
  }).filter(Boolean);

  const { error: logErr } = await supabase.from('diet_log').insert(logEntries);
  if (logErr) return NextResponse.json({ error: logErr.message }, { status: 500 });

  // Increment combo use_count
  const { data: combo } = await supabase.from('meal_combos').select('use_count').eq('id', combo_id).single();
  if (combo) {
    await supabase.from('meal_combos').update({
      use_count: (combo.use_count ?? 0) + 1,
      last_used: date,
    }).eq('id', combo_id);
  }

  // Increment food item use_counts
  for (const food of (foods || []) as any[]) {
    supabase.from('food_items').update({ use_count: (food.use_count ?? 0) + 1 }).eq('id', food.id).then(() => {});
  }

  return NextResponse.json({ ok: true, logged: logEntries.length });
}
