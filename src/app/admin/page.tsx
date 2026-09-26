import Link from 'next/link';
import { cookies } from 'next/headers';
import NetworkTable from '@/components/admin/NetworkTable';
import { getNetworkInventory } from '@/lib/network-locations';
import AdminLogin from '@/components/admin/AdminLogin';

export const dynamic = 'force-dynamic';

/** Reached by typing the URL — deliberately not linked from anywhere, since it is a
 *  maintenance page rather than part of the daily flow. */
export default async function AdminPage() {
  const secret = process.env.ADMIN_SECRET;
  const store = await cookies();
  const isOwner = !!secret && store.get('admin_token')?.value === secret;

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-12 font-sans selection:bg-blue-500/30 flex flex-col">
      <header className="mb-8 md:mb-12 border-b border-gray-800 pb-6">
        <Link href="/" className="group inline-block">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-100 leading-none">
            Administración
          </h1>
          <p className="text-[10px] tracking-[0.25em] text-gray-600 uppercase mt-2 group-hover:text-gray-500 transition-colors">
            Redes y ubicaciones
          </p>
        </Link>
      </header>

      {isOwner ? (
        <section>
          <h2 className="text-gray-400 text-sm mb-2 font-medium uppercase tracking-wider">Redes detectadas</h2>
          <p className="text-xs text-gray-600 mb-6 max-w-2xl">
            Asigna cada red a una ubicación. Los cambios afectan a lo que se calcule de ahora en
            adelante; los días ya resumidos conservan su reparto actual.
          </p>
          <NetworkTable initial={await getNetworkInventory()} />
        </section>
      ) : (
        <AdminLogin />
      )}
    </main>
  );
}
