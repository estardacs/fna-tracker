import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Inicializar cliente Supabase (Service Role para escritura si es necesario, o Anon si RLS lo permite)
// Nota: Para APIs de escritura desde dispositivos, idealmente usaríamos una API Secret customizada
// para no exponer la Service Key, pero por ahora usaremos las vars públicas + una validación simple.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, value, secret, data } = body;

    // Validación simple de seguridad (puedes cambiar 'fna-secret' por lo que quieras en tu app Android)
    if (secret !== 'fna-tracker-upload-key') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!type || value === undefined) {
      return NextResponse.json({ error: 'Missing type or value' }, { status: 400 });
    }

    // Mapeo de datos entrantes a tu esquema 'metrics'
    // Asumimos que la App envía:
    // type: 'steps' | 'sleep' | 'heart_rate' | 'stress'
    // value: número
    // data: objeto JSON con detalles (ej. desglose de sueño)

    const payload = {
      created_at: new Date().toISOString(),
      device_id: 'xiaomi-band',
      metric_type: type, // 'daily_steps', 'sleep_summary', 'heart_rate_avg'
      value: Number(value),
      metadata: data || {} // Guardar el objeto JSON completo aquí
    };

    const { error } = await supabase
      .from('metrics')
      .insert(payload);

    if (error) {
      console.error('Error inserting metrics:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Server error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
