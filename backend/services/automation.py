from __future__ import annotations

import asyncio
import json
import os
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func

from database.db import SessionLocal
from database.models import MFHolding, StockHolding, Transaction
from services.mf_nav import refresh_nav_for_holding, search_scheme_code
from services.stock_price import get_multiple_prices
from services.equity_sync import sync_equity_lookthrough


BACKEND_DIR = Path(__file__).resolve().parents[1]
STATE_FILE = BACKEND_DIR / "automation_state.json"
GMAIL_CREDENTIALS_FILE = BACKEND_DIR / "credentials.json"
GMAIL_TOKEN_FILE = BACKEND_DIR / "token.json"


def _utc_now() -> datetime:
    return datetime.utcnow()


def _read_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_state(state: dict[str, Any]) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _due(last_run: str | None, every: timedelta) -> bool:
    parsed = _parse_dt(last_run)
    if not parsed:
        return True
    return _utc_now() - parsed >= every


def _automation_enabled() -> bool:
    return os.getenv("AUTO_SYNC_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}


def _gmail_ready() -> bool:
    return GMAIL_CREDENTIALS_FILE.exists() and GMAIL_TOKEN_FILE.exists()


def _token_was_revoked(error: str | None) -> bool:
    text = (error or "").lower()
    return "invalid_grant" in text or "expired or revoked" in text


async def _run_gmail_delta(state: dict[str, Any], force: bool = False) -> dict[str, Any]:
    interval_minutes = max(int(os.getenv("GMAIL_AUTO_SYNC_MINUTES", "240")), 15)
    if not force and not _due(state.get("last_gmail_sync"), timedelta(minutes=interval_minutes)):
        return {"status": "skipped", "reason": "not_due"}
    if _token_was_revoked(state.get("last_gmail_error")):
        return {"status": "skipped", "reason": "gmail_reconnect_required"}
    if not _gmail_ready():
        return {"status": "skipped", "reason": "gmail_not_authorized"}

    try:
        from routers.gmail import run_gmail_sync

        result = await run_gmail_sync(hours=24, mode="auto", max_messages=300 if force else 160)
        state["last_gmail_sync"] = _utc_now().isoformat()
        state["last_gmail_result"] = result
        state.pop("last_gmail_error", None)
        return {"status": "ok", "result": result}
    except Exception as exc:
        state["last_gmail_error"] = str(exc)
        state["last_gmail_attempt"] = _utc_now().isoformat()
        return {"status": "error", "error": str(exc)}


async def _refresh_investments(state: dict[str, Any], force: bool = False) -> dict[str, Any]:
    interval_hours = max(int(os.getenv("INVESTMENT_REFRESH_HOURS", "24")), 1)
    if not force and not _due(state.get("last_investment_refresh"), timedelta(hours=interval_hours)):
        return {"status": "skipped", "reason": "not_due"}

    db = SessionLocal()
    try:
        stock_holdings = db.query(StockHolding).all()
        mf_holdings = db.query(MFHolding).all()
        stocks_updated = 0
        nav_updated = 0

        if stock_holdings:
            prices = get_multiple_prices([h.symbol for h in stock_holdings])
            for holding in stock_holdings:
                price = float(prices.get(holding.symbol) or 0)
                if price > 0:
                    holding.current_price = price
                    holding.updated_at = _utc_now()
                    stocks_updated += 1

        for holding in mf_holdings:
            if not holding.scheme_code:
                code = await search_scheme_code(holding.scheme_name)
                if code:
                    holding.scheme_code = code
            if holding.scheme_code:
                result = await refresh_nav_for_holding(holding.scheme_code, holding.units)
                if result:
                    holding.nav = result["nav"]
                    holding.value = result["value"]
                    holding.nav_date = _utc_now().date()
                    holding.updated_at = _utc_now()
                    nav_updated += 1

        db.commit()
        result = {
            "stocks_updated": stocks_updated,
            "stocks_total": len(stock_holdings),
            "mutual_funds_updated": nav_updated,
            "mutual_funds_total": len(mf_holdings),
        }
        state["last_investment_refresh"] = _utc_now().isoformat()
        state["last_investment_result"] = result
        state.pop("last_investment_error", None)
        return {"status": "ok", "result": result}
    except Exception as exc:
        db.rollback()
        state["last_investment_error"] = str(exc)
        state["last_investment_attempt"] = _utc_now().isoformat()
        return {"status": "error", "error": str(exc)}
    finally:
        db.close()


async def _refresh_equity_lookthrough(state: dict[str, Any], force: bool = False) -> dict[str, Any]:
    if os.getenv("EQUITY_LOOKTHROUGH_SYNC_ENABLED", "true").strip().lower() not in {"1", "true", "yes", "on"}:
        return {"status": "skipped", "reason": "disabled"}

    interval_hours = max(int(os.getenv("EQUITY_LOOKTHROUGH_REFRESH_HOURS", "24")), 6)
    if not force and not _due(state.get("last_equity_lookthrough_refresh"), timedelta(hours=interval_hours)):
        return {"status": "skipped", "reason": "not_due"}

    db = SessionLocal()
    try:
        result = await sync_equity_lookthrough(db)
        state["last_equity_lookthrough_refresh"] = _utc_now().isoformat()
        state["last_equity_lookthrough_result"] = result
        state.pop("last_equity_lookthrough_error", None)
        return {"status": "ok", "result": result}
    except Exception as exc:
        db.rollback()
        state["last_equity_lookthrough_error"] = str(exc)
        state["last_equity_lookthrough_attempt"] = _utc_now().isoformat()
        return {"status": "error", "error": str(exc)}
    finally:
        db.close()


async def _run_ingestion_scan(state: dict[str, Any], force: bool = False) -> dict[str, Any]:
    if os.getenv("INGESTION_AUTO_SYNC_ENABLED", "true").strip().lower() not in {"1", "true", "yes", "on"}:
        return {"status": "skipped", "reason": "disabled"}

    interval_minutes = max(int(os.getenv("INGESTION_AUTO_SYNC_MINUTES", "240")), 30)
    if not force and not _due(state.get("last_ingestion_scan"), timedelta(minutes=interval_minutes)):
        return {"status": "skipped", "reason": "not_due"}

    auto_import = os.getenv("INGESTION_AUTO_IMPORT", "true").strip().lower() in {"1", "true", "yes", "on"}
    gmail_days = max(int(os.getenv("INGESTION_GMAIL_LOOKBACK_DAYS", "45")), 1)
    max_messages = max(int(os.getenv("INGESTION_GMAIL_MAX_MESSAGES", "80")), 1)

    db = SessionLocal()
    try:
        from services.ingestion_automation import run_ingestion_automation

        result = await run_ingestion_automation(
            db,
            source="all",
            auto_import=auto_import,
            gmail_days=gmail_days,
            max_messages=max_messages,
        )
        state["last_ingestion_scan"] = _utc_now().isoformat()
        state["last_ingestion_result"] = result
        state.pop("last_ingestion_error", None)
        return {"status": "ok", "result": result}
    except Exception as exc:
        db.rollback()
        state["last_ingestion_error"] = str(exc)
        state["last_ingestion_attempt"] = _utc_now().isoformat()
        return {"status": "error", "error": str(exc)}
    finally:
        db.close()


def _current_month_has_cashflow() -> bool:
    db = SessionLocal()
    try:
        current_month = date.today().strftime("%Y-%m")
        return (
            db.query(Transaction)
            .filter(func.strftime("%Y-%m", Transaction.date) == current_month)
            .count()
            > 0
        )
    finally:
        db.close()


def _safe_month_end_snapshot(state: dict[str, Any], force: bool = False) -> dict[str, Any]:
    if os.getenv("AUTO_CAPTURE_MONTH_END_SNAPSHOT", "true").strip().lower() not in {"1", "true", "yes", "on"}:
        return {"status": "skipped", "reason": "disabled"}

    today = date.today()
    tomorrow = today + timedelta(days=1)
    is_month_end_window = tomorrow.month != today.month or today.day >= 28
    month_year = today.strftime("%Y-%m")
    if not force and not is_month_end_window:
        return {"status": "skipped", "reason": "not_month_end_window"}
    if not force and state.get("last_snapshot_month") == month_year:
        return {"status": "skipped", "reason": "already_captured"}
    if not _current_month_has_cashflow():
        return {"status": "skipped", "reason": "no_current_month_cashflow"}

    db = SessionLocal()
    try:
        from routers.wealth import take_wealth_snapshot

        result = take_wealth_snapshot(db)
        state["last_snapshot_month"] = month_year
        state["last_snapshot_at"] = _utc_now().isoformat()
        state["last_snapshot_result"] = result
        return {"status": "ok", "result": result}
    except Exception as exc:
        db.rollback()
        state["last_snapshot_error"] = str(exc)
        state["last_snapshot_attempt"] = _utc_now().isoformat()
        return {"status": "error", "error": str(exc)}
    finally:
        db.close()


async def run_automation_once(force: bool = False) -> dict[str, Any]:
    state = _read_state()
    run_started = _utc_now().isoformat()
    results = {
        "gmail": await _run_gmail_delta(state, force=force),
        "ingestion": await _run_ingestion_scan(state, force=force),
        "investments": await _refresh_investments(state, force=force),
        "equity_lookthrough": await _refresh_equity_lookthrough(state, force=force),
        "snapshot": _safe_month_end_snapshot(state, force=force),
    }
    state["last_run"] = run_started
    state["last_results"] = results
    _write_state(state)
    return {"status": "ok", "enabled": _automation_enabled(), "run_started": run_started, "results": results}


def automation_status() -> dict[str, Any]:
    state = _read_state()
    gmail_interval = max(int(os.getenv("GMAIL_AUTO_SYNC_MINUTES", "240")), 15)
    ingestion_interval = max(int(os.getenv("INGESTION_AUTO_SYNC_MINUTES", "240")), 30)
    investment_interval = max(int(os.getenv("INVESTMENT_REFRESH_HOURS", "24")), 1)
    equity_interval = max(int(os.getenv("EQUITY_LOOKTHROUGH_REFRESH_HOURS", "24")), 6)
    return {
        "enabled": _automation_enabled(),
        "gmail": {
            "configured": GMAIL_CREDENTIALS_FILE.exists(),
            "authorized": GMAIL_TOKEN_FILE.exists() and not _token_was_revoked(state.get("last_gmail_error")),
            "reconnect_required": _token_was_revoked(state.get("last_gmail_error")),
            "interval_minutes": gmail_interval,
            "last_sync": state.get("last_gmail_sync"),
            "last_result": state.get("last_gmail_result"),
            "last_error": state.get("last_gmail_error"),
        },
        "ingestion": {
            "enabled": os.getenv("INGESTION_AUTO_SYNC_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"},
            "auto_import": os.getenv("INGESTION_AUTO_IMPORT", "true").strip().lower() in {"1", "true", "yes", "on"},
            "interval_minutes": ingestion_interval,
            "drop_folder": os.getenv("INGESTION_INBOX_DIR")
            or str(Path.home() / "Documents" / "LifeDashboard" / "IngestionInbox"),
            "last_scan": state.get("last_ingestion_scan"),
            "last_result": state.get("last_ingestion_result"),
            "last_error": state.get("last_ingestion_error"),
        },
        "investments": {
            "interval_hours": investment_interval,
            "last_refresh": state.get("last_investment_refresh"),
            "last_result": state.get("last_investment_result"),
            "last_error": state.get("last_investment_error"),
        },
        "equity_lookthrough": {
            "enabled": os.getenv("EQUITY_LOOKTHROUGH_SYNC_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"},
            "interval_hours": equity_interval,
            "last_refresh": state.get("last_equity_lookthrough_refresh"),
            "last_result": state.get("last_equity_lookthrough_result"),
            "last_error": state.get("last_equity_lookthrough_error"),
        },
        "snapshot": {
            "auto_capture_enabled": os.getenv("AUTO_CAPTURE_MONTH_END_SNAPSHOT", "true").strip().lower() in {"1", "true", "yes", "on"},
            "last_snapshot_month": state.get("last_snapshot_month"),
            "last_snapshot_at": state.get("last_snapshot_at"),
            "last_result": state.get("last_snapshot_result"),
            "last_error": state.get("last_snapshot_error"),
        },
        "last_run": state.get("last_run"),
        "last_results": state.get("last_results"),
    }


async def automation_loop() -> None:
    while True:
        # Do not run network/data work during app startup. The dashboard should
        # become responsive first; the first automation pass happens after the
        # configured loop interval or when the user clicks Run.
        interval = max(int(os.getenv("AUTOMATION_LOOP_MINUTES", "30")), 5)
        await asyncio.sleep(interval * 60)
        try:
            if _automation_enabled():
                await run_automation_once(force=False)
        except Exception:
            pass
