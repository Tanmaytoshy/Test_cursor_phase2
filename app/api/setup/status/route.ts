import { NextResponse } from 'next/server';
import { getTokenStatus } from '@/lib/google-auth';
import { isFrameioConnected } from '@/lib/frameio-auth';

export async function GET() {
  try {
    const status = getTokenStatus();
    return NextResponse.json({ ...status, frameio: isFrameioConnected() });
  } catch {
    return NextResponse.json({ source: false, dest: false, frameio: false });
  }
}
