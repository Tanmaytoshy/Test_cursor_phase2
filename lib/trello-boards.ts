/**
 * Trello board auto-discovery.
 *
 * Rather than hard-coding EDITORS_TRELLO_BOARD_ID / CLIENT_TRELLO_BOARD_ID,
 * this module fetches all boards the token can access and classifies them:
 *
 *  - EDITORS board  → name contains the letters e, d, i, t as a subsequence
 *                     (case-insensitive).  Examples: "Editors", "Video Editing",
 *                     "Edit Queue", "Post-Edit Review" all match.
 *  - CLIENT board   → the first board that does NOT match the editors pattern.
 *
 * Priority order:
 *  1. Explicit env vars (EDITORS_TRELLO_BOARD_ID / CLIENT_TRELLO_BOARD_ID) — if
 *     both are set they are used as-is and no API call is made.
 *  2. In-memory cache (reset on process restart).
 *  3. Persistent cache in data/tokens.json under the "trello_boards" key
 *     (TTL: 1 hour).
 *  4. Live discovery via Trello API.
 */

import fs from 'fs';
import path from 'path';

const TRELLO_BASE = 'https://api.trello.com/1';
const TOKENS_PATH = path.join(process.cwd(), 'data', 'tokens.json');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface ResolvedBoards {
  editorsBoardId: string;
  clientBoardId: string;
  /** true when the IDs came from the Trello API rather than env vars */
  autoDiscovered: boolean;
  /** names of the discovered boards, for logging/UI */
  editorsBoardName?: string;
  clientBoardName?: string;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

let memCache: (ResolvedBoards & { cachedAt: number }) | null = null;

// ── Subsequence check ─────────────────────────────────────────────────────────

/**
 * Returns true if `name` contains the letters e, d, i, t in that order
 * (not necessarily consecutive).  Case-insensitive.
 *
 * Examples that return true:  "Editors", "Video Editing", "Edit Queue"
 * Examples that return false: "Client Reviews", "Done", "Archive"
 */
export function containsEditSubsequence(name: string): boolean {
  const target = 'edit';
  const lower = name.toLowerCase();
  let ti = 0;
  for (let i = 0; i < lower.length && ti < target.length; i++) {
    if (lower[i] === target[ti]) ti++;
  }
  return ti === target.length;
}

// ── Persistent cache helpers ──────────────────────────────────────────────────

interface TokensFile {
  trello_boards?: {
    editors_board_id: string;
    editors_board_name: string;
    client_board_id: string;
    client_board_name: string;
    resolved_at: number;
  };
  [key: string]: unknown;
}

function readTokensFile(): TokensFile {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')) as TokensFile;
  } catch {
    return {};
  }
}

function writeTokensFile(data: TokensFile): void {
  try {
    fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('[trello-boards] Could not write tokens file:', err);
  }
}

function loadFromDiskCache(): ResolvedBoards | null {
  const file = readTokensFile();
  const cached = file.trello_boards;
  if (!cached) return null;
  if (Date.now() - cached.resolved_at > CACHE_TTL_MS) return null;
  return {
    editorsBoardId: cached.editors_board_id,
    clientBoardId: cached.client_board_id,
    editorsBoardName: cached.editors_board_name,
    clientBoardName: cached.client_board_name,
    autoDiscovered: true,
  };
}

function saveToDiskCache(result: ResolvedBoards): void {
  const file = readTokensFile();
  file.trello_boards = {
    editors_board_id: result.editorsBoardId,
    editors_board_name: result.editorsBoardName ?? '',
    client_board_id: result.clientBoardId,
    client_board_name: result.clientBoardName ?? '',
    resolved_at: Date.now(),
  };
  writeTokensFile(file);
}

// ── Live discovery ────────────────────────────────────────────────────────────

interface TrelloBoard {
  id: string;
  name: string;
  closed: boolean;
}

async function discoverFromApi(apiKey: string, token: string): Promise<ResolvedBoards> {
  const res = await fetch(
    `${TRELLO_BASE}/members/me/boards?key=${apiKey}&token=${token}&fields=id,name,closed`
  );
  if (!res.ok) {
    throw new Error(`Trello board discovery failed: HTTP ${res.status}`);
  }

  const boards: TrelloBoard[] = await res.json();
  const open = boards.filter((b) => !b.closed);

  const editorsBoard = open.find((b) => containsEditSubsequence(b.name));
  if (!editorsBoard) {
    throw new Error(
      `No editors board found. None of your Trello boards contain the ` +
      `letters e-d-i-t in sequence. Board names: ${open.map((b) => b.name).join(', ')}`
    );
  }

  const clientBoard = open.find((b) => b.id !== editorsBoard.id && !containsEditSubsequence(b.name));
  if (!clientBoard) {
    throw new Error(
      `No client board found. Every accessible board matched the editors ` +
      `pattern (e-d-i-t). Board names: ${open.map((b) => b.name).join(', ')}`
    );
  }

  const result: ResolvedBoards = {
    editorsBoardId: editorsBoard.id,
    editorsBoardName: editorsBoard.name,
    clientBoardId: clientBoard.id,
    clientBoardName: clientBoard.name,
    autoDiscovered: true,
  };

  console.log(
    `[trello-boards] Auto-discovered — editors: "${editorsBoard.name}" (${editorsBoard.id}),` +
    ` client: "${clientBoard.name}" (${clientBoard.id})`
  );

  memCache = { ...result, cachedAt: Date.now() };
  saveToDiskCache(result);

  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the editors and client board IDs, auto-discovering them if needed.
 * Pass `apiKey` and `token` so discovery can call the Trello API when required.
 */
export async function resolveTrelloBoards(
  apiKey: string,
  token: string
): Promise<ResolvedBoards> {
  // 1. Explicit env vars override everything
  const envEditors = process.env.EDITORS_TRELLO_BOARD_ID;
  const envClient  = process.env.CLIENT_TRELLO_BOARD_ID;
  if (envEditors && envClient) {
    return {
      editorsBoardId: envEditors,
      clientBoardId: envClient,
      autoDiscovered: false,
    };
  }

  // 2. In-memory cache
  if (memCache && Date.now() - memCache.cachedAt < CACHE_TTL_MS) {
    return memCache;
  }

  // 3. Disk cache
  const disk = loadFromDiskCache();
  if (disk) {
    memCache = { ...disk, cachedAt: Date.now() };
    return disk;
  }

  // 4. Live discovery
  return discoverFromApi(apiKey, token);
}

/**
 * Clears both the in-memory and persistent caches, forcing fresh discovery
 * on the next call to `resolveTrelloBoards`.
 */
export function clearTrelloBoardsCache(): void {
  memCache = null;
  const file = readTokensFile();
  delete file.trello_boards;
  writeTokensFile(file);
  console.log('[trello-boards] Cache cleared — boards will be re-discovered on next use.');
}
