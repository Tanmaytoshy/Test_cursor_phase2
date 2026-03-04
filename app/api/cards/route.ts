import { NextRequest, NextResponse } from 'next/server';
import { getTrelloCredentials } from '@/lib/trello-auth';

const TRELLO_BASE = 'https://api.trello.com/1';

export async function POST(request: NextRequest) {
  const { apiKey, token } = getTrelloCredentials(request.headers);

  if (!apiKey || !token) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { idList, name, desc, due, dueComplete } = body;

  if (!idList) {
    return NextResponse.json({ error: 'idList is required' }, { status: 400 });
  }

  const params = new URLSearchParams({
    key: apiKey,
    token,
    idList,
    name: name || 'Untitled',
    desc: desc || '',
    ...(due ? { due } : {}),
    ...(dueComplete != null ? { dueComplete: String(dueComplete) } : {}),
  });

  const res = await fetch(`${TRELLO_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Trello error: ${res.status} ${text}` },
      { status: res.status }
    );
  }

  return NextResponse.json(await res.json());
}
