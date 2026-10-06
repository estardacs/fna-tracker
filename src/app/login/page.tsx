import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import AdminLogin from '@/components/admin/AdminLogin';

export const dynamic = 'force-dynamic';

/** Solo rutas internas: un `next` como `//evil.com` o `https://...` convertiría el login en
 *  un redirect abierto. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);

  const secret = process.env.ADMIN_SECRET;
  const store = await cookies();
  if (secret && store.get('admin_token')?.value === secret) redirect(next);

  return (
    <main className="min-h-screen bg-black text-white p-4 md:p-12 font-sans selection:bg-blue-500/30 flex flex-col">
      <header className="mb-8 md:mb-12 border-b border-gray-800 pb-6 flex items-center gap-3">
        <img src="/sand-clock.svg" alt="" aria-hidden="true" className="w-10 h-10 md:w-12 md:h-12 flex-shrink-0" />
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-100 leading-none">
          Fña Tracker
        </h1>
      </header>
      <AdminLogin redirectTo={next} />
    </main>
  );
}
