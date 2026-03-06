/**
 * POST /api/webhook/trello
 * HEAD /api/webhook/trello  (Trello sends HEAD to verify the webhook URL)
 *
 * Trello calls this endpoint in real-time whenever anything changes on the
 * editors board.  We look for cards moving into the configured DONE_LIST_NAME
 * and, when found, run the full automation:
 *
 *  1. Extract the Frame.io link from the card's description
 *  2. Resolve the file ID → get original download URL
 *  3. Find the target Frame.io project folder
 *  4. Remote-upload the file to Frame.io (Frame.io pulls from the source URL)
 *  5. Find the matching card on the client board (by name)
 *  6. Prepend the new Frame.io view URL to the client card description
 *  7. Move the editors card to the DOUBLE_CHECK_LIST_NAME column
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  extractFrameioFileId,
  getFrameioDownloadUrl,
  resolveFrameioTargetFolderId,
  uploadToFrameio,
} from '@/lib/frameio';
import { resolveTrelloBoards } from '@/lib/trello-boards';

const TRELLO_BASE = 'https://api.trello.com/1';

// ── Regex to find Frame.io links in card descriptions ────────────────────────
// Handles: next.frame.io/..., app.frame.io/..., f.io/...
const FRAMEIO_URL_RE =
  /https?:\/\/(?:(?:[\w-]+\.)?frame\.io|f\.io)\/[^\s<>"')\[\]]+/i;

// ── Trello HEAD verification (required by Trello to activate the webhook) ────
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

// ── Main webhook handler ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  let body: TrelloWebhookPayload;
  try {
    body = await request.json();
  } catch {
    // Trello sometimes sends empty pings — acknowledge them gracefully
    return NextResponse.json({ ok: true });
  }

  // Only react to card "updateCard" actions where idList changed
  const action = body?.action;
  if (!action || action.type !== 'updateCard') {
    return NextResponse.json({ ok: true, skipped: 'not updateCard' });
  }

  const listChange = action.data?.listAfter;
  if (!listChange) {
    return NextResponse.json({ ok: true, skipped: 'no list change' });
  }

  const doneListName = process.env.DONE_LIST_NAME || 'Done';
  if (listChange.name !== doneListName) {
    return NextResponse.json({ ok: true, skipped: `list is "${listChange.name}", not "${doneListName}"` });
  }

  const card = action.data?.card;
  if (!card?.id) {
    return NextResponse.json({ ok: true, skipped: 'no card data' });
  }

  // Fire the automation in the background so we return 200 to Trello immediately
  // (Trello expects a response within a few seconds)
  runAutomation(card.id, card.name).catch((err) => {
    console.error('[webhook] automation error:', err);
  });

  return NextResponse.json({ ok: true, message: `Automation started for card "${card.name}"` });
}

// ── Core automation ───────────────────────────────────────────────────────────
async function runAutomation(editorCardId: string, editorCardName: string): Promise<void> {
  const apiKey = process.env.TRELLO_KEY;
  const token  = process.env.TRELLO_TOKEN;

  if (!apiKey || !token) throw new Error('TRELLO_KEY / TRELLO_TOKEN not set');

  console.log(`[webhook] Starting automation for editor card "${editorCardName}" (${editorCardId})`);

  // Step 1 — Fetch the full editor card to get its description
  const editorCard = await fetchTrelloCard(apiKey, token, editorCardId);
  const desc = editorCard.desc || '';

  // Step 2 — Extract Frame.io link from description
  const frameMatch = desc.match(FRAMEIO_URL_RE);
  if (!frameMatch) {
    console.warn(`[webhook] No Frame.io link found in card "${editorCardName}". Stopping.`);
    return;
  }
  const frameioUrl = frameMatch[0].replace(/[)\],.;!?]+$/, '');
  console.log(`[webhook] Found Frame.io URL: ${frameioUrl}`);

  // Step 3 — Resolve the file ID and get its download URL
  const fileId = await extractFrameioFileId(frameioUrl);
  console.log(`[webhook] Resolved Frame.io file ID: ${fileId}`);

  const downloadUrl = await getFrameioDownloadUrl(fileId);
  console.log(`[webhook] Got download URL (length ${downloadUrl.length})`);

  // Step 4 — Find the target Frame.io project and root folder
  const rootFolderId = await resolveFrameioTargetFolderId();
  console.log(`[webhook] Resolved target Frame.io folder: ${rootFolderId}`);

  // Step 5 — Remote-upload to Frame.io (Frame.io fetches from downloadUrl directly)
  const safeFileName = sanitizeFileName(editorCardName);
  const { view_url: newFrameioUrl } = await uploadToFrameio({
    fileName: safeFileName,
    sourceUrl: downloadUrl,
    parentFolderId: rootFolderId,
  });
  console.log(`[webhook] Uploaded to Frame.io. New URL: ${newFrameioUrl}`);

  // Step 6 — Find the matching client card by name
  const { clientBoardId, editorsBoardId, clientBoardName, editorsBoardName } =
    await resolveTrelloBoards(apiKey, token);

  console.log(
    `[webhook] Using boards — editors: "${editorsBoardName ?? editorsBoardId}", ` +
    `client: "${clientBoardName ?? clientBoardId}"`
  );

  const clientCard = await findTrelloCardByName(apiKey, token, clientBoardId, editorCardName);
  if (!clientCard) {
    console.warn(`[webhook] No client card found with name "${editorCardName}" on client board. Skipping client card update.`);
  } else {
    // Step 7 — Prepend new Frame.io link to the client card description
    const existingDesc = clientCard.desc || '';
    const newDesc = `Frame.io Review: ${newFrameioUrl}\n\n${existingDesc}`.trim();
    await updateTrelloCard(apiKey, token, clientCard.id, { desc: newDesc });
    console.log(`[webhook] Updated client card "${clientCard.name}" (${clientCard.id}) with new Frame.io link`);
  }

  // Step 8 — Move the editors card to the Double Check column

  const doubleCheckListName = process.env.DOUBLE_CHECK_LIST_NAME || 'Double Check';
  const doubleCheckList = await findTrelloListByName(apiKey, token, editorsBoardId, doubleCheckListName);

  if (!doubleCheckList) {
    console.warn(`[webhook] "${doubleCheckListName}" list not found on editors board. Skipping card move.`);
  } else {
    await updateTrelloCard(apiKey, token, editorCardId, { idList: doubleCheckList.id });
    console.log(`[webhook] Moved editor card to "${doubleCheckListName}"`);
  }

  console.log(`[webhook] Automation complete for "${editorCardName}"`);
}

// ── Trello helpers ────────────────────────────────────────────────────────────

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  url?: string;
}

interface TrelloList {
  id: string;
  name: string;
}

async function fetchTrelloCard(apiKey: string, token: string, cardId: string): Promise<TrelloCard> {
  const res = await fetch(
    `${TRELLO_BASE}/cards/${cardId}?key=${apiKey}&token=${token}&fields=id,name,desc,idList,url`
  );
  if (!res.ok) throw new Error(`Failed to fetch Trello card ${cardId}: HTTP ${res.status}`);
  return res.json();
}

async function findTrelloCardByName(
  apiKey: string,
  token: string,
  boardId: string,
  cardName: string
): Promise<TrelloCard | null> {
  const res = await fetch(
    `${TRELLO_BASE}/boards/${boardId}/cards?key=${apiKey}&token=${token}` +
      `&filter=open&fields=id,name,desc,idList`
  );
  if (!res.ok) throw new Error(`Failed to fetch cards from board ${boardId}: HTTP ${res.status}`);
  const cards: TrelloCard[] = await res.json();
  return cards.find((c) => c.name.trim() === cardName.trim()) ?? null;
}

async function findTrelloListByName(
  apiKey: string,
  token: string,
  boardId: string,
  listName: string
): Promise<TrelloList | null> {
  const res = await fetch(
    `${TRELLO_BASE}/boards/${boardId}/lists?key=${apiKey}&token=${token}&filter=open&fields=id,name`
  );
  if (!res.ok) throw new Error(`Failed to fetch lists from board ${boardId}: HTTP ${res.status}`);
  const lists: TrelloList[] = await res.json();
  return lists.find((l) => l.name.trim() === listName.trim()) ?? null;
}

async function updateTrelloCard(
  apiKey: string,
  token: string,
  cardId: string,
  updates: Record<string, string>
): Promise<void> {
  const params = new URLSearchParams({ key: apiKey, token, ...updates });
  const res = await fetch(`${TRELLO_BASE}/cards/${cardId}?${params}`, {
    method: 'PUT',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update Trello card ${cardId}: ${res.status} ${text}`);
  }
}

function sanitizeFileName(name: string): string {
  // Keep the original card name, add .mp4 extension if no extension present
  const safe = name.replace(/[/\\?%*:|"<>]/g, '_').trim();
  return /\.\w{2,5}$/.test(safe) ? safe : `${safe}.mp4`;
}

// ── Webhook payload types ─────────────────────────────────────────────────────

interface TrelloWebhookPayload {
  action?: {
    type: string;
    data?: {
      card?: { id: string; name: string; desc?: string };
      listAfter?: { id: string; name: string };
      listBefore?: { id: string; name: string };
    };
  };
}
