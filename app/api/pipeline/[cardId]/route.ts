import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createJob, updateJob } from '@/lib/jobs';
import { transferDrive } from '@/lib/drive-transfer';
import { getTrelloCredentials } from '@/lib/trello-auth';

const TRELLO_BASE = 'https://api.trello.com/1';
const DRIVE_URL_RE =
  /https?:\/\/drive\.google\.com\/(?:file\/d\/|drive\/folders\/|open\?id=)[^\s<>"')]+/;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const { cardId } = await params;
  const { apiKey, token } = getTrelloCredentials(request.headers);

  if (!apiKey || !token) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const cardName: string = body.card_name || '';

  const jobId = randomUUID();
  createJob(jobId, cardId, cardName);

  // Fire-and-forget — does not block the response
  runPipelineBackground(jobId, cardId, apiKey, token, cardName);

  return NextResponse.json({ job_id: jobId, status: 'running' });
}

async function runPipelineBackground(
  jobId: string,
  cardId: string,
  apiKey: string,
  token: string,
  cardName: string
): Promise<void> {
  try {
    const [cardRes, attachRes] = await Promise.all([
      fetch(
        `${TRELLO_BASE}/cards/${cardId}?key=${apiKey}&token=${token}&fields=id,name,desc,url`
      ),
      fetch(`${TRELLO_BASE}/cards/${cardId}/attachments?key=${apiKey}&token=${token}`),
    ]);

    if (!cardRes.ok) {
      updateJob(jobId, {
        status: 'error',
        error: `Could not fetch card: HTTP ${cardRes.status}`,
      });
      return;
    }

    const card = await cardRes.json();
    const attachments = attachRes.ok ? await attachRes.json() : [];

    const driveUrl = findDriveUrl(card.desc || '', attachments);
    if (!driveUrl) {
      updateJob(jobId, {
        status: 'error',
        error: "No Google Drive link found in this card's description or attachments.",
      });
      return;
    }

    const links = await transferDrive(driveUrl, (msg) => {
      console.log(`[job:${jobId}] ${msg}`);
    });

    if (!links.length) {
      updateJob(jobId, {
        status: 'error',
        error: 'Transfer completed but produced no public links.',
      });
      return;
    }

    updateJob(jobId, {
      status: 'complete',
      public_links: links,
      finished_at: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline error] job=${jobId}`, err);
    updateJob(jobId, { status: 'error', error: msg });
  }
}

function findDriveUrl(desc: string, attachments: Array<{ url?: string }>): string | null {
  const m = desc.match(DRIVE_URL_RE);
  if (m) return m[0];
  for (const att of attachments) {
    if (att.url && DRIVE_URL_RE.test(att.url)) return att.url;
  }
  return null;
}
