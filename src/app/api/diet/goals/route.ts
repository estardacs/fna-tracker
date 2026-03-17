import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Profile constants
const AGE = 23;
const HEIGHT_CM = 178;
const FIBER_G = 38;

function calcMacros(calories: number, weightKg: number) {
  const protein_g = Math.round(weightKg * 2);              // 2g/kg
  const fat_g     = Math.max(
    Math.round(weightKg * 0.7),                            // min 0.7g/kg
    Math.round((calories * 0.20) / 9),                     // min 20% of kcal from fat
  );
  const carbs_g   = Math.max(0, Math.round((calories - protein_g * 4 - fat_g * 9) / 4));
  return { protein_g, fat_g, carbs_g, fiber_g: FIBER_G };
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { calories, protein_g, carbs_g, fat_g, fiber_g } = body;

  if (!calories || Number(calories) <= 0) {
    return NextResponse.json({ error: 'calories requerido' }, { status: 400 });
  }

  let macros: { protein_g: number; fat_g: number; carbs_g: number; fiber_g: number };

  // If any macro is provided manually, use all manual values (skip auto-calc)
  if (protein_g !== undefined || carbs_g !== undefined || fat_g !== undefined || fiber_g !== undefined) {
    macros = {
      protein_g: Number(protein_g ?? 0),
      carbs_g:   Number(carbs_g   ?? 0),
      fat_g:     Number(fat_g     ?? 0),
      fiber_g:   Number(fiber_g   ?? FIBER_G),
    };
  } else {
    // Auto-calculate from latest weight
    const { data: weightRow } = await supabase
      .from('health_weight_log')
      .select('weight_kg')
      .order('date', { ascending: false })
      .limit(1)
      .single();
    const weightKg = weightRow?.weight_kg ?? 80.6;
    macros = calcMacros(Number(calories), weightKg);
  }

  const { error } = await supabase
    .from('diet_goals')
    .update({ calories: Number(calories), ...macros })
    .eq('id', 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, goal: { calories: Number(calories), ...macros } });
}

// Expose for internal use (e.g. recalculate on weight change)
export { calcMacros, AGE, HEIGHT_CM };
