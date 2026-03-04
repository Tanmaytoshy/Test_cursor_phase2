# Hosting Guide — Stinson's Dashboard on Railway

## Overview

This app runs as a persistent Node.js server on **Railway** (not serverless).
This is critical because the Google Drive pipeline does long-running background jobs
and needs a persistent in-memory job store.

---

## Step 1 — Google Cloud Console setup (one time)

You need **two** OAuth 2.0 clients — one per Google account (source + destination).
You can reuse the same Google Cloud project for both.

1. Go to https://console.cloud.google.com/
2. Create a project (or use an existing one)
3. Enable the **Google Drive API**
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Under "Authorised redirect URIs" add:
   ```
   https://YOUR-RAILWAY-DOMAIN.railway.app/api/auth/google/callback
   ```
7. Download the JSON — copy the `client_id` and `client_secret` values
8. Repeat steps 4-7 for the second (destination) account if using a different Google Cloud project,
   or just create a second OAuth client in the same project

---

## Step 2 — Push to GitHub

```bash
cd nextjs
git init
git add .
git commit -m "Initial Next.js app"
git remote add origin https://github.com/Tanmaytoshy/Test_cursor.git
git push -u origin main
```

---

## Step 3 — Deploy to Railway

1. Sign up at https://railway.app (free plan works)
2. Click **New Project → Deploy from GitHub repo**
3. Select your `Test_cursor` repository and the branch
4. Railway auto-detects Next.js and deploys it

---

## Step 4 — Set environment variables in Railway

In your Railway project → **Variables**, add:

| Variable | Value |
|---|---|
| `APP_URL` | `https://your-app.up.railway.app` (your Railway domain) |
| `SETUP_PASSWORD` | A strong password you choose |
| `GOOGLE_SOURCE_CLIENT_ID` | From step 1 (source account) |
| `GOOGLE_SOURCE_CLIENT_SECRET` | From step 1 (source account) |
| `GOOGLE_DEST_CLIENT_ID` | From step 1 (dest account) |
| `GOOGLE_DEST_CLIENT_SECRET` | From step 1 (dest account) |

---

## Step 5 — Connect your custom domain

1. In Railway: **Settings → Networking → Custom Domain**
2. Enter your domain (e.g. `dashboard.yourdomain.com`)
3. Railway gives you a CNAME record
4. In your domain registrar DNS settings, add:
   ```
   Type: CNAME
   Name: dashboard (or @)
   Value: <railway-provided-cname>
   ```
5. SSL is automatic — Railway provisions a Let's Encrypt certificate

6. **Important**: Update `APP_URL` in Railway env vars to your custom domain:
   ```
   APP_URL=https://dashboard.yourdomain.com
   ```
7. Also update the OAuth redirect URI in Google Cloud Console to:
   ```
   https://dashboard.yourdomain.com/api/auth/google/callback
   ```

---

## Step 6 — Connect Google accounts (one time after deploy)

1. Visit `https://your-domain.com/setup`
2. Enter your `SETUP_PASSWORD`
3. Click **Connect** for the source account → completes OAuth in browser
4. Click **Connect** for the destination account → completes OAuth in browser
5. Both show "✓ Connected" — you're done

### Persisting tokens across redeployments

By default tokens are stored in `data/tokens.json` which is wiped on redeploy.
**Fix:** Add a Railway Volume:

1. Railway project → **Volumes → Create Volume**
2. Mount path: `/app/data`
3. Tokens will survive redeployments

**Alternative:** After the first `/setup` OAuth flow, grab the `refresh_token` values
from the `data/tokens.json` file and set them as env vars:
```
GOOGLE_SOURCE_REFRESH_TOKEN=1//...
GOOGLE_DEST_REFRESH_TOKEN=1//...
```
These env vars are loaded automatically, so you never need to re-authenticate.

---

## Local development

```bash
cd nextjs
npm install
cp .env.example .env.local
# Fill in your values in .env.local
npm run dev
```

Visit http://localhost:3000

For local OAuth, set `APP_URL=http://localhost:3000` and add
`http://localhost:3000/api/auth/google/callback` to your Google OAuth redirect URIs.

---

## Cost estimate

| Service | Cost |
|---|---|
| Railway Hobby plan | $5/month (includes $5 usage credit) |
| Domain (optional) | ~$10-15/year |
| Google APIs | Free (within generous quotas) |
| **Total** | **~$5/month** |

Railway's free trial gives you $5 credit to start with, so first month is free.
