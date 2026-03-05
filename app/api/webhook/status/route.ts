/**
 * GET /api/webhook/status
 *
 * Returns the current webhook registration status and environment variable
 * configuration health for the new Frame.io + Trello automation feature.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isFrameioConnected, getFrameioAccountId, hasFrameioAccountId } from '@/lib/frameio-auth';
import { resolveTrelloBoards } from '@/lib/trello-boards';
import { getPublicAppUrl } from '@/lib/app-url';

const TRELLO_BASE = 'https://api.trello.com/1';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.TRELLO_KEY;
  const token  = process.env.TRELLO_TOKEN;
  const appUrl = getPublicAppUrl(request);

  const frameioConnected = isFrameioConnected();

  // Auto-fetch FRAMEIO_ACCOUNT_ID if Frame.io is connected but not yet cached
  let frameioAccountIdOk = !!process.env.FRAMEIO_ACCOUNT_ID || hasFrameioAccountId();
  if (frameioConnected && !frameioAccountIdOk) {
    try {
      await getFrameioAccountId();
      frameioAccountIdOk = true;
    } catch {
      // Non-fatal — will show as missing in config
    }
  }

  // Attempt to resolve board IDs (auto-discover if env vars not set)
  let resolvedBoards: Awaited<ReturnType<typeof resolveTrelloBoards>> | null = null;
  if (apiKey && token) {
    try {
      resolvedBoards = await resolveTrelloBoards(apiKey, token);
    } catch {
      // Non-fatal — reported in the config section below
    }
  }

  const config = {
    TRELLO_KEY:               !!apiKey,
    TRELLO_TOKEN:             !!token,
    APP_URL:                  !!appUrl,
    FRAMEIO_CLIENT_ID:        !!process.env.FRAMEIO_CLIENT_ID,
    FRAMEIO_CLIENT_SECRET:    !!process.env.FRAMEIO_CLIENT_SECRET,
    // Account ID is auto-resolved from Frame.io once OAuth is connected.
    // Keep this green when connected so webhook registration is not blocked.
    FRAMEIO_ACCOUNT_ID:       frameioAccountIdOk || frameioConnected,
    FRAMEIO_PROJECT_NAME:     !!process.env.FRAMEIO_PROJECT_NAME,
    FRAMEIO_CONNECTED:        frameioConnected,
    EDITORS_TRELLO_BOARD_ID:  !!(process.env.EDITORS_TRELLO_BOARD_ID || resolvedBoards?.editorsBoardId),
    CLIENT_TRELLO_BOARD_ID:   !!(process.env.CLIENT_TRELLO_BOARD_ID  || resolvedBoards?.clientBoardId),
    DONE_LIST_NAME:           !!process.env.DONE_LIST_NAME,
    DOUBLE_CHECK_LIST_NAME:   !!process.env.DOUBLE_CHECK_LIST_NAME,
  };

  const allConfigured = Object.values(config).every(Boolean);

  // If credentials are missing, return config status only
  if (!apiKey || !token) {
    return NextResponse.json({ config, allConfigured, webhooks: [], callbackUrl: null });
  }

  const callbackUrl = appUrl
    ? `${appUrl.replace(/\/$/, '')}/api/webhook/trello`
    : null;

  // List registered webhooks for this token
  let webhooks: Array<{ id: string; callbackURL: string; idModel: string; description?: string; active?: boolean }> = [];
  try {
    const res = await fetch(
      `${TRELLO_BASE}/tokens/${token}/webhooks?key=${apiKey}&token=${token}`
    );
    if (res.ok) {
      const all = await res.json();
      webhooks = callbackUrl
        ? all.filter((w: { callbackURL: string }) => w.callbackURL === callbackUrl)
        : all;
    }
  } catch {
    // Non-fatal
  }

  const editorsBoardId = resolvedBoards?.editorsBoardId;
  const isRegistered = webhooks.some(
    (w) => w.idModel === editorsBoardId && w.callbackURL === callbackUrl
  );

  return NextResponse.json({
    config,
    allConfigured,
    callbackUrl,
    isRegistered,
    webhooks,
    boards: resolvedBoards
      ? {
          editors: { id: resolvedBoards.editorsBoardId, name: resolvedBoards.editorsBoardName },
          client:  { id: resolvedBoards.clientBoardId,  name: resolvedBoards.clientBoardName  },
          autoDiscovered: resolvedBoards.autoDiscovered,
        }
      : null,
  });
}
