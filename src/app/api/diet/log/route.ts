import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { date, meal, food_item_id, recipe_id, quantity = 1 } = body;

  if (!date || !meal || (!food_item_id && !recipe_id)) {
    return NextResponse.json({ error: 'date, meal y food_item_id o recipe_id son requeridos' }, { status: 400 });
  }

  let macros = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0, sugar_g: 0 };

  if (food_item_id) {
    const { data, error } = await supabase.from('food_items').select('*').eq('id', food_item_id).single();
    if (error || !data) return NextResponse.json({ error: 'Alimento no encontrado' }, { status: 404 });
    macros = {
      calories:  Number(data.calories)  * quantity,
      protein_g: Number(data.protein_g) * quantity,
      carbs_g:   Number(data.carbs_g)   * quantity,
      fat_g:     Number(data.fat_g)     * quantity,
      fiber_g:   Number(data.fiber_g ?? 0) * quantity,
      sodium_mg: Number(data.sodium_mg ?? 0) * quantity,
      sugar_g:   Number(data.sugar_g ?? 0) * quantity,
    };
  } else if (recipe_id) {
    const { data: ingredients } = await supabase
      .from('recipe_ingredients')
      .select('quantity, food_items(*)')
      .eq('recipe_id', recipe_id);

    for (const ing of (ingredients || []) as any[]) {
      const fi = ing.food_items;
      const q = ing.quantity * quantity;
      macros.calories  += Number(fi.calories)  * q;
      macros.protein_g += Number(fi.protein_g) * q;
      macros.carbs_g   += Number(fi.carbs_g)   * q;
      macros.fat_g     += Number(fi.fat_g)     * q;
      macros.fiber_g   += Number(fi.fiber_g ?? 0) * q;
      macros.sodium_mg += Number(fi.sodium_mg ?? 0) * q;
      macros.sugar_g   += Number(fi.sugar_g ?? 0) * q;
    }
  }

  const { data, error } = await supabase
    .from('diet_log')
    .insert({
      date,
      meal,
      food_item_id: food_item_id ?? null,
      recipe_id: recipe_id ?? null,
      quantity,
      ...macros,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entry: data });
}
