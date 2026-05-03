import json
import os
import sys
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File

from services.ai_service import AI_EXTRACTION_PROVIDER, ANTHROPIC_MODEL, OLLAMA_MODEL, OPENAI_MODEL, ollama_status

router = APIRouter(prefix="/api/gmail", tags=["gmail"])

BACKEND_DIR = Path(__file__).resolve().parents[1]
CREDENTIALS_FILE = BACKEND_DIR / "credentials.json"
TOKEN_FILE = BACKEND_DIR / "token.json"
STATE_FILE = BACKEND_DIR / "gmail_sync_state.json"
AUTOMATION_STATE_FILE = BACKEND_DIR / "automation_state.json"


def _google_deps_ready() -> bool:
    try:
        import google.oauth2.credentials  # noqa: F401
        import google_auth_oauthlib.flow  # noqa: F401
        import googleapiclient.discovery  # noqa: F401
        return True
    except Exception:
        return False


def _load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(payload: dict) -> None:
    STATE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _load_automation_state() -> dict:
    if not AUTOMATION_STATE_FILE.exists():
        return {}
    try:
        return json.loads(AUTOMATION_STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_automation_state(payload: dict) -> None:
    AUTOMATION_STATE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _update_automation_gmail_state(**updates) -> None:
    state = _load_automation_state()
    for key, value in updates.items():
        if value is None:
            state.pop(key, None)
        else:
            state[key] = value
    _save_automation_state(state)


def _token_was_revoked(error: str | None) -> bool:
    text = (error or "").lower()
    return "invalid_grant" in text or "expired or revoked" in text


def _email_ai_status(ollama: dict) -> dict:
    has_openai = bool(os.getenv("OPENAI_API_KEY"))
    has_anthropic = bool(os.getenv("ANTHROPIC_API_KEY"))
    provider = AI_EXTRACTION_PROVIDER
    if provider in {"openai", "premium"} and has_openai:
        return {"online": True, "provider": "openai", "model": OPENAI_MODEL}
    if provider in {"anthropic", "claude"} and has_anthropic:
        return {"online": True, "provider": "anthropic", "model": ANTHROPIC_MODEL}
    if provider in {"ollama", "local"}:
        return {"online": bool(ollama.get("online")), "provider": "ollama", "model": OLLAMA_MODEL}
    if has_openai:
        return {"online": True, "provider": "openai", "model": OPENAI_MODEL}
    if has_anthropic:
        return {"online": True, "provider": "anthropic", "model": ANTHROPIC_MODEL}
    return {"online": bool(ollama.get("online")), "provider": "ollama", "model": OLLAMA_MODEL}


@router.get("/status")
async def gmail_status():
    ai = await ollama_status()
    email_ai = _email_ai_status(ai)
    state = _load_state()
    configured = CREDENTIALS_FILE.exists()
    token_revoked = _token_was_revoked(state.get("last_error"))
    authorized = TOKEN_FILE.exists() and not token_revoked
    deps_ready = _google_deps_ready()

    if not configured:
        next_step = "Upload Gmail OAuth credentials once, then click Connect & Sync."
    elif token_revoked:
        next_step = "Reconnect Gmail. Google revoked the saved OAuth token, often after password or security changes."
    elif not authorized:
        next_step = "Click Connect & Sync. Google will ask you to approve read-only Gmail access once."
    elif not email_ai["online"]:
        next_step = "Configure OpenAI/Anthropic or start Ollama for email extraction."
    elif not state.get("initial_backfill_done"):
        next_step = "Ready for initial sync of current and previous month."
    else:
        next_step = "Ready for delta sync."

    return {
        "configured": configured,
        "authorized": authorized,
        "reconnect_required": token_revoked,
        "deps_ready": deps_ready,
        "ai_online": bool(email_ai["online"]),
        "ai_provider": email_ai["provider"],
        "ai_model": email_ai["model"],
        "local_ollama_online": bool(ai.get("online")),
        "last_sync": state.get("last_sync"),
        "last_successful_sync": state.get("last_successful_sync"),
        "initial_backfill_done": bool(state.get("initial_backfill_done")),
        "last_mode": state.get("last_mode"),
        "last_query": state.get("last_query"),
        "last_result": state.get("last_result"),
        "last_error": state.get("last_error"),
        "next_step": next_step,
    }


@router.post("/credentials")
async def upload_gmail_credentials(file: UploadFile = File(...)):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The credentials file is empty.")

    try:
        parsed = json.loads(content.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Upload the OAuth client JSON downloaded from Google Cloud.")

    if not isinstance(parsed, dict) or not ("installed" in parsed or "web" in parsed):
        raise HTTPException(status_code=400, detail="This does not look like a Google OAuth client JSON file.")

    CREDENTIALS_FILE.write_text(json.dumps(parsed, indent=2), encoding="utf-8")
    return {"status": "ok", "configured": True, "authorized": TOKEN_FILE.exists()}


@router.post("/sync")
async def run_gmail_sync(hours: int = 72, mode: str = "auto", max_messages: int = 300):
    if not _google_deps_ready():
        raise HTTPException(
            status_code=500,
            detail="Google API libraries are missing. Install the backend requirements and restart the app.",
        )
    if not CREDENTIALS_FILE.exists():
        raise HTTPException(
            status_code=400,
            detail="Gmail OAuth credentials are missing. Upload credentials in the Gmail sync panel first.",
        )

    scripts_dir = str(BACKEND_DIR / "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)

    try:
        from sync_gmail import GmailSyncSetupError, sync_gmail
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Gmail sync module unavailable: {exc}") from exc

    try:
        safe_mode = mode if mode in {"auto", "full_month", "delta", "recent"} else "auto"
        result = await sync_gmail(
            hours=max(1, min(int(hours), 720)),
            mode=safe_mode,
            max_messages=max(1, min(int(max_messages), 500)),
            dry_run=False,
        )
    except GmailSyncSetupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        now = datetime.utcnow().isoformat()
        _save_state({"last_sync": now, "last_error": str(exc)})
        _update_automation_gmail_state(last_gmail_attempt=now, last_gmail_error=str(exc))
        raise HTTPException(status_code=500, detail=f"Gmail sync failed: {exc}") from exc

    now = datetime.utcnow().isoformat()
    previous = _load_state()
    state = {
        **previous,
        "last_sync": now,
        "last_successful_sync": now,
        "initial_backfill_done": previous.get("initial_backfill_done") or result.get("mode") == "full_month",
        "last_mode": result.get("mode"),
        "last_query": result.get("query"),
        "last_result": result,
        "last_error": None,
    }
    _save_state(state)
    _update_automation_gmail_state(
        last_gmail_sync=now,
        last_gmail_result={"status": "ok", **result},
        last_gmail_error=None,
    )
    return {"status": "ok", **result}
