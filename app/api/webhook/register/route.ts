/**
 * POST /api/webhook/register
 *
 * Registers a Trello webhook for the editors board, pointing at
 * /api/webhook/trello on this app's public URL.
 *
 * Trello requires the callback URL to be publicly reachable (HTTPS).
 * Use APP_URL env var to set the public base URL.
 *
 * POST body (JSON): { action: "register" | "delete", webhookId?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveTrelloBoards } from '@/lib/trello-boards';

const TRELLO_BASE = 'https://api.trello.com/1';

export async function POST(request: NextRequest) {
  const apiKey = process.env.TRELLO_KEY;
  const token  = process.env.TRELLO_TOKEN;
  const appUrl = process.env.APP_URL;

  if (!apiKey || !token) {
    return NextResponse.json({ error: 'TRELLO_KEY / TRELLO_TOKEN not set' }, { status: 500 });
  }
  if (!appUrl) {
    return NextResponse.json({ error: 'APP_URL not set' }, { status: 500 });
  }

  let editorsBoardId: string;
  try {
    const boards = await resolveTrelloBoards(apiKey, token);
    editorsBoardId = boards.editorsBoardId;
    if (boards.autoDiscovered) {
      console.log(`[register] Auto-discovered editors board: "${boards.editorsBoardName}" (${editorsBoardId})`);
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Could not resolve editors board: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const action = body?.action ?? 'register';

  if (action === 'delete') {
    const webhookId = body?.webhookId;
    if (!webhookId) {
      return NextResponse.json({ error: 'webhookId is required to delete' }, { status: 400 });
    }
    return deleteWebhook(apiKey, token, webhookId);
  }

  return registerWebhook(apiKey, token, appUrl, editorsBoardId);
}

async function registerWebhook(
  apiKey: string,
  token: string,
  appUrl: string,
  boardId: string
): Promise<NextResponse> {
  const callbackUrl = `${appUrl.replace(/\/$/, '')}/api/webhook/trello`;

  // Check for existing webhook to avoid duplicates
  const listRes = await fetch(
    `${TRELLO_BASE}/tokens/${token}/webhooks?key=${apiKey}&token=${token}`
  );

  if (listRes.ok) {
    const existing: Array<{ id: string; callbackURL: string; idModel: string }> =
      await listRes.json();
    const dup = existing.find(
      (w) => w.callbackURL === callbackUrl && w.idModel === boardId
    );
    if (dup) {
      return NextResponse.json({
        ok: true,
        message: 'Webhook already registered',
        webhook: dup,
      });
    }
  }

  const params = new URLSearchParams({ key: apiKey, token });
  const res = await fetch(`${TRELLO_BASE}/webhooks?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callbackURL: callbackUrl,
      idModel: boardId,
      description: 'Stinson Phase2 — editors board Done → Frame.io automation',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Trello webhook registration failed: ${res.status} ${text}` },
      { status: res.status }
    );
  }

  const webhook = await res.json();
  return NextResponse.json({ ok: true, message: 'Webhook registered', webhook });
}

async function deleteWebhook(
  apiKey: string,
  token: string,
  webhookId: string
): Promise<NextResponse> {
  const res = await fetch(
    `${TRELLO_BASE}/webhooks/${webhookId}?key=${apiKey}&token=${token}`,
    { method: 'DELETE' }
  );

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Failed to delete webhook: ${res.status} ${text}` },
      { status: res.status }
    );
  }

  return NextResponse.json({ ok: true, message: 'Webhook deleted' });
}
