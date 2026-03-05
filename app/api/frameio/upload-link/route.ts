import { NextRequest, NextResponse } from 'next/server';
import { getTrelloCredentials } from '@/lib/trello-auth';

const TRELLO_BASE = 'https://api.trello.com/1';

interface TrelloCardDetails {
  id: string;
  name: string;
  desc?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { apiKey, token } = getTrelloCredentials(request.headers);
    if (!apiKey || !token) {
      return NextResponse.json({ error: 'Missing Trello credentials' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const target = String(body?.target || '').trim();
    const frameioLink = String(body?.frameioLink || '').trim();

    if (!target) {
      return NextResponse.json({ error: 'Target card URL or ID is required.' }, { status: 400 });
    }
    if (!frameioLink || !/^https?:\/\//i.test(frameioLink)) {
      return NextResponse.json({ error: 'A valid Frame.io link is required.' }, { status: 400 });
    }

    const cardRef = extractCardRef(target);
    if (!cardRef) {
      return NextResponse.json(
        { error: 'Could not parse Trello card ID/URL. Use a full Trello card URL or card ID.' },
        { status: 400 }
      );
    }

    const card = await fetchCard(apiKey, token, cardRef);
    const desc = (card.desc || '').trim();
    const updatedDesc = desc
      ? `Frame.io Review: ${frameioLink}\n\n${desc}`
      : `Frame.io Review: ${frameioLink}`;

    await updateCard(apiKey, token, card.id, { desc: updatedDesc });

    return NextResponse.json({
      ok: true,
      cardId: card.id,
      cardName: card.name,
      uploadedLink: frameioLink,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function extractCardRef(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const directId = trimmed.match(/^[a-zA-Z0-9]{8,64}$/);
  if (directId) return trimmed;

  const urlId = trimmed.match(/trello\.com\/c\/([a-zA-Z0-9]+)/i);
  if (urlId) return urlId[1];

  return null;
}

async function fetchCard(apiKey: string, token: string, cardRef: string): Promise<TrelloCardDetails> {
  const res = await fetch(
    `${TRELLO_BASE}/cards/${cardRef}?key=${apiKey}&token=${token}&fields=id,name,desc`
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch target card (${res.status}): ${text}`);
  }
  return res.json();
}

async function updateCard(
  apiKey: string,
  token: string,
  cardId: string,
  updates: Record<string, string>
): Promise<void> {
  const params = new URLSearchParams({ key: apiKey, token, ...updates });
  const res = await fetch(`${TRELLO_BASE}/cards/${cardId}?${params.toString()}`, {
    method: 'PUT',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update card (${res.status}): ${text}`);
  }
}
