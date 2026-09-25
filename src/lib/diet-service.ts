/**
 * Diet operations, independent of how they are invoked.
 *
 * The MCP server in src/app/api/mcp/route.ts is a thin wrapper over these functions, so
 * swapping bearer auth for OAuth — or exposing the same operations over a different
 * transport — does not touch any of the logic below.
 *
 * Macros are always derived from the *_per_100g columns, never from whatever the caller
 * claims, so a model cannot invent nutrition values for a food that already exists.
 */
import { supabase } from '@/lib/supabase';
import { format, subDays, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TIMEZONE = 'America/Santiago';

/** Kilocalories in one kilogram of body fat — the standard figure for deficit maths. */
const KCAL_PER_KG_FAT = 7700;

export const MEALS = ['desayuno', 'almuerzo', 'once', 'cena', 'snack'] as const;
export type Meal = (typeof MEALS)[number];

export type LogStatus = 'planned' | 'confirmed';
export type FoodSource = 'label' | 'web' | 'estimated';

export function todayInSantiago(): string {
  return format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');
}

const MACRO_COLUMNS =
  'calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g, sodium_per_100g, sugar_per_100g';

type PerHundred = Record<string, number | null>;

function macrosFor(food: PerHundred, grams: number) {
  const factor = grams / 100;
  const round = (v: number | null | undefined) => Math.round(Number(v ?? 0) * factor * 10) / 10;
  return {
    calories: round(food.calories_per_100g),
    protein_g: round(food.protein_per_100g),
    carbs_g: round(food.carbs_per_100g),
    fat_g: round(food.fat_per_100g),
    fiber_g: round(food.fiber_per_100g),
    sodium_mg: round(food.sodium_per_100g),
    sugar_g: round(food.sugar_per_100g),
  };
}

// ---------------------------------------------------------------- foods

export async function searchFoods(query: string, limit = 10) {
  const term = query.trim();
  if (!term) return [];

  const { data, error } = await supabase
    .from('food_items')
    .select(`id, name, brand, serving_size_g, serving_label, source, verified_at, use_count, ${MACRO_COLUMNS}`)
    .or(`name.ilike.%${term}%,brand.ilike.%${term}%`)
    .order('use_count', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`No se pudo buscar alimentos: ${error.message}`);
  return data ?? [];
}

export async function getFoodById(id: string) {
  const { data, error } = await supabase
    .from('food_items')
    .select(`id, name, brand, serving_size_g, serving_label, source, verified_at, ${MACRO_COLUMNS}`)
    .eq('id', id)
    .single();

  if (error || !data) throw new Error(`Alimento no encontrado: ${id}`);
  return data;
}

export async function createFood(input: {
  name: string;
  brand?: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g?: number;
  sodium_per_100g?: number;
  sugar_per_100g?: number;
  serving_size_g?: number;
  serving_label?: string;
  source: FoodSource;
}) {
  const { data, error } = await supabase
    .from('food_items')
    .insert({
      ...input,
      fiber_per_100g: input.fiber_per_100g ?? 0,
      sodium_per_100g: input.sodium_per_100g ?? 0,
      sugar_per_100g: input.sugar_per_100g ?? 0,
      name_normalized: input.name.toLowerCase().trim(),
      // Only a label reading counts as verified; web and estimates stay unverified
      // until someone checks the physical package.
      verified_at: input.source === 'label' ? todayInSantiago() : null,
      // Legacy per-serving columns the older UI still reads.
      calories: input.calories_per_100g,
      protein_g: input.protein_per_100g,
      carbs_g: input.carbs_per_100g,
      fat_g: input.fat_per_100g,
    })
    .select('id, name, brand, source')
    .single();

  if (error) throw new Error(`No se pudo crear el alimento: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------- logging

export async function logFood(input: {
  date: string;
  meal: Meal;
  foodId: string;
  grams: number;
  status?: LogStatus;
}) {
  if (!(input.grams > 0)) throw new Error('Los gramos deben ser un número positivo.');

  const food = await getFoodById(input.foodId);
  const macros = macrosFor(food as PerHundred, input.grams);

  const { data, error } = await supabase
    .from('diet_log')
    .insert({
      date: input.date,
      meal: input.meal,
      food_item_id: input.foodId,
      grams_consumed: input.grams,
      quantity: input.grams,
      status: input.status ?? 'confirmed',
      ...macros,
    })
    .select('id')
    .single();

  if (error) throw new Error(`No se pudo registrar: ${error.message}`);

  supabase.rpc('increment_food_use', { food_id: input.foodId }).then(
    () => {},
    () => {}, // use_count is a convenience for search ranking; never fail a log over it
  );

  return { id: data.id, food: food.name, grams: input.grams, ...macros };
}

export async function listCombos() {
  const { data, error } = await supabase
    .from('meal_combos')
    .select('id, name, servings, use_count, combo_items(grams_consumed, food_items(id, name))')
    .order('use_count', { ascending: false });

  if (error) throw new Error(`No se pudieron listar los combos: ${error.message}`);
  return data ?? [];
}

/**
 * Logs `portions` servings of a combo. Ingredient amounts are stored for the whole batch,
 * so a 4-serving meal prep divides by 4 — the reason `servings` exists at all.
 */
export async function logCombo(input: {
  date: string;
  meal: Meal;
  comboId: string;
  portions?: number;
  status?: LogStatus;
}) {
  const portions = input.portions ?? 1;
  if (!(portions > 0)) throw new Error('Las porciones deben ser un número positivo.');

  const { data: combo, error: comboErr } = await supabase
    .from('meal_combos')
    .select('id, name, servings, combo_items(food_item_id, grams_consumed)')
    .eq('id', input.comboId)
    .single();

  if (comboErr || !combo) throw new Error(`Combo no encontrado: ${input.comboId}`);

  const items = (combo.combo_items ?? []) as { food_item_id: string; grams_consumed: number }[];
  if (items.length === 0) throw new Error(`El combo "${combo.name}" no tiene ingredientes.`);

  const scale = portions / (combo.servings || 1);
  const logged = [];
  for (const item of items) {
    logged.push(
      await logFood({
        date: input.date,
        meal: input.meal,
        foodId: item.food_item_id,
        grams: Math.round(Number(item.grams_consumed) * scale * 10) / 10,
        status: input.status,
      }),
    );
  }

  await supabase
    .from('meal_combos')
    .update({ use_count: (combo as { use_count?: number }).use_count ?? 0, last_used: input.date })
    .eq('id', combo.id);

  return { combo: combo.name, portions, entries: logged };
}

export async function deleteLogEntry(id: string) {
  const { data, error } = await supabase.from('diet_log').delete().eq('id', id).select('id').single();
  if (error || !data) throw new Error(`No se pudo borrar el registro ${id}: ${error?.message ?? 'no existe'}`);
  return { id };
}

export async function confirmDay(date: string) {
  const { data, error } = await supabase
    .from('diet_log')
    .update({ status: 'confirmed' })
    .eq('date', date)
    .eq('status', 'planned')
    .select('id');

  if (error) throw new Error(`No se pudo confirmar el día: ${error.message}`);
  return { confirmed: data?.length ?? 0 };
}

// ---------------------------------------------------------------- goals & summaries

export async function getGoals() {
  const { data, error } = await supabase.from('diet_goals').select('*').eq('id', 1).single();
  if (error || !data) throw new Error('No hay metas configuradas.');
  return data;
}

type LogRow = {
  id: string; meal: string; status: string; grams_consumed: number;
  calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number;
  food_items: { name: string } | null;
};

function sumMacros(rows: LogRow[]) {
  const round = (n: number) => Math.round(n * 10) / 10;
  return rows.reduce(
    (acc, r) => ({
      calories: round(acc.calories + Number(r.calories || 0)),
      protein_g: round(acc.protein_g + Number(r.protein_g || 0)),
      carbs_g: round(acc.carbs_g + Number(r.carbs_g || 0)),
      fat_g: round(acc.fat_g + Number(r.fat_g || 0)),
      fiber_g: round(acc.fiber_g + Number(r.fiber_g || 0)),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
  );
}

export async function getDaySummary(date: string) {
  const [{ data: rows, error }, goals] = await Promise.all([
    supabase
      .from('diet_log')
      .select('id, meal, status, grams_consumed, calories, protein_g, carbs_g, fat_g, fiber_g, food_items(name)')
      .eq('date', date)
      .order('logged_at', { ascending: true }),
    getGoals(),
  ]);

  if (error) throw new Error(`No se pudo leer el día: ${error.message}`);

  const all = (rows ?? []) as unknown as LogRow[];
  const confirmed = all.filter(r => r.status === 'confirmed');
  const planned = all.filter(r => r.status === 'planned');

  const eaten = sumMacros(confirmed);
  const plannedTotals = sumMacros(planned);

  return {
    date,
    goals: {
      calories: goals.calories,
      protein_g: goals.protein_g,
      fat_g: goals.fat_g,
      carbs_g: goals.carbs_g,
      tdee: goals.tdee_calories,
    },
    eaten,
    planned: plannedTotals,
    remaining: {
      calories: Math.round((goals.calories - eaten.calories) * 10) / 10,
      protein_g: Math.round((goals.protein_g - eaten.protein_g) * 10) / 10,
      fat_g: Math.round((goals.fat_g - eaten.fat_g) * 10) / 10,
    },
    // Deficit is measured against TDEE, not the calorie target: eating exactly the target
    // is not a zero deficit, it is the intended one.
    deficit: goals.tdee_calories ? Math.round(goals.tdee_calories - eaten.calories) : null,
    entries: all.map(r => ({
      id: r.id,
      meal: r.meal,
      status: r.status,
      food: r.food_items?.name ?? 'desconocido',
      grams: Number(r.grams_consumed),
      calories: Number(r.calories),
      protein_g: Number(r.protein_g),
    })),
  };
}

export async function getProgress(days = 7) {
  const today = todayInSantiago();
  const from = format(subDays(parseISO(today + 'T12:00:00'), days - 1), 'yyyy-MM-dd');

  const [{ data: rows, error }, goals] = await Promise.all([
    supabase
      .from('diet_log')
      .select('date, calories, protein_g')
      .gte('date', from)
      .lte('date', today)
      .eq('status', 'confirmed'),
    getGoals(),
  ]);

  if (error) throw new Error(`No se pudo leer el progreso: ${error.message}`);

  const byDate = new Map<string, { calories: number; protein_g: number }>();
  for (const r of rows ?? []) {
    const cur = byDate.get(r.date) ?? { calories: 0, protein_g: 0 };
    cur.calories += Number(r.calories || 0);
    cur.protein_g += Number(r.protein_g || 0);
    byDate.set(r.date, cur);
  }

  // Days with no confirmed intake are excluded rather than counted as zero, which would
  // fabricate an enormous deficit for any day that simply was not logged.
  const logged = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (logged.length === 0) {
    return { days, from, to: today, loggedDays: 0, avgCalories: null, avgProtein: null, totalDeficit: null, projectedKg: null, daily: [] };
  }

  const totalCalories = logged.reduce((s, [, v]) => s + v.calories, 0);
  const totalProtein = logged.reduce((s, [, v]) => s + v.protein_g, 0);
  const tdee = goals.tdee_calories;
  const totalDeficit = tdee ? logged.reduce((s, [, v]) => s + (tdee - v.calories), 0) : null;

  return {
    days,
    from,
    to: today,
    loggedDays: logged.length,
    avgCalories: Math.round(totalCalories / logged.length),
    avgProtein: Math.round(totalProtein / logged.length),
    totalDeficit: totalDeficit === null ? null : Math.round(totalDeficit),
    projectedKg: totalDeficit === null ? null : Math.round((totalDeficit / KCAL_PER_KG_FAT) * 100) / 100,
    daily: logged.map(([date, v]) => ({ date, calories: Math.round(v.calories), protein_g: Math.round(v.protein_g) })),
  };
}

// ---------------------------------------------------------------- weight

export async function logWeight(weightKg: number, date?: string) {
  const when = date ?? todayInSantiago();
  const { error } = await supabase.from('health_weight_log').insert({ date: when, weight_kg: weightKg });
  if (error) throw new Error(`No se pudo registrar el peso: ${error.message}`);
  return { date: when, weight_kg: weightKg };
}

export async function getLatestWeight() {
  const { data } = await supabase
    .from('health_weight_log')
    .select('date, weight_kg')
    .order('date', { ascending: false })
    .limit(1)
    .single();
  return data ?? null;
}

/**
 * Mifflin-St Jeor. TDEE drifts down as weight drops, so a figure calculated once at 87 kg
 * overstates the deficit months later — this recomputes it from the latest weigh-in.
 */
export async function recalculateTdee() {
  const [goals, weight] = await Promise.all([getGoals(), getLatestWeight()]);
  if (!weight) throw new Error('No hay ningún registro de peso.');
  if (!goals.height_cm || !goals.birth_year || !goals.sex) {
    throw new Error('Faltan datos corporales (altura, año de nacimiento o sexo) en diet_goals.');
  }

  const age = Number(todayInSantiago().slice(0, 4)) - goals.birth_year;
  const base = 10 * Number(weight.weight_kg) + 6.25 * Number(goals.height_cm) - 5 * age;
  const bmr = goals.sex === 'M' ? base + 5 : base - 161;
  const tdee = Math.round(bmr * Number(goals.activity_factor ?? 1.3));

  const { error } = await supabase.from('diet_goals').update({ tdee_calories: tdee }).eq('id', 1);
  if (error) throw new Error(`No se pudo actualizar el TDEE: ${error.message}`);

  return { weight_kg: Number(weight.weight_kg), age, bmr: Math.round(bmr), tdee, previous: goals.tdee_calories };
}
