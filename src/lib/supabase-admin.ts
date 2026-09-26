/**
 * Cliente Supabase con service_role. SOLO SERVIDOR.
 *
 * ⚠️ Este es el único cliente del proyecto que puede leer las tablas bancarias, y existe
 * porque `bank_*` es la única familia de tablas acá que NO tiene política `anon_all`: sus
 * GRANTs están revocados para `anon` y `authenticated`, y la RLS está activa sin políticas.
 * Ver el encabezado de supabase/migrations/20260926120000_bank_tables.sql.
 *
 * `import 'server-only'` es la parte importante: si alguien importa este módulo desde un
 * componente cliente, el build falla. Sin eso, la llave service_role terminaría dentro del
 * bundle del navegador, que es exactamente el desastre que este diseño evita.
 *
 * Solo src/lib/bank-service.ts debería importar esto. Nada más.
 *
 * La trampa que va a morder a alguien: si copias el patrón de /api/diet/* e importas
 * `@/lib/supabase` (la anon key) para consultar una tabla bancaria, no obtienes un error
 * sino `[]` — datos vacíos en silencio. Si una consulta de gastos vuelve vacía y no debería,
 * revisa primero qué cliente estás usando.
 */
import 'server-only';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL no está configurada');
if (!serviceKey) {
  // Fallar acá y no silenciosamente: sin esta llave /gastos no puede leer nada, y el modo
  // de falla sin este throw sería una página vacía sin explicación.
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY no está configurada. Las tablas bancarias solo son ' +
      'legibles con service_role — agrégala en .env.local y en Vercel.',
  );
}

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
