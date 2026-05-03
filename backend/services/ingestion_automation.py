from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import mimetypes
import os
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from database.models import HealthMetric, IngestionFile, ManualAsset, MonthClose


BACKEND_DIR = Path(__file__).resolve().parents[1]
STATE_FILE = BACKEND_DIR / "automation_state.json"
GMAIL_CREDENTIALS_FILE = BACKEND_DIR / "credentials.json"
GMAIL_TOKEN_FILE = BACKEND_DIR / "token.json"
DEFAULT_DROP_DIR = Path.home() / "Documents" / "LifeDashboard" / "IngestionInbox"
DEFAULT_STORE_DIR = BACKEND_DIR / "ingestion_files"
DEFAULT_GMAIL_DIR = BACKEND_DIR / "gmail_attachments"

SUPPORTED_SUFFIXES = {".csv", ".txt", ".xlsx", ".xlsm", ".pdf"}
AUTO_IMPORT_TYPES = {"bank_statement", "stock_holdings", "health_csv", "mutual_fund_cas"}
FINANCE_ATTACHMENT_TERMS = {
    "statement",
    "account",
    "bank",
    "holding",
    "holdings",
    "portfolio",
    "zerodha",
    "cams",
    "kfin",
    "kfintech",
    "cas",
    "cdsl",
    "nsdl",
    "mutual fund",
    "mf",
    "health",
    "steps",
    "sleep",
    "nps",
    "epfo",
    "ppf",
    "fd",
    "fixed deposit",
    "loan",
    "emi",
    "credit card",
}


@dataclass
class FileClassification:
    detected_type: str
    confidence: float
    auto_import: bool
    reason: str


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


def _drop_dir() -> Path:
    return Path(os.getenv("INGESTION_INBOX_DIR") or str(DEFAULT_DROP_DIR)).expanduser()


def _store_dir() -> Path:
    return Path(os.getenv("INGESTION_STORE_DIR") or str(DEFAULT_STORE_DIR)).expanduser()


def _gmail_dir() -> Path:
    return Path(os.getenv("INGESTION_GMAIL_ATTACHMENT_DIR") or str(DEFAULT_GMAIL_DIR)).expanduser()


def _ensure_dirs() -> None:
    _drop_dir().mkdir(parents=True, exist_ok=True)
    _store_dir().mkdir(parents=True, exist_ok=True)
    _gmail_dir().mkdir(parents=True, exist_ok=True)


def _safe_filename(value: str) -> str:
    name = Path(value or "attachment").name.strip() or "attachment"
    name = re.sub(r"[^A-Za-z0-9._ -]+", "_", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name[:140] or "attachment"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_sample(path: Path, limit: int = 65536) -> bytes:
    try:
        with path.open("rb") as fh:
            return fh.read(limit)
    except OSError:
        return b""


def _decode_sample(sample: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return sample.decode(encoding, errors="replace")
        except Exception:
            continue
    return ""


def _norm(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _headers_from_text(text: str) -> set[str]:
    rows: list[list[str]] = []
    try:
        rows = list(csv.reader(io.StringIO(text[:20000])))
    except Exception:
        rows = []
    candidates: set[str] = set()
    for row in rows[:25]:
        normalised = {_norm(cell) for cell in row if str(cell or "").strip()}
        if len(normalised) >= 2:
            candidates |= normalised
    return candidates


def _text_has_any(text: str, terms: set[str] | tuple[str, ...]) -> bool:
    lower = text.lower()
    return any(term in lower for term in terms)


def classify_file(path: Path, context: dict[str, Any] | None = None) -> FileClassification:
    context = context or {}
    suffix = path.suffix.lower()
    filename = path.name.lower()
    joined_context = " ".join(str(context.get(k) or "") for k in ("subject", "sender", "source_key")).lower()
    combined = f"{filename} {joined_context}"
    sample = _read_sample(path)
    text = _decode_sample(sample)
    headers = _headers_from_text(text)
    compact_headers = " ".join(sorted(headers))

    is_tabular = suffix in {".csv", ".txt"}
    is_excel = suffix in {".xlsx", ".xlsm"}
    is_pdf = suffix == ".pdf"

    card_or_loan = _text_has_any(combined, {"credit card", "creditcard", "loan", "emi"})
    if card_or_loan and (is_pdf or is_tabular):
        return FileClassification(
            "liability_statement",
            0.78,
            False,
            "Looks like a credit-card, loan, or EMI statement. It is staged for review so it does not pollute bank cashflow.",
        )

    if is_pdf and _text_has_any(combined, {"cas", "cams", "kfin", "kfintech", "cdsl", "consolidated account statement"}):
        has_password = bool(os.getenv("CAS_PASSWORD", "").strip())
        return FileClassification(
            "mutual_fund_cas",
            0.96,
            has_password,
            "CAS PDF detected. Auto-import requires CAS_PASSWORD in backend .env." if not has_password else "CAS PDF detected.",
        )

    health_hits = {"steps", "stepcount", "sleep", "sleephours", "restinghr", "restingheartrate", "activemins"} & headers
    if is_tabular and ("date" in headers or "day" in headers or "logdate" in headers) and health_hits:
        return FileClassification("health_csv", 0.92, True, "Health CSV columns detected.")

    stock_hits = {"symbol", "instrument", "tradingsymbol", "stock", "quantity", "qty", "avgcost", "avgprice", "averageprice", "ltp"} & headers
    if (is_excel or is_tabular) and (
        _text_has_any(combined, {"zerodha", "holding", "holdings", "portfolio"})
        or ({"symbol", "quantity"} <= headers)
        or ({"instrument", "qty"} <= headers)
        or len(stock_hits) >= 3
    ):
        return FileClassification("stock_holdings", 0.9, True, "Stock holding export detected.")

    bank_hits = {"date", "trandate", "transactiondate", "valuedate", "narration", "particulars", "description", "transactionremarks", "debitamount", "creditamount", "withdrawalamount", "depositamount", "balance", "bal"} & headers
    if is_tabular and not card_or_loan and (
        len(bank_hits) >= 4
        or (
            _text_has_any(combined, {"bank", "account statement", "statement"})
            and len({"date", "narration", "description", "particulars"} & headers) >= 1
            and len({"debitamount", "creditamount", "withdrawalamount", "depositamount", "amount"} & headers) >= 1
        )
    ):
        return FileClassification("bank_statement", 0.9, True, "Bank statement CSV detected.")

    if _text_has_any(combined, {"epfo", "epf", "ppf", "nps", "fixed deposit", "fd"}):
        return FileClassification(
            "manual_balance_statement",
            0.62,
            False,
            "Looks like a balance statement. It is staged because balance extraction is not reliable enough yet.",
        )

    if compact_headers:
        return FileClassification("unknown", 0.3, False, "File has tabular data, but it did not match a safe importer.")
    return FileClassification("unknown", 0.15, False, "Unsupported or unknown attachment type.")


def _loads_json(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def serialize_ingestion_file(row: IngestionFile) -> dict[str, Any]:
    return {
        "id": row.id,
        "source": row.source,
        "source_key": row.source_key,
        "filename": row.filename,
        "stored_path": row.stored_path,
        "mime_type": row.mime_type,
        "size_bytes": row.size_bytes,
        "sha256": row.sha256,
        "detected_type": row.detected_type,
        "confidence": round(float(row.confidence or 0), 2),
        "status": row.status,
        "reason": row.reason,
        "error": row.error,
        "metadata": _loads_json(row.metadata_json, {}),
        "result": _loads_json(row.result_json, None),
        "imported_at": row.imported_at.isoformat() if row.imported_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _update_month_close_bank(db: Session, result: dict[str, Any]) -> dict[str, Any]:
    latest_balance = result.get("latest_statement_balance")
    latest_balance_date = result.get("latest_statement_balance_date")
    bank_balance_updated = False

    if latest_balance is not None:
        try:
            latest_balance_value = float(latest_balance or 0)
        except (TypeError, ValueError):
            latest_balance_value = 0.0
        if latest_balance_value > 0:
            note_date = latest_balance_date or "latest statement row"
            note = f"Auto-updated from statement ending {note_date}"
            bank_asset = db.query(ManualAsset).filter_by(asset_type="BANK").first()
            if bank_asset:
                bank_asset.value = latest_balance_value
                bank_asset.notes = note
                bank_asset.updated_at = _utc_now()
            else:
                db.add(ManualAsset(asset_type="BANK", value=latest_balance_value, notes=note))
            bank_balance_updated = True

    current_month = date.today().strftime("%Y-%m")
    if current_month in set(result.get("unique_months") or []):
        close = db.query(MonthClose).filter_by(month_year=current_month).first()
        if not close:
            close = MonthClose(month_year=current_month)
            db.add(close)
        close.bank_statement_imported = True
        close.updated_at = _utc_now()

    db.commit()
    return {"bank_balance_updated": bank_balance_updated}


def _mark_investments_refreshed(db: Session) -> None:
    month_year = date.today().strftime("%Y-%m")
    close = db.query(MonthClose).filter_by(month_year=month_year).first()
    if not close:
        close = MonthClose(month_year=month_year)
        db.add(close)
    close.investments_refreshed = True
    close.updated_at = _utc_now()
    db.commit()


def _parse_health_date(raw: str) -> date | None:
    raw = str(raw or "").strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%m-%y", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _parse_int(raw) -> int | None:
    raw = str(raw or "").replace(",", "").strip()
    return int(float(raw)) if raw else None


def _parse_float(raw) -> float | None:
    raw = str(raw or "").replace(",", "").strip()
    return float(raw) if raw else None


def _import_health_csv(db: Session, path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise ValueError("Empty CSV file")

    headers = {_norm(k): k for k in rows[0].keys()}

    def col(*names: str) -> str | None:
        for name in names:
            if name in headers:
                return headers[name]
        return None

    date_col = col("date", "day", "logdate")
    if not date_col:
        raise ValueError(f"Could not find date column. Found: {list(rows[0].keys())}")

    steps_col = col("steps", "stepcount")
    sleep_col = col("sleephours", "sleep", "sleepduration")
    hr_col = col("restinghr", "restingheartrate", "heartrate")
    active_col = col("activemins", "activeminutes", "exercise")
    calories_col = col("calories", "kcal")

    imported = skipped = 0
    for row in rows:
        metric_date = _parse_health_date(row.get(date_col, ""))
        if not metric_date:
            skipped += 1
            continue
        metric = db.query(HealthMetric).filter_by(date=metric_date).first()
        if not metric:
            metric = HealthMetric(date=metric_date)
            db.add(metric)
        if steps_col:
            metric.steps = _parse_int(row.get(steps_col))
        if sleep_col:
            metric.sleep_hours = _parse_float(row.get(sleep_col))
        if hr_col:
            metric.resting_hr = _parse_int(row.get(hr_col))
        if active_col:
            metric.active_mins = _parse_int(row.get(active_col))
        if calories_col:
            metric.calories = _parse_int(row.get(calories_col))
        imported += 1
    db.commit()
    return {"status": "ok", "imported": imported, "skipped": skipped}


async def import_ingestion_file(db: Session, file_id: int, detected_type: str | None = None) -> dict[str, Any]:
    row = db.query(IngestionFile).filter_by(id=file_id).first()
    if not row:
        raise ValueError("Ingestion file not found")

    if detected_type:
        row.detected_type = detected_type

    path = Path(row.stored_path)
    if not path.exists():
        row.status = "error"
        row.error = "Stored file is missing."
        row.updated_at = _utc_now()
        db.commit()
        return serialize_ingestion_file(row)

    try:
        detected = row.detected_type
        if detected == "bank_statement":
            scripts_dir = str(BACKEND_DIR / "scripts")
            if scripts_dir not in sys.path:
                sys.path.insert(0, scripts_dir)
            from import_bank_statement import import_csv

            result = await import_csv(
                csv_path=str(path),
                account_source="Auto Import",
                skip_duplicates=True,
                use_llm=False,
            )
            result.update(_update_month_close_bank(db, result))
        elif detected == "stock_holdings":
            from routers.wealth import _parse_stocks_csv, _parse_stocks_xlsx, _upsert_stock_holdings

            content = path.read_bytes()
            if path.suffix.lower() in {".xlsx", ".xlsm"}:
                holdings, skipped, headers, source_sheet = _parse_stocks_xlsx(content)
                fmt = "xlsx"
            else:
                holdings, skipped, headers = _parse_stocks_csv(content)
                source_sheet = None
                fmt = "csv"
            if not holdings:
                raise ValueError(f"Could not find stock holdings. Found: {headers}")
            imported, updated = _upsert_stock_holdings(db, holdings)
            result = {"status": "ok", "imported": imported, "updated": updated, "skipped": skipped, "format": fmt, "sheet": source_sheet}
        elif detected == "mutual_fund_cas":
            cas_password = os.getenv("CAS_PASSWORD", "").strip()
            if not cas_password:
                raise ValueError("CAS_PASSWORD is required in backend .env for automated CAS import.")
            scripts_dir = str(BACKEND_DIR / "scripts")
            if scripts_dir not in sys.path:
                sys.path.insert(0, scripts_dir)
            from import_cas import import_cas

            imported = import_cas(str(path), cas_password, db)
            if imported > 0:
                _mark_investments_refreshed(db)
            result = {"status": "ok", "imported": imported}
        elif detected == "health_csv":
            result = _import_health_csv(db, path)
        else:
            raise ValueError(f"No safe importer is enabled for {detected}.")

        row.status = "imported"
        row.result_json = json.dumps(result, default=str)
        row.error = None
        row.imported_at = _utc_now()
        row.updated_at = _utc_now()
        db.commit()
        db.refresh(row)
        return serialize_ingestion_file(row)
    except Exception as exc:
        db.rollback()
        row = db.query(IngestionFile).filter_by(id=file_id).first()
        if row:
            row.status = "error"
            row.error = str(exc)
            row.updated_at = _utc_now()
            db.commit()
            db.refresh(row)
            return serialize_ingestion_file(row)
        raise


async def stage_file(
    db: Session,
    path: Path,
    *,
    source: str,
    source_key: str | None = None,
    metadata: dict[str, Any] | None = None,
    auto_import: bool = True,
) -> dict[str, Any]:
    _ensure_dirs()
    if not path.exists() or not path.is_file() or path.suffix.lower() not in SUPPORTED_SUFFIXES:
        return {"status": "skipped", "filename": path.name, "reason": "Unsupported or missing file."}

    metadata = metadata or {}
    digest = _sha256_file(path)
    existing = db.query(IngestionFile).filter_by(sha256=digest).first()
    if existing:
        return {"status": "duplicate", "file": serialize_ingestion_file(existing)}

    safe_name = _safe_filename(path.name)
    stored_path = _store_dir() / f"{digest[:16]}-{safe_name}"
    if path.resolve() != stored_path.resolve():
        shutil.copy2(path, stored_path)

    classification = classify_file(stored_path, metadata)
    row = IngestionFile(
        source=source,
        source_key=source_key,
        filename=safe_name,
        stored_path=str(stored_path),
        mime_type=mimetypes.guess_type(safe_name)[0],
        size_bytes=stored_path.stat().st_size,
        sha256=digest,
        detected_type=classification.detected_type,
        confidence=classification.confidence,
        status="staged",
        reason=classification.reason,
        metadata_json=json.dumps(metadata, default=str),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    should_import = (
        auto_import
        and classification.auto_import
        and classification.detected_type in AUTO_IMPORT_TYPES
        and classification.confidence >= 0.86
    )
    if should_import:
        return {"status": "imported", "file": await import_ingestion_file(db, row.id)}
    return {"status": "staged", "file": serialize_ingestion_file(row)}


async def scan_drop_folder(db: Session, *, auto_import: bool = True) -> dict[str, Any]:
    _ensure_dirs()
    drop = _drop_dir()
    results: list[dict[str, Any]] = []
    for path in sorted(drop.iterdir(), key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_SUFFIXES:
            continue
        results.append(await stage_file(db, path, source="drop_folder", metadata={"drop_folder": str(drop)}, auto_import=auto_import))

    return {
        "status": "ok",
        "drop_folder": str(drop),
        "files_seen": len(results),
        "imported": sum(1 for item in results if item.get("status") == "imported"),
        "staged": sum(1 for item in results if item.get("status") == "staged"),
        "duplicates": sum(1 for item in results if item.get("status") == "duplicate"),
        "skipped": sum(1 for item in results if item.get("status") == "skipped"),
        "results": results[:25],
    }


def _gmail_date(value: date | datetime) -> str:
    if isinstance(value, datetime):
        value = value.date()
    return value.strftime("%Y/%m/%d")


def _gmail_attachment_parts(payload: dict[str, Any]):
    for part in payload.get("parts", []) or []:
        filename = part.get("filename") or ""
        body = part.get("body") or {}
        if filename and body.get("attachmentId"):
            yield part
        yield from _gmail_attachment_parts(part)


def _gmail_ready() -> bool:
    return GMAIL_CREDENTIALS_FILE.exists() and GMAIL_TOKEN_FILE.exists()


async def scan_gmail_attachments(
    db: Session,
    *,
    days: int = 45,
    max_messages: int = 80,
    auto_import: bool = True,
) -> dict[str, Any]:
    _ensure_dirs()
    if not _gmail_ready():
        return {"status": "skipped", "reason": "gmail_not_authorized"}

    try:
        from scripts.sync_gmail import _get_gmail_service, _get_header
    except Exception as exc:
        return {"status": "skipped", "reason": f"gmail_import_unavailable: {exc}"}

    service = _get_gmail_service()
    since = datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 365)))
    query = (
        f"has:attachment after:{_gmail_date(since)} "
        "-category:promotions -category:social -category:forums"
    )

    resp = service.users().messages().list(userId="me", q=query, maxResults=max(1, min(max_messages, 300))).execute()
    messages = resp.get("messages", []) or []
    results: list[dict[str, Any]] = []
    downloaded = 0
    skipped = 0
    errors = 0

    for msg_meta in messages:
        msg_id = msg_meta.get("id")
        if not msg_id:
            continue
        try:
            msg = service.users().messages().get(userId="me", id=msg_id, format="full").execute()
            payload = msg.get("payload") or {}
            headers = payload.get("headers") or []
            subject = _get_header(headers, "Subject") or "(No subject)"
            sender = _get_header(headers, "From") or "Unknown sender"
            message_date = _get_header(headers, "Date")
            context_text = f"{subject} {sender}".lower()

            for part in _gmail_attachment_parts(payload):
                filename = _safe_filename(part.get("filename") or "attachment")
                suffix = Path(filename).suffix.lower()
                if suffix not in SUPPORTED_SUFFIXES:
                    skipped += 1
                    continue
                if not _text_has_any(f"{filename} {context_text}", FINANCE_ATTACHMENT_TERMS):
                    skipped += 1
                    continue

                attachment_id = part.get("body", {}).get("attachmentId")
                attachment = service.users().messages().attachments().get(
                    userId="me",
                    messageId=msg_id,
                    id=attachment_id,
                ).execute()
                data = attachment.get("data")
                if not data:
                    skipped += 1
                    continue
                content = base64.urlsafe_b64decode(data + "==")
                local_name = _safe_filename(f"{msg_id[:10]}-{filename}")
                local_path = _gmail_dir() / local_name
                local_path.write_bytes(content)
                downloaded += 1
                metadata = {
                    "message_id": msg_id,
                    "subject": subject,
                    "sender": sender,
                    "message_date": message_date,
                }
                results.append(await stage_file(
                    db,
                    local_path,
                    source="gmail",
                    source_key=f"{msg_id}:{attachment_id}",
                    metadata=metadata,
                    auto_import=auto_import,
                ))
        except Exception as exc:
            errors += 1
            results.append({"status": "error", "message_id": msg_id, "error": str(exc)})

    return {
        "status": "ok",
        "query": query,
        "messages_seen": len(messages),
        "attachments_downloaded": downloaded,
        "skipped": skipped,
        "errors": errors,
        "imported": sum(1 for item in results if item.get("status") == "imported"),
        "staged": sum(1 for item in results if item.get("status") == "staged"),
        "duplicates": sum(1 for item in results if item.get("status") == "duplicate"),
        "results": results[:25],
    }


async def run_ingestion_automation(
    db: Session,
    *,
    source: str = "all",
    auto_import: bool = True,
    gmail_days: int = 45,
    max_messages: int = 80,
) -> dict[str, Any]:
    state = _read_state()
    started = _utc_now().isoformat()
    results: dict[str, Any] = {}
    if source in {"all", "drop_folder"}:
        results["drop_folder"] = await scan_drop_folder(db, auto_import=auto_import)
    if source in {"all", "gmail"}:
        results["gmail_attachments"] = await scan_gmail_attachments(
            db,
            days=gmail_days,
            max_messages=max_messages,
            auto_import=auto_import,
        )
    state["last_ingestion_scan"] = started
    state["last_ingestion_result"] = results
    state.pop("last_ingestion_error", None)
    _write_state(state)
    return {"status": "ok", "started": started, "auto_import": auto_import, "results": results}


def list_ingestion_files(db: Session, *, status: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    query = db.query(IngestionFile)
    if status:
        query = query.filter(IngestionFile.status == status)
    rows = query.order_by(IngestionFile.created_at.desc()).limit(max(1, min(limit, 200))).all()
    return [serialize_ingestion_file(row) for row in rows]


def mark_ingestion_file_status(db: Session, file_id: int, status: str) -> dict[str, Any]:
    row = db.query(IngestionFile).filter_by(id=file_id).first()
    if not row:
        raise ValueError("Ingestion file not found")
    if status not in {"staged", "skipped"}:
        raise ValueError("Only staged/skipped status changes are supported.")
    row.status = status
    row.updated_at = _utc_now()
    if status == "skipped":
        row.reason = "Manually ignored."
    db.commit()
    db.refresh(row)
    return serialize_ingestion_file(row)


def ingestion_automation_status(db: Session) -> dict[str, Any]:
    _ensure_dirs()
    state = _read_state()
    rows = db.query(IngestionFile).order_by(IngestionFile.created_at.desc()).limit(50).all()
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.status] = counts.get(row.status, 0) + 1

    cas_password_ready = bool(os.getenv("CAS_PASSWORD", "").strip())
    auto_import = os.getenv("INGESTION_AUTO_IMPORT", "true").strip().lower() in {"1", "true", "yes", "on"}
    auto_enabled = os.getenv("INGESTION_AUTO_SYNC_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
    interval_minutes = max(int(os.getenv("INGESTION_AUTO_SYNC_MINUTES", "240")), 30)

    automated_inputs = [
        {
            "key": "gmail_actionables",
            "label": "Gmail actionables and bills",
            "method": "Gmail OAuth reads likely bills/action emails and extracts bills/reminders.",
            "frequency": f"Every {max(int(os.getenv('GMAIL_AUTO_SYNC_MINUTES', '240')), 15)} minutes while backend is running.",
            "status": "automated" if GMAIL_CREDENTIALS_FILE.exists() and GMAIL_TOKEN_FILE.exists() else "setup_required",
        },
        {
            "key": "bank",
            "label": "Bank statement CSV",
            "method": "Gmail attachments or local inbox folder; high-confidence bank CSVs auto-import and de-duplicate.",
            "frequency": f"Every {interval_minutes} minutes while backend is running, plus manual Run.",
            "status": "automated" if auto_enabled else "disabled",
        },
        {
            "key": "stocks",
            "label": "Stock holdings",
            "method": "Zerodha holdings XLSX/CSV from Gmail or local inbox; prices refresh separately from market data.",
            "frequency": f"Holdings scan every {interval_minutes} minutes; prices every {max(int(os.getenv('INVESTMENT_REFRESH_HOURS', '24')), 1)} hours.",
            "status": "automated" if auto_enabled else "disabled",
        },
        {
            "key": "mutual_funds",
            "label": "Mutual funds",
            "method": "CAS PDFs from Gmail or local inbox refresh holdings; NAV and look-through refresh separately.",
            "frequency": f"CAS scan every {interval_minutes} minutes; NAV/look-through every 24 hours.",
            "status": "automated" if cas_password_ready and auto_enabled else "needs_cas_password",
        },
        {
            "key": "health",
            "label": "Health CSV",
            "method": "CSV exports emailed or dropped into the inbox are detected by date/steps/sleep columns.",
            "frequency": f"Every {interval_minutes} minutes while backend is running.",
            "status": "automated" if auto_enabled else "disabled",
        },
    ]

    manual_inputs = [
        {
            "key": "fd",
            "label": "Fixed deposits",
            "current": "Manual balance field.",
            "automation_path": "Email FD receipts/statements or place them in the inbox; current build stages them for review. A bank/API parser would be needed for safe balance extraction.",
        },
        {
            "key": "ppf_epf_nps",
            "label": "PPF, EPF, NPS",
            "current": "Manual balance fields.",
            "automation_path": "Download official passbook/statement PDFs to the inbox. They are staged today; exact balance extraction should be added provider-by-provider.",
        },
        {
            "key": "real_estate_gold",
            "label": "Real estate and physical gold",
            "current": "Manual balance/grams.",
            "automation_path": "Gold price can refresh from market data if enabled. Real estate still needs a conservative manual or quarterly valuation feed.",
        },
        {
            "key": "liabilities",
            "label": "Credit cards and loans",
            "current": "Manual liability entries.",
            "automation_path": "Credit-card/loan statements are staged, not auto-imported, so they do not mix with bank cashflow until dedicated parsers are added.",
        },
        {
            "key": "people_crm",
            "label": "People / CRM",
            "current": "Manual contacts.",
            "automation_path": "Could sync Google Contacts later, but that needs a broader OAuth scope and explicit contact matching rules.",
        },
    ]

    return {
        "enabled": auto_enabled,
        "auto_import": auto_import,
        "interval_minutes": interval_minutes,
        "drop_folder": str(_drop_dir()),
        "store_folder": str(_store_dir()),
        "gmail_authorized": GMAIL_CREDENTIALS_FILE.exists() and GMAIL_TOKEN_FILE.exists(),
        "cas_password_ready": cas_password_ready,
        "last_scan": state.get("last_ingestion_scan"),
        "last_result": state.get("last_ingestion_result"),
        "last_error": state.get("last_ingestion_error"),
        "counts": counts,
        "recent_files": [serialize_ingestion_file(row) for row in rows],
        "needs_review": [serialize_ingestion_file(row) for row in rows if row.status in {"staged", "error"}][:12],
        "automated_inputs": automated_inputs,
        "manual_inputs": manual_inputs,
    }
