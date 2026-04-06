"""
scripts/sync_gmail.py
─────────────────────────────────────────────────────────────────────
Fetches unread emails from the last 24 hours via the Gmail API,
passes them through the local Ollama LLM to extract action items,
and stores the results in the `actionables` table.

Prerequisites:
  1. pip install google-api-python-client google-auth-oauthlib google-auth-httplib2
  2. Create a project in Google Cloud Console:
       https://console.cloud.google.com/
     Enable the Gmail API, create OAuth2 credentials (Desktop App),
     and download the file as  backend/credentials.json
  3. Run this script once:  python scripts/sync_gmail.py
     A browser window will open for one-time Google sign-in.
     The token is saved to  backend/token.json  for future runs.

Usage:
    cd backend
    python scripts/sync_gmail.py                    # last 24 hours
    python scripts/sync_gmail.py --hours 48         # last 48 hours
    python scripts/sync_gmail.py --dry-run          # print without saving
─────────────────────────────────────────────────────────────────────
"""

import argparse
import asyncio
import base64
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from email import message_from_bytes
from pathlib import Path

# Allow running from backend/ directly
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database.db import SessionLocal, create_tables
from database.models import Actionable
from services.ai_service import extract_actionables_from_email

# ── Google API constants ──────────────────────────────────────────────

SCOPES           = ["https://www.googleapis.com/auth/gmail.readonly"]
CREDENTIALS_FILE = Path(__file__).resolve().parents[1] / "credentials.json"
TOKEN_FILE       = Path(__file__).resolve().parents[1] / "token.json"

# Gmail system label IDs to ignore (promos, social, forums, updates)
SKIP_LABELS = {"CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS", "CATEGORY_UPDATES"}


# ── Gmail auth ────────────────────────────────────────────────────────

def _get_gmail_service():
    """
    Authenticate with Gmail using OAuth2.
    On first run, opens a browser window for consent.
    Token is cached in token.json for subsequent runs.
    """
    try:
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
    except ImportError:
        print("ERROR: Google API libraries not installed.")
        print("Run: pip install google-api-python-client google-auth-oauthlib google-auth-httplib2")
        sys.exit(1)

    if not CREDENTIALS_FILE.exists():
        print(f"ERROR: credentials.json not found at {CREDENTIALS_FILE}")
        print("Download OAuth2 credentials from Google Cloud Console → APIs & Services → Credentials")
        sys.exit(1)

    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json())

    return build("gmail", "v1", credentials=creds)


# ── Email parsing ─────────────────────────────────────────────────────

def _decode_body(part) -> str:
    """Decode a Gmail message part's body to a plain string."""
    data = part.get("body", {}).get("data", "")
    if not data:
        return ""
    try:
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    except Exception:
        return ""


def _extract_plain_text(msg_payload: dict) -> str:
    """
    Recursively extract plain-text body from a Gmail message payload.
    Prefers text/plain parts; falls back to stripping HTML.
    """
    mime_type = msg_payload.get("mimeType", "")

    if mime_type == "text/plain":
        return _decode_body(msg_payload)

    if mime_type == "text/html":
        raw_html = _decode_body(msg_payload)
        # Basic HTML stripping — avoid pulling in BeautifulSoup just for this
        import re
        clean = re.sub(r"<[^>]+>", " ", raw_html)
        return re.sub(r"\s{2,}", "\n", clean).strip()

    # Multipart — recurse through parts
    parts    = msg_payload.get("parts", [])
    plain_txt = ""
    for part in parts:
        text = _extract_plain_text(part)
        if text:
            plain_txt += text + "\n"
            if msg_payload.get("mimeType", "").startswith("multipart/alternative"):
                break   # stop at first usable part in alternative blocks
    return plain_txt.strip()


def _get_header(headers: list[dict], name: str) -> str:
    """Find a header value by name (case-insensitive)."""
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


# ── Main sync loop ────────────────────────────────────────────────────

async def sync_gmail(hours: int = 24, dry_run: bool = False) -> dict:
    """
    Fetch recent Gmail messages, extract actionables via LLM,
    and persist to the actionables table.
    """
    create_tables()

    print(f"\nConnecting to Gmail…")
    service = _get_gmail_service()

    # Build query: unread, last N hours, skip system labels
    cutoff   = datetime.now(timezone.utc) - timedelta(hours=hours)
    after_ts = int(cutoff.timestamp())
    query    = f"is:unread after:{after_ts} -label:promotions -label:social"

    print(f"Query: {query}")

    # List matching message IDs
    try:
        resp = service.users().messages().list(
            userId="me", q=query, maxResults=50
        ).execute()
    except Exception as e:
        print(f"ERROR listing messages: {e}")
        return {"processed": 0, "actionables_created": 0, "errors": 1}

    messages = resp.get("messages", [])
    print(f"Found {len(messages)} messages to process\n")

    if not messages:
        return {"processed": 0, "actionables_created": 0, "errors": 0}

    processed = 0
    total_actionables = 0
    errors = 0

    db = SessionLocal()
    try:
        for msg_meta in messages:
            msg_id = msg_meta["id"]

            try:
                # Fetch full message
                msg = service.users().messages().get(
                    userId="me", id=msg_id, format="full"
                ).execute()

                # Skip if in ignored label categories
                label_ids = set(msg.get("labelIds", []))
                if label_ids & SKIP_LABELS:
                    print(f"  [{msg_id}] Skipped (promotional/social label)")
                    continue

                headers = msg["payload"].get("headers", [])
                subject = _get_header(headers, "Subject") or "(No subject)"
                sender  = _get_header(headers, "From")    or "Unknown sender"
                body    = _extract_plain_text(msg["payload"])

                if not body.strip():
                    print(f"  [{msg_id}] Skipped (empty body): {subject[:60]}")
                    continue

                print(f"  [{msg_id}] Processing: {subject[:70]}")
                print(f"             From: {sender[:60]}")

                # Extract actionables via LLM
                actionables = await extract_actionables_from_email(subject, body)

                if not actionables:
                    print(f"             → 0 actionables extracted")
                    processed += 1
                    continue

                print(f"             → {len(actionables)} actionable(s) found")

                for item in actionables:
                    task_desc = item.get("task_description", "").strip()
                    if not task_desc:
                        continue

                    # Check for duplicate (same email ID + description)
                    if not dry_run:
                        dup = db.query(Actionable).filter_by(
                            original_email_id = msg_id,
                            task_description  = task_desc,
                        ).first()
                        if dup:
                            print(f"               • (dup) {task_desc[:60]}")
                            continue

                    # Parse due_date
                    from datetime import date as date_cls
                    due = None
                    if item.get("due_date"):
                        try:
                            due = date_cls.fromisoformat(str(item["due_date"]))
                        except ValueError:
                            pass

                    priority = item.get("priority", "Medium")
                    if priority not in ("High", "Medium", "Low"):
                        priority = "Medium"

                    print(f"               • [{priority}] {task_desc[:60]}")
                    if item.get("due_date"):
                        print(f"                 Due: {item['due_date']}")

                    if not dry_run:
                        db.add(Actionable(
                            source            = "Gmail",
                            task_description  = task_desc,
                            due_date          = due,
                            priority          = priority,
                            status            = "Pending",
                            original_email_id = msg_id,
                            sender            = sender[:200],
                            subject           = subject[:500],
                        ))
                        total_actionables += 1

                if not dry_run:
                    db.commit()

                processed += 1

            except Exception as e:
                errors += 1
                print(f"  [{msg_id}] ERROR: {e}")
                continue

    finally:
        db.close()

    return {
        "processed":           processed,
        "actionables_created": total_actionables,
        "errors":              errors,
    }


# ── CLI entry point ───────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Sync Gmail → extract action items → store in Life Dashboard"
    )
    parser.add_argument("--hours",   type=int,  default=24,
                        help="How many hours back to scan (default: 24)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print extracted items without saving to DB")
    args = parser.parse_args()

    result = asyncio.run(sync_gmail(hours=args.hours, dry_run=args.dry_run))

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Sync complete.")
    print(f"  Emails processed  : {result['processed']}")
    print(f"  Actionables saved : {result['actionables_created']}")
    print(f"  Errors            : {result['errors']}")


if __name__ == "__main__":
    main()
