import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import AdminLogin from '@/components/admin/AdminLogin';
import { getGastosOverview } from '@/lib/bank-service';
import SyncStatusPanel from '@/components/gastos/SyncStatusPanel';
import AccountCards from '@/components/gastos/AccountCards';
import TransactionList from '@/components/gastos/TransactionList';

export const dynamic = 'force-dynamic';

function GastosSkeleton() {
  return (
    <div className="space-y-10">
      {[3, 3].map((n, section) => (
        <div key={section} className="space-y-3">
          <div className="h-3 w-32 bg-gray-800/60 rounded-full animate-pulse" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: n }).map((_, i) => (
              <div
                key={i}
                className="h-28 rounded-2xl bg-gray-900/40 border border-gray-800/50 animate-pulse"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="h-64 rounded-2xl bg-gray-900/40 border border-gray-800/50 animate-pulse" />
    </div>
  );
}

/**
 * Los datos se leen acá adentro y no en el componente de página, para que estén dentro de la
 * rama autenticada: una visita sin la cookie nunca llega a consultar la base.
 *
 * No hay RealtimeRefresher. Las tablas bancarias no están en la publicación de realtime y la
 * sincronización es manual, así que refrescar cada 30 segundos no mostraría nada nuevo.
 */
async function GastosData() {
  const { syncs, accounts, transactions } = await getGastosOverview();

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-gray-400 text-sm mb-1 font-medium uppercase tracking-wider">
          Sincronización
        </h2>
        <p className="text-xs text-gray-600 mb-4 max-w-2xl">
          Los datos se traen a mano desde tu máquina, porque el banco pide clave dinámica. Que
          la última corrida sea de hace días es normal, no una falla.
        </p>
        <SyncStatusPanel syncs={syncs} />
      </section>

      <section>
        <h2 className="text-gray-400 text-sm mb-4 font-medium uppercase tracking-wider">
          Cuentas
        </h2>
        <AccountCards accounts={accounts} />
      </section>

      <section>
        <h2 className="text-gray-400 text-sm mb-4 font-medium uppercase tracking-wider">
          Últimos movimientos
        </h2>
        <TransactionList transactions={transactions} />
      </section>
    </div>
  );
}

export default async function GastosPage() {
  const secret = process.env.ADMIN_SECRET;
  const store = await cookies();
  const isOwner = !!secret && store.get('admin_token')?.value === secret;

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-12 font-sans selection:bg-blue-500/30">
      <header className="mb-8 md:mb-12 border-b border-gray-800 pb-6">
        <Link href="/" className="group inline-block">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-100 leading-none">
            Gastos
          </h1>
          <p className="text-[10px] tracking-[0.25em] text-gray-600 uppercase mt-2 group-hover:text-gray-500 transition-colors">
            Cuentas y movimientos
          </p>
        </Link>
      </header>

      {isOwner ? (
        <Suspense fallback={<GastosSkeleton />}>
          <GastosData />
        </Suspense>
      ) : (
        <AdminLogin />
      )}
    </main>
  );
}
