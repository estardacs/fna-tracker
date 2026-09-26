/**
 * Ingesta de datos bancarios desde un colector local.
 *
 * NO EXPORTA GET, a propósito. Un token robado puede envenenar datos; no puede leerlos de
 * vuelta. Sin handler de GET, Next responde 405 y no hay superficie de lectura que proteger.
 * Si alguna vez se necesita leer gastos por HTTP, va en otra ruta con el gate de cookie
 * normal del middleware, no acá.
 *
 * Autenticación: bearer token propio, siguiendo el patrón de /api/mcp. Va en
 * PUBLIC_WRITE_PATHS de middleware.ts porque un colector no puede presentar la cookie de
 * admin — exento de ese chequeo, no de autenticación.
 *
 * El token es distinto de MCP_TOKEN y de ADMIN_SECRET. Reutilizar uno significaría que
 * comprometer el colector entrega también el MCP o el panel.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ingestBankSync, tokensMatch } from '@/lib/bank-service';

export const dynamic = 'force-dynamic';

function authorize(req: NextRequest): NextResponse | null {
  const expected = process.env.BANK_INGEST_TOKEN;

  // Fail closed: sin token configurado en el servidor, la ruta no acepta nada. El modo de
  // falla alternativo —aceptar todo porque la variable está vacía— es inaceptable acá.
  if (!expected) {
    return NextResponse.json(
      { error: 'BANK_INGEST_TOKEN no está configurado en el servidor' },
      { status: 503 },
    );
  }

  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token || !tokensMatch(token, expected)) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="fna-tracker"' } },
    );
  }

  return null;
}

export async function POST(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'El cuerpo no es JSON válido' }, { status: 400 });
  }

  try {
    const result = await ingestBankSync(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof z.ZodError) {
      // El lote se rechaza completo. Un solo campo malo —sobre todo una fecha— envenenaría
      // el dedup_key de forma permanente, así que no se escribe nada parcial.
      return NextResponse.json(
        { error: 'Payload inválido', issues: e.issues.slice(0, 20) },
        { status: 400 },
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[gastos] ingesta falló:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
