'use client';

import { useCallback, useEffect, useState } from 'react';

/* ─── Webhook status types ───────────────────────────────────── */
interface WebhookConfig {
  TRELLO_KEY: boolean; TRELLO_TOKEN: boolean; APP_URL: boolean;
  FRAMEIO_CLIENT_ID: boolean; FRAMEIO_CLIENT_SECRET: boolean;
  FRAMEIO_ACCOUNT_ID: boolean; FRAMEIO_PROJECT_NAME: boolean;
  FRAMEIO_CONNECTED: boolean;
  EDITORS_TRELLO_BOARD_ID: boolean; CLIENT_TRELLO_BOARD_ID: boolean;
  DONE_LIST_NAME: boolean; DOUBLE_CHECK_LIST_NAME: boolean;
}
interface WebhookHook { id: string; callbackURL: string; idModel: string; description?: string }
interface WebhookStatus {
  config: WebhookConfig; allConfigured: boolean;
  isRegistered: boolean; callbackUrl: string | null; webhooks: WebhookHook[];
}

/* ─── Types ──────────────────────────────────────────────────── */
interface TrelloLabel { color: string | null; name?: string }
interface TrelloMember { fullName: string; initials?: string }
interface TrelloCard {
  id: string; name: string; desc?: string; idList: string; listName?: string;
  labels?: TrelloLabel[]; due?: string | null; dueComplete?: boolean;
  url?: string; shortUrl?: string; closed?: boolean; members?: TrelloMember[];
}
interface TrelloList { id: string; name: string }
interface TrelloBoard { id: string; name: string }

/* ─── Constants ──────────────────────────────────────────────── */
const LABEL_COLORS: Record<string, string> = {
  green: '#22c55e', yellow: '#f59e0b', orange: '#f97316', red: '#ef4444',
  purple: '#a855f7', blue: '#3b82f6', sky: '#0ea5e9', lime: '#84cc16',
  pink: '#ec4899', black: '#374151', null: '#9ca3af', '': '#9ca3af',
};

/* ─── Helpers ────────────────────────────────────────────────── */

/* ─── Logo SVG ───────────────────────────────────────────────── */
function LogoSvg({ size = 36 }: { size?: number }) {
  const id = `lg${size}`;
  return (
    <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width={size} height={size}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="9" fill={`url(#${id})`} />
      <rect x="6" y="6" width="10" height="20" rx="3" fill="white" opacity=".95" />
      <rect x="20" y="6" width="10" height="13" rx="3" fill="white" opacity=".7" />
    </svg>
  );
}

/* ─── Main component ─────────────────────────────────────────── */
export default function Dashboard() {
  const [isAuth, setIsAuth]               = useState(false);
  const [boards, setBoards]               = useState<TrelloBoard[]>([]);
  const [boardId, setBoardId]             = useState('');
  const [boardName, setBoardName]         = useState('');
  const [allCards, setAllCards]           = useState<TrelloCard[]>([]);
  const [allLists, setAllLists]           = useState<TrelloList[]>([]);
  const [search, setSearch]               = useState('');
  const [showArchived, setShowArchived]   = useState(false);
  const [loading, setLoading]             = useState(false);
  const [selectedCard, setSelectedCard]   = useState<TrelloCard | null>(null);
  const [toast, setToast]                 = useState('');
  const [toastKey, setToastKey]           = useState(0);
  const [processingDoneIds, setProcessingDoneIds] = useState<Record<string, boolean>>({});

  // Webhook automation panel
  const [showWebhook, setShowWebhook]       = useState(false);
  const [webhookStatus, setWebhookStatus]   = useState<WebhookStatus | null>(null);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookAction, setWebhookAction]   = useState<'idle' | 'registering' | 'deleting'>('idle');

  /* Toast helper */
  function showToast(msg: string) {
    setToast(msg);
    setToastKey(k => k + 1);
  }

  /* Auth headers */
  const headers = useCallback(
    () => ({} as Record<string, string>),
    []
  );

  /* ── Auto-connect using server env credentials ─────────────── */
  useEffect(() => {
    fetch('/api/boards')
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
        return data;
      })
      .then((data) => {
        if (Array.isArray(data)) {
          setBoards(data);
          setIsAuth(true);
          if (data.length === 0) showToast('Connected — but no boards found on this account');
        } else {
          throw new Error('Unexpected response from /api/boards');
        }
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        showToast(`Trello auth failed — set TRELLO_KEY and TRELLO_TOKEN. (${msg})`);
        setIsAuth(false);
      });
  }, []);

  /* ── Toast auto-hide ───────────────────────────────────────── */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(t);
  }, [toast, toastKey]);

  function handleLogout() {
    // No user-scoped auth in env mode; just reset local UI state.
    setIsAuth(false);
    setBoards([]); setBoardId(''); setBoardName('');
    setAllCards([]); setAllLists([]);
  }

  /* ── Load board ────────────────────────────────────────────── */
  async function loadBoard(id: string, name: string, archived: boolean) {
    setLoading(true); setAllCards([]); setAllLists([]);
    try {
      const res = await fetch(`/api/boards/${id}/cards?include_closed=${archived}`, { headers: headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAllCards(data.cards);
      setAllLists(data.lists);
    } catch {
      showToast('Error loading board');
    } finally {
      setLoading(false);
    }
  }

  function handleBoardChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    const name = e.target.options[e.target.selectedIndex]?.text || '';
    setBoardId(id); setBoardName(name);
    if (id) loadBoard(id, name, showArchived);
  }

  useEffect(() => {
    if (boardId) loadBoard(boardId, boardName, showArchived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  /* ── Derived render data ───────────────────────────────────── */
  const query = search.trim().toLowerCase();
  const filteredLists = allLists.map(list => ({
    ...list,
    cards: allCards.filter(c =>
      c.idList === list.id &&
      (!query || c.name.toLowerCase().includes(query) || (c.desc || '').toLowerCase().includes(query))
    ),
  }));

  let statTotal = 0, statOverdue = 0, statSoon = 0, statDone = 0;
  allCards.forEach(c => {
    if (!c.due) return;
    statTotal++;
    const diff = (new Date(c.due).getTime() - Date.now()) / 3600000;
    if (c.dueComplete) statDone++;
    else if (diff < 0) statOverdue++;
    else if (diff < 48) statSoon++;
  });

  async function moveCardToDone(card: TrelloCard) {
    if (processingDoneIds[card.id]) return;
    setProcessingDoneIds(prev => ({ ...prev, [card.id]: true }));

    try {
      const doneList = allLists.find(l => l.name.trim().toLowerCase() === 'done');
      if (!doneList) {
        showToast('Done list not found');
        return;
      }

      // Step 1: run Frame.io transfer first.
      const transferRes = await fetch(`/api/frameio/transfer/${card.id}`, {
        method: 'POST',
        headers: headers(),
      });
      const transferData = await transferRes.json().catch(() => null);
      if (!transferRes.ok) {
        throw new Error(transferData?.error || `Frame.io transfer failed (HTTP ${transferRes.status})`);
      }

      const shareLink: string = transferData?.uploaded_frameio_url || '';
      if (!shareLink) {
        throw new Error('Frame.io upload completed but no shareable link was returned.');
      }

      // Step 2: only after successful transfer, move card to Done.
      const moveRes = await fetch(`/api/cards/${card.id}`, {
        method: 'PATCH',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ idList: doneList.id }),
      });
      if (!moveRes.ok) throw new Error(`Move failed (HTTP ${moveRes.status})`);

      setAllCards(prev => prev.map(c =>
        c.id === card.id ? { ...c, idList: doneList.id, listName: doneList.name } : c
      ));
      showToast(`Moved to "${doneList.name}"`);

      try {
        await navigator.clipboard.writeText(shareLink);
      } catch {
        // Clipboard permissions can fail in some browser contexts.
      }

      const target = window.prompt(
        `Share link copied:\n${shareLink}\n\nWhere should I upload this new link? Paste Trello card URL or card ID. Leave empty to skip.`
      );

      if (!target || !target.trim()) {
        showToast('Frame.io link ready. Upload skipped for now.');
        return;
      }

      const uploadRes = await fetch('/api/frameio/upload-link', {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: target.trim(), frameioLink: shareLink }),
      });
      const uploadData = await uploadRes.json().catch(() => null);
      if (!uploadRes.ok) {
        throw new Error(uploadData?.error || `Could not upload link (HTTP ${uploadRes.status})`);
      }

      showToast(`Uploaded link to "${uploadData?.cardName || 'target card'}"`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg || 'Could not complete Done + Frame.io flow');
    } finally {
      setProcessingDoneIds(prev => ({ ...prev, [card.id]: false }));
    }
  }

  /* ── Due badge helper ──────────────────────────────────────── */
  function dueBadge(card: TrelloCard) {
    if (!card.due) return null;
    const diff = (new Date(card.due).getTime() - Date.now()) / 3600000;
    let cls: string, label: string;
    if (card.dueComplete)  { cls = 'due-done';    label = 'Done'; }
    else if (diff < 0)     { cls = 'due-overdue'; label = 'Overdue'; }
    else if (diff < 48)    { cls = 'due-soon';    label = 'Due soon'; }
    else                   { cls = 'due-ok';      label = new Date(card.due).toLocaleDateString(); }
    return (
      <span className={`due-badge ${cls}`}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
        </svg>
        {label}
      </span>
    );
  }

  /* ── Webhook automation helpers ──────────────────────────────── */
  async function loadWebhookStatus() {
    setWebhookLoading(true);
    try {
      const res = await fetch('/api/webhook/status');
      const data = await res.json();
      setWebhookStatus(data);
    } catch {
      showToast('Could not load webhook status');
    } finally {
      setWebhookLoading(false);
    }
  }

  async function handleRegisterWebhook() {
    setWebhookAction('registering');
    try {
      const res = await fetch('/api/webhook/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register' }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Registration failed'); return; }
      showToast(data.message || 'Webhook registered!');
      await loadWebhookStatus();
    } catch {
      showToast('Webhook registration request failed');
    } finally {
      setWebhookAction('idle');
    }
  }

  async function handleDeleteWebhook(webhookId: string) {
    setWebhookAction('deleting');
    try {
      const res = await fetch('/api/webhook/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', webhookId }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Delete failed'); return; }
      showToast('Webhook deleted');
      await loadWebhookStatus();
    } catch {
      showToast('Webhook delete request failed');
    } finally {
      setWebhookAction('idle');
    }
  }

  function handleToggleWebhookPanel() {
    const next = !showWebhook;
    setShowWebhook(next);
    if (next && !webhookStatus) loadWebhookStatus();
  }

  function isDoubleCheck(list: TrelloList) {
    const normalized = list.name.toLowerCase().replace(/[^a-z]/g, '');
    return (
      normalized.includes('doublecheck') ||
      normalized.includes('doulecheck')
    );
  }

  /* ─────────────────────────────────────────────────────────────
     RENDER
  ────────────────────────────────────────────────────────────── */
  return (
    <>
      {/* ── App shell ──────────────────────────────────────────── */}
      {isAuth && (
        <div className="app-shell">
          {/* Topbar */}
          <div className="topbar">
            <div className="nav-logo">
              <LogoSvg size={22} />
              <span className="nav-logo-text">Stinson&apos;s Dashboard</span>
            </div>
            <div className="nav-divider" />

            <select
              className="btn btn-ghost"
              style={{ cursor: 'pointer', minWidth: 180 }}
              value={boardId}
              onChange={handleBoardChange}
            >
              <option value="">— select a board —</option>
              {boards.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>

            <div className="spacer" />

            <div className="search-wrap">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input
                type="text"
                className="search-input"
                placeholder="Search cards…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <label className="filter-closed-wrap">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
              />
              Archived
            </label>

            <button
              className={`btn btn-ghost btn-sm webhook-toggle-btn${showWebhook ? ' active' : ''}`}
              onClick={handleToggleWebhookPanel}
              title="Frame.io Automation"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              Automation
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Sign out</button>
          </div>

          {/* Webhook automation panel */}
          {showWebhook && (
            <div className="webhook-panel">
              <div className="webhook-panel-header">
                <div className="webhook-panel-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                  </svg>
                  Frame.io Automation
                  <span className="webhook-panel-sub">
                    Done → download from Frame.io → upload to your account → update client card → move to Double Check
                  </span>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={loadWebhookStatus} disabled={webhookLoading}>
                  {webhookLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {webhookStatus && (
                <>
                  {/* Config health */}
                  <div className="webhook-config-grid">
                    {Object.entries(webhookStatus.config).map(([key, ok]) => (
                      <div key={key} className={`webhook-config-item${ok ? ' ok' : ' missing'}`}>
                        <span className="webhook-config-dot" />
                        <span className="webhook-config-key">{key}</span>
                      </div>
                    ))}
                  </div>

                  {/* Frame.io connect button */}
                  {webhookStatus.config.FRAMEIO_CLIENT_ID && webhookStatus.config.FRAMEIO_CLIENT_SECRET && !webhookStatus.config.FRAMEIO_CONNECTED && (
                    <div className="webhook-frameio-connect">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
                      </svg>
                      Frame.io is not yet authorized.
                      <button
                        className="btn btn-confirm btn-sm"
                        onClick={() => {
                          const pw = prompt('Enter setup password to connect Frame.io:');
                          if (pw) window.open(`/api/auth/frameio?password=${encodeURIComponent(pw)}`, '_blank', 'width=600,height=700');
                        }}
                      >
                        Connect Frame.io →
                      </button>
                    </div>
                  )}

                  {webhookStatus.config.FRAMEIO_CONNECTED && (
                    <div className="webhook-frameio-ok">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/>
                      </svg>
                      Frame.io account connected
                    </div>
                  )}

                  {!webhookStatus.allConfigured && (
                    <div className="webhook-alert">
                      Some environment variables are missing (shown in red above). Set them and redeploy before registering the webhook.
                    </div>
                  )}

                  {/* Webhook registration */}
                  <div className="webhook-registration">
                    <div className="webhook-reg-status">
                      <span className={`status-badge ${webhookStatus.isRegistered ? 'status-connected' : 'status-disconnected'}`}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                        {webhookStatus.isRegistered ? 'Webhook Active' : 'Not Registered'}
                      </span>
                      {webhookStatus.callbackUrl && (
                        <span className="webhook-url">{webhookStatus.callbackUrl}</span>
                      )}
                    </div>

                    {!webhookStatus.isRegistered && (
                      <button
                        className="btn btn-confirm btn-sm"
                        disabled={!webhookStatus.allConfigured || webhookAction !== 'idle'}
                        onClick={handleRegisterWebhook}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                        </svg>
                        {webhookAction === 'registering' ? 'Registering…' : 'Register Webhook'}
                      </button>
                    )}

                    {webhookStatus.webhooks.length > 0 && (
                      <div className="webhook-list">
                        {webhookStatus.webhooks.map(wh => (
                          <div key={wh.id} className="webhook-item">
                            <div className="webhook-item-info">
                              <span className="webhook-item-id">ID: {wh.id}</span>
                              {wh.description && (
                                <span className="webhook-item-desc">{wh.description}</span>
                              )}
                            </div>
                            <button
                              className="btn btn-ghost btn-sm webhook-delete-btn"
                              disabled={webhookAction !== 'idle'}
                              onClick={() => handleDeleteWebhook(wh.id)}
                            >
                              {webhookAction === 'deleting' ? '…' : 'Delete'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {webhookLoading && !webhookStatus && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', color: 'var(--muted)', fontSize: '.82rem' }}>
                  <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  Loading status…
                </div>
              )}
            </div>
          )}

          {/* Stats bar */}
          {allLists.length > 0 && (
            <div className="statsbar">
              <div className="stat">
                <div className="stat-dot" style={{ background: '#64748b' }} />
                <span>Total: <strong>{statTotal}</strong></span>
              </div>
              <div className="stat">
                <div className="stat-dot" style={{ background: '#f87171' }} />
                <span>Overdue: <strong>{statOverdue}</strong></span>
              </div>
              <div className="stat">
                <div className="stat-dot" style={{ background: '#fbbf24' }} />
                <span>Due soon: <strong>{statSoon}</strong></span>
              </div>
              <div className="stat">
                <div className="stat-dot" style={{ background: '#34d399' }} />
                <span>Completed: <strong>{statDone}</strong></span>
              </div>
            </div>
          )}

          {/* Board */}
          <div className="board">
            {loading && (
              <div className="placeholder">
                <div className="spinner" />
                <p>Loading cards…</p>
              </div>
            )}

            {!loading && !boardId && (
              <div className="placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <rect x="3" y="3" width="7" height="18" rx="1.5"/>
                  <rect x="14" y="3" width="7" height="11" rx="1.5"/>
                </svg>
                <p>Select a board to get started</p>
              </div>
            )}

            {!loading && boardId && allLists.length === 0 && (
              <div className="placeholder"><p>No lists found on this board.</p></div>
            )}

            {!loading && filteredLists.map(list => (
              <div key={list.id} className="column">
                <div className="col-header">
                  <span className="col-title">{list.name}</span>
                  <span className="col-count">{list.cards.length}</span>
                </div>
                <div className="col-body">
                  {list.cards.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 16, fontSize: '.8rem', color: 'var(--muted)' }}>
                      No cards
                    </div>
                  )}
                  {list.cards.map(card => {
                    const showDoubleCheckPipeline = isDoubleCheck(list);

                    return (
                      <div
                        key={card.id}
                        className="card"
                        onClick={() => setSelectedCard(card)}
                      >
                        {card.labels?.length ? (
                          <div className="card-labels">
                            {card.labels.map((l, i) => (
                              <div
                                key={i}
                                className="label-chip"
                                style={{
                                  background: LABEL_COLORS[l.color ?? ''] || '#9ca3af',
                                  flexBasis: Math.max(32, (l.name?.length || 0) * 7),
                                }}
                                title={l.name || ''}
                              />
                            ))}
                          </div>
                        ) : null}

                        <div className="card-name">{card.name}</div>

                        <div className="card-meta">
                          {dueBadge(card)}
                          {card.members?.length ? (
                            <div className="member-avatars">
                              {card.members.slice(0, 3).map((m, i) => (
                                <div key={i} className="avatar" title={m.fullName}>
                                  {(m.initials || '?').slice(0, 2)}
                                </div>
                              ))}
                              {card.members.length > 3 && (
                                <div className="avatar">+{card.members.length - 3}</div>
                              )}
                            </div>
                          ) : null}
                        </div>

                        {/* Double Check shortcut -> Done */}
                        {showDoubleCheckPipeline && (
                          <div className="card-action-row" onClick={e => e.stopPropagation()}>
                            <button
                              className="btn-move-done"
                              disabled={!!processingDoneIds[card.id]}
                              onClick={() => moveCardToDone(card)}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M20 6L9 17l-5-5"/>
                              </svg>
                              {processingDoneIds[card.id] ? 'Processing…' : 'Move to Done'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Card detail modal ───────────────────────────────────── */}
      {selectedCard && (
        <div
          className="modal-overlay"
          onClick={e => { if (e.target === e.currentTarget) setSelectedCard(null); }}
        >
          <div className="modal">
            <button className="modal-close" onClick={() => setSelectedCard(null)}>
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
            <ModalContent card={selectedCard} />
          </div>
        </div>
      )}

      {/* ── Toast ──────────────────────────────────────────────── */}
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>

      {/* ── Keyboard close ─────────────────────────────────────── */}
      <KeyboardHandler
        onEscape={() => {
          if (selectedCard) { setSelectedCard(null); return; }
        }}
      />
    </>
  );
}

/* ── Card modal content ──────────────────────────────────────── */
function ModalContent({ card }: { card: TrelloCard }) {
  const dueDate = card.due ? new Date(card.due) : null;
  const diff = dueDate ? (dueDate.getTime() - Date.now()) / 3600000 : null;
  let dueText = '—', dueColor = '';
  if (dueDate && diff !== null) {
    if (card.dueComplete)  { dueText = `${dueDate.toLocaleDateString()} ✓`; dueColor = '#15803d'; }
    else if (diff < 0)     { dueText = `${dueDate.toLocaleDateString()} · Overdue`; dueColor = '#dc2626'; }
    else if (diff < 48)    { dueText = `${dueDate.toLocaleDateString()} · Due soon`; dueColor = '#b45309'; }
    else                   { dueText = dueDate.toLocaleDateString(); }
  }

  return (
    <>
      <div className="modal-list-tag">{card.listName}</div>
      <div className="modal-title">{card.name}</div>

      {card.labels?.length ? (
        <div className="modal-labels">
          {card.labels.map((l, i) => (
            <span
              key={i}
              className="modal-label"
              style={{ background: LABEL_COLORS[l.color ?? ''] || '#9ca3af' }}
            >
              {l.name || l.color}
            </span>
          ))}
        </div>
      ) : null}

      <div className="modal-section">
        <div className="modal-section-title">Description</div>
        <div className={`modal-desc${card.desc ? '' : ' empty'}`}>
          {card.desc || 'No description provided.'}
        </div>
      </div>

      <div className="modal-row modal-section">
        <div className="modal-info-item">
          <div className="modal-section-title">Due Date</div>
          <div className="modal-info-val" style={dueColor ? { color: dueColor } : {}}>
            {dueText}
          </div>
        </div>
        {card.closed && (
          <div className="modal-info-item">
            <div className="modal-section-title">Status</div>
            <div className="modal-info-val" style={{ color: 'var(--muted)' }}>Archived</div>
          </div>
        )}
      </div>

      {card.members?.length ? (
        <div className="modal-section">
          <div className="modal-section-title">Members</div>
          <div className="modal-members">
            {card.members.map((m, i) => (
              <div key={i} className="modal-member">
                <div className="avatar">{(m.initials || '?').slice(0, 2)}</div>
                {m.fullName}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <a
        className="modal-link"
        href={card.shortUrl || card.url || '#'}
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Open in Trello
      </a>
    </>
  );
}

/* ── Keyboard handler ────────────────────────────────────────── */
function KeyboardHandler({ onEscape }: { onEscape: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onEscape]);
  return null;
}

