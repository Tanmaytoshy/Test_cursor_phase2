#!/usr/bin/env python3
"""
Fetch all cards from a given Trello board.

Authentication:
  - TRELLO_API_KEY  : your Trello developer API key
  - TRELLO_TOKEN    : your Trello user token

Both can be passed as environment variables or via CLI flags.

Usage:
  python trello_cards.py --board-id <BOARD_ID>
  python trello_cards.py --board-id <BOARD_ID> --api-key KEY --token TOKEN
  python trello_cards.py --board-id <BOARD_ID> --output cards.json

How to get your API key and token:
  1. Go to https://trello.com/power-ups/admin and create a Power-Up to get an API key.
  2. Generate a token at:
     https://trello.com/1/authorize?expiration=never&scope=read&response_type=token&key=<YOUR_API_KEY>

How to find your Board ID:
  Open your board in Trello and append '.json' to the URL, e.g.:
  https://trello.com/b/<BOARD_SHORT_LINK>.json  — the 'id' field at the top is the board ID.
  Alternatively, pass --list-boards to list all your boards with their IDs.
"""

import os
import sys
import json
import argparse

import requests


TRELLO_BASE_URL = "https://api.trello.com/1"


def build_params(api_key: str, token: str, **extra) -> dict:
    return {"key": api_key, "token": token, **extra}


def list_boards(api_key: str, token: str) -> list[dict]:
    """Return all boards the authenticated user has access to."""
    url = f"{TRELLO_BASE_URL}/members/me/boards"
    params = build_params(api_key, token, fields="id,name,url,closed")
    resp = requests.get(url, params=params, timeout=15)
    resp.raise_for_status()
    return resp.json()


def get_board_info(board_id: str, api_key: str, token: str) -> dict:
    """Return basic info about a board."""
    url = f"{TRELLO_BASE_URL}/boards/{board_id}"
    params = build_params(api_key, token, fields="id,name,url,desc")
    resp = requests.get(url, params=params, timeout=15)
    resp.raise_for_status()
    return resp.json()


def get_lists(board_id: str, api_key: str, token: str) -> list[dict]:
    """Return all lists on the board (maps list ID -> name)."""
    url = f"{TRELLO_BASE_URL}/boards/{board_id}/lists"
    params = build_params(api_key, token, fields="id,name,closed")
    resp = requests.get(url, params=params, timeout=15)
    resp.raise_for_status()
    return resp.json()


def get_cards(board_id: str, api_key: str, token: str, include_closed: bool = False) -> list[dict]:
    """
    Return all cards on the board.

    By default only open cards are returned. Pass include_closed=True to
    include archived cards as well.
    """
    url = f"{TRELLO_BASE_URL}/boards/{board_id}/cards"
    filter_val = "all" if include_closed else "open"
    params = build_params(
        api_key,
        token,
        filter=filter_val,
        fields="id,name,desc,idList,labels,due,dueComplete,url,closed,shortUrl",
        attachments="false",
        checklists="none",
    )
    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def enrich_cards(cards: list[dict], list_map: dict[str, str]) -> list[dict]:
    """Attach a human-readable 'listName' field to each card."""
    for card in cards:
        card["listName"] = list_map.get(card.get("idList", ""), "Unknown")
    return cards


def print_cards(cards: list[dict], board_name: str) -> None:
    total = len(cards)
    print(f"\nBoard : {board_name}")
    print(f"Total cards fetched: {total}\n")
    print(f"{'#':<5} {'List':<30} {'Card Name':<50} {'Due':<12} {'URL'}")
    print("-" * 130)
    for i, card in enumerate(cards, start=1):
        due = (card.get("due") or "")[:10]  # ISO date -> YYYY-MM-DD
        list_name = card.get("listName", "")[:29]
        name = card.get("name", "")[:49]
        url = card.get("shortUrl", card.get("url", ""))
        print(f"{i:<5} {list_name:<30} {name:<50} {due:<12} {url}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch all cards from a Trello board.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--board-id",
        help="The Trello board ID (24-char hex string).",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("TRELLO_API_KEY", ""),
        help="Trello API key (default: $TRELLO_API_KEY env var).",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("TRELLO_TOKEN", ""),
        help="Trello user token (default: $TRELLO_TOKEN env var).",
    )
    parser.add_argument(
        "--include-closed",
        action="store_true",
        help="Also fetch archived/closed cards.",
    )
    parser.add_argument(
        "--output",
        metavar="FILE",
        help="Save results as JSON to this file.",
    )
    parser.add_argument(
        "--list-boards",
        action="store_true",
        help="List all accessible boards (with IDs) and exit.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if not args.api_key or not args.token:
        print(
            "ERROR: Trello API key and token are required.\n"
            "Set the TRELLO_API_KEY and TRELLO_TOKEN environment variables,\n"
            "or pass --api-key and --token on the command line.",
            file=sys.stderr,
        )
        sys.exit(1)

    # --list-boards: show all boards and exit
    if args.list_boards:
        boards = list_boards(args.api_key, args.token)
        print(f"\n{'ID':<28} {'Name'}")
        print("-" * 70)
        for b in boards:
            status = " [archived]" if b.get("closed") else ""
            print(f"{b['id']:<28} {b['name']}{status}")
        return

    if not args.board_id:
        print("ERROR: --board-id is required (or use --list-boards to find it).", file=sys.stderr)
        sys.exit(1)

    # Fetch board metadata, lists, and cards
    print(f"Fetching data for board: {args.board_id} …")

    board = get_board_info(args.board_id, args.api_key, args.token)
    lists = get_lists(args.board_id, args.api_key, args.token)
    list_map = {lst["id"]: lst["name"] for lst in lists}

    cards = get_cards(args.board_id, args.api_key, args.token, include_closed=args.include_closed)
    cards = enrich_cards(cards, list_map)

    print_cards(cards, board["name"])

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            json.dump({"board": board, "lists": lists, "cards": cards}, fh, indent=2)
        print(f"\nResults saved to: {args.output}")


if __name__ == "__main__":
    main()
