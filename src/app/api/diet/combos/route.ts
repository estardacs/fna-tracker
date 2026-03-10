import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/diet/combos — list all combos with their items
export async function GET() {
  const { data: combos, error } = await supabase
    .from('meal_combos')
    .select(`
      id, name, use_count, last_used,
      combo_items (
        id, grams_consumed,
        food_items (id, name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g)
      )
    `)
    .order('use_count', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(combos ?? []);
}

// POST /api/diet/combos — create a new combo
// Body: { name: string, items: [{food_item_id: string, grams_consumed: number}] }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, items } = body;

  if (!name || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'name y items[] son requeridos' }, { status: 400 });
  }

  const { data: combo, error: comboErr } = await supabase
    .from('meal_combos')
    .insert({ name })
    .select()
    .single();

  if (comboErr || !combo) return NextResponse.json({ error: comboErr?.message }, { status: 500 });

  const { error: itemsErr } = await supabase.from('combo_items').insert(
    items.map((it: any) => ({
      combo_id:       combo.id,
      food_item_id:   it.food_item_id,
      grams_consumed: Number(it.grams_consumed),
    }))
  );

  if (itemsErr) {
    // Clean up orphaned combo
    await supabase.from('meal_combos').delete().eq('id', combo.id);
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, combo });
}
