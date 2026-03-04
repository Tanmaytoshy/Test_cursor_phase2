/**
 * GET /api/auth/frameio
 *
 * Initiates the Frame.io (Adobe IMS) OAuth flow.
 * Redirects the user to Adobe's login page.
 * Protected by SETUP_PASSWORD.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFrameioAuthUrl } from '@/lib/frameio-auth';

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (!process.env.SETUP_PASSWORD || password !== process.env.SETUP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const authUrl = getFrameioAuthUrl();
    return NextResponse.redirect(authUrl);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
