/**
 * Frame.io v4 OAuth token management (Adobe IMS)
 *
 * Mirrors the same pattern as lib/google-auth.ts:
 *  - Tokens stored in data/tokens.json under the "frameio" key
 *  - Env var fallbacks: FRAMEIO_ACCESS_TOKEN, FRAMEIO_REFRESH_TOKEN
 *  - Auto-refresh when access token is expired
 *
 * Adobe IMS endpoints:
 *  - Auth:    https://ims-na1.adobelogin.com/ims/authorize/v2
 *  - Token:   https://ims-na1.adobelogin.com/ims/token/v3
 *  - Refresh: same token endpoint, grant_type=refresh_token
 */

import fs from 'fs';
import path from 'path';
import { getPublicAppUrl } from '@/lib/app-url';

const DATA_DIR   = path.join(process.cwd(), 'data');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');

const ADOBE_AUTH_URL    = 'https://ims-na1.adobelogin.com/ims/authorize/v2';
const ADOBE_TOKEN_URL   = 'https://ims-na1.adobelogin.com/ims/token/v3';

// Scopes must match exactly what is configured in the Adobe Developer Console
// OAuth Web App credential (openid + offline_access for refresh token support)
const FRAMEIO_SCOPES = [
  'openid',
  'offline_access',
  'additional_info.roles',
  'profile',
  'email',
].join(',');

export interface FrameioTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;   // unix ms
  token_type?: string | null;
  account_id?: string | null;   // auto-fetched from GET /v4/accounts
}

// ── Token file read/write (same file as Google tokens) ───────────────────────

interface AllTokens {
  source?: object;
  dest?: object;
  frameio?: FrameioTokens;
  trello_boards?: object;
}

function readAllTokens(): AllTokens {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8')) as AllTokens;
    }
  } catch { /* ignore */ }
  return {};
}

function writeAllTokens(data: AllTokens): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    // Silently ignore read-only filesystem (Vercel) — tokens must use env vars there
    if (code !== 'EROFS' && code !== 'ENOENT') throw err;
  }
}

export function readFrameioTokens(): FrameioTokens {
  const all = readAllTokens();
  const stored = all.frameio || {};

  // Env var fallbacks (file tokens win if present)
  const tokens: FrameioTokens = {
    access_token:  process.env.FRAMEIO_ACCESS_TOKEN  || null,
    refresh_token: process.env.FRAMEIO_REFRESH_TOKEN || null,
    expires_at:    null,
  };

  if (stored.access_token)  tokens.access_token  = stored.access_token;
  if (stored.refresh_token) tokens.refresh_token = stored.refresh_token;
  if (stored.expires_at)    tokens.expires_at    = stored.expires_at;

  return tokens;
}

function readStoredAccountId(): string | null {
  const all = readAllTokens();
  const aid = (all.frameio as FrameioTokens)?.account_id;
  return aid || null;
}

function writeStoredAccountId(accountId: string): void {
  const all = readAllTokens();
  if (!all.frameio) all.frameio = {};
  (all.frameio as FrameioTokens).account_id = accountId;
  writeAllTokens(all);
}

export function writeFrameioTokens(tokens: FrameioTokens): void {
  const all = readAllTokens();
  all.frameio = tokens;
  writeAllTokens(all);
}

// ── OAuth helpers ─────────────────────────────────────────────────────────────

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId     = process.env.FRAMEIO_CLIENT_ID;
  const clientSecret = process.env.FRAMEIO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('FRAMEIO_CLIENT_ID and FRAMEIO_CLIENT_SECRET must be set');
  }
  return { clientId, clientSecret };
}

function getRedirectUri(): string {
  const appUrl = getPublicAppUrl();
  if (!appUrl) throw new Error('APP_URL (or Vercel public URL) must be set');
  return `${appUrl}/api/auth/frameio/callback`;
}

/** Build the Adobe IMS authorization URL to redirect the user to. */
export function getFrameioAuthUrl(): string {
  const { clientId } = getCredentials();
  const redirectUri = getRedirectUri();

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    scope:         FRAMEIO_SCOPES,
    response_type: 'code',
  });

  return `${ADOBE_AUTH_URL}?${params}`;
}

/** Exchange the authorization code (from callback) for access + refresh tokens. */
export async function exchangeCodeForTokens(code: string): Promise<FrameioTokens> {
  const { clientId, clientSecret } = getCredentials();
  const redirectUri = getRedirectUri();

  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    client_id:     clientId,
    client_secret: clientSecret,
    redirect_uri:  redirectUri,
  });

  const res = await fetch(ADOBE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Adobe IMS token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const tokens: FrameioTokens = {
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at:    data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    token_type:    data.token_type,
  };

  writeFrameioTokens(tokens);
  return tokens;
}

/** Refresh the access token using the stored refresh token. */
async function refreshAccessToken(refreshToken: string): Promise<FrameioTokens> {
  const { clientId, clientSecret } = getCredentials();

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    client_id:     clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(ADOBE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Adobe IMS token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const current = readFrameioTokens();
  const tokens: FrameioTokens = {
    ...current,
    access_token: data.access_token,
    expires_at:   data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    // Adobe may return a new refresh_token
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
  };

  writeFrameioTokens(tokens);
  return tokens;
}

/**
 * Get a valid Frame.io access token, refreshing automatically if expired.
 * Throws if no credentials are available at all.
 */
export async function getValidAccessToken(): Promise<string> {
  const tokens = readFrameioTokens();

  if (!tokens.access_token && !tokens.refresh_token) {
    throw new Error(
      'Frame.io is not connected. Visit /api/auth/frameio to authorize.'
    );
  }

  // Token is valid and not close to expiry (5 min buffer)
  const isValid =
    tokens.access_token &&
    tokens.expires_at &&
    tokens.expires_at > Date.now() + 5 * 60 * 1000;

  if (isValid) return tokens.access_token!;

  // Need refresh
  if (!tokens.refresh_token) {
    // No refresh token — use access token as-is (may fail if expired)
    if (tokens.access_token) return tokens.access_token;
    throw new Error('Frame.io access token is expired and no refresh token is available. Re-authorize.');
  }

  const refreshed = await refreshAccessToken(tokens.refresh_token);
  return refreshed.access_token!;
}

/** Returns true if Frame.io is connected (has at least a refresh token). */
export function isFrameioConnected(): boolean {
  const tokens = readFrameioTokens();
  return !!(tokens.refresh_token || tokens.access_token);
}

const FRAMEIO_ME_URL = 'https://api.frame.io/v2/me';
const FRAMEIO_V4_ACCOUNTS_URL = 'https://api.frame.io/v4/accounts?page_size=1';

/**
 * Returns the Frame.io account ID. Priority: env var → stored (tokens.json) → fetch from API.
 * Auto-fetches and stores the account ID when Frame.io is connected but not yet cached.
 */
export async function getFrameioAccountId(): Promise<string> {
  const fromEnv = process.env.FRAMEIO_ACCOUNT_ID;
  if (fromEnv?.trim()) return fromEnv.trim();

  const stored = readStoredAccountId();
  if (stored) return stored;

  const token = await getValidAccessToken();
  // Primary attempt: legacy v2 /me endpoint.
  const meRes = await fetch(FRAMEIO_ME_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (meRes.ok) {
    const data = (await meRes.json()) as { account_id?: string };
    const accountId = data?.account_id;
    if (accountId) {
      writeStoredAccountId(accountId);
      console.log(`[frameio-auth] Auto-fetched and cached FRAMEIO_ACCOUNT_ID via /v2/me: ${accountId}`);
      return accountId;
    }
  }

  // Fallback: v4 accounts listing. Some tokens can access v4 but not v2 /me.
  const accountsRes = await fetch(FRAMEIO_V4_ACCOUNTS_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (accountsRes.ok) {
    const body = (await accountsRes.json()) as { data?: Array<{ id?: string }> };
    const accountId = body?.data?.[0]?.id;
    if (accountId) {
      writeStoredAccountId(accountId);
      console.log(`[frameio-auth] Auto-fetched and cached FRAMEIO_ACCOUNT_ID via /v4/accounts: ${accountId}`);
      return accountId;
    }
    throw new Error('Frame.io /v4/accounts response missing account id');
  }

  const meText = await meRes.text().catch(() => '');
  const accountsText = await accountsRes.text().catch(() => '');
  throw new Error(
    `Frame.io account lookup failed. ` +
    `/v2/me: ${meRes.status} ${meText || '(no body)'}; ` +
    `/v4/accounts: ${accountsRes.status} ${accountsText || '(no body)'}. ` +
    `Reconnect Frame.io from Automation if this persists.`
  );
}

/** Returns true if we have or can resolve FRAMEIO_ACCOUNT_ID (sync check only). */
export function hasFrameioAccountId(): boolean {
  if (process.env.FRAMEIO_ACCOUNT_ID?.trim()) return true;
  return !!readStoredAccountId();
}
