import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');

interface AccountTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  token_type?: string | null;
  scope?: string | null;
}

interface TokenData {
  source?: AccountTokens;
  dest?: AccountTokens;
}

function readTokens(): TokenData {
  const data: TokenData = {};

  // Env var overrides (lowest priority — file tokens win if present)
  if (process.env.GOOGLE_SOURCE_REFRESH_TOKEN) {
    data.source = { refresh_token: process.env.GOOGLE_SOURCE_REFRESH_TOKEN };
  }
  if (process.env.GOOGLE_DEST_REFRESH_TOKEN) {
    data.dest = { refresh_token: process.env.GOOGLE_DEST_REFRESH_TOKEN };
  }

  // File-based tokens (higher priority — setup page writes here)
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      const file = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8')) as TokenData;
      if (file.source) data.source = file.source;
      if (file.dest) data.dest = file.dest;
    }
  } catch {
    // Ignore read errors
  }

  return data;
}

export function writeTokens(tokens: TokenData) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  } catch (err: unknown) {
    // Vercel and other read-only environments can't write to disk.
    // Tokens must be persisted via GOOGLE_DEST_REFRESH_TOKEN env var instead.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EROFS' && code !== 'ENOENT' && code !== 'EROFS') {
      throw err;
    }
  }
}

// If source credentials are not configured, fall back to the destination account.
// This covers the common case where source files are shared links from various
// users — any authenticated Google account can download them.
function resolveType(type: 'source' | 'dest'): 'source' | 'dest' {
  if (type === 'source' && !process.env.GOOGLE_SOURCE_CLIENT_ID) {
    return 'dest';
  }
  return type;
}

export function getOAuth2Client(type: 'source' | 'dest') {
  const effective = resolveType(type);

  const clientId =
    effective === 'source'
      ? process.env.GOOGLE_SOURCE_CLIENT_ID
      : process.env.GOOGLE_DEST_CLIENT_ID;
  const clientSecret =
    effective === 'source'
      ? process.env.GOOGLE_SOURCE_CLIENT_SECRET
      : process.env.GOOGLE_DEST_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      `Google ${effective} credentials not configured. ` +
        `Set GOOGLE_${effective.toUpperCase()}_CLIENT_ID and GOOGLE_${effective.toUpperCase()}_CLIENT_SECRET.`
    );
  }

  const redirectUri = `${process.env.APP_URL}/api/auth/google/callback`;
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const tokens = readTokens();
  if (tokens[effective]) {
    oauth2Client.setCredentials(tokens[effective] as Parameters<typeof oauth2Client.setCredentials>[0]);

    // Auto-persist refreshed tokens
    oauth2Client.on('tokens', (newTokens) => {
      const current = readTokens();
      current[effective] = { ...current[effective], ...newTokens };
      try {
        writeTokens(current);
      } catch {
        // Ignore write errors in read-only environments
      }
    });
  }

  return oauth2Client;
}

export function getAuthUrl(type: 'source' | 'dest'): string {
  const oauth2Client = getOAuth2Client(type);
  const scopes =
    type === 'source'
      ? ['https://www.googleapis.com/auth/drive.readonly']
      : [
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive',
        ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state: type,
  });
}

export async function handleOAuthCallback(type: 'source' | 'dest', code: string) {
  const oauth2Client = getOAuth2Client(type);
  const { tokens } = await oauth2Client.getToken(code);
  const current = readTokens();
  current[type] = tokens as AccountTokens;
  writeTokens(current);
  return tokens;
}

export function getRefreshToken(type: 'source' | 'dest'): string | null {
  const tokens = readTokens();
  return tokens[type]?.refresh_token || null;
}

export function getTokenStatus(): { source: boolean; dest: boolean; sourceFallback: boolean } {
  const tokens = readTokens();
  const sourceFallback = !process.env.GOOGLE_SOURCE_CLIENT_ID;
  const destReady = !!tokens.dest?.refresh_token;
  return {
    source: sourceFallback ? destReady : !!tokens.source?.refresh_token,
    dest: destReady,
    sourceFallback,
  };
}

export function getDriveService(type: 'source' | 'dest') {
  const auth = getOAuth2Client(type);
  return google.drive({ version: 'v3', auth });
}
