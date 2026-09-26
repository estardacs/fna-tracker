import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { SyncStatus } from '@/lib/bank-service';
import { BANK_NAMES, relativeTime } from './format';
import { cn } from '@/lib/utils';

/**
 * Va primero en la página, antes de los saldos, y es deliberado.
 *
 * Esto no puede ser totalmente automático: la clave dinámica exige a un humano y el scraping
 * de HTML se rompe cuando un banco rediseña su portal. Entonces "última sincronización: hace
 * 3 días" y "falló" son estados normales de operación, no errores, y tienen que ser visibles
 * para que nunca confundas datos viejos con datos actuales.
 */
const STYLES = {
  ok:      { icon: CheckCircle2,  cls: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5',  text: 'Al día' },
  partial: { icon: AlertTriangle, cls: 'text-amber-400 border-amber-500/20 bg-amber-500/5',        text: 'Parcial' },
  failed:  { icon: XCircle,       cls: 'text-red-400 border-red-500/20 bg-red-500/5',              text: 'Falló' },
  running: { icon: Clock,         cls: 'text-blue-400 border-blue-500/20 bg-blue-500/5',           text: 'Corriendo' },
} as const;

export default function SyncStatusPanel({ syncs }: { syncs: SyncStatus[] }) {
  if (!syncs.length) {
    return (
      <div className="border border-gray-800/60 rounded-2xl p-6 bg-gray-900/30">
        <p className="text-gray-400 text-sm">Todavía no hay ninguna sincronización registrada.</p>
        <p className="text-gray-600 text-xs mt-2 font-mono">
          npm run sync-banks -- --bank=bchile --dry-run
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {syncs.map(s => {
        const style = STYLES[s.status];
        const Icon = style.icon;
        return (
          <div key={s.bank} className={cn('border rounded-2xl p-4', style.cls)}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-gray-100 font-medium leading-tight">
                  {BANK_NAMES[s.bank] ?? s.bank}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {relativeTime(s.finishedAt ?? s.startedAt)}
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-medium shrink-0">
                <Icon className="w-4 h-4" />
                {style.text}
              </span>
            </div>

            <div className="mt-3 flex gap-3 text-[11px] text-gray-500 font-mono">
              <span>{s.accountsSeen} cuentas</span>
              <span>+{s.txInserted}</span>
              <span>~{s.txUpdated}</span>
              {s.txMissing > 0 && <span className="text-amber-500/80">−{s.txMissing}</span>}
            </div>

            {s.error && (
              // El mensaje ya viene sanitizado por sanitizeError(): sin RUT y sin corridas
              // largas de dígitos. Aun así se corta visualmente.
              <p className="mt-3 text-[11px] text-red-300/80 break-words line-clamp-3">
                {s.error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
