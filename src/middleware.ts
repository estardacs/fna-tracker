import { NextRequest, NextResponse } from 'next/server';

// Rutas que llaman máquinas (dispositivos, MacroDroid, el colector, clientes MCP). No pueden
// presentar la cookie, así que quedan exentas de este chequeo — no de autenticación: cada una
// valida su propio secret o bearer token.
const MACHINE_PATHS = [
  '/api/track/wearable',
  '/api/track/health',
  '/api/track/bank',
  '/api/summarize',
  '/api/mcp',
];

// Lo único que se ve sin sesión: el formulario de login y el endpoint que lo recibe.
const AUTH_PATHS = ['/login', '/api/auth/login', '/api/auth/logout'];

const matches = (pathname: string, paths: string[]) =>
  paths.some((p) => pathname === p || pathname.startsWith(p + '/'));

/**
 * Todo es privado por defecto: sin la cookie de ADMIN_SECRET no se renderiza ninguna página
 * ni responde ninguna API, GET incluido. Antes el candado cubría solo las escrituras y cada
 * página decidía si mostrarse, así que el dashboard y /history quedaban públicos.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (matches(pathname, MACHINE_PATHS) || matches(pathname, AUTH_PATHS)) {
    return NextResponse.next();
  }

  const secret = process.env.ADMIN_SECRET;
  const token = req.cookies.get('admin_token')?.value;
  // Fail closed: sin ADMIN_SECRET configurado no entra nadie.
  if (secret && token === secret) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const login = new URL('/login', req.url);
  if (pathname !== '/') login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Todo menos los assets de Next y los archivos de /public (íconos, manifest del PWA), que
  // el navegador pide antes de tener sesión.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico|json|txt)$).*)'],
};
