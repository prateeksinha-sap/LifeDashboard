"""
scripts/sync_gmail.py
─────────────────────────────────────────────────────────────────────
Fetches relevant emails via the Gmail API,
passes them through the configured AI extraction provider to extract action items,
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
from datetime import date, datetime, timedelta, timezone
from email import message_from_bytes
from pathlib import Path

# Allow running from backend/ directly
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database.db import SessionLocal, create_tables
from database.models import Actionable, Bill
from services.ai_service import extract_actionables_from_email, extract_email_tasks

# ── Google API constants ──────────────────────────────────────────────

SCOPES           = ["https://www.googleapis.com/auth/gmail.readonly"]
CREDENTIALS_FILE = Path(__file__).resolve().parents[1] / "credentials.json"
TOKEN_FILE       = Path(__file__).resolve().parents[1] / "token.json"
STATE_FILE       = Path(__file__).resolve().parents[1] / "gmail_sync_state.json"

# Gmail system label IDs to ignore. Do not skip Updates: banks, schools,
# utilities, and brokerages often land there.
SKIP_LABELS = {"CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"}

IMPORTANT_TERMS = [
    "bill", "due", "payment", "statement", "invoice", "fee", "fees",
    "receipt", "reminder", "registration", "school", "vibgyor", "bank",
    "credit card", "electricity", "power", "insurance", "renewal",
    "appointment", "deadline", "action required",
    "last date", "overdue", "penalty", "charges", "emi", "loan", "premium",
    "cams", "kfin", "cdsl", "nsdl", "zerodha", "groww", "kuvera", "epfo",
    "admission", "parent", "class", "homework", "exam", "ptm", "transport",
]


class GmailSyncSetupError(RuntimeError):
    """Raised when Gmail sync is not configured enough to run."""


# ── Gmail auth ────────────────────────────────────────────────────────

def _get_gmail_service():
    """
    Authenticate with Gmail using OAuth2.
    On first run, opens a browser window for consent.
    Token is cached in token.json for subsequent runs.
    """
    try:
        from google.auth.exceptions import RefreshError
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
    except ImportError as exc:
        raise GmailSyncSetupError(
            "Google API libraries are not installed. Install google-api-python-client, "
            "google-auth-oauthlib and google-auth-httplib2."
        ) from exc

    if not CREDENTIALS_FILE.exists():
        raise GmailSyncSetupError(
            f"credentials.json not found at {CREDENTIALS_FILE}. Upload Gmail OAuth credentials in the dashboard."
        )
        print(f"ERROR: credentials.json not found at {CREDENTIALS_FILE}")
        print("Download OAuth2 credentials from Google Cloud Console → APIs & Services → Credentials")
        sys.exit(1)

    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except RefreshError as exc:
                text = str(exc).lower()
                if "invalid_grant" not in text and "expired or revoked" not in text:
                    raise
                creds = None
        if not creds or not creds.valid:
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


def _load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _gmail_date(value: date | datetime) -> str:
    if isinstance(value, datetime):
        value = value.date()
    return value.strftime("%Y/%m/%d")


def _first_day_of_current_month() -> date:
    today = date.today()
    return date(today.year, today.month, 1)


def _first_day_of_previous_month() -> date:
    today = date.today()
    if today.month == 1:
        return date(today.year - 1, 12, 1)
    return date(today.year, today.month - 1, 1)


def _query_for_sync(mode: str, hours: int) -> tuple[str, str]:
    state = _load_state()
    last_success = state.get("last_successful_sync")
    has_backfill = bool(state.get("initial_backfill_done"))
    effective_mode = mode

    if mode == "auto":
        effective_mode = "delta" if has_backfill and last_success else "full_month"

    if effective_mode == "full_month":
        query = f"after:{_gmail_date(_first_day_of_previous_month())} -category:promotions -category:social -category:forums"
        return query, effective_mode

    if effective_mode == "delta":
        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(hours, 1))
        if last_success:
            try:
                parsed = datetime.fromisoformat(last_success.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                cutoff = min(cutoff, parsed - timedelta(hours=2))
            except ValueError:
                pass
        query = f"after:{_gmail_date(cutoff)} -category:promotions -category:social -category:forums"
        return query, effective_mode

    cutoff = datetime.now(timezone.utc) - timedelta(hours=max(hours, 1))
    query = f"after:{_gmail_date(cutoff)} -category:promotions -category:social -category:forums"
    return query, "recent"


def _looks_potentially_important(subject: str, sender: str, body: str) -> bool:
    text = f"{subject}\n{sender}\n{body[:2500]}".lower()
    return any(term in text for term in IMPORTANT_TERMS)


# ── Main sync loop ────────────────────────────────────────────────────

async def sync_gmail(hours: int = 24, dry_run: bool = False, mode: str = "auto", max_messages: int = 100) -> dict:
    """
    Fetch recent Gmail messages, extract actionables via LLM,
    and persist to the actionables table.
    """
    create_tables()

    print(f"\nConnecting to Gmail…")
    service = _get_gmail_service()

    # Initial sync backfills the current month; later syncs pull deltas.
    # Do not restrict to unread: important bills/school mails are often read first.
    query, effective_mode = _query_for_sync(mode, hours)

    print(f"Query: {query}")

    # List matching message IDs
    try:
        resp = service.users().messages().list(
            userId="me", q=query, maxResults=max(1, min(int(max_messages), 500))
        ).execute()
    except Exception as e:
        print(f"ERROR listing messages: {e}")
        return {"processed": 0, "candidates": 0, "skipped_unimportant": 0, "actionables_created": 0, "bills_created": 0, "errors": 1, "mode": effective_mode, "query": query}

    messages = resp.get("messages", [])
    print(f"Found {len(messages)} messages to process\n")

    if not messages:
        return {"processed": 0, "candidates": 0, "skipped_unimportant": 0, "actionables_created": 0, "bills_created": 0, "errors": 0, "mode": effective_mode, "query": query}

    processed = 0
    total_actionables = 0
    total_bills = 0
    candidates = 0
    skipped_unimportant = 0
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

                if not _looks_potentially_important(subject, sender, body):
                    skipped_unimportant += 1
                    continue

                candidates += 1

                print(f"  [{msg_id}] Processing: {subject[:70]}")
                print(f"             From: {sender[:60]}")

                # Extract actionables and bills via LLM. Bills feed Upcoming
                # Bills; actionables feed Smart Inbox, Reminders, and Top 3.
                extracted = await extract_email_tasks(f"Subject: {subject}\n\n{body}")
                actionables = [
                    {
                        "task_description": todo.text,
                        "due_date": None,
                        "priority": todo.priority.capitalize(),
                    }
                    for todo in extracted.todos
                ]
                bills = extracted.bills
                if not actionables and not bills:
                    actionables = await extract_actionables_from_email(subject, body)

                if not actionables and not bills:
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

                for bill in bills:
                    name = (bill.name or "").strip()
                    if not name or not bill.due_date:
                        continue

                    from datetime import date as date_cls
                    try:
                        due = date_cls.fromisoformat(str(bill.due_date))
                    except ValueError:
                        continue

                    amount = float(bill.amount or 0)
                    if not dry_run:
                        dup_bill = db.query(Bill).filter_by(
                            name=name[:200],
                            due_date=due,
                            amount=amount,
                        ).first()
                        if dup_bill:
                            continue
                        db.add(Bill(
                            name=name[:200],
                            amount=amount,
                            due_date=due,
                            is_paid=False,
                            is_recurring=False,
                            recurrence_days=None,
                        ))
                        total_bills += 1

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
        "candidates":          candidates,
        "skipped_unimportant": skipped_unimportant,
        "actionables_created": total_actionables,
        "bills_created":        total_bills,
        "errors":              errors,
        "mode":                effective_mode,
        "query":               query,
    }


# ── CLI entry point ───────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Sync Gmail → extract action items → store in Life Dashboard"
    )
    parser.add_argument("--hours",   type=int,  default=24,
                        help="How many hours back to scan for delta/recent mode")
    parser.add_argument("--mode", choices=["auto", "full_month", "delta", "recent"], default="auto")
    parser.add_argument("--max-messages", type=int, default=100)
    parser.add_argument("--dry-run", action="store_true",
                        help="Print extracted items without saving to DB")
    args = parser.parse_args()

    result = asyncio.run(sync_gmail(hours=args.hours, dry_run=args.dry_run, mode=args.mode, max_messages=args.max_messages))

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Sync complete.")
    print(f"  Emails processed  : {result['processed']}")
    print(f"  Candidate emails  : {result.get('candidates', 0)}")
    print(f"  Actionables saved : {result['actionables_created']}")
    print(f"  Bills saved       : {result.get('bills_created', 0)}")
    print(f"  Errors            : {result['errors']}")


if __name__ == "__main__":
    main()
