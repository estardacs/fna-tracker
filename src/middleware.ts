import { NextRequest, NextResponse } from 'next/server';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Rutas automáticas (dispositivos/MacroDroid) — nunca requieren auth
const PUBLIC_WRITE_PATHS = [
  '/api/track/wearable',
  '/api/track/health',
  '/api/summarize',
  '/api/auth/login',
  '/api/auth/logout',
  // MCP clients cannot present the admin cookie; /api/mcp authenticates itself with a
  // bearer token. Exempt from this check, not from authentication.
  '/api/mcp',
];

export function middleware(req: NextRequest) {
  if (!WRITE_METHODS.has(req.method)) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_WRITE_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get('admin_token')?.value;
  const secret = process.env.ADMIN_SECRET;

  if (!secret || !token || token !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
