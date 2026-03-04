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

  // Legacy app.frame.io review link → call v2 share endpoint to resolve
  const reviewMatch = trimmed.match(/app\.frame\.io\/reviews\/([^/?#]+)/i);
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

  // Raw UUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return trimmed;
  }

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
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.url;
  } catch {
    return url;
  }
}

/**
 * Fetch the original download URL for a Frame.io file (v4).
 * Returns the direct download URL string.
 */
export async function getFrameioDownloadUrl(fileId: string): Promise<string> {
  const accountId = await getFrameioAccountId();

  const res = await fetch(
    `${FRAMEIO_BASE}/accounts/${accountId}/files/${fileId}?include=media_links.original`,
    { headers: await frameioHeaders() }
  );

  if (!res.ok) {
    const text = await res.text();
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
