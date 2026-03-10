import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Phase 1: Parse the user description into a list of {name, grams, ...macros?}
const PHASE1_SYSTEM = `Eres un asistente de nutrición. El usuario describe lo que comió o preparó.
Extrae cada alimento y su cantidad en gramos PARA UNA SOLA PORCIÓN/UNIDAD.
Responde ÚNICAMENTE con un JSON array válido (sin texto antes ni después):
[
  {
    "name": "Nombre Del Alimento",
    "grams": número_en_gramos,
    "calories_per_100g": número_o_null,
    "protein_per_100g": número_o_null,
    "carbs_per_100g": número_o_null,
    "fat_per_100g": número_o_null,
    "fiber_per_100g": número_o_null,
    "sodium_per_100g": número_o_null
  }
]

REGLA CRÍTICA — ETIQUETAS NUTRICIONALES:
Si el usuario proporciona datos nutricionales del producto (kcal, proteína, carbos, grasa, etc.),
usa EXACTAMENTE esos valores. Conviértelos a por-100g si vienen por porción.
Ejemplo: "Avena Quaker. Por 40g: 150kcal, 5g prot, 27g carb, 3g grasa"
→ calories_per_100g: 375, protein_per_100g: 12.5, carbs_per_100g: 67.5, fat_per_100g: 7.5
Si NO hay datos nutricionales en el texto, pon null en todos los campos macro (se estimarán después).

REGLAS SOBRE RECETAS CASERAS:
- Si el usuario describe una RECETA (lista de ingredientes para hacer un plato — queque, torta, guiso, etc.),
  extrae UN SOLO ITEM con el nombre del plato final y los gramos TOTALES sumando TODOS los ingredientes.
  Pon null en los macros (Phase 2 los estimará para el producto final).
  Ejemplo: "queque de plátano: 3 huevos, 3 plátanos, ½ taza azúcar, 2 tazas harina, ½ taza leche, vainilla"
  → [{ "name": "Queque de Plátano Casero", "grams": 900, "calories_per_100g": null, ... }]
- Si el usuario describe ALIMENTOS SEPARADOS que comió juntos, extrae cada uno.

REGLAS GENERALES:
- Si el usuario dice "hice 4 de estos", "preparé 3 tappers" etc., extrae SOLO UNA porción.
  Ejemplo: "hice 4 tappers con 400g fideos" → grams: 100 (400/4)
- "name" usa Title Case, NUNCA incluye cantidades ni pesos.
  MAL: "hallulla (92g)", "fideos 200g" — BIEN: "Hallulla", "Fideos Integrales"
- Convierte medidas caseras: 1 taza ≈ 240g, 1 cucharada ≈ 15g, 1 huevo ≈ 55g
- Si no se menciona cantidad, estima una porción típica
- Devuelve siempre un array`;

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
- Para RECETAS CASERAS (queque, torta, guiso, etc.): estima los macros del producto FINAL horneado/cocido por 100g.
  Ten en cuenta que hornear concentra nutrientes (pierde humedad) y los ingredientes se mezclan.
  Ejemplo "Queque de Plátano Casero" → estima kcal, proteína, carbos, grasas por 100g del queque ya horneado.
- Redondea a 1 decimal`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function parseJSON(text: string): unknown {
  // Strip all markdown code fences, then extract from first [ to last ]
  const stripped = text.replace(/```(?:json)?/g, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start !== -1 && end > start) {
    return JSON.parse(stripped.slice(start, end + 1));
  }
  return JSON.parse(stripped);
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY no configurada en el servidor' }, { status: 503 });
  }

  const body = await req.json();
  const { input, type, text: extraText } = body as { input: string; type: 'text' | 'image'; text?: string };

  if (!input || !type) {
    return NextResponse.json({ error: 'input y type son requeridos' }, { status: 400 });
  }

  try {
    if (type === 'image') {
      // For images, use single-phase: parse + estimate in one call
      const userPrompt = extraText
        ? `Contexto del usuario: ${extraText}\n\nExtrae la información nutricional de la etiqueta. Si el contexto indica una cantidad consumida, úsala como "grams".`
        : 'Extrae la información nutricional de la etiqueta.';

      const imageResponse = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: `Analiza esta etiqueta nutricional. Extrae los valores por 100g.
Responde ÚNICAMENTE con un JSON array (sin texto antes ni después):
[{ "name": "nombre del producto", "grams": número_o_null, "calories_per_100g": X, "protein_per_100g": X, "carbs_per_100g": X, "fat_per_100g": X, "fiber_per_100g": X, "sodium_per_100g": X }]`,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: input } },
            { type: 'text', text: userPrompt },
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

    // Text: Phase 1 — parse into [{name, grams, ...macros?}]
    type P1Item = {
      name: string; grams: number;
      calories_per_100g: number | null; protein_per_100g: number | null;
      carbs_per_100g: number | null;    fat_per_100g: number | null;
      fiber_per_100g: number | null;    sodium_per_100g: number | null;
    };
    let parsedItems: P1Item[];

    const phase1 = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 768,
      system: PHASE1_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
    });

    try {
      const p1text = phase1.content.find((b) => b.type === 'text')?.text ?? '';
      const raw = parseJSON(p1text) as any[];
      parsedItems = (Array.isArray(raw) ? raw : [raw]).map((r: any) => ({
        name:              r.name,
        grams:             Number(r.grams) || 100,
        calories_per_100g: r.calories_per_100g != null ? Number(r.calories_per_100g) : null,
        protein_per_100g:  r.protein_per_100g  != null ? Number(r.protein_per_100g)  : null,
        carbs_per_100g:    r.carbs_per_100g    != null ? Number(r.carbs_per_100g)    : null,
        fat_per_100g:      r.fat_per_100g      != null ? Number(r.fat_per_100g)      : null,
        fiber_per_100g:    r.fiber_per_100g    != null ? Number(r.fiber_per_100g)    : null,
        sodium_per_100g:   r.sodium_per_100g   != null ? Number(r.sodium_per_100g)   : null,
      }));
    } catch {
      return NextResponse.json({ error: 'No se pudo interpretar la descripción. Intenta ser más específico.' }, { status: 502 });
    }

    if (parsedItems.length === 0) {
      return NextResponse.json({ error: 'No se detectaron alimentos en la descripción.' }, { status: 422 });
    }

    // ---- DB matching for each item (skip if user already provided full nutrition) ----
    const hasNutrition = (item: P1Item) => item.calories_per_100g != null && item.protein_per_100g != null;

    const matchResults = await Promise.all(
      parsedItems.map(async (item) => {
        // If user provided nutrition data, don't override with DB match
        if (hasNutrition(item)) return { item, match: null };
        const { data } = await supabase.rpc('search_food_items', { q: item.name, lim: 1 });
        const match = (data as any[])?.[0] ?? null;
        return { item, match: match && match.similarity_score > 0.35 ? match : null };
      })
    );

    // ---- Phase 2: Estimate macros only for items with no nutrition data and no DB match ----
    const needEstimate = matchResults.filter((r) => !r.match && !hasNutrition(r.item));
    let estimatedMap: Record<string, any> = {};

    if (needEstimate.length > 0) {
      const phase2 = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 768,
        system: PHASE2_SYSTEM,
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: JSON.stringify(needEstimate.map((r) => r.item.name)) }],
        }],
      });

      try {
        const p2text = phase2.content.find((b) => b.type === 'text')?.text ?? '';
        const estimated = parseJSON(p2text) as any[];
        for (const e of (Array.isArray(estimated) ? estimated : [estimated])) {
          estimatedMap[e.name?.toLowerCase() ?? ''] = e;
        }
      } catch {
        // Phase 2 failed: items will show with 0 macros, user can edit
      }
    }

    // ---- Build suggestions ----
    const suggestions = matchResults.map(({ item, match }) => {
      // Priority 1: DB match (unless user provided nutrition — don't override)
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
          matched_food: { id: match.id, name: match.name, similarity: match.similarity_score },
        };
      }

      // Priority 2: User provided nutrition in their message — use verbatim
      if (hasNutrition(item)) {
        return {
          name:      item.name,
          grams:     item.grams,
          calories_per_100g: item.calories_per_100g!,
          protein_per_100g:  item.protein_per_100g!,
          carbs_per_100g:    item.carbs_per_100g  ?? 0,
          fat_per_100g:      item.fat_per_100g    ?? 0,
          fiber_per_100g:    item.fiber_per_100g  ?? 0,
          sodium_per_100g:   item.sodium_per_100g ?? 0,
          matched_food: null,
        };
      }

      // Priority 3: AI estimate
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
