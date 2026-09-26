/**
 * Network → location assignments for the /admin panel.
 *
 * middleware.ts already gates every write under /api/* on the admin cookie, but it only
 * filters write methods. The GET is guarded here explicitly: it exposes every network
 * this account has ever connected to, with dates, which is not public information.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabase } from '@/lib/supabase';
import { invalidateNetworkMap, getNetworkInventory } from '@/lib/network-locations';

export const dynamic = 'force-dynamic';

const CATEGORIES = ['home', 'office', 'university', 'outside'] as const;
const KINDS = ['ssid', 'gateway_mac'] as const;

async function isOwner(): Promise<boolean> {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const store = await cookies();
  return store.get('admin_token')?.value === secret;
}

export async function GET() {
  if (!(await isOwner())) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    return NextResponse.json({ networks: await getNetworkInventory() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const { kind, value, category, label } = await req.json();

  if (!KINDS.includes(kind) || !value || !CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'kind, value y category válidos son requeridos' }, { status: 400 });
  }

  const { error } = await supabase
    .from('network_locations')
    .upsert(
      { kind, value, category, label: label?.trim() || defaultLabel(category), updated_at: new Date().toISOString() },
      { onConflict: 'kind,value' },
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  invalidateNetworkMap();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { kind, value } = await req.json();
  if (!kind || !value) {
    return NextResponse.json({ error: 'kind y value son requeridos' }, { status: 400 });
  }

  const { error } = await supabase.from('network_locations').delete().eq('kind', kind).eq('value', value);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  invalidateNetworkMap();
  return NextResponse.json({ ok: true });
}

/** A label is required by the schema, so an empty one falls back to the category name
 *  rather than rejecting the save. */
function defaultLabel(category: string): string {
  return { home: 'Casa', office: 'Oficina', university: 'Universidad', outside: 'Fuera' }[category] ?? 'Fuera';
}
