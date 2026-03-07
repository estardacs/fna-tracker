import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Phase 1: Parse the user description into a list of {name, grams}
const PHASE1_SYSTEM = `Eres un asistente de nutrición. El usuario describe lo que comió.
Extrae cada alimento mencionado y su cantidad en gramos.
Responde ÚNICAMENTE con un JSON array válido (sin texto antes ni después):
[
  { "name": "nombre del alimento sin cantidades", "grams": número_en_gramos }
]
REGLAS:
- "hallulla" no es "hallulla (92g)" — omite el peso del nombre
- Convierte medidas caseras a gramos: 1 taza ≈ 240g, 1 cucharada ≈ 15g, 1 huevo ≈ 55g
- Si no se menciona cantidad, estima una porción típica en gramos
- Si dice "1 unidad" de algo sin peso, usa el peso estándar de esa unidad
- Para recetas caseras (queque, torta, etc.) reporta el peso del trozo/porción consumida
- Devuelve siempre un array, aunque sea un solo alimento`;

// Phase 2: Estimate macros per 100g for items not found in DB
const PHASE2_SYSTEM = `Eres un nutricionista experto en alimentos chilenos e internacionales.
Para cada alimento listado, estima sus macros por 100g usando tablas nutricionales estándar.
Responde ÚNICAMENTE con un JSON array (sin texto antes ni después):
[
  {
    "name": "nombre del alimento",
    "calories_per_100g": número,
    "protein_per_100g": número,
    "carbs_per_100g": número,
    "fat_per_100g": número,
    "fiber_per_100g": número,
    "sodium_per_100g": número
  }
]
REGLAS:
- Valores para alimentos chilenos (hallulla, marraqueta, sopaipilla, charquicán, etc.) usando datos locales
- Para recetas caseras, estima el valor promedio del producto final
- Redondea a 1 decimal`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function parseJSON(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(cleaned);
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY no configurada en el servidor' }, { status: 503 });
  }

  const body = await req.json();
  const { input, type } = body as { input: string; type: 'text' | 'image' };

  if (!input || !type) {
    return NextResponse.json({ error: 'input y type son requeridos' }, { status: 400 });
  }

  try {
    // ---- Phase 1: Parse description ----
    let parsedItems: { name: string; grams: number }[];

    if (type === 'image') {
      // For images, use single-phase: parse + estimate in one call
      const imageResponse = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: `Analiza esta etiqueta nutricional. Extrae los valores por 100g (o por porción si es más relevante).
Responde ÚNICAMENTE con un JSON array:
[{ "name": "...", "grams": null, "calories_per_100g": X, "protein_per_100g": X, "carbs_per_100g": X, "fat_per_100g": X, "fiber_per_100g": X, "sodium_per_100g": X }]`,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: input } },
            { type: 'text', text: 'Extrae la información nutricional.' },
          ],
        }],
      });

      const imageText = imageResponse.content.find((b) => b.type === 'text')?.text ?? '';
      const imageData = parseJSON(imageText) as any[];
      const imageItems = Array.isArray(imageData) ? imageData : [imageData];

      return NextResponse.json({
        suggestions: imageItems.map((item: any) => ({
          name: item.name || 'Alimento escaneado',
          grams: item.grams ?? 100,
          calories_per_100g: Number(item.calories_per_100g ?? 0),
          protein_per_100g:  Number(item.protein_per_100g ?? 0),
          carbs_per_100g:    Number(item.carbs_per_100g ?? 0),
          fat_per_100g:      Number(item.fat_per_100g ?? 0),
          fiber_per_100g:    Number(item.fiber_per_100g ?? 0),
          sodium_per_100g:   Number(item.sodium_per_100g ?? 0),
          matched_food: null,
        })),
      });
    }

    // Text: Phase 1 — parse into [{name, grams}]
    const phase1 = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: PHASE1_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
    });

    try {
      const p1text = phase1.content.find((b) => b.type === 'text')?.text ?? '';
      parsedItems = parseJSON(p1text) as { name: string; grams: number }[];
      if (!Array.isArray(parsedItems)) parsedItems = [parsedItems as any];
    } catch {
      return NextResponse.json({ error: 'No se pudo interpretar la descripción. Intenta ser más específico.' }, { status: 502 });
    }

    if (parsedItems.length === 0) {
      return NextResponse.json({ error: 'No se detectaron alimentos en la descripción.' }, { status: 422 });
    }

    // ---- DB matching for each item ----
    const matchResults = await Promise.all(
      parsedItems.map(async (item) => {
        const { data } = await supabase.rpc('search_food_items', { q: item.name, lim: 1 });
        const match = (data as any[])?.[0] ?? null;
        return { item, match: match && match.similarity_score > 0.35 ? match : null };
      })
    );

    // ---- Phase 2: Estimate macros for unmatched items ----
    const unmatched = matchResults.filter((r) => !r.match).map((r) => r.item);
    let estimatedMap: Record<string, any> = {};

    if (unmatched.length > 0) {
      const phase2 = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 768,
        system: PHASE2_SYSTEM,
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: JSON.stringify(unmatched.map((u) => u.name)) }],
        }],
      });

      try {
        const p2text = phase2.content.find((b) => b.type === 'text')?.text ?? '';
        const estimated = parseJSON(p2text) as any[];
        for (const e of (Array.isArray(estimated) ? estimated : [estimated])) {
          estimatedMap[e.name?.toLowerCase() ?? ''] = e;
        }
      } catch {
        // If phase 2 fails, we'll show items without pre-filled macros
      }
    }

    // ---- Build suggestions ----
    const suggestions = matchResults.map(({ item, match }) => {
      if (match) {
        return {
          name:      match.name,
          grams:     item.grams,
          calories_per_100g: Number(match.calories_per_100g),
          protein_per_100g:  Number(match.protein_per_100g),
          carbs_per_100g:    Number(match.carbs_per_100g),
          fat_per_100g:      Number(match.fat_per_100g),
          fiber_per_100g:    Number(match.fiber_per_100g ?? 0),
          sodium_per_100g:   Number(match.sodium_per_100g ?? 0),
          matched_food: {
            id:            match.id,
            name:          match.name,
            similarity:    match.similarity_score,
          },
        };
      }

      // Not matched: use estimated per-100g
      const est = estimatedMap[item.name.toLowerCase()] ?? {};
      return {
        name:      item.name,
        grams:     item.grams,
        calories_per_100g: Number(est.calories_per_100g ?? 0),
        protein_per_100g:  Number(est.protein_per_100g  ?? 0),
        carbs_per_100g:    Number(est.carbs_per_100g    ?? 0),
        fat_per_100g:      Number(est.fat_per_100g      ?? 0),
        fiber_per_100g:    Number(est.fiber_per_100g    ?? 0),
        sodium_per_100g:   Number(est.sodium_per_100g   ?? 0),
        matched_food: null,
      };
    });

    return NextResponse.json({ suggestions });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Error al llamar a la IA' }, { status: 500 });
  }
}
