import { NextRequest, NextResponse } from 'next/server';
import { getTrelloCredentials } from '@/lib/trello-auth';

const TRELLO_BASE = 'https://api.trello.com/1';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const { cardId } = await params;
  const { apiKey, token } = getTrelloCredentials(request.headers);

  if (!apiKey || !token) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const queryParams = new URLSearchParams({ key: apiKey, token, ...body });

  const res = await fetch(`${TRELLO_BASE}/cards/${cardId}?${queryParams.toString()}`, {
    method: 'PUT',
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
