from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.db import get_db
from database.models import (
    Actionable,
    Bill,
    HealthMetric,
    HistoricalWealth,
    FinancialGoal,
    Liability,
    ManualAsset,
    MFHolding,
    PersonalCRM,
    Priority,
    StockHolding,
    Todo,
    Transaction,
)
from services.ingestion_automation import (
    import_ingestion_file,
    ingestion_automation_status,
    list_ingestion_files,
    mark_ingestion_file_status,
    run_ingestion_automation,
)

router = APIRouter(prefix="/api/ingestion", tags=["ingestion"])


def _manual_value(db: Session, key: str) -> float:
    asset = db.query(ManualAsset).filter_by(asset_type=key).first()
    return float(asset.value or 0) if asset else 0.0


def _age_days(value) -> int | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return max((datetime.utcnow() - value).days, 0)
    if isinstance(value, date):
        return max((date.today() - value).days, 0)
    return None


def _source_quality(status: str, required: bool, current_month_ready: bool | None = None) -> int:
    if status != "ready":
        return 0 if required else 35
    if current_month_ready is False:
        return 60
    return 100


def _source(key: str, label: str, status: str, count: int, detail: str, required: bool, *,
            current_month_ready: bool | None = None, last_updated=None, action: str = "") -> dict:
    quality = _source_quality(status, required, current_month_ready)
    issues = []
    if status != "ready":
        issues.append("Missing required data." if required else "Optional data not connected yet.")
    if current_month_ready is False:
        issues.append("No current-month data yet.")
    return {
        "key": key,
        "label": label,
        "status": status,
        "count": count,
        "detail": detail,
        "required_for_month_close": required,
        "current_month_ready": current_month_ready,
        "last_updated": last_updated.isoformat() if hasattr(last_updated, "isoformat") else None,
        "age_days": _age_days(last_updated),
        "quality_score": quality,
        "issues": issues,
        "next_action": action,
    }


@router.get("/status")
def ingestion_status(db: Session = Depends(get_db)):
    tx_stats = db.query(func.count(Transaction.id), func.min(Transaction.date), func.max(Transaction.date)).one()
    current_month = date.today().strftime("%Y-%m")
    current_month_tx = db.query(Transaction).filter(func.strftime("%Y-%m", Transaction.date) == current_month).count()

    manual_assets = db.query(ManualAsset).all()
    manual_last = max((a.updated_at for a in manual_assets if a.updated_at), default=None)
    stock_last = db.query(func.max(StockHolding.updated_at)).scalar()
    mf_last = db.query(func.max(MFHolding.updated_at)).scalar()
    sources = [
        _source(
            "bank",
            "Bank account statement",
            "ready" if tx_stats[0] else "missing",
            int(tx_stats[0] or 0),
            (
                f"{tx_stats[1].isoformat()} to {tx_stats[2].isoformat()}"
                if tx_stats[1] and tx_stats[2] else "Upload CSV exported from your bank."
            ),
            True,
            current_month_ready=current_month_tx > 0,
            last_updated=tx_stats[2],
            action="Upload this month's bank CSV." if current_month_tx == 0 else "Review monthly categories.",
        ),
        _source(
            "stocks",
            "Stocks",
            "ready" if db.query(StockHolding).count() else "missing",
            db.query(StockHolding).count(),
            "Import Zerodha holdings XLSX/CSV or add holdings.",
            True,
            last_updated=stock_last,
            action="Upload latest Zerodha holdings export.",
        ),
        _source(
            "mutual_funds",
            "Mutual funds",
            "ready" if db.query(MFHolding).count() else "missing",
            db.query(MFHolding).count(),
            "Import CDSL/CAMS/KFintech CAS PDF, then refresh NAV.",
            True,
            last_updated=mf_last,
            action="Upload latest CAS statement.",
        ),
        *[
            _source(
                key,
                label,
                "ready" if _manual_value(db, asset_key) > 0 else "missing",
                1 if _manual_value(db, asset_key) > 0 else 0,
                detail,
                required,
                last_updated=manual_last,
                action=f"Update {label} balance.",
            )
            for key, label, asset_key, detail, required in [
                ("gold", "Gold", "GOLD_GRAMS", "Enter physical gold in grams.", True),
                ("real_estate", "Real estate", "REAL_ESTATE", "Enter conservative current market value.", True),
                ("fd", "Fixed deposits", "FD", "Enter principal plus accrued interest.", True),
                ("ppf", "PPF", "PPF", "Enter current PPF account balance.", True),
                ("pf", "PF / EPF", "EPF", "Enter EPFO passbook balance.", True),
                ("nps", "NPS", "NPS", "Enter current NPS statement balance.", True),
            ]
        ],
        _source("bills", "Upcoming bills", "ready" if db.query(Bill).count() else "missing", db.query(Bill).count(), "Add recurring and one-off payment reminders.", False, action="Add recurring bills or sync Gmail."),
        _source("health", "Health data", "ready" if db.query(HealthMetric).count() else "missing", db.query(HealthMetric).count(), "Import health CSV or log values through API.", False, action="Import health data when ready."),
        _source("reminders", "Reminders", "ready" if db.query(Todo).count() or db.query(Actionable).count() else "missing", db.query(Todo).count() + db.query(Actionable).count(), "Add manually or sync Gmail actionables.", False, action="Sync Gmail or add reminders."),
        _source("priorities", "Top priorities", "ready" if db.query(Priority).count() else "missing", db.query(Priority).count(), "Add weekly Q1/Q2/Q3/Q4 priorities.", False, action="Add weekly priorities."),
        _source("snapshots", "Net worth snapshots", "ready" if db.query(HistoricalWealth).count() else "missing", db.query(HistoricalWealth).count(), "Captured at month close after required inputs are complete.", True, action="Capture month-end snapshot."),
        _source("people", "People / CRM", "ready" if db.query(PersonalCRM).count() else "missing", db.query(PersonalCRM).count(), "Track important relationships and check-in cadence.", False, action="Add important contacts."),
        _source("liabilities", "Liabilities", "ready" if db.query(Liability).count() else "missing", db.query(Liability).count(), "Loans, credit-card dues, and other debt for true net worth.", False, action="Add loans and dues."),
        _source("goals", "Financial goals", "ready" if db.query(FinancialGoal).count() else "missing", db.query(FinancialGoal).count(), "Targets used to judge whether the current path is enough.", False, action="Add target amount and date."),
    ]

    ready = sum(1 for source in sources if source["status"] == "ready")
    return {
        "ready": ready,
        "total": len(sources),
        "completion_pct": round(ready / len(sources) * 100),
        "quality_score": round(sum(s["quality_score"] for s in sources) / len(sources)),
        "required_ready": sum(1 for s in sources if s["required_for_month_close"] and s["status"] == "ready"),
        "required_total": sum(1 for s in sources if s["required_for_month_close"]),
        "top_issues": [issue for source in sources for issue in source["issues"]][:5],
        "sources": sources,
    }


@router.get("/automation/status")
def get_ingestion_automation_status(db: Session = Depends(get_db)):
    return ingestion_automation_status(db)


@router.get("/automation/files")
def get_ingestion_automation_files(
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    return list_ingestion_files(db, status=status, limit=limit)


@router.post("/automation/run")
async def run_ingestion_automation_now(
    source: str = Query(default="all", pattern="^(all|drop_folder|gmail)$"),
    auto_import: bool = Query(default=True),
    gmail_days: int = Query(default=45, ge=1, le=365),
    max_messages: int = Query(default=80, ge=1, le=300),
    db: Session = Depends(get_db),
):
    try:
        return await run_ingestion_automation(
            db,
            source=source,
            auto_import=auto_import,
            gmail_days=gmail_days,
            max_messages=max_messages,
        )
    except Exception as exc:
        raise HTTPException(400, str(exc))


@router.post("/automation/files/{file_id}/import")
async def import_staged_ingestion_file(
    file_id: int,
    detected_type: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    try:
        return await import_ingestion_file(db, file_id, detected_type=detected_type)
    except Exception as exc:
        raise HTTPException(400, str(exc))


@router.patch("/automation/files/{file_id}/status")
def update_ingestion_file_status(
    file_id: int,
    status: str = Query(..., pattern="^(staged|skipped)$"),
    db: Session = Depends(get_db),
):
    try:
        return mark_ingestion_file_status(db, file_id, status)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
