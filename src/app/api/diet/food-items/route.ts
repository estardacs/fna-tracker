import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const recientes = req.nextUrl.searchParams.get('recientes') === '1';

  // Return recently used foods (no query)
  if (recientes) {
    const { data: logs } = await supabase
      .from('diet_log')
      .select('food_item_id, logged_at')
      .not('food_item_id', 'is', null)
      .order('logged_at', { ascending: false })
      .limit(60);

    // Deduplicate by food_item_id, preserving recency order
    const seen = new Set<string>();
    const recentIds: string[] = [];
    for (const log of (logs || []) as any[]) {
      if (log.food_item_id && !seen.has(log.food_item_id)) {
        seen.add(log.food_item_id);
        recentIds.push(log.food_item_id);
        if (recentIds.length >= 10) break;
      }
    }
    if (recentIds.length === 0) return NextResponse.json([]);

    const { data: items } = await supabase
      .from('food_items')
      .select('id, name, brand, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g, serving_label, use_count')
      .in('id', recentIds);

    // Re-sort to match recency order
    const map = new Map((items || []).map((i: any) => [i.id, i]));
    return NextResponse.json(recentIds.map((id) => map.get(id)).filter(Boolean));
  }

  if (!q.trim()) return NextResponse.json([]);

  // Fuzzy search using pg_trgm
  const { data, error } = await supabase.rpc('search_food_items', { q, lim: 10 });

  if (error) {
    // Fallback to ilike if rpc not available (migration not yet applied)
    const { data: fallback } = await supabase
      .from('food_items')
      .select('id, name, brand, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g, serving_label, use_count')
      .ilike('name', `%${q}%`)
      .order('use_count', { ascending: false })
      .limit(10);
    return NextResponse.json(fallback ?? []);
  }

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    name, brand,
    calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
    fiber_per_100g = 0, sodium_per_100g = 0, sugar_per_100g = 0,
    serving_size_g, serving_label,
  } = body;

  if (!name || calories_per_100g == null) {
    return NextResponse.json({ error: 'name y calories_per_100g son requeridos' }, { status: 400 });
  }

  const c100 = Number(calories_per_100g);
  const p100 = Number(protein_per_100g ?? 0);
  const ch100 = Number(carbs_per_100g ?? 0);
  const f100 = Number(fat_per_100g ?? 0);
  const fi100 = Number(fiber_per_100g);
  const so100 = Number(sodium_per_100g);
  const su100 = Number(sugar_per_100g);

  // name_normalized: strip "(Xg)" suffixes, lowercase
  const name_normalized = name.replace(/\s*\(\s*\d+\.?\d*\s*g\s*\)/gi, '').trim().toLowerCase();

  const { data, error } = await supabase
    .from('food_items')
    .insert({
      name,
      brand: brand || null,
      name_normalized,
      // Per-100g columns (source of truth)
      calories_per_100g: c100,
      protein_per_100g:  p100,
      carbs_per_100g:    ch100,
      fat_per_100g:      f100,
      fiber_per_100g:    fi100,
      sodium_per_100g:   so100,
      sugar_per_100g:    su100,
      // Legacy columns (kept for backward compat) = per-100g values
      calories:  c100,
      protein_g: p100,
      carbs_g:   ch100,
      fat_g:     f100,
      fiber_g:   fi100,
      sodium_mg: so100,
      sugar_g:   su100,
      serving_size_g: serving_size_g ? Number(serving_size_g) : null,
      serving_label:  serving_label || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item: data });
}
