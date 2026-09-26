/**
 * Cliente Supabase con service_role. SOLO SERVIDOR.
 *
 * ⚠️ Es el único cliente del proyecto que puede leer las tablas bancarias, y existe porque
 * `bank_*` es la única familia de tablas acá SIN política `anon_all`: sus GRANTs están
 * revocados para `anon` y `authenticated`, y la RLS está activa sin políticas. Ver el
 * encabezado de supabase/migrations/20260926120000_bank_tables.sql.
 *
 * `import 'server-only'` es la parte importante: si alguien importa este módulo desde un
 * componente cliente, el build falla. Sin eso, la llave service_role terminaría dentro del
 * bundle del navegador, que es exactamente el desastre que este diseño evita.
 *
 * Solo src/lib/bank-service.ts debería importar esto. Nada más.
 *
 * La trampa que va a morder a alguien: si copias el patrón de /api/diet/* e importas
 * `@/lib/supabase` (la anon key) para consultar una tabla bancaria, no obtienes un error sino
 * `[]` — datos vacíos en silencio. Si una consulta de gastos vuelve vacía y no debería, revisa
 * primero qué cliente estás usando.
 */
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * El cliente se construye en el primer uso, no al importar el módulo.
 *
 * La diferencia importa en el deploy. Con la validación en el scope del módulo, un Vercel sin
 * `SUPABASE_SERVICE_ROLE_KEY` no falla al abrir /gastos: falla el `next build` completo,
 * cuando Next importa el módulo para recolectar los datos de la página, y se cae el deploy de
 * toda la app por una variable que solo necesita una ruta. Diferido, la app despliega y el
 * fallo queda contenido en /gastos, con un mensaje que dice qué falta.
 *
 * Sigue siendo fail closed: sin la llave no se devuelve un cliente degradado, se lanza.
 */
function getClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL no está configurada');
  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY no está configurada. Las tablas bancarias solo son ' +
        'legibles con service_role — agrégala en .env.local y en las variables de Vercel.',
    );
  }

  client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/**
 * Proxy en vez de exportar `getClient` directo, para que los ~15 sitios de uso en
 * bank-service.ts sigan escribiéndose `supabaseAdmin.from(...)`. Lo único que hace es diferir
 * la construcción hasta el primer acceso a una propiedad.
 */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});
