#!/usr/bin/env python3
"""
Flask backend for the Trello Board Viewer UI.

Run:
    pip install flask requests
    python app.py
"""
from __future__ import annotations

import os
import re
import sys
import uuid
import threading
import traceback
import time

from flask import Flask, jsonify, request, render_template
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import drive_transfer

app = Flask(__name__)

TRELLO_BASE = "https://api.trello.com/1"

DRIVE_URL_RE = re.compile(
    r'https?://drive\.google\.com/(?:file/d/|drive/folders/|open\?id=)[^\s<>"\')]+',
)

# In-memory job store: job_id → job dict
# Each job: { status, card_id, card_name, started_at, public_links?, error? }
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


# ── Helpers ───────────────────────────────────────────────────

def trello_get(path: str, api_key: str, token: str, **params):
    resp = requests.get(
        f"{TRELLO_BASE}{path}",
        params={"key": api_key, "token": token, **params},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()


def _find_drive_url(description: str, attachments: list[dict]) -> str | None:
    match = DRIVE_URL_RE.search(description or "")
    if match:
        return match.group(0)
    for att in attachments:
        url = att.get("url", "")
        if DRIVE_URL_RE.search(url):
            return url
    return None


# ── Background pipeline worker ─────────────────────────────────

def _pipeline_worker(
    job_id: str,
    card_id: str,
    api_key: str,
    token: str,
    card_name: str,
    board_name: str = "",
):
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def fail(msg: str):
        with _jobs_lock:
            _jobs[job_id]["status"] = "error"
            _jobs[job_id]["error"]  = msg

    # 1. Fetch card
    try:
        card = trello_get(f"/cards/{card_id}", api_key, token, fields="id,name,desc,url")
        attachments = trello_get(f"/cards/{card_id}/attachments", api_key, token)
    except Exception as e:
        fail(f"Could not fetch card details: {e}")
        return

    # 2. Find Drive link
    drive_url = _find_drive_url(card.get("desc", ""), attachments)
    if not drive_url:
        fail("No Google Drive link found in this card's description or attachments.")
        return

    app.logger.info("Pipeline worker — job=%s card=%s drive=%s", job_id, card_name, drive_url)

    # 3. Run drive_transfer
    try:
        links = drive_transfer.run(
            drive_url,
            source_credentials=os.path.join(project_root, drive_transfer.DEFAULT_SOURCE_CREDENTIALS),
            dest_credentials=os.path.join(project_root, drive_transfer.DEFAULT_DEST_CREDENTIALS),
            source_token=os.path.join(project_root, drive_transfer.DEFAULT_SOURCE_TOKEN),
            dest_token=os.path.join(project_root, drive_transfer.DEFAULT_DEST_TOKEN),
            tmp_dir=os.path.join(project_root, "tmp_pipeline"),
            destination_root_folder=board_name.strip() or None,
        )
    except Exception as e:
        app.logger.error("Drive transfer failed: %s\n%s", e, traceback.format_exc())
        fail(f"Drive transfer failed: {e}")
        return

    if not links:
        fail("Transfer completed but produced no public links.")
        return

    app.logger.info("Pipeline worker done — job=%s links=%s", job_id, links)
    with _jobs_lock:
        _jobs[job_id]["status"]       = "complete"
        _jobs[job_id]["public_links"] = links
        _jobs[job_id]["finished_at"]  = time.time()


# ── Routes ────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/boards")
def boards():
    api_key = request.headers.get("X-Trello-Key", "")
    token   = request.headers.get("X-Trello-Token", "")
    if not api_key or not token:
        return jsonify({"error": "Missing credentials"}), 401
    data = trello_get(
        "/members/me/boards", api_key, token,
        fields="id,name,desc,url,prefs,closed", filter="open",
    )
    return jsonify(data)


@app.route("/api/boards/<board_id>/lists")
def board_lists(board_id):
    api_key = request.headers.get("X-Trello-Key", "")
    token   = request.headers.get("X-Trello-Token", "")
    if not api_key or not token:
        return jsonify({"error": "Missing credentials"}), 401
    data = trello_get(
        f"/boards/{board_id}/lists", api_key, token,
        fields="id,name,closed", filter="open",
    )
    return jsonify(data)


@app.route("/api/boards/<board_id>/cards")
def board_cards(board_id):
    api_key = request.headers.get("X-Trello-Key", "")
    token   = request.headers.get("X-Trello-Token", "")
    if not api_key or not token:
        return jsonify({"error": "Missing credentials"}), 401

    include_closed = request.args.get("include_closed", "false") == "true"
    filter_val     = "all" if include_closed else "open"

    cards = trello_get(
        f"/boards/{board_id}/cards", api_key, token,
        filter=filter_val,
        fields="id,name,desc,idList,labels,due,dueComplete,url,shortUrl,closed,idMembers,idChecklists",
        attachments="false", checklists="none",
        members="true", member_fields="fullName,avatarHash,initials",
    )
    lists = trello_get(
        f"/boards/{board_id}/lists", api_key, token,
        fields="id,name", filter="open",
    )
    list_map = {lst["id"]: lst["name"] for lst in lists}
    for card in cards:
        card["listName"] = list_map.get(card.get("idList", ""), "Unknown")

    return jsonify({"cards": cards, "lists": lists})


@app.route("/api/cards/<card_id>", methods=["PATCH"])
def update_card(card_id):
    api_key = request.headers.get("X-Trello-Key", "")
    token   = request.headers.get("X-Trello-Token", "")
    if not api_key or not token:
        return jsonify({"error": "Missing credentials"}), 401
    body   = request.get_json(silent=True) or {}
    params = {"key": api_key, "token": token, **body}
    resp   = requests.put(f"{TRELLO_BASE}/cards/{card_id}", params=params, timeout=15)
    if not resp.ok:
        return jsonify({"error": f"Trello API error: {resp.status_code} {resp.text}"}), resp.status_code
    return jsonify(resp.json())


@app.route("/api/cards", methods=["POST"])
def create_card():
    api_key = request.headers.get("X-Trello-Key", "")
    token   = request.headers.get("X-Trello-Token", "")
    if not api_key or not token:
        return jsonify({"error": "Missing credentials"}), 401
    body    = request.get_json(silent=True) or {}
    id_list = body.get("idList", "")
    if not id_list:
        return jsonify({"error": "idList is required"}), 400

    params = {
        "key": api_key, "token": token,
        "idList": id_list,
        "name":   body.get("name", "Untitled"),
        "desc":   body.get("desc", ""),
    }
    if body.get("due"):
        params["due"] = body["due"]
    if body.get("dueComplete") is not None:
        params["dueComplete"] = str(body["dueComplete"]).lower()

    resp = requests.post(f"{TRELLO_BASE}/cards", params=params, timeout=15)
    if not resp.ok:
        return jsonify({"error": f"Trello API error: {resp.status_code} {resp.text}"}), resp.status_code
    return jsonify(resp.json())


@app.route("/api/pipeline/<card_id>", methods=["POST"])
def start_pipeline(card_id):
    """Start the pipeline in a background thread and return a job_id immediately."""
    api_key   = request.headers.get("X-Trello-Key", "")
    token     = request.headers.get("X-Trello-Token", "")
    if not api_key or not token:
        return jsonify({"error": "Missing credentials"}), 401

    body      = request.get_json(silent=True) or {}
    card_name = body.get("card_name", "")
    board_id  = body.get("board_id", "")
    board_name = ""
    if board_id:
        try:
            board = trello_get(f"/boards/{board_id}", api_key, token, fields="id,name")
            board_name = board.get("name", "") or ""
        except Exception:
            app.logger.warning("Could not resolve board name for board_id=%s", board_id)

    job_id    = str(uuid.uuid4())

    with _jobs_lock:
        _jobs[job_id] = {
            "status":     "running",
            "card_id":    card_id,
            "card_name":  card_name,
            "board_name": board_name,
            "started_at": time.time(),
        }

    t = threading.Thread(
        target=_pipeline_worker,
        args=(job_id, card_id, api_key, token, card_name, board_name),
        daemon=True,
    )
    t.start()

    return jsonify({"job_id": job_id, "status": "running"})


@app.route("/api/jobs/<job_id>")
def get_job(job_id):
    """Poll a pipeline job for its current status."""
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


if __name__ == "__main__":
    # threaded=True so polling requests don't block the pipeline worker
    app.run(debug=True, port=5050, threaded=True)
