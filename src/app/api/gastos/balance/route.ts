/**
 * Anota un saldo a mano para una cuenta.
 *
 * A diferencia de /api/track/bank, esta ruta NO lleva token propio: la protege el chequeo de
 * cookie de admin del middleware, igual que el resto de `/api/*`. Es correcto porque quien la
 * usa es la persona desde el navegador, no un colector.
 */
import { NextRequest, NextResponse } from 'next/server';
import { recordManualBalance } from '@/lib/bank-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { accountId?: string; balance?: number | string; observedAt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'El cuerpo no es JSON válido' }, { status: 400 });
  }

  const { accountId, observedAt } = body;
  if (!accountId) return NextResponse.json({ error: 'Falta accountId' }, { status: 400 });

  // Se acepta "1.234.567" y "1234567": el punto es separador de miles en Chile, y pedirle a
  // alguien que lo escriba sin formato es invitarlo a equivocarse.
  const raw = typeof body.balance === 'string'
    ? Number(body.balance.replace(/\./g, '').replace(',', '.'))
    : body.balance;

  if (raw === undefined || !Number.isFinite(raw)) {
    return NextResponse.json({ error: 'El saldo debe ser un número' }, { status: 400 });
  }

  try {
    await recordManualBalance({ accountId, balance: raw, observedAt });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
