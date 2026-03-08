import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')?.trim();
  if (!name) return NextResponse.json({ error: 'name requerido' }, { status: 400 });

  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      messages: [{
        role: 'user',
        content: `Para el alimento "${name}", dime cuánto pesa la unidad natural o porción que se consume entera.
Responde con UNA sola línea corta, solo pesos reales en gramos. Sin calorías ni macros. Sin porcentajes recomendados.
REGLA CLAVE: indica el peso REAL de la unidad completa tal como viene (pan entero, fruta entera, lata completa, etc.).
Formato: "1 unidad ≈ Xg" o "1 X ≈ Xg · 2 X ≈ Xg" si se come en múltiplos.
Ejemplos correctos:
- hallulla → "1 unidad ≈ 90g"
- marraqueta → "1 unidad ≈ 110g (2 mitades)"
- palta → "1 unidad chica ≈ 150g · grande ≈ 220g"
- lata de atún → "1 lata ≈ 160g · escurrido ≈ 120g"
- huevo → "1 huevo mediano ≈ 55g · grande ≈ 65g"
- pechuga de pollo → "½ pechuga ≈ 125g · entera ≈ 250g"
- arroz crudo → "porción cruda ≈ 80g (rinde ≈ 200g cocido)"
- durazno → "1 unidad ≈ 130g"
Solo la línea, sin explicación adicional.`,
      }],
    });

    const hint = res.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
    return NextResponse.json({ hint });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
