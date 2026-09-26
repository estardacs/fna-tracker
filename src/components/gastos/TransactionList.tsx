import type { TransactionView } from '@/lib/bank-service';
import { money, shortDate } from './format';
import { cn } from '@/lib/utils';

const SOURCE_LABELS: Record<string, string> = {
  account: 'cuenta',
  credit_card_unbilled: 'no facturado',
  credit_card_billed: 'facturado',
};

export default function TransactionList({ transactions }: { transactions: TransactionView[] }) {
  if (!transactions.length) {
    return (
      <p className="text-gray-500 text-sm border border-gray-800/60 rounded-2xl p-6 bg-gray-900/30">
        Sin movimientos registrados.
      </p>
    );
  }

  return (
    <div className="border border-gray-800/60 rounded-2xl bg-gray-900/30 divide-y divide-gray-800/50">
      {transactions.map(t => (
        <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
          <span className="text-[11px] text-gray-600 font-mono w-14 shrink-0">
            {shortDate(t.postedDate)}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-200 truncate">{t.description}</p>
            <p className="text-[10px] text-gray-600 truncate">
              {t.accountLabel}
              {t.card && ` · ${t.card}`}
              {t.installments && ` · cuota ${t.installments}`}
              {' · '}{SOURCE_LABELS[t.source] ?? t.source}
            </p>
          </div>

          <span className={cn(
            'text-sm font-medium tabular-nums shrink-0',
            // Positivo = abono, negativo = cargo, igual que lo entrega el banco.
            t.amount < 0 ? 'text-gray-200' : 'text-emerald-400',
          )}>
            {money(t.amount, t.currency)}
          </span>
        </div>
      ))}
    </div>
  );
}
