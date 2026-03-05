import { NextRequest, NextResponse } from 'next/server';
import { getTrelloCredentials } from '@/lib/trello-auth';
import {
  extractFrameioFileId,
  findFrameioProject,
  getFrameioDownloadUrl,
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
  try {
    const { cardId } = await params;
    const { apiKey, token } = getTrelloCredentials(request.headers);

    if (!apiKey || !token) {
      return NextResponse.json({ error: 'Missing Trello credentials' }, { status: 401 });
    }

    const [card, attachments] = await Promise.all([
      fetchTrelloCard(apiKey, token, cardId),
      fetchTrelloAttachments(apiKey, token, cardId),
    ]);
    const sourceFrameioUrl = findFrameioUrl(card.desc || '', attachments);
    if (!sourceFrameioUrl) {
      return NextResponse.json(
        { error: 'No Frame.io link found in this card description or attachments.' },
        { status: 400 }
      );
    }

    const fileId = await extractFrameioFileId(sourceFrameioUrl);
    const downloadUrl = await getFrameioDownloadUrl(fileId);

    const projectName = process.env.FRAMEIO_PROJECT_NAME;
    if (!projectName) {
      return NextResponse.json(
        { error: 'FRAMEIO_PROJECT_NAME is not set.' },
        { status: 500 }
      );
    }

    const { root_folder_id } = await findFrameioProject(projectName);
    const uploaded = await uploadToFrameio({
      fileName: sanitizeFileName(card.name || 'uploaded-file'),
      sourceUrl: downloadUrl,
      parentFolderId: root_folder_id,
    });

    return NextResponse.json({
      ok: true,
      cardId: card.id,
      source_frameio_url: sourceFrameioUrl,
      uploaded_frameio_url: uploaded.view_url,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
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
