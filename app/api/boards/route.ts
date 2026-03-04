import { NextRequest, NextResponse } from 'next/server';
import { getTrelloCredentials } from '@/lib/trello-auth';

const TRELLO_BASE = 'https://api.trello.com/1';

export async function GET(request: NextRequest) {
  const { apiKey, token } = getTrelloCredentials(request.headers);

  if (!apiKey || !token) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
  }

  const res = await fetch(
    `${TRELLO_BASE}/members/me/boards?key=${apiKey}&token=${token}&fields=id,name,desc,url,prefs,closed`
  );

  if (!res.ok) {
    return NextResponse.json({ error: `Trello error: ${res.status}` }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}
