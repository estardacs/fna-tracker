import { supabase } from '@/lib/supabase';
import { unstable_noStore as noStore } from 'next/cache';

export interface DietGoal {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

export interface DietLogEntry {
  id: string;
  food_item_id?: string;
  name: string;
  grams_consumed: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sodium_mg: number;
  sugar_g: number;
}

export interface DietDayStats {
  date: string;
  goal: DietGoal;
  totals: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
    sodium_mg: number;
    sugar_g: number;
  };
  meals: Record<string, DietLogEntry[]>;
}

export interface FoodItem {
  id: string;
  name: string;
  brand?: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g: number;
  sodium_per_100g: number;
  sugar_per_100g: number;
  serving_size_g?: number;
  serving_label?: string;
  use_count?: number;
  similarity_score?: number;
}

const MEAL_ORDER = ['desayuno', 'almuerzo', 'once', 'cena', 'snack'];

export async function getDietDayStats(dateStr?: string): Promise<DietDayStats> {
  noStore();

  const date = dateStr ?? new Date().toISOString().slice(0, 10);

  const [logRes, goalRes] = await Promise.all([
    supabase
      .from('diet_log')
      .select('*, food_items(name)')
      .eq('date', date)
      .order('logged_at', { ascending: true }),
    supabase.from('diet_goals').select('*').eq('id', 1).single(),
  ]);

  const goal: DietGoal = goalRes.data
    ? {
        calories:  goalRes.data.calories  ?? 2300,
        protein_g: goalRes.data.protein_g ?? 160,
        carbs_g:   goalRes.data.carbs_g   ?? 240,
        fat_g:     goalRes.data.fat_g     ?? 75,
        fiber_g:   goalRes.data.fiber_g   ?? 38,
      }
    : { calories: 2300, protein_g: 160, carbs_g: 240, fat_g: 75, fiber_g: 38 };

  const meals: Record<string, DietLogEntry[]> = Object.fromEntries(
    MEAL_ORDER.map((m) => [m, []])
  );

  const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0, sugar_g: 0 };

  for (const row of (logRes.data || []) as any[]) {
    const name = (row.food_items as any)?.name ?? 'Desconocido';

    const entry: DietLogEntry = {
      id:             row.id,
      food_item_id:   row.food_item_id ?? undefined,
      name,
      grams_consumed: row.grams_consumed ?? null,
      calories:  row.calories,
      protein_g: row.protein_g,
      carbs_g:   row.carbs_g,
      fat_g:     row.fat_g,
      fiber_g:   row.fiber_g ?? 0,
      sodium_mg: row.sodium_mg ?? 0,
      sugar_g:   row.sugar_g ?? 0,
    };

    if (meals[row.meal]) meals[row.meal].push(entry);

    totals.calories  += row.calories;
    totals.protein_g += row.protein_g;
    totals.carbs_g   += row.carbs_g;
    totals.fat_g     += row.fat_g;
    totals.fiber_g   += row.fiber_g ?? 0;
    totals.sodium_mg += row.sodium_mg ?? 0;
    totals.sugar_g   += row.sugar_g ?? 0;
  }

  return { date, goal, totals, meals };
}

export async function searchFoodItems(query: string): Promise<FoodItem[]> {
  const { data } = await supabase
    .from('food_items')
    .select('id, name, brand, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g, serving_size_g, serving_label, use_count')
    .ilike('name', `%${query}%`)
    .order('use_count', { ascending: false })
    .limit(20);

  return (data || []).map((r: any) => ({
    id:                r.id,
    name:              r.name,
    brand:             r.brand ?? undefined,
    calories_per_100g: Number(r.calories_per_100g ?? 0),
    protein_per_100g:  Number(r.protein_per_100g  ?? 0),
    carbs_per_100g:    Number(r.carbs_per_100g     ?? 0),
    fat_per_100g:      Number(r.fat_per_100g       ?? 0),
    fiber_per_100g:    Number(r.fiber_per_100g     ?? 0),
    sodium_per_100g:   Number(r.sodium_per_100g    ?? 0),
    sugar_per_100g:    Number(r.sugar_per_100g     ?? 0),
    serving_size_g:    r.serving_size_g ?? undefined,
    serving_label:     r.serving_label  ?? undefined,
    use_count:         r.use_count      ?? 0,
  }));
}

export async function getGoal(): Promise<DietGoal> {
  const { data } = await supabase.from('diet_goals').select('*').eq('id', 1).single();
  return data
    ? { calories: data.calories, protein_g: data.protein_g, carbs_g: data.carbs_g, fat_g: data.fat_g, fiber_g: data.fiber_g ?? 38 }
    : { calories: 2300, protein_g: 160, carbs_g: 240, fat_g: 75, fiber_g: 38 };
}
