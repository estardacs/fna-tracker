import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `Eres un asistente de nutrición. El usuario te dará la descripción de un alimento (texto o imagen de etiqueta nutricional).
Responde ÚNICAMENTE con un JSON válido con estos campos (sin texto adicional):
{
  "name": "nombre del alimento",
  "brand": "marca (o null)",
  "calories": número de kcal por porción,
  "protein_g": gramos de proteína por porción,
  "carbs_g": gramos de carbohidratos por porción,
  "fat_g": gramos de grasa por porción,
  "fiber_g": gramos de fibra por porción (o 0),
  "sodium_mg": miligramos de sodio por porción (o 0),
  "sugar_g": gramos de azúcar por porción (o 0),
  "serving_size_g": gramos de una porción (o null),
  "serving_label": "descripción de la porción, ej: 1 taza (240ml) (o null)"
}
Si no puedes determinar un valor con certeza razonable, usa 0 o null según corresponda.`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY no configurada' }, { status: 503 });
  }

  const body = await req.json();
  const { input, type } = body as { input: string; type: 'text' | 'image' };

  if (!input || !type) {
    return NextResponse.json({ error: 'input y type son requeridos' }, { status: 400 });
  }

  const userContent: Anthropic.MessageParam['content'] =
    type === 'image'
      ? [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: input },
          },
          { type: 'text', text: 'Extrae la información nutricional de esta imagen.' },
        ]
      : [{ type: 'text', text: input }];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '';

  let suggestion: Record<string, unknown>;
  try {
    suggestion = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'El modelo no devolvió JSON válido', raw: text }, { status: 502 });
  }

  return NextResponse.json({ suggestion });
}
