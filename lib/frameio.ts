/**
 * Frame.io v4 API integration
 *
 * Handles:
 *  - Extracting Frame.io file IDs from share/review/project URLs
 *  - Fetching the original download URL for a file
 *  - Finding a project by name and getting its root folder ID
 *  - Uploading a file to Frame.io via remote upload (no local download needed)
 *
 * Authentication: OAuth access token via lib/frameio-auth.ts (auto-refreshed).
 * Account scoping: FRAMEIO_ACCOUNT_ID env var.
 */

import { getValidAccessToken, getFrameioAccountId } from '@/lib/frameio-auth';

const FRAMEIO_BASE = 'https://api.frame.io/v4';
const FRAMEIO_V2_BASE = 'https://api.frame.io/v2';

async function frameioHeaders(): Promise<Record<string, string>> {
  const token = await getValidAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Extract a Frame.io file/asset ID from a variety of URL formats:
 *  - https://next.frame.io/project/{proj_id}/view/{file_id}
 *  - https://app.frame.io/reviews/{review_token}     (legacy share link)
 *  - https://f.io/{short_token}                       (short link — we follow redirect)
 *  - A raw UUID string passed directly
 */
export async function extractFrameioFileId(url: string): Promise<string> {
  const trimmed = url.trim();

  // Direct next.frame.io project view link → file_id is the last path segment
  const nextMatch = trimmed.match(
    /next\.frame\.io\/project\/[^/]+\/view\/([0-9a-f-]{36})/i
  );
  if (nextMatch) return nextMatch[1];

  // Review/share links on any frame.io host → call v2 share endpoint to resolve
  const reviewMatch = trimmed.match(/(?:app|next)\.frame\.io\/reviews\/([^/?#]+)/i);
  if (reviewMatch) {
    const token = reviewMatch[1];
    return resolveReviewToken(token);
  }

  // Short link — follow redirect and retry
  const shortMatch = trimmed.match(/^https?:\/\/f\.io\/([^/?#]+)/i);
  if (shortMatch) {
    const resolved = await followRedirect(trimmed);
    if (resolved && resolved !== trimmed) return extractFrameioFileId(resolved);
    throw new Error(`Could not resolve short Frame.io link: ${trimmed}`);
  }

  // Generic fallback for frame.io URLs:
  // 1) known UUID query params
  // 2) any UUID in path segments
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const isFrameioHost = host === 'f.io' || host.endsWith('.frame.io');

    if (isFrameioHost) {
      for (const key of ['id', 'asset_id', 'file_id']) {
        const candidate = parsed.searchParams.get(key);
        if (candidate && isUuid(candidate)) return candidate;
      }

      const pathUuid = parsed.pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (pathUuid) return pathUuid[0];
    }
  } catch {
    // Not a parseable URL; continue to other fallbacks.
  }

  // Raw UUID
  if (isUuid(trimmed)) {
    return trimmed;
  }

  // Last fallback: any UUID embedded in the input.
  const embeddedUuid = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (embeddedUuid) return embeddedUuid[0];

  throw new Error(
    `Unsupported Frame.io URL format: ${trimmed}. ` +
      'Expected formats: next.frame.io/project/.../view/{id}, app.frame.io/reviews/{token}'
  );
}

/** Resolve a Frame.io v2 review/share token → asset ID */
async function resolveReviewToken(token: string): Promise<string> {
  const res = await fetch(`${FRAMEIO_V2_BASE}/shares/${token}`, {
    headers: await frameioHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Frame.io share lookup failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  const assetId = data?.assets?.[0]?.id || data?.asset?.id || data?.id;
  if (!assetId) {
    throw new Error(`Could not extract asset ID from share token: ${token}`);
  }
  return assetId;
}

/** Follow a redirect and return the final URL */
async function followRedirect(url: string): Promise<string> {
  try {
    const headRes = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (headRes.url && headRes.url !== url) return headRes.url;
  } catch {
    // Some providers block HEAD; retry with GET.
  }

  try {
    const getRes = await fetch(url, { method: 'GET', redirect: 'follow' });
    return getRes.url || url;
  } catch {
    return url;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Fetch the original download URL for a Frame.io file (v4).
 * Returns the direct download URL string.
 */
export async function getFrameioDownloadUrl(fileId: string): Promise<string> {
  const accountId = await getFrameioAccountId();
  // #region agent log
  fetch('http://127.0.0.1:7910/ingest/13c36fba-646f-40a8-b59a-5c7afb7d1da7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7515eb'},body:JSON.stringify({sessionId:'7515eb',runId:'initial',hypothesisId:'H9',location:'lib/frameio.ts:getFrameioDownloadUrl',message:'Fetching file download URL from v4 account endpoint',data:{accountIdPreview:accountId.slice(0,8),fileIdPreview:fileId.slice(0,8)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  const res = await fetch(
    `${FRAMEIO_BASE}/accounts/${accountId}/files/${fileId}?include=media_links.original`,
    { headers: await frameioHeaders() }
  );

  if (!res.ok) {
    const text = await res.text();
    // #region agent log
    fetch('http://127.0.0.1:7910/ingest/13c36fba-646f-40a8-b59a-5c7afb7d1da7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7515eb'},body:JSON.stringify({sessionId:'7515eb',runId:'initial',hypothesisId:'H10',location:'lib/frameio.ts:getFrameioDownloadUrl',message:'v4 file lookup failed',data:{status:res.status,errorPreview:text.slice(0,220),fileIdPreview:fileId.slice(0,8)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    throw new Error(
      `Failed to fetch Frame.io file ${fileId} (${res.status}): ${text}`
    );
  }

  const data = await res.json();
  const downloadUrl =
    data?.data?.media_links?.original?.url ||
    data?.data?.original ||
    data?.data?.download_url;

  if (!downloadUrl) {
    throw new Error(
      `No download URL found for Frame.io file ${fileId}. ` +
        'Ensure the token has download permissions.'
    );
  }

  return downloadUrl;
}

/**
 * Fallback resolution when account-scoped /files/{id} lookup returns 404.
 * Tries alternate non-account-scoped endpoints with the same asset/file id.
 */
export async function getFrameioDownloadUrlByIdFallback(fileId: string): Promise<string> {
  const endpointCandidates = [
    { source: 'v4-file', url: `${FRAMEIO_BASE}/files/${fileId}?include=media_links.original` },
    { source: 'v2-asset', url: `${FRAMEIO_V2_BASE}/assets/${fileId}` },
  ];

  let lastErr = 'No endpoint attempts executed';
  for (const candidate of endpointCandidates) {
    // #region agent log
    fetch('http://127.0.0.1:7910/ingest/13c36fba-646f-40a8-b59a-5c7afb7d1da7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7515eb'},body:JSON.stringify({sessionId:'7515eb',runId:'post-fix',hypothesisId:'H15',location:'lib/frameio.ts:getFrameioDownloadUrlByIdFallback',message:'Trying id fallback endpoint',data:{source:candidate.source,fileIdPreview:fileId.slice(0,8)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    const res = await fetch(candidate.url, { headers: await frameioHeaders() });
    if (!res.ok) {
      const text = await res.text();
      lastErr = `${candidate.source}: ${res.status} ${text}`;
      // #region agent log
      fetch('http://127.0.0.1:7910/ingest/13c36fba-646f-40a8-b59a-5c7afb7d1da7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7515eb'},body:JSON.stringify({sessionId:'7515eb',runId:'post-fix',hypothesisId:'H16',location:'lib/frameio.ts:getFrameioDownloadUrlByIdFallback',message:'Id fallback endpoint failed',data:{source:candidate.source,status:res.status,errorPreview:text.slice(0,180)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      continue;
    }

    const payload = await res.json();
    const downloadUrl =
      payload?.data?.media_links?.original?.url ||
      payload?.data?.original ||
      payload?.data?.download_url ||
      payload?.media_links?.original?.url ||
      payload?.original ||
      payload?.download_url;

    if (downloadUrl) {
      // #region agent log
      fetch('http://127.0.0.1:7910/ingest/13c36fba-646f-40a8-b59a-5c7afb7d1da7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7515eb'},body:JSON.stringify({sessionId:'7515eb',runId:'post-fix',hypothesisId:'H17',location:'lib/frameio.ts:getFrameioDownloadUrlByIdFallback',message:'Id fallback endpoint produced download URL',data:{source:candidate.source,downloadUrlHost:safeHost(downloadUrl)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return downloadUrl;
    }
  }

  throw new Error(`Could not resolve download URL with id fallback endpoints. Last error: ${lastErr}`);
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Find a Frame.io project by name and return its { project_id, root_folder_id }.
 * Searches through all projects in the account.
 */
export async function findFrameioProject(
  projectName: string
): Promise<{ project_id: string; root_folder_id: string }> {
  const accountId = await getFrameioAccountId();

  // Paginate if needed
  let after: string | null = null;
  do {
    const reqUrl: string =
      `${FRAMEIO_BASE}/accounts/${accountId}/projects?page_size=50` +
      (after ? `&after=${after}` : '');

    const res = await fetch(reqUrl, { headers: await frameioHeaders() });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to list Frame.io projects (${res.status}): ${text}`);
    }

    const body = await res.json();
    const projects: Array<{
      id: string;
      name: string;
      root_asset_id?: string;
      root_folder_id?: string;
    }> = body?.data ?? [];

    const match = projects.find(
      (p) => p.name.toLowerCase() === projectName.toLowerCase()
    );

    if (match) {
      const rootFolderId = match.root_folder_id || match.root_asset_id;
      if (!rootFolderId) {
        throw new Error(
          `Project "${projectName}" found but has no root_folder_id/root_asset_id`
        );
      }
      return { project_id: match.id, root_folder_id: rootFolderId };
    }

    after = body?.links?.next ? extractAfterCursor(body.links.next) : null;
  } while (after);

  throw new Error(
    `Frame.io project "${projectName}" not found in account ${accountId}`
  );
}

function extractAfterCursor(nextLink: string): string | null {
  try {
    const url = new URL(nextLink, 'https://api.frame.io');
    return url.searchParams.get('after');
  } catch {
    return null;
  }
}

/**
 * Upload a file to Frame.io using the remote upload method.
 * The source file is fetched directly by Frame.io from the provided URL —
 * we never download it to this server.
 *
 * Returns the new file's view_url (e.g. https://next.frame.io/project/.../view/{id}).
 */
export async function uploadToFrameio(params: {
  fileName: string;
  sourceUrl: string;
  parentFolderId: string;
  accountId?: string;
}): Promise<{ file_id: string; view_url: string }> {
  const accountId = params.accountId || await getFrameioAccountId();

  const res = await fetch(
    `${FRAMEIO_BASE}/accounts/${accountId}/folders/${params.parentFolderId}/files`,
    {
      method: 'POST',
      headers: await frameioHeaders(),
      body: JSON.stringify({
        data: {
          name: params.fileName,
          source_url: params.sourceUrl,
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Frame.io upload failed (${res.status}): ${text}`);
  }

  const body = await res.json();
  const file = body?.data;

  if (!file?.id) {
    throw new Error('Frame.io upload response missing file ID');
  }

  const viewUrl =
    file.view_url ||
    `https://next.frame.io/project/${file.project_id}/view/${file.id}`;

  return { file_id: file.id, view_url: viewUrl };
}
