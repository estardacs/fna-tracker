import { CreditCard, Landmark, PiggyBank, Wallet } from 'lucide-react';
import type { AccountView } from '@/lib/bank-service';
import { BANK_NAMES, KIND_LABELS, money, relativeTime, shortDate } from './format';

const ICONS = {
  checking: Landmark,
  savings: PiggyBank,
  credit_card: CreditCard,
  line_of_credit: CreditCard,
  wallet: Wallet,
} as const;

export default function AccountCards({ accounts }: { accounts: AccountView[] }) {
  if (!accounts.length) {
    return (
      <p className="text-gray-500 text-sm border border-gray-800/60 rounded-2xl p-6 bg-gray-900/30">
        Ninguna cuenta registrada todavía. Aparecen solas en la primera sincronización.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {accounts.map(a => {
        const Icon = ICONS[a.kind as keyof typeof ICONS] ?? Landmark;
        const isCard = a.kind === 'credit_card';
        return (
          <div key={a.id} className="border border-gray-800/60 rounded-2xl p-4 bg-gray-900/30">
            <div className="flex items-start gap-3">
              <Icon className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-gray-200 text-sm font-medium truncate">{a.label}</p>
                <p className="text-[11px] text-gray-600 mt-0.5">
                  {BANK_NAMES[a.bank] ?? a.bank} · {KIND_LABELS[a.kind] ?? a.kind}
                </p>
              </div>
            </div>

            {isCard ? (
              <div className="mt-4 space-y-1">
                <p className="text-2xl font-semibold text-gray-100 tabular-nums">
                  {money(a.natUsed, a.currency)}
                </p>
                <p className="text-[11px] text-gray-500">
                  usado de {money(a.natTotal, a.currency)}
                  {a.natAvailable !== null && ` · disponible ${money(a.natAvailable, a.currency)}`}
                </p>
                {a.nextDueDate && (
                  <p className="text-[11px] text-amber-400/80">
                    vence {shortDate(a.nextDueDate)}
                  </p>
                )}
                {a.periodExpenses !== null && (
                  <p className="text-[11px] text-gray-500">
                    gastos del período {money(a.periodExpenses, a.currency)}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-4 text-2xl font-semibold text-gray-100 tabular-nums">
                {money(a.balance, a.currency)}
              </p>
            )}

            <p className="mt-3 text-[10px] text-gray-600">
              saldo capturado {relativeTime(a.capturedAt)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
