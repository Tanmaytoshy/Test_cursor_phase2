import { NextRequest, NextResponse } from 'next/server';
import { handleOAuthCallback } from '@/lib/google-auth';

export async function GET(request: NextRequest) {
  const base = process.env.APP_URL || '';
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`${base}/setup?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state || (state !== 'source' && state !== 'dest')) {
    return NextResponse.redirect(`${base}/setup?error=invalid_callback`);
  }

  try {
    const tokens = await handleOAuthCallback(state as 'source' | 'dest', code);
    const refreshToken = tokens.refresh_token;
    const params = new URLSearchParams({ connected: state });
    if (refreshToken) params.set('refresh_token', refreshToken);
    return NextResponse.redirect(`${base}/setup?${params.toString()}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(`${base}/setup?error=${encodeURIComponent(msg)}`);
  }
}
