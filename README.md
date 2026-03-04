# Google Drive Video Transfer

Download a video (or any file) from a Google Drive link, re-upload it to a **different** Google account, make it **publicly accessible**, and get the shareable link.

## Setup

### 1. Google Cloud project and OAuth (two accounts)

You need **two** OAuth 2.0 Desktop app credentials (one for the account that has the file, one for the account where you want to upload):

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or use an existing one).
3. **Enable the Google Drive API**: APIs & Services → Enable APIs and Services → search “Google Drive API” → Enable.
4. Create OAuth credentials for **each** account:
   - APIs & Services → Credentials → Create Credentials → **OAuth client ID**.
   - If asked, set Application type to **Desktop app** and name it (e.g. “Drive source”, “Drive dest”).
   - Download the JSON for the **first** account and save it as `credentials_source.json` in this folder.
   - Create another OAuth client (or use a second project), download its JSON, and save as `credentials_dest.json` in this folder.

5. Add the test users (if the app is in “Testing”):
   - OAuth consent screen → Test users → Add your **source** and **destination** Gmail addresses.

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Run the script

```bash
python drive_transfer.py "https://drive.google.com/file/d/YOUR_FILE_ID/view"
```

- The **first run** will open the browser twice: once to sign in with the account that **has** the file (source), then with the account where you want to **upload** (destination). Tokens are saved so you don’t have to log in again every time.
- The script will:
  1. Download the file from the source account.
  2. Upload it to the destination account.
  3. Set the permission to **“Anyone with the link”** (viewer).
  4. Print the **shareable link** (public).

### Options

| Option | Description |
|--------|-------------|
| `--source-credentials` | Path to source account OAuth JSON (default: `credentials_source.json`) |
| `--dest-credentials` | Path to destination account OAuth JSON (default: `credentials_dest.json`) |
| `--source-token` | Where to save source token (default: `token_source.json`) |
| `--dest-token` | Where to save destination token (default: `token_dest.json`) |
| `--keep-file` | Keep the downloaded file on disk after upload |

Example with custom credential paths:

```bash
python drive_transfer.py "https://drive.google.com/file/d/abc123xyz/view" \
  --source-credentials ./my_source_creds.json \
  --dest-credentials ./my_dest_creds.json
```

## Supported link formats

The script extracts the file ID from URLs like:

- `https://drive.google.com/file/d/FILE_ID/view`
- `https://drive.google.com/open?id=FILE_ID`
- `https://drive.google.com/uc?id=FILE_ID`

## Notes

- Works for **videos** and any other Drive file type.
- The source file must be accessible to the **source** Google account (owner or shared with that account).
- The shareable link printed at the end is **public** (anyone with the link can view).
- Downloaded file is deleted after upload unless you use `--keep-file`.
