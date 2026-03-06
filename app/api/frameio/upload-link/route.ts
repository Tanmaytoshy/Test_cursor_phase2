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
    const targetBoardName = String(body?.targetBoardName || '').trim();
    const targetCardName = String(body?.targetCardName || '').trim();
    const frameioLink = String(body?.frameioLink || '').trim();

    const hasBoardCardTarget = !!targetBoardName && !!targetCardName;
    const hasDirectTarget = !!target;

    if (!hasBoardCardTarget && !hasDirectTarget) {
      return NextResponse.json(
        { error: 'Provide target card URL/ID OR targetBoardName + targetCardName.' },
        { status: 400 }
      );
    }
    if (!frameioLink || !/^https?:\/\//i.test(frameioLink)) {
      return NextResponse.json({ error: 'A valid Frame.io link is required.' }, { status: 400 });
    }

    let card: TrelloCardDetails;
    if (hasBoardCardTarget) {
      card = await resolveCardByBoardAndName(apiKey, token, targetBoardName, targetCardName);
    } else {
      const cardRef = extractCardRef(target);
      if (!cardRef) {
        return NextResponse.json(
          { error: 'Could not parse Trello card ID/URL. Use a full Trello card URL or card ID.' },
          { status: 400 }
        );
      }
      card = await fetchCard(apiKey, token, cardRef);
    }
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

interface TrelloBoardLite {
  id: string;
  name: string;
  closed?: boolean;
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

async function resolveCardByBoardAndName(
  apiKey: string,
  token: string,
  boardNameInput: string,
  cardNameInput: string
): Promise<TrelloCardDetails> {
  const boards = await fetchBoards(apiKey, token);
  const board = pickBoardByName(boards, boardNameInput);
  if (!board) {
    const sample = boards.slice(0, 12).map((b) => b.name).join(', ');
    throw new Error(`Board "${boardNameInput}" not found. Available boards include: ${sample}`);
  }

  const cards = await fetchBoardCards(apiKey, token, board.id);
  const normalizedTarget = normalizeForMatch(cardNameInput);
  const exactMatches = cards.filter((c) => normalizeForMatch(c.name) === normalizedTarget);
  const partialMatches = cards.filter((c) => normalizeForMatch(c.name).includes(normalizedTarget));
  const candidates = exactMatches.length > 0 ? exactMatches : partialMatches;

  if (candidates.length === 0) {
    throw new Error(`No card named "${cardNameInput}" found on board "${board.name}".`);
  }
  if (candidates.length > 1) {
    const sample = candidates.slice(0, 8).map((c) => c.name).join(', ');
    throw new Error(
      `Multiple cards matched "${cardNameInput}" on board "${board.name}". Be more specific. Matches: ${sample}`
    );
  }

  return candidates[0];
}

function pickBoardByName(boards: TrelloBoardLite[], boardNameInput: string): TrelloBoardLite | null {
  const normalizedTarget = normalizeForMatch(boardNameInput);
  const exactMatches = boards.filter((b) => normalizeForMatch(b.name) === normalizedTarget);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return null;

  const partialMatches = boards.filter((b) => normalizeForMatch(b.name).includes(normalizedTarget));
  if (partialMatches.length === 1) return partialMatches[0];
  return null;
}

async function fetchBoards(apiKey: string, token: string): Promise<TrelloBoardLite[]> {
  const res = await fetch(
    `${TRELLO_BASE}/members/me/boards?key=${apiKey}&token=${token}&fields=id,name,closed`
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch boards (${res.status}): ${text}`);
  }
  const boards = await res.json();
  return (Array.isArray(boards) ? boards : []).filter((b) => !b.closed);
}

async function fetchBoardCards(
  apiKey: string,
  token: string,
  boardId: string
): Promise<TrelloCardDetails[]> {
  const res = await fetch(
    `${TRELLO_BASE}/boards/${boardId}/cards?key=${apiKey}&token=${token}&fields=id,name,desc&filter=all`
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch cards for board ${boardId} (${res.status}): ${text}`);
  }
  const cards = await res.json();
  return Array.isArray(cards) ? cards : [];
}

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
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
