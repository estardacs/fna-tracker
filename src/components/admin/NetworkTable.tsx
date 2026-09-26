'use client';

import { useState } from 'react';
import { Loader2, Wifi, Router, Check, X, Home, Building2, GraduationCap, MapPin } from 'lucide-react';

type Category = 'home' | 'office' | 'university' | 'outside';

interface Network {
  kind: 'ssid' | 'gateway_mac';
  value: string;
  devices: string[];
  rowCount: number;
  firstSeen: string;
  lastSeen: string;
  category: Category | null;
  label: string | null;
}

const CATEGORIES: { value: Category; label: string; icon: typeof Home; color: string }[] = [
  { value: 'home',       label: 'Casa',        icon: Home,          color: 'text-emerald-400' },
  { value: 'office',     label: 'Trabajo',     icon: Building2,     color: 'text-blue-400' },
  { value: 'university', label: 'Universidad', icon: GraduationCap, color: 'text-violet-400' },
  { value: 'outside',    label: 'Fuera',       icon: MapPin,        color: 'text-gray-500' },
];

const DEVICE_LABELS: Record<string, string> = {
  'oppo-5-lite': 'Celular',
  'windows-pc': 'Yoga (antiguo)',
  'Lenovo Yoga 7 Slim': 'Yoga',
  'Lenovo Yoga Slim 7': 'Yoga',
  'PC Escritorio': 'PC Escritorio',
};

export default function NetworkTable({ initial }: { initial: Network[] }) {
  // Rendered server-side, so the table arrives populated: no mount-time fetch and no
  // loading flash. Reloading only happens to recover from a failed save.
  const [networks, setNetworks] = useState<Network[]>(initial);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  const reload = async () => {
    const res = await fetch('/api/admin/networks');
    if (!res.ok) return;
    const { networks } = await res.json();
    setNetworks(networks);
  };

  const save = async (net: Network, category: Category, label: string) => {
    const key = `${net.kind}:${net.value}`;
    setSaving(key);

    // Optimistic: the row updates immediately and only reverts if the request fails.
    setNetworks(prev => prev.map(n => (keyOf(n) === key ? { ...n, category, label } : n)));

    const res = await fetch('/api/admin/networks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: net.kind, value: net.value, category, label }),
    });

    setSaving(null);
    if (!res.ok) {
      setError('No se pudo guardar. ¿Sigue activa la sesión?');
      reload();
    }
  };

  // Unassigned first — those are the ones that need a decision — then by volume.
  const sorted = [...networks].sort((a, b) => {
    if (!a.category && b.category) return -1;
    if (a.category && !b.category) return 1;
    return b.rowCount - a.rowCount;
  });

  const pending = sorted.filter(n => !n.category).length;

  return (
    <div className="space-y-4">
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <p className="text-sm text-gray-500">
        {networks.length} redes detectadas
        {pending > 0 && <span className="text-amber-400"> · {pending} sin asignar</span>}
      </p>

      <div className="space-y-2">
        {sorted.map(net => (
          <NetworkRow
            key={keyOf(net)}
            net={net}
            saving={saving === keyOf(net)}
            onSave={save}
          />
        ))}
      </div>
    </div>
  );
}

function keyOf(n: Network) {
  return `${n.kind}:${n.value}`;
}

function NetworkRow({
  net, saving, onSave,
}: {
  net: Network;
  saving: boolean;
  onSave: (net: Network, category: Category, label: string) => void;
}) {
  const [label, setLabel] = useState(net.label ?? '');
  const [labelDirty, setLabelDirty] = useState(false);

  const Icon = net.kind === 'gateway_mac' ? Router : Wifi;
  const assigned = CATEGORIES.find(c => c.value === net.category);

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        net.category ? 'bg-gray-900/40 border-gray-800' : 'bg-amber-500/5 border-amber-500/20'
      }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        {/* Identity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Icon className={`w-4 h-4 shrink-0 ${net.kind === 'gateway_mac' ? 'text-orange-400' : 'text-gray-500'}`} />
            <span className="font-mono text-sm text-gray-200 truncate">{net.value}</span>
            {net.kind === 'gateway_mac' && (
              <span className="text-[10px] uppercase tracking-wide text-orange-400/70 shrink-0">router</span>
            )}
          </div>

          {/* What makes a network recognisable: which devices saw it, and when */}
          <div className="text-xs text-gray-600 mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            <span>{net.devices.map(d => DEVICE_LABELS[d] ?? d).join(', ')}</span>
            <span className="font-mono">
              {net.firstSeen === net.lastSeen ? net.firstSeen : `${net.firstSeen} → ${net.lastSeen}`}
            </span>
            <span className="font-mono">{net.rowCount.toLocaleString('es-CL')} registros</span>
          </div>
        </div>

        {/* Assignment */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex gap-1">
            {CATEGORIES.map(c => {
              const CatIcon = c.icon;
              const active = net.category === c.value;
              return (
                <button
                  key={c.value}
                  onClick={() => onSave(net, c.value, label || c.label)}
                  title={c.label}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer border ${
                    active
                      ? `bg-gray-800 border-gray-700 ${c.color}`
                      : 'border-transparent text-gray-600 hover:text-gray-400 hover:bg-gray-800/50'
                  }`}
                >
                  <CatIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{c.label}</span>
                </button>
              );
            })}
          </div>

          <input
            value={label}
            onChange={e => { setLabel(e.target.value); setLabelDirty(true); }}
            onBlur={() => { if (labelDirty && net.category) onSave(net, net.category, label); }}
            onKeyDown={e => { if (e.key === 'Enter' && net.category) (e.target as HTMLInputElement).blur(); }}
            placeholder={assigned?.label ?? 'etiqueta'}
            className="w-32 bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-700 focus:outline-none focus:border-gray-600"
          />

          <div className="w-4 shrink-0">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />
              : net.category ? <Check className="w-3.5 h-3.5 text-emerald-500/60" />
              : <X className="w-3.5 h-3.5 text-amber-500/60" />}
          </div>
        </div>
      </div>
    </div>
  );
}
