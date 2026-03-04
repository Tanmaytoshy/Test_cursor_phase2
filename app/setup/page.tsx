'use client';

import { useEffect, useState } from 'react';

interface TokenStatus { source: boolean; dest: boolean; sourceFallback?: boolean; frameio?: boolean }

export default function SetupPage() {
  const [password, setPassword]       = useState('');
  const [authed, setAuthed]           = useState(false);
  const [status, setStatus]           = useState<TokenStatus | null>(null);
  const [message, setMessage]         = useState('');
  const [msgType, setMsgType]         = useState<'success' | 'error'>('success');
  const [loading, setLoading]         = useState(false);
  const [refreshToken, setRefreshToken] = useState('');
  const [refreshTokenType, setRefreshTokenType] = useState('');

  /* Read query params on mount */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const connected = p.get('connected');
    const error = p.get('error');
    const rt = p.get('refresh_token');
    if (connected) {
      setMessage(`✓ ${connected === 'source' ? 'Source' : 'Destination'} account connected!`);
      setMsgType('success');
      if (rt) { setRefreshToken(rt); setRefreshTokenType(connected); }
    }
    if (error) {
      setMessage(`Error: ${decodeURIComponent(error)}`);
      setMsgType('error');
    }
  }, []);

  async function handleUnlock() {
    setLoading(true);
    try {
      // Validate password by trying to hit the auth initiation endpoint
      const res = await fetch(`/api/auth/google/source?password=${encodeURIComponent(password)}`, {
        redirect: 'manual',
      });
      // A redirect (3xx) means password was correct; a 401 means wrong
      if (res.type === 'opaqueredirect' || res.status === 302 || res.status === 200) {
        await loadStatus();
        setAuthed(true);
      } else {
        setMessage('Incorrect password');
        setMsgType('error');
      }
    } catch {
      // fetch may throw on opaque redirect in some browsers — that's fine, password was accepted
      await loadStatus();
      setAuthed(true);
    } finally {
      setLoading(false);
    }
  }

  async function loadStatus() {
    const res = await fetch('/api/setup/status');
    const data = await res.json();
    setStatus(data);
    setAuthed(true);
  }

  function connectAccount(type: 'source' | 'dest') {
    window.location.href = `/api/auth/google/${type}?password=${encodeURIComponent(password)}`;
  }

  /* Auto-show status if arriving back from OAuth callback */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('connected') || p.get('error')) {
      loadStatus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Listen for Frame.io OAuth popup success */
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === 'frameio_auth_success') {
        setMessage('✓ Frame.io connected!');
        setMsgType('success');
        loadStatus();
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function connectFrameio() {
    window.open(
      `/api/auth/frameio?password=${encodeURIComponent(password)}`,
      'frameio_auth',
      'width=600,height=700,left=200,top=100'
    );
  }

  return (
    <div className="setup-page">
      <div className="setup-card">
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width={32} height={32}>
            <defs>
              <linearGradient id="slg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#7c3aed"/>
                <stop offset="100%" stopColor="#38bdf8"/>
              </linearGradient>
            </defs>
            <rect width="36" height="36" rx="9" fill="url(#slg)"/>
            <rect x="6" y="6" width="10" height="20" rx="3" fill="white" opacity=".95"/>
            <rect x="20" y="6" width="10" height="13" rx="3" fill="white" opacity=".7"/>
          </svg>
          <span style={{
            fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-.3px',
            background: 'linear-gradient(135deg,#a78bfa 0%,#38bdf8 55%,#fbbf24 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            Stinson&apos;s Dashboard
          </span>
        </div>

        <h1 style={{
          background: 'linear-gradient(135deg,#a78bfa,#38bdf8)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          Google Drive Setup
        </h1>
        <p className="subtitle">
          Connect your source and destination Google accounts so the pipeline can transfer Drive files.
          This page is password-protected — only you should access it.
        </p>

        {/* Message banner */}
        {message && (
          <div className={`setup-message ${msgType}`}>{message}</div>
        )}

        {/* Refresh token display for read-only environments (Vercel) */}
        {refreshToken && (
          <div style={{
            background: 'rgba(99,102,241,.1)', border: '1px solid rgba(99,102,241,.3)',
            borderRadius: 10, padding: '14px 16px', marginBottom: 16, fontSize: '.78rem',
          }}>
            <div style={{ fontWeight: 700, color: '#a78bfa', marginBottom: 6 }}>
              ⚠ Save this refresh token as an environment variable
            </div>
            <div style={{ color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
              This deployment has a read-only filesystem. Add this to Vercel
              → Settings → Environment Variables, then redeploy:
            </div>
            <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>
              {refreshTokenType === 'dest' ? 'GOOGLE_DEST_REFRESH_TOKEN' : 'GOOGLE_SOURCE_REFRESH_TOKEN'}
            </div>
            <div style={{
              background: 'rgba(0,0,0,.4)', borderRadius: 6, padding: '8px 10px',
              fontFamily: 'monospace', fontSize: '.72rem', color: '#7dd3fc',
              wordBreak: 'break-all', userSelect: 'all',
            }}>
              {refreshToken}
            </div>
          </div>
        )}

        {!authed ? (
          /* Password gate */
          <>
            <div className="field" style={{ marginTop: 24 }}>
              <label>Setup Password</label>
              <input
                type="password"
                placeholder="Enter setup password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                autoFocus
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={handleUnlock}
              disabled={loading || !password}
            >
              {loading ? 'Verifying…' : 'Unlock Setup'}
            </button>
            <p style={{ marginTop: 16, fontSize: '.78rem', color: 'var(--muted)' }}>
              The password is set via the <code>SETUP_PASSWORD</code> environment variable on your server.
            </p>
          </>
        ) : (
          /* Account status */
          <>
            <div style={{ marginBottom: 24, marginTop: 8 }}>
              {/* Source account */}
              <div className="account-row">
                <div className="account-info">
                  <div className="account-name">Source Account</div>
                  <div className="account-desc">
                    {status?.sourceFallback
                      ? 'Using destination account — shared Drive links work without a separate source account'
                      : 'Downloads files FROM this Drive (read-only)'}
                  </div>
                </div>
                {status?.sourceFallback ? (
                  <span className="status-badge" style={{ background: 'rgba(99,102,241,.15)', color: '#818cf8' }}>
                    Auto
                  </span>
                ) : status?.source ? (
                  <span className="status-badge status-connected">✓ Connected</span>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ width: 'auto', marginTop: 0 }}
                    onClick={() => connectAccount('source')}
                  >
                    Connect
                  </button>
                )}
              </div>

              {/* Dest account */}
              <div className="account-row">
                <div className="account-info">
                  <div className="account-name">Destination Account</div>
                  <div className="account-desc">Uploads files TO this Drive (full access)</div>
                </div>
                {status?.dest ? (
                  <span className="status-badge status-connected">✓ Connected</span>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ width: 'auto', marginTop: 0 }}
                    onClick={() => connectAccount('dest')}
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>

            {/* Frame.io connection */}
            <div style={{ marginTop: 24, marginBottom: 8 }}>
              <h2 style={{
                fontSize: '1.1rem', fontWeight: 700, marginBottom: 12,
                background: 'linear-gradient(135deg,#a78bfa,#38bdf8)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                Frame.io Setup
              </h2>
              <div className="account-row">
                <div className="account-info">
                  <div className="account-name">Frame.io Account</div>
                  <div className="account-desc">
                    Authorise via Adobe IMS so the app can upload videos and resolve review links
                  </div>
                </div>
                {status?.frameio ? (
                  <span className="status-badge status-connected">✓ Connected</span>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ width: 'auto', marginTop: 0 }}
                    onClick={connectFrameio}
                  >
                    Connect Frame.io
                  </button>
                )}
              </div>
            </div>

            {status?.source && status?.dest && status?.frameio && (
              <div className="setup-message success" style={{ marginBottom: 16 }}>
                ✓ All services connected — the pipeline is ready to use!
              </div>
            )}
            {status?.source && status?.dest && !status?.frameio && (
              <div className="setup-message success" style={{ marginBottom: 16 }}>
                ✓ Google accounts connected — connect Frame.io to enable the full automation.
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="btn btn-ghost btn-sm"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={loadStatus}
              >
                Refresh Status
              </button>
              <a
                href="/"
                className="btn btn-primary btn-sm"
                style={{ flex: 1, justifyContent: 'center', textDecoration: 'none' }}
              >
                Go to Dashboard →
              </a>
            </div>

            <p style={{ marginTop: 20, fontSize: '.76rem', color: 'var(--muted)', lineHeight: 1.7 }}>
              Tokens are saved to <code>data/tokens.json</code> on the server.
              Mount a Railway Volume at <code>/app/data</code> to persist them across redeployments.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
