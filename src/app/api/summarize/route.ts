import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/summarize
 * Triggers the Supabase Edge Function `summarize-daily`.
 * Called from the history page on load so data is always fresh.
 * Requires SUMMARIZER_SECRET env var to authenticate with the edge function.
 */
export async function POST() {
  const secret = process.env.SUMMARIZER_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!secret || !supabaseUrl) {
    // Not configured — silently skip, don't block history loading
    return NextResponse.json({ skipped: true, reason: 'SUMMARIZER_SECRET not configured' });
  }

  const edgeFnUrl = `${supabaseUrl}/functions/v1/summarize-daily`;

  try {
    // Supabase Edge Functions require a valid JWT in Authorization.
    // We use the anon key (valid JWT) + pass our custom secret in X-Secret header.
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const res = await fetch(edgeFnUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${anonKey}`,
        'X-Secret': secret,
      },
      signal: AbortSignal.timeout(20_000),
    });

    const body = await res.json().catch(() => ({}));
    console.log(`[summarize] Edge function response: ${res.status}`, body);

    return NextResponse.json({ ok: res.ok, status: res.status, body });
  } catch (err: any) {
    // Timeout or network error — don't block history loading
    console.warn('[summarize] Edge function call failed:', err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 200 });
  }
}
