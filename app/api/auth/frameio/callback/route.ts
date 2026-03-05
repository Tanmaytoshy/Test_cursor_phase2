/**
 * GET /api/auth/frameio/callback
 *
 * Adobe IMS redirects here after the user authorizes the app.
 * Exchanges the authorization code for access + refresh tokens and stores them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens, readFrameioTokens } from '@/lib/frameio-auth';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code  = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    const desc = searchParams.get('error_description') || error;
    return new NextResponse(errorPage(`Adobe authorization denied: ${desc}`), {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  if (!code) {
    return new NextResponse(errorPage('No authorization code received from Adobe.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  try {
    const issued = await exchangeCodeForTokens(code);
    const persisted = readFrameioTokens();
    const persistenceOk =
      !!issued.refresh_token &&
      persisted.refresh_token === issued.refresh_token;
    // #region agent log
    fetch('http://127.0.0.1:7910/ingest/13c36fba-646f-40a8-b59a-5c7afb7d1da7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7515eb'},body:JSON.stringify({sessionId:'7515eb',runId:'initial',hypothesisId:'H5',location:'app/api/auth/frameio/callback/route.ts:GET',message:'Frame.io callback token persistence check',data:{persistenceOk,issuedHasRefresh:!!issued.refresh_token,persistedHasRefresh:!!persisted.refresh_token,issuedRefreshLen:(issued.refresh_token||'').length,persistedRefreshLen:(persisted.refresh_token||'').length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    return new NextResponse(successPage({
      persistenceOk,
      accessToken: issued.access_token || '',
      refreshToken: issued.refresh_token || '',
    }), {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new NextResponse(errorPage(msg), {
      status: 500,
      headers: { 'Content-Type': 'text/html' },
    });
  }
}

function successPage(params: {
  persistenceOk: boolean;
  accessToken: string;
  refreshToken: string;
}): string {
  const { persistenceOk, accessToken, refreshToken } = params;
  const needsManualEnv = !persistenceOk;

  return `<!DOCTYPE html>
<html>
<head>
  <title>Frame.io Connected</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #080b12; color: #e2e8f0;
           display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #111827; border: 1px solid rgba(255,255,255,.07); border-radius: 16px;
            padding: 32px 34px; text-align: center; max-width: 720px; }
    .icon { font-size: 3rem; margin-bottom: 16px; }
    h2 { font-size: 1.2rem; font-weight: 700; margin-bottom: 10px; color: #34d399; }
    p { font-size: .88rem; color: #94a3b8; line-height: 1.6; margin-bottom: 20px; }
    a { color: #a78bfa; font-size: .84rem; text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
    .warn {
      text-align: left; margin: 18px 0 16px;
      border: 1px solid rgba(251,191,36,.3); border-radius: 12px;
      background: rgba(251,191,36,.08); padding: 12px 14px;
      color: #fde68a; font-size: .82rem; line-height: 1.55;
    }
    .token-block {
      text-align: left; margin-top: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: .75rem; white-space: pre-wrap; word-break: break-all;
      background: rgba(2,6,23,.65); border: 1px solid rgba(255,255,255,.09);
      border-radius: 10px; padding: 10px 11px; color: #e2e8f0;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h2>Frame.io Connected!</h2>
    <p>Your Frame.io OAuth authorization succeeded.</p>
    ${needsManualEnv ? `
      <div class="warn">
        This environment cannot persist tokens to the local filesystem (common on Vercel serverless).
        <br/><br/>
        Add these in Vercel Project Settings → Environment Variables, redeploy, and then refresh the dashboard:
        <div class="token-block">FRAMEIO_ACCESS_TOKEN=${escapeHtml(accessToken)}
FRAMEIO_REFRESH_TOKEN=${escapeHtml(refreshToken)}</div>
      </div>
    ` : `
      <p>Tokens were saved successfully. You can close this tab and return to the dashboard.</p>
    `}
    <a href="/">← Back to Dashboard</a>
  </div>
  <script>
    // Auto-close after 3 seconds if opened as a popup
    if (window.opener) {
      window.opener.postMessage({ type: 'frameio_auth_success' }, '*');
      setTimeout(() => window.close(), 2500);
    }
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Frame.io Auth Error</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #080b12; color: #e2e8f0;
           display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #111827; border: 1px solid rgba(248,113,113,.2); border-radius: 16px;
            padding: 40px 48px; text-align: center; max-width: 440px; }
    .icon { font-size: 3rem; margin-bottom: 16px; }
    h2 { font-size: 1.1rem; font-weight: 700; margin-bottom: 10px; color: #f87171; }
    p { font-size: .84rem; color: #94a3b8; line-height: 1.6; word-break: break-word; }
    a { color: #a78bfa; font-size: .84rem; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✗</div>
    <h2>Authorization Failed</h2>
    <p>${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
    <br/>
    <a href="/">← Back to Dashboard</a>
  </div>
</body>
</html>`;
}
