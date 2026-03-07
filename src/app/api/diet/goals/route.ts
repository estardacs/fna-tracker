import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { calories, protein_g, carbs_g, fat_g } = body;

  const { error } = await supabase
    .from('diet_goals')
    .update({ calories, protein_g, carbs_g, fat_g })
    .eq('id', 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
