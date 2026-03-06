import { NextRequest, NextResponse } from 'next/server';
import { getTrelloCredentials } from '@/lib/trello-auth';
import {
  extractFrameioFileId,
  getFrameioDownloadUrl,
  getFrameioDownloadUrlByIdFallback,
  resolveFrameioTargetFolderId,
  resolveFrameioPublicSourceUrl,
  uploadToFrameio,
} from '@/lib/frameio';

const TRELLO_BASE = 'https://api.trello.com/1';
const FRAMEIO_URL_RE =
  /https?:\/\/(?:(?:[\w-]+\.)?frame\.io|f\.io)\/[^\s<>"')\[\]]+/i;

interface TrelloCardLite {
  id: string;
  name: string;
  desc?: string;
}

interface TrelloAttachment {
  url?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  let cardIdForLog: string | null = null;
  try {
    const { cardId } = await params;
    cardIdForLog = cardId;
    const { apiKey, token } = getTrelloCredentials(request.headers);

    if (!apiKey || !token) {
      return NextResponse.json({ error: 'Missing Trello credentials' }, { status: 401 });
    }

    const [card, attachments] = await Promise.all([
      fetchTrelloCard(apiKey, token, cardId),
      fetchTrelloAttachments(apiKey, token, cardId),
    ]);
    const sourceFrameioUrl = findFrameioUrl(card.desc || '', attachments);
    // #region agent log
    fetch('http://127.0.0.1:7910/ingest/13c36fba-646f-40a8-b59a-5c7afb7d1da7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7515eb'},body:JSON.stringify({sessionId:'7515eb',runId:'initial',hypothesisId:'H6',location:'app/api/frameio/transfer/[cardId]/route.ts:POST',message:'Resolved source Frame.io URL candidate',data:{cardId,hasSourceUrl:!!sourceFrameioUrl,sourceUrlPreview:sourceFrameioUrl?sourceFrameioUrl.slice(0,120):null,attachmentCount:attachments.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!sourceFrameioUrl) {
      return NextResponse.json(
        { error: 'No Frame.io link found in this card description or attachments.' },
        { status: 400 }
      );
    }

    const fileId = await extractFrameioFileId(sourceFrameioUrl);
    // #region agent log
    fetch('http://127.0.0.1:7910/ingest/13c36fba-646f-40a8-b59a-5c7afb7d1da7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7515eb'},body:JSON.stringify({sessionId:'7515eb',runId:'initial',hypothesisId:'H7',location:'app/api/frameio/transfer/[cardId]/route.ts:POST',message:'Extracted Frame.io file id',data:{cardId,fileIdPreview:fileId.slice(0,8),sourceHost:safeHost(sourceFrameioUrl)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    let downloadUrl = '';
    try {
      downloadUrl = await getFrameioDownloadUrl(fileId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const shouldTryIdFallback = /Failed to fetch Frame\.io file .* \(404\)/i.test(msg);
      // #region agent log
      fetch('http://127.0.0.1:7910/ingest/13c36fba-646f-40a8-b59a-5c7afb7d1da7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7515eb'},body:JSON.stringify({sessionId:'7515eb',runId:'post-fix',hypothesisId:'H11',location:'app/api/frameio/transfer/[cardId]/route.ts:POST',message:'Primary file lookup failed; evaluating id fallback',data:{shouldTryIdFallback,errorPreview:msg.slice(0,180),sourceHost:safeHost(sourceFrameioUrl)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (!shouldTryIdFallback) throw err;
      try {
        downloadUrl = await getFrameioDownloadUrlByIdFallback(fileId);
        // #region agent log
        fetch('http://127.0.0.1:7910/ingest/13c36fba-646f-40a8-b59a-5c7afb7d1da7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7515eb'},body:JSON.stringify({sessionId:'7515eb',runId:'post-fix',hypothesisId:'H12',location:'app/api/frameio/transfer/[cardId]/route.ts:POST',message:'Id fallback resolved download URL',data:{sourceHost:safeHost(sourceFrameioUrl),downloadUrlHost:safeHost(downloadUrl)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      } catch (idFallbackErr: unknown) {
        const idFallbackMsg = idFallbackErr instanceof Error ? idFallbackErr.message : String(idFallbackErr);
        downloadUrl = await resolveFrameioPublicSourceUrl(sourceFrameioUrl);
        // #region agent log
        fetch('http://127.0.0.1:7910/ingest/13c36fba-646f-40a8-b59a-5c7afb7d1da7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7515eb'},body:JSON.stringify({sessionId:'7515eb',runId:'post-fix',hypothesisId:'H18',location:'app/api/frameio/transfer/[cardId]/route.ts:POST',message:'Using public source URL fallback after id fallback failure',data:{idFallbackError:idFallbackMsg.slice(0,180),sourceHost:safeHost(sourceFrameioUrl),resolvedSourceHost:safeHost(downloadUrl)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
    }

    const targetFolderId = await resolveFrameioTargetFolderId();
    const uploaded = await uploadToFrameio({
      fileName: sanitizeFileName(card.name || 'uploaded-file'),
      sourceUrl: downloadUrl,
      parentFolderId: targetFolderId,
    });

    return NextResponse.json({
      ok: true,
      cardId: card.id,
      source_frameio_url: sourceFrameioUrl,
      uploaded_frameio_url: uploaded.view_url,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Temporary debug logging to expose the exact backend failure in local runs.
    console.error('[frameio-transfer] POST failed', {
      cardId: cardIdForLog,
      error: toDebugError(err),
    });
    // #region agent log
    fetch('http://127.0.0.1:7910/ingest/13c36fba-646f-40a8-b59a-5c7afb7d1da7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7515eb'},body:JSON.stringify({sessionId:'7515eb',runId:'initial',hypothesisId:'H8',location:'app/api/frameio/transfer/[cardId]/route.ts:POST',message:'Transfer route failed',data:{error:msg.slice(0,300)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function fetchTrelloCard(
  apiKey: string,
  token: string,
  cardId: string
): Promise<TrelloCardLite> {
  const res = await fetch(
    `${TRELLO_BASE}/cards/${cardId}?key=${apiKey}&token=${token}&fields=id,name,desc`
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch Trello card ${cardId}: HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchTrelloAttachments(
  apiKey: string,
  token: string,
  cardId: string
): Promise<TrelloAttachment[]> {
  const res = await fetch(
    `${TRELLO_BASE}/cards/${cardId}/attachments?key=${apiKey}&token=${token}`
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch Trello attachments for ${cardId}: HTTP ${res.status}`);
  }
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

function findFrameioUrl(desc: string, attachments: TrelloAttachment[]): string | null {
  const fromDesc = firstFrameioMatch(desc);
  if (fromDesc) return fromDesc;

  for (const att of attachments) {
    const u = firstFrameioMatch(att.url || '');
    if (u) return u;
  }
  return null;
}

function firstFrameioMatch(text: string): string | null {
  const m = text.match(FRAMEIO_URL_RE);
  if (!m?.[0]) return null;
  // Strip trailing punctuation and any Trello markdown link remnants like ][url]
  return m[0].replace(/[)\],.;!?]+$/, '');
}

function sanitizeFileName(name: string): string {
  const safe = name.replace(/[/\\?%*:|"<>]/g, '_').trim();
  return /\.\w{2,5}$/.test(safe) ? safe : `${safe}.mp4`;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function toDebugError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return { raw: String(err) };
  }

  const e = err as Error & {
    status?: number;
    code?: string | number;
    response?: unknown;
    body?: unknown;
    details?: unknown;
    cause?: unknown;
  };

  return {
    name: e.name,
    message: e.message,
    stack: e.stack,
    code: e.code,
    status: e.status,
    response: e.response,
    body: e.body,
    details: e.details,
    cause:
      e.cause instanceof Error
        ? {
            name: e.cause.name,
            message: e.cause.message,
            stack: e.cause.stack,
          }
        : e.cause,
  };
}
