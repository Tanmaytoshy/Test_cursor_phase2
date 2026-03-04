#!/usr/bin/env python3
"""
Download files from a Google Drive file or folder link and re-upload them to
another (or the same) Google Drive account, make them publicly accessible,
and print the shareable links.
"""
from __future__ import annotations

import io
import re
import os
import argparse
import mimetypes

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaFileUpload
from googleapiclient.errors import HttpError


# Source: read-only. Destination: create + manage permissions.
SCOPES_READ = ["https://www.googleapis.com/auth/drive.readonly"]
SCOPES_FULL = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive",
]

DEFAULT_SOURCE_CREDENTIALS = "credentials_source.json"
DEFAULT_DEST_CREDENTIALS = "credentials_dest.json"
DEFAULT_SOURCE_TOKEN = "token_source.json"
DEFAULT_DEST_TOKEN = "token_dest.json"


# ──────────────────────────────────────────────────────────────────────────────
# URL parsing helpers
# ──────────────────────────────────────────────────────────────────────────────

def parse_drive_url(url: str) -> tuple[str, str]:
    """
    Returns (kind, id) where kind is 'folder' or 'file'.
    Raises ValueError if the URL cannot be parsed.
    """
    folder_match = re.search(r"/folders/([a-zA-Z0-9_-]+)", url)
    if folder_match:
        return "folder", folder_match.group(1)

    file_patterns = [
        r"/file/d/([a-zA-Z0-9_-]+)",
        r"[?&]id=([a-zA-Z0-9_-]+)",
        r"/uc\?.*export=download.*[?&]id=([a-zA-Z0-9_-]+)",
        r"([a-zA-Z0-9_-]{25,})",  # bare ID fallback
    ]
    for pat in file_patterns:
        m = re.search(pat, url)
        if m:
            return "file", m.group(1)

    raise ValueError(f"Could not extract a Drive file or folder ID from: {url}")


# ──────────────────────────────────────────────────────────────────────────────
# Auth
# ──────────────────────────────────────────────────────────────────────────────

def get_drive_service(credentials_path: str, token_path: str, label: str, scopes: list):
    """Build and return an authenticated Google Drive v3 service."""
    creds = None
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, scopes)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(credentials_path):
                raise FileNotFoundError(
                    f"[{label}] Credentials file not found: '{credentials_path}'.\n"
                    "  Download an OAuth 2.0 Desktop client JSON from Google Cloud Console."
                )
            print(f"\n[{label}] Opening browser for Google sign-in...")
            flow = InstalledAppFlow.from_client_secrets_file(credentials_path, scopes)
            creds = flow.run_local_server(port=0)
        with open(token_path, "w") as f:
            f.write(creds.to_json())
        print(f"  [{label}] Token saved to {token_path}")
    return build("drive", "v3", credentials=creds)


# ──────────────────────────────────────────────────────────────────────────────
# Drive operations
# ──────────────────────────────────────────────────────────────────────────────

def get_folder_name(service, folder_id: str) -> str:
    """Return the name of a Drive folder by ID."""
    meta = service.files().get(fileId=folder_id, fields="name").execute()
    return meta.get("name", "Untitled folder")


def list_folder_files(service, folder_id: str) -> list[dict]:
    """Return a list of non-folder file metadata dicts inside a Drive folder."""
    files = []
    page_token = None
    query = (
        f"'{folder_id}' in parents "
        "and mimeType != 'application/vnd.google-apps.folder' "
        "and trashed = false"
    )
    while True:
        resp = service.files().list(
            q=query,
            fields="nextPageToken, files(id, name, mimeType)",
            pageToken=page_token,
        ).execute()
        files.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return files


def create_folder(service, folder_name: str) -> str:
    """Create a folder in Drive and return its ID."""
    body = {
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder",
    }
    folder = service.files().create(body=body, fields="id").execute()
    return folder["id"]


def download_file(service, file_id: str, dest_path: str, label: str = "") -> str:
    """Download a Drive file by ID to dest_path. Returns dest_path."""
    request = service.files().get_media(fileId=file_id)
    buffer = io.BytesIO()
    downloader = MediaIoBaseDownload(buffer, request, chunksize=32 * 1024 * 1024)
    done = False
    while not done:
        status, done = downloader.next_chunk()
        if status:
            pct = int(status.progress() * 100)
            bar = "█" * (pct // 5) + "░" * (20 - pct // 5)
            print(f"\r  {label}[{bar}] {pct}%", end="", flush=True)
    print()
    buffer.seek(0)
    os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
    with open(dest_path, "wb") as f:
        f.write(buffer.read())
    return dest_path


def upload_file(
    service,
    local_path: str,
    mime_type: str | None = None,
    parent_folder_id: str | None = None,
) -> str:
    """Upload local_path to Drive, optionally inside a folder. Returns the new file's ID."""
    name = os.path.basename(local_path)
    if mime_type is None:
        guessed, _ = mimetypes.guess_type(local_path)
        mime_type = guessed or "application/octet-stream"
    body: dict = {"name": name}
    if parent_folder_id:
        body["parents"] = [parent_folder_id]
    media = MediaFileUpload(local_path, mimetype=mime_type, resumable=True, chunksize=32 * 1024 * 1024)
    file = service.files().create(body=body, media_body=media, fields="id").execute()
    return file["id"]


def make_public(service, resource_id: str) -> None:
    """Grant 'anyone' reader access so the resource is reachable via a link."""
    service.permissions().create(
        fileId=resource_id,
        body={"type": "anyone", "role": "reader"},
    ).execute()


def folder_shareable_link(folder_id: str) -> str:
    return f"https://drive.google.com/drive/folders/{folder_id}?usp=sharing"


def file_shareable_link(file_id: str) -> str:
    return f"https://drive.google.com/file/d/{file_id}/view?usp=sharing"


# ──────────────────────────────────────────────────────────────────────────────
# Main transfer logic
# ──────────────────────────────────────────────────────────────────────────────

def transfer_single_file(
    source_service,
    dest_service,
    file_id: str,
    file_name: str,
    mime_type: str,
    tmp_dir: str,
    keep_file: bool,
    dest_folder_id: str | None = None,
) -> str:
    """Download one file and upload it into dest_folder_id (if given). Returns the new file's Drive ID."""
    local_path = os.path.join(tmp_dir, file_name)
    print(f"  Downloading: {file_name}")
    download_file(source_service, file_id, local_path, label=f"{file_name} ")
    try:
        print(f"  Uploading:   {file_name}")
        new_id = upload_file(dest_service, local_path, mime_type or None, dest_folder_id)
        print(f"  Done:        {file_name}")
        return new_id
    finally:
        if not keep_file and os.path.exists(local_path):
            os.remove(local_path)


def run(
    drive_url: str,
    source_credentials: str = DEFAULT_SOURCE_CREDENTIALS,
    dest_credentials: str = DEFAULT_DEST_CREDENTIALS,
    source_token: str = DEFAULT_SOURCE_TOKEN,
    dest_token: str = DEFAULT_DEST_TOKEN,
    keep_file: bool = False,
    tmp_dir: str = ".",
) -> list[str]:
    """
    Main entry point. Returns a list of public shareable links for all
    files transferred.
    """
    kind, resource_id = parse_drive_url(drive_url)

    # If both credential files point to the same account, authenticate once
    # with full scopes so the user only signs in once.
    same_account = (
        os.path.abspath(source_credentials) == os.path.abspath(dest_credentials)
    )

    if same_account:
        print("Source and destination are the same account — authenticating once...")
        service = get_drive_service(
            dest_credentials, dest_token, "Your Account", SCOPES_FULL
        )
        source_service = service
        dest_service = service
    else:
        print("Authenticating with source Google account (for download)...")
        source_service = get_drive_service(
            source_credentials, source_token, "Source", SCOPES_READ
        )
        print("Authenticating with destination Google account (for upload)...")
        dest_service = get_drive_service(
            dest_credentials, dest_token, "Destination", SCOPES_FULL
        )

    os.makedirs(tmp_dir, exist_ok=True)

    if kind == "folder":
        # Mirror the source folder structure exactly:
        # 1. Get source folder name
        # 2. Create matching folder in destination
        # 3. Upload all files into it
        # 4. Make the folder public and return one folder link
        folder_name = get_folder_name(source_service, resource_id)
        print(f"\nSource folder name: \"{folder_name}\"")

        print(f"Listing files in source folder...")
        files = list_folder_files(source_service, resource_id)
        if not files:
            print("No files found in the folder.")
            return []
        print(f"Found {len(files)} file(s): {', '.join(f['name'] for f in files)}\n")

        print(f"Creating folder \"{folder_name}\" in destination Drive...")
        dest_folder_id = create_folder(dest_service, folder_name)
        print(f"  Folder created (id: {dest_folder_id})\n")

        for i, f in enumerate(files, 1):
            print(f"[{i}/{len(files)}] {f['name']}")
            transfer_single_file(
                source_service,
                dest_service,
                f["id"],
                f["name"],
                f.get("mimeType", ""),
                tmp_dir,
                keep_file,
                dest_folder_id=dest_folder_id,
            )
            print()

        print("Making folder publicly accessible...")
        make_public(dest_service, dest_folder_id)
        folder_link = folder_shareable_link(dest_folder_id)

        print("\n" + "=" * 60)
        print("Transfer complete. Public shareable folder link:")
        print("=" * 60)
        print(f"  {folder_link}")
        print("=" * 60)
        return [folder_link]

    else:
        # Single file — upload and share the file directly
        meta = source_service.files().get(
            fileId=resource_id, fields="id,name,mimeType"
        ).execute()
        new_id = transfer_single_file(
            source_service,
            dest_service,
            meta["id"],
            meta["name"],
            meta.get("mimeType", ""),
            tmp_dir,
            keep_file,
            
        )
        make_public(dest_service, new_id)
        link = file_shareable_link(new_id)

        print("\n" + "=" * 60)
        print("Transfer complete. Public shareable link:")
        print("=" * 60)
        print(f"  {link}")
        print("=" * 60)
        return [link]


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=(
            "Download files from a Google Drive file or folder URL, "
            "re-upload to another (or the same) Google account, make them "
            "public, and print the shareable links."
        )
    )
    parser.add_argument(
        "drive_url",
        help="Google Drive file or folder URL",
    )
    parser.add_argument(
        "--source-credentials",
        default=DEFAULT_SOURCE_CREDENTIALS,
        help=f"Path to source account OAuth client JSON (default: {DEFAULT_SOURCE_CREDENTIALS})",
    )
    parser.add_argument(
        "--dest-credentials",
        default=DEFAULT_DEST_CREDENTIALS,
        help=f"Path to destination account OAuth client JSON (default: {DEFAULT_DEST_CREDENTIALS}). "
             "Use the same file as --source-credentials to upload to the same account.",
    )
    parser.add_argument(
        "--source-token",
        default=DEFAULT_SOURCE_TOKEN,
        help=f"Where to cache source auth token (default: {DEFAULT_SOURCE_TOKEN})",
    )
    parser.add_argument(
        "--dest-token",
        default=DEFAULT_DEST_TOKEN,
        help=f"Where to cache destination auth token (default: {DEFAULT_DEST_TOKEN})",
    )
    parser.add_argument(
        "--keep-file",
        action="store_true",
        help="Keep downloaded files on disk after upload",
    )
    parser.add_argument(
        "--tmp-dir",
        default=".",
        help="Directory to store temporary downloads (default: current directory)",
    )
    args = parser.parse_args()
    run(
        args.drive_url,
        source_credentials=args.source_credentials,
        dest_credentials=args.dest_credentials,
        source_token=args.source_token,
        dest_token=args.dest_token,
        keep_file=args.keep_file,
        tmp_dir=args.tmp_dir,
    )


if __name__ == "__main__":
   main()
