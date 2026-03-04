import { NextRequest, NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/google-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const { type } = await params;

  if (type !== 'source' && type !== 'dest') {
    return NextResponse.json({ error: 'Invalid type. Use "source" or "dest".' }, { status: 400 });
  }

  const password = request.nextUrl.searchParams.get('password');
  if (!process.env.SETUP_PASSWORD || password !== process.env.SETUP_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const authUrl = getAuthUrl(type as 'source' | 'dest');
    return NextResponse.redirect(authUrl);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
