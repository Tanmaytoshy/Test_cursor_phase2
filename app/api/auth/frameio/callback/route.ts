/**
 * GET /api/auth/frameio/callback
 *
 * Adobe IMS redirects here after the user authorizes the app.
 * Exchanges the authorization code for access + refresh tokens and stores them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/frameio-auth';

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
    await exchangeCodeForTokens(code);
    return new NextResponse(successPage(), {
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

function successPage(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Frame.io Connected</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #080b12; color: #e2e8f0;
           display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #111827; border: 1px solid rgba(255,255,255,.07); border-radius: 16px;
            padding: 40px 48px; text-align: center; max-width: 400px; }
    .icon { font-size: 3rem; margin-bottom: 16px; }
    h2 { font-size: 1.2rem; font-weight: 700; margin-bottom: 10px; color: #34d399; }
    p { font-size: .88rem; color: #94a3b8; line-height: 1.6; margin-bottom: 20px; }
    a { color: #a78bfa; font-size: .84rem; text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h2>Frame.io Connected!</h2>
    <p>Your Frame.io account is now linked. You can close this tab and return to the dashboard.</p>
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
