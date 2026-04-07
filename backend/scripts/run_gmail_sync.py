"""
run_gmail_sync.py — silent wrapper for Windows Task Scheduler
─────────────────────────────────────────────────────────────
Runs sync_gmail.py and logs output to backend/logs/gmail_sync.log.
Called by the scheduled task every 60 minutes.

Exits silently if credentials.json is missing (not yet configured).
"""

import sys
import os
import asyncio
import logging
from datetime import datetime
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────
BACKEND_DIR = Path(__file__).resolve().parents[1]
LOG_DIR     = BACKEND_DIR / "logs"
LOG_FILE    = LOG_DIR / "gmail_sync.log"
CREDS_FILE  = BACKEND_DIR / "credentials.json"

LOG_DIR.mkdir(exist_ok=True)

# ── Logging ────────────────────────────────────────────────────────────
logging.basicConfig(
    filename    = str(LOG_FILE),
    level       = logging.INFO,
    format      = "%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt     = "%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Guard: skip if OAuth not configured ────────────────────────────────
if not CREDS_FILE.exists():
    log.warning("credentials.json not found — skipping Gmail sync")
    sys.exit(0)

# ── Run sync ───────────────────────────────────────────────────────────
sys.path.insert(0, str(BACKEND_DIR))

try:
    from scripts.sync_gmail import sync_gmail
    log.info("Starting Gmail sync…")
    result = asyncio.run(sync_gmail(hours=2, dry_run=False))
    log.info(
        "Sync complete — emails=%s  actionables=%s  errors=%s",
        result.get("processed",           0),
        result.get("actionables_created", 0),
        result.get("errors",              0),
    )
except Exception as exc:
    log.error("Sync failed: %s", exc, exc_info=True)
    sys.exit(1)
