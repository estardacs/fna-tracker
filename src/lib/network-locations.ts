/**
 * Network → location mapping, read from the `network_locations` table.
 *
 * This used to be hardcoded in three places (data-processor, the Edge Function, and the
 * MacBook's .env.local). It now lives in data, editable from /admin.
 *
 * The Edge Function keeps its own copy of this logic — it runs on Deno and cannot import
 * from src/lib. Changes here must be mirrored there.
 */
import { supabase } from '@/lib/supabase';

export type LocationCategory = 'home' | 'office' | 'university' | 'outside';

export interface NetworkAssignment {
  category: LocationCategory;
  label: string;
}

export interface NetworkMap {
  bySsid: Map<string, NetworkAssignment>;
  byGateway: Map<string, NetworkAssignment>;
}

/** Mirrors the seed in 20260926000000_network_locations.sql. Used only if the table
 *  cannot be read: a transient database error should degrade the location breakdown,
 *  not blank it out. */
const FALLBACK_SSIDS: Record<string, NetworkAssignment> = {
  'Depto 402':    { category: 'home',       label: 'Casa' },
  'Depto 402 2':  { category: 'home',       label: 'Casa' },
  'Ethernet/Off': { category: 'home',       label: 'Casa' },
  'GeCo':         { category: 'office',     label: 'Oficina' },
  'IF-Comunidad': { category: 'office',     label: 'Diio' },
  'eduroam':      { category: 'university', label: 'Universidad' },
  'Eduroam':      { category: 'university', label: 'Universidad' },
};

function fallbackMap(): NetworkMap {
  return {
    bySsid: new Map(Object.entries(FALLBACK_SSIDS)),
    byGateway: new Map([['2c:96:82:95:97:90', { category: 'home' as const, label: 'Casa' }]]),
  };
}

// getWeeklyStats calls getDailyStats once per day, so without this the table would be
// read seven times to render one page. Short TTL: an edit in /admin should show up on
// the next refresh, not minutes later.
const TTL_MS = 60_000;
let cache: { map: NetworkMap; at: number } | null = null;

export async function getNetworkMap(): Promise<NetworkMap> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;

  const { data, error } = await supabase
    .from('network_locations')
    .select('kind, value, category, label');

  if (error || !data) {
    console.warn('[networks] could not read network_locations, using fallback:', error?.message);
    return fallbackMap();
  }

  const map: NetworkMap = { bySsid: new Map(), byGateway: new Map() };
  for (const row of data) {
    const assignment = { category: row.category as LocationCategory, label: row.label };
    if (row.kind === 'gateway_mac') map.byGateway.set(row.value.toLowerCase(), assignment);
    else map.bySsid.set(row.value, assignment);
  }

  cache = { map, at: Date.now() };
  return map;
}

/** Clears the cache so a save in /admin is visible immediately. */
export function invalidateNetworkMap() {
  cache = null;
}

/**
 * Gateway MAC wins over SSID. The MacBook sends both — a MAC it read directly and an
 * SSID its local NETWORK_MAP translated — and the MAC is the raw fact, so resolving it
 * here makes that local config redundant.
 */
export function resolveNetwork(
  map: NetworkMap,
  metadata: { wifi_ssid?: string; gateway_mac?: string } | null | undefined,
): NetworkAssignment | null {
  const mac = metadata?.gateway_mac?.trim().toLowerCase();
  if (mac) {
    const byMac = map.byGateway.get(mac);
    if (byMac) return byMac;
  }

  const ssid = metadata?.wifi_ssid?.trim();
  if (ssid) {
    const bySsid = map.bySsid.get(ssid);
    if (bySsid) return bySsid;
  }

  return null;
}

export interface NetworkInventoryRow {
  kind: 'ssid' | 'gateway_mac';
  value: string;
  devices: string[];
  rowCount: number;
  firstSeen: string;
  lastSeen: string;
  category: LocationCategory | null;
  label: string | null;
}

/**
 * Every network ever seen, joined with its assignment. Shared by the /admin page (which
 * renders it server-side, so the table arrives populated) and by the API route.
 */
export async function getNetworkInventory(): Promise<NetworkInventoryRow[]> {
  const [inventory, assigned] = await Promise.all([
    supabase.rpc('get_network_inventory'),
    supabase.from('network_locations').select('kind, value, category, label'),
  ]);

  if (inventory.error) throw new Error(`No se pudo leer el inventario: ${inventory.error.message}`);

  const assignments = new Map(
    (assigned.data ?? []).map(a => [`${a.kind}:${a.value}`, { category: a.category as LocationCategory, label: a.label }]),
  );

  return (inventory.data ?? []).map((n: {
    kind: string; value: string; devices: string[]; row_count: number; first_seen: string; last_seen: string;
  }) => ({
    kind: n.kind as 'ssid' | 'gateway_mac',
    value: n.value,
    devices: n.devices,
    rowCount: Number(n.row_count),
    firstSeen: n.first_seen,
    lastSeen: n.last_seen,
    ...(assignments.get(`${n.kind}:${n.value}`) ?? { category: null, label: null }),
  }));
}
