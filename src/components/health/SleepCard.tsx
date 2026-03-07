'use client';

import { Moon } from 'lucide-react';
import { cn } from '@/lib/utils';

type SleepData = {
  totalMinutes: number;
  deepMinutes: number;
  lightMinutes: number;
  remMinutes: number;
  awakeMinutes: number;
  score: number;
  sleepStart: string;
  sleepEnd: string;
  phases: { start: string; end: string; phase: 'deep' | 'light' | 'rem' | 'awake' }[];
  naps: { start: string; end: string; durationMinutes: number }[];
};

type Props = { sleep: SleepData | null };

const PHASE_COLORS: Record<string, string> = {
  deep: 'bg-indigo-600',
  light: 'bg-sky-400',
  rem: 'bg-purple-500',
  awake: 'bg-red-500/70',
};

const PHASE_LABELS: Record<string, string> = {
  deep: 'Profundo',
  light: 'Ligero',
  rem: 'REM',
  awake: 'Despierto',
};

function formatTime(isoString: string) {
  const d = new Date(isoString);
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export default function SleepCard({ sleep }: Props) {
  if (!sleep) {
    return (
      <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4 flex items-center justify-center h-full min-h-[220px]">
        <div className="text-center">
          <Moon className="w-8 h-8 text-gray-700 mx-auto mb-2" />
          <p className="text-gray-500 text-sm italic">Sin datos de sueño</p>
        </div>
      </div>
    );
  }

  const total = sleep.totalMinutes || 1;

  // Build hipnogram from phases if available, else from summary
  const hasPhases = sleep.phases && sleep.phases.length > 0;
  const sleepStartMs = new Date(sleep.sleepStart).getTime();
  const sleepEndMs = new Date(sleep.sleepEnd).getTime();
  const durationMs = sleepEndMs - sleepStartMs;

  const phaseSegments = hasPhases
    ? sleep.phases.map((p) => {
        const pStart = new Date(p.start).getTime();
        const pEnd = new Date(p.end).getTime();
        const leftPct = ((pStart - sleepStartMs) / durationMs) * 100;
        const widthPct = ((pEnd - pStart) / durationMs) * 100;
        return { phase: p.phase, leftPct: Math.max(0, leftPct), widthPct: Math.max(0.5, widthPct) };
      })
    : null;

  // Summary bar (always shown)
  const summaryPhases = [
    { phase: 'deep' as const, minutes: sleep.deepMinutes },
    { phase: 'light' as const, minutes: sleep.lightMinutes },
    { phase: 'rem' as const, minutes: sleep.remMinutes },
    { phase: 'awake' as const, minutes: sleep.awakeMinutes },
  ].filter((p) => p.minutes > 0);

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Moon className="w-4 h-4 text-indigo-400" />
          <h3 className="text-gray-400 text-xs font-medium uppercase tracking-wider">Sueño</h3>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <span>{formatTime(sleep.sleepStart)}</span>
          <span>→</span>
          <span>{formatTime(sleep.sleepEnd)}</span>
          {sleep.score > 0 && (
            <span className="ml-1 bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded font-mono">
              {sleep.score}%
            </span>
          )}
        </div>
      </div>

      {/* Total */}
      <div className="mb-3">
        <span className="text-2xl font-bold text-gray-100 tracking-tight">{formatDuration(sleep.totalMinutes)}</span>
      </div>

      {/* Hipnogram (phases timeline) */}
      {phaseSegments && (
        <div className="mb-3">
          <p className="text-[9px] text-gray-600 uppercase tracking-wider mb-1">Hipnograma</p>
          <div className="relative h-6 w-full bg-gray-800/50 rounded-full overflow-hidden">
            {phaseSegments.map((seg, i) => (
              <div
                key={i}
                className={cn('absolute top-0 bottom-0', PHASE_COLORS[seg.phase])}
                style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
                title={`${PHASE_LABELS[seg.phase]}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Summary stacked bar */}
      {summaryPhases.length > 0 && (
        <div className="mb-3">
          <div className="flex h-2 w-full rounded-full overflow-hidden gap-px">
            {summaryPhases.map((p) => (
              <div
                key={p.phase}
                className={PHASE_COLORS[p.phase]}
                style={{ width: `${(p.minutes / total) * 100}%` }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Phase breakdown */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {summaryPhases.map((p) => (
          <div key={p.phase} className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className={cn('w-2 h-2 rounded-full', PHASE_COLORS[p.phase])} />
              <span className="text-[10px] text-gray-500">{PHASE_LABELS[p.phase]}</span>
            </div>
            <span className="text-[10px] font-mono text-gray-400">{formatDuration(p.minutes)}</span>
          </div>
        ))}
      </div>

      {/* Siestas */}
      {sleep.naps.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-800/50">
          <p className="text-[9px] text-gray-600 uppercase tracking-wider mb-1.5">
            Siesta{sleep.naps.length > 1 ? 's' : ''} ({sleep.naps.length})
          </p>
          <div className="flex flex-col gap-1">
            {sleep.naps.map((nap, i) => (
              <div key={i} className="flex items-center justify-between text-[10px]">
                <span className="text-gray-400">
                  Siesta de {formatTime(nap.start)} a {formatTime(nap.end)}
                </span>
                <span className="font-mono text-gray-500">{formatDuration(nap.durationMinutes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
