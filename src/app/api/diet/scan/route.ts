import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `Eres un asistente de nutrición experto en alimentos chilenos e internacionales.
El usuario describirá uno o más alimentos con sus cantidades en gramos u otras medidas.

Responde ÚNICAMENTE con un JSON array válido (sin texto antes ni después), donde cada elemento es un alimento:
[
  {
    "name": "nombre descriptivo del alimento con la cantidad, ej: Hallulla (92g)",
    "brand": null,
    "calories": número total de kcal para esa cantidad,
    "protein_g": gramos de proteína totales,
    "carbs_g": gramos de carbohidratos totales,
    "fat_g": gramos de grasa totales,
    "fiber_g": gramos de fibra (o 0),
    "sodium_mg": miligramos de sodio (o 0),
    "sugar_g": gramos de azúcar (o 0),
    "serving_size_g": la cantidad en gramos que el usuario mencionó (o null),
    "serving_label": "descripción, ej: 92g"
  }
]

IMPORTANTE:
- Los valores nutricionales deben ser el TOTAL para la cantidad mencionada, NO por 100g
- Si el usuario dice "92gr de hallulla", los macros deben ser los de 92g de hallulla
- Usa valores estándar de tablas nutricionales para alimentos sin marca específica
- Para alimentos chilenos (hallulla, marraqueta, queque, etc.) usa valores típicos locales
- Si es imagen de etiqueta nutricional, respeta los valores de la etiqueta
- Devuelve siempre un array, incluso si es un solo alimento`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY no configurada en el servidor' }, { status: 503 });
  }

  const body = await req.json();
  const { input, type } = body as { input: string; type: 'text' | 'image' };

  if (!input || !type) {
    return NextResponse.json({ error: 'input y type son requeridos' }, { status: 400 });
  }

  const userContent: Anthropic.MessageParam['content'] =
    type === 'image'
      ? [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: input } },
          { type: 'text', text: 'Extrae la información nutricional de esta etiqueta.' },
        ]
      : [{ type: 'text', text: input }];

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const text = response.content.find((b) => b.type === 'text')?.text ?? '';

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

    let suggestions: Record<string, unknown>[];
    try {
      const parsed = JSON.parse(cleaned);
      suggestions = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return NextResponse.json({ error: 'El modelo no devolvió JSON válido', raw: text }, { status: 502 });
    }

    return NextResponse.json({ suggestions });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Error al llamar a la API de IA' }, { status: 500 });
  }
}
