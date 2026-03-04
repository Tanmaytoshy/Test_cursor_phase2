# Phase 2 — Frame.io Automation Setup Guide

This document explains how to configure and deploy the **Frame.io automation** feature added in this phase.

---

## What it does

When an editor moves a card to the **"Done"** column on the **editors Trello board**, the system automatically:

1. Reads the Frame.io video link from the card description
2. Fetches the original download URL from Frame.io (using the v4 API)
3. Uploads the video to **your** Frame.io account/project via remote upload (Frame.io fetches it directly — no server storage needed)
4. Finds the matching card on the **client Trello board** (matched by card name)
5. Prepends the new Frame.io view URL to the client card description
6. Moves the editors card to the **"Double Check"** column on the editors board

---

## Prerequisites

- The app must be deployed to a **public HTTPS URL** (Railway, Vercel, etc.) — Trello webhooks require a publicly reachable callback URL
- A Frame.io v4 account (Adobe-managed)
- Trello API key + token (already set up from Phase 1)

---

## New Environment Variables

Add these to your Railway/deployment environment (in addition to the existing ones):

| Variable | Description |
|---|---|
| `FRAMEIO_API_TOKEN` | Frame.io developer API token (see below) |
| `FRAMEIO_ACCOUNT_ID` | Your Frame.io account UUID |
| `FRAMEIO_PROJECT_NAME` | Exact name of the Frame.io project to upload videos into |
| `EDITORS_TRELLO_BOARD_ID` | Trello board ID for the editors board (from board URL) |
| `CLIENT_TRELLO_BOARD_ID` | Trello board ID for the client board |
| `DONE_LIST_NAME` | Exact name of the "Done" column on the editors board (case-sensitive) |
| `DOUBLE_CHECK_LIST_NAME` | Exact name of the "Double Check" column on the editors board (case-sensitive) |

---

## Getting your Frame.io credentials

### API Token

1. Go to [developer.adobe.com/console](https://developer.adobe.com/console)
2. Sign in with the **same Adobe ID** you use for Frame.io
3. Create a new project (or use an existing one)
4. Add the **Frame.io API** to the project
5. Create credentials → choose **User Authentication (OAuth)**
6. Generate a user token — this is your `FRAMEIO_API_TOKEN`

> The token must have **read** (to get download URL) and **write** (to upload files) permissions on Frame.io.

### Account ID

After generating a token, call:
```
GET https://api.frame.io/v4/accounts
Authorization: Bearer YOUR_TOKEN
```
The first item's `id` field is your `FRAMEIO_ACCOUNT_ID`.

Alternatively, it appears in Frame.io API response URLs.

---

## Getting your Trello Board IDs

Open the board in Trello. The URL looks like:
```
https://trello.com/b/BOARD_ID/board-name
```
The `BOARD_ID` (e.g. `abc12345`) is what you need.

---

## Frame.io link format in card descriptions

The editor must put the Frame.io link **in the card description**. Supported formats:

| Format | Example |
|---|---|
| Project view link (preferred) | `https://next.frame.io/project/{id}/view/{file_id}` |
| Legacy review/share link | `https://app.frame.io/reviews/{token}` |

The system extracts the **first** Frame.io URL it finds in the description.

---

## Registering the Trello Webhook

Once all environment variables are set and the app is deployed:

1. Open the dashboard in your browser
2. Click **"Automation"** in the top navigation bar
3. Check the config health grid — all items should be green
4. Click **"Register Webhook"**

The webhook is registered at:
```
POST {APP_URL}/api/webhook/trello
```

Trello will call this URL in real-time whenever any action occurs on the editors board.

> **You only need to register the webhook once.** It persists on Trello's side until explicitly deleted.

---

## Webhook API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/webhook/trello` | POST | Receives Trello webhook events |
| `/api/webhook/trello` | HEAD | Trello verification ping (auto-handled) |
| `/api/webhook/register` | POST | Register or delete the webhook |
| `/api/webhook/status` | GET | Check webhook + config status |

---

## Troubleshooting

**Webhook not firing?**
- Confirm the app is deployed to a public HTTPS URL
- Check the "Automation" panel in the dashboard — ensure `isRegistered: true`
- Trello requires the callback URL to respond with 200 to both HEAD and POST

**Frame.io upload failing?**
- Confirm `FRAMEIO_API_TOKEN` has write access to the target project
- Confirm `FRAMEIO_ACCOUNT_ID` matches the token's account
- Check server logs for detailed error messages

**Client card not updating?**
- Ensure the client board card name **exactly matches** the editor card name (case-sensitive, same spacing)
- Confirm `CLIENT_TRELLO_BOARD_ID` is set correctly

**Card not moving to Double Check?**
- Ensure `DOUBLE_CHECK_LIST_NAME` exactly matches the column name on the editors board (case-sensitive)
- Confirm `EDITORS_TRELLO_BOARD_ID` is set correctly

---

## Architecture note

The Frame.io upload uses **remote upload** — Frame.io fetches the video directly from the source URL. This means:
- No video data passes through this server
- No temporary file storage needed
- Works on serverless platforms (Vercel) and persistent servers (Railway)
