from datetime import date, datetime
from calendar import monthrange

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.db import get_db
from database.models import (
    Actionable,
    Bill,
    CategoryRule,
    HistoricalWealth,
    ManualAsset,
    MonthClose,
    AssetSnapshot,
    Transaction,
)
from routers.wealth import get_wealth
from services.cashflow_rules import is_hidden_cashflow_category
from services.transaction_categorizer import categorize_transaction_rule, extract_merchant

router = APIRouter(prefix="/api/month-close", tags=["month-close"])


class MonthClosePatch(BaseModel):
    bank_statement_imported: bool | None = None
    balances_updated: bool | None = None
    investments_refreshed: bool | None = None
    actionables_reviewed: bool | None = None
    notes: str | None = None


def _current_month() -> str:
    return date.today().strftime("%Y-%m")


def _month_bounds(month_year: str) -> tuple[date, date]:
    year, month = [int(part) for part in month_year.split("-")]
    return date(year, month, 1), date(year, month, monthrange(year, month)[1])


def _get_or_create(db: Session, month_year: str) -> MonthClose:
    close = db.query(MonthClose).filter_by(month_year=month_year).first()
    if close:
        return close
    close = MonthClose(month_year=month_year)
    db.add(close)
    db.commit()
    db.refresh(close)
    return close


def _manual_values(db: Session) -> dict[str, float]:
    return {a.asset_type: float(a.value or 0) for a in db.query(ManualAsset).all()}


def _cashflow(db: Session, month_year: str) -> tuple[float, float, int]:
    income = db.query(func.sum(Transaction.amount)).filter(
        Transaction.transaction_type == "Credit",
        func.strftime("%Y-%m", Transaction.date) == month_year,
    ).scalar() or 0.0
    debit_rows = db.query(Transaction).filter(
        Transaction.transaction_type == "Debit",
        func.strftime("%Y-%m", Transaction.date) == month_year,
    ).all()
    expenses = 0.0
    for row in debit_rows:
        category = (row.category or "").strip()
        if not category or category.lower() in {"misc", "miscellaneous", "uncategorized"}:
            category, _confidence = categorize_transaction_rule(row.description, row.transaction_type)
        if is_hidden_cashflow_category(category):
            continue
        expenses += float(row.amount or 0)
    count = db.query(Transaction).filter(func.strftime("%Y-%m", Transaction.date) == month_year).count()
    return round(float(income), 2), round(float(expenses), 2), count


def _transaction_coverage(db: Session, month_year: str) -> tuple[date | None, date | None]:
    row = db.query(func.min(Transaction.date), func.max(Transaction.date)).filter(
        func.strftime("%Y-%m", Transaction.date) == month_year
    ).first()
    return row[0], row[1]


def _previous_month(month_year: str) -> str:
    year, month = [int(part) for part in month_year.split("-")]
    if month == 1:
        return f"{year - 1}-12"
    return f"{year}-{month - 1:02d}"


def _category_breakdown(db: Session, month_year: str, direction: str = "Debit") -> dict:
    rows = (
        db.query(Transaction)
        .filter(
            Transaction.transaction_type == direction,
            func.strftime("%Y-%m", Transaction.date) == month_year,
        )
        .all()
    )
    buckets: dict[str, dict] = {}
    total = 0.0
    visible_count = 0
    for row in rows:
        merchant = extract_merchant(row.description)
        category = (row.category or "").strip()
        if not category or category.lower() in {"misc", "miscellaneous", "uncategorized"}:
            category, _confidence = categorize_transaction_rule(row.description, row.transaction_type)
        if direction == "Debit" and is_hidden_cashflow_category(category):
            continue
        amount = float(row.amount or 0)
        total += amount
        visible_count += 1
        bucket = buckets.setdefault(category, {"category": category, "total": 0.0, "count": 0, "merchants": {}})
        bucket["total"] += amount
        bucket["count"] += 1
        bucket["merchants"][merchant] = bucket["merchants"].get(merchant, 0.0) + amount

    categories = []
    for bucket in buckets.values():
        merchants = sorted(bucket["merchants"].items(), key=lambda item: item[1], reverse=True)
        categories.append({
            "category": bucket["category"],
            "total": round(bucket["total"], 2),
            "count": bucket["count"],
            "percentage": round(bucket["total"] / total * 100, 1) if total else 0,
            "top_merchants": [{"merchant": name, "total": round(value, 2)} for name, value in merchants[:5]],
        })
    categories.sort(key=lambda item: item["total"], reverse=True)
    return {"total": round(total, 2), "count": visible_count, "categories": categories}


def _review_insights(status: dict, expenses: dict, previous: dict | None, rule_count: int) -> list[dict]:
    insights = []
    savings = status["metrics"]["savings"]
    income = status["metrics"]["income"]
    savings_rate = round((savings / income) * 100, 1) if income else None
    if savings_rate is not None:
        insights.append({
            "severity": "good" if savings_rate >= 20 else "warning" if savings_rate >= 0 else "critical",
            "title": "Savings rate",
            "detail": f"{savings_rate}% for the month.",
        })
    if expenses["categories"]:
        top = expenses["categories"][0]
        insights.append({
            "severity": "info",
            "title": "Largest outflow",
            "detail": f"{top['category']} is INR {round(top['total']):,} ({top['percentage']}%).",
        })
    ambiguous = [cat for cat in expenses["categories"] if cat["category"] in {"Transfers Out", "Miscellaneous"}]
    if ambiguous:
        insights.append({
            "severity": "warning",
            "title": "Needs categorisation cleanup",
            "detail": f"{len(ambiguous)} ambiguous bucket(s) remain. Saved rules: {rule_count}.",
        })
    if previous and previous["expenses"] > 0:
        delta = status["metrics"]["expenses"] - previous["expenses"]
        pct = round(delta / previous["expenses"] * 100, 1)
        insights.append({
            "severity": "info" if pct <= 10 else "warning",
            "title": "Expense change vs previous month",
            "detail": f"{pct:+.1f}% ({'up' if delta >= 0 else 'down'} INR {abs(round(delta)):,}).",
        })
    if status["missing"]:
        insights.append({
            "severity": "warning",
            "title": "Month close incomplete",
            "detail": " ".join(status["missing"][:2]),
        })
    return insights


def _net_worth_parts(db: Session) -> dict:
    manual = _manual_values(db)
    wealth = get_wealth(db)
    total = round(float(wealth["total_net_worth"]), 2)
    liquid = manual.get("BANK", 0)
    invested = round(total - liquid, 2)
    return {
        "liquid": liquid,
        "invested": invested,
        "total": total,
        "manual_count": len([v for v in manual.values() if v > 0]),
        "mf_count": int(wealth["mf_count"]),
        "stock_count": int(wealth["stock_count"]),
    }


def _asset_values(db: Session) -> dict[str, float]:
    values = {
        "Cash": 0.0,
        "Mutual Funds": 0.0,
        "Stocks": 0.0,
        "Gold": 0.0,
        "Real Estate": 0.0,
        "Fixed Deposits": 0.0,
        "PPF": 0.0,
        "PF": 0.0,
        "NPS": 0.0,
    }
    label_map = {"Cash / Bank": "Cash", "EPF": "PF"}
    for item in get_wealth(db)["slices"]:
        label = label_map.get(item["label"], item["label"])
        values[label] = round(float(item["value"]), 2)
    return values


def _status_payload(db: Session, month_year: str) -> dict:
    close = _get_or_create(db, month_year)
    income, expenses, tx_count = _cashflow(db, month_year)
    start, end = _month_bounds(month_year)
    min_tx_date, max_tx_date = _transaction_coverage(db, month_year)
    parts = _net_worth_parts(db)
    pending_actions = db.query(Actionable).filter(Actionable.status == "Pending").count()
    today = date.today()
    period_complete = today >= end
    bank_statement_complete = tx_count > 0 and (
        not period_complete or (max_tx_date is not None and max_tx_date >= end)
    )

    auto = {
        "bank_statement_imported": bank_statement_complete,
        "balances_updated": parts["liquid"] > 0 or parts["manual_count"] > 0,
        "investments_refreshed": parts["invested"] > 0 or parts["mf_count"] > 0 or parts["stock_count"] > 0,
        "actionables_reviewed": pending_actions == 0 or close.actionables_reviewed,
    }
    checklist = {
        "bank_statement_imported": close.bank_statement_imported or auto["bank_statement_imported"],
        "balances_updated": close.balances_updated or auto["balances_updated"],
        "investments_refreshed": close.investments_refreshed or auto["investments_refreshed"],
        "actionables_reviewed": close.actionables_reviewed or auto["actionables_reviewed"],
        "snapshot_captured": close.snapshot_captured,
        "period_complete": period_complete,
    }
    input_required_keys = ["bank_statement_imported", "balances_updated", "investments_refreshed"]
    close_required_keys = [*input_required_keys, "period_complete", "snapshot_captured"]
    completed = sum(1 for key in close_required_keys if checklist[key])
    score = round((completed / len(close_required_keys)) * 100)
    can_capture_snapshot = period_complete and all(checklist[key] for key in input_required_keys)

    missing = []
    labels = {
        "bank_statement_imported": "Import this month's complete bank statement.",
        "balances_updated": "Update cash and manual balances.",
        "investments_refreshed": "Refresh investments or import holdings.",
        "period_complete": "Wait until the month is complete before locking the snapshot.",
        "snapshot_captured": "Capture the month-end snapshot.",
    }
    for key in input_required_keys:
        if not checklist[key]:
            missing.append(labels[key])
    if not checklist["period_complete"]:
        missing.append(labels["period_complete"])
    if can_capture_snapshot and not checklist["snapshot_captured"]:
        missing.append(labels["snapshot_captured"])

    close.data_quality_score = score
    close.status = "Closed" if checklist["snapshot_captured"] and score == 100 and period_complete else "Open"
    db.commit()

    due = today >= date(end.year, end.month, max(25, end.day - 3)) and not checklist["snapshot_captured"]

    return {
        "month_year": month_year,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "status": close.status,
        "due": due,
        "data_quality_score": score,
        "checklist": checklist,
        "statement_coverage": {
            "first_transaction_date": min_tx_date.isoformat() if min_tx_date else None,
            "last_transaction_date": max_tx_date.isoformat() if max_tx_date else None,
            "complete_for_month": bank_statement_complete,
        },
        "missing": missing,
        "can_capture_snapshot": can_capture_snapshot,
        "required_steps": [
            {
                "key": "bank_statement_imported",
                "label": "Import bank statement",
                "why": "Powers income, expenses, savings rate, and savings trend.",
                "required": True,
                "done": checklist["bank_statement_imported"],
            },
            {
                "key": "balances_updated",
                "label": "Update cash and manual balances",
                "why": "Powers in-hand cash and the liquid part of net worth.",
                "required": True,
                "done": checklist["balances_updated"],
            },
            {
                "key": "investments_refreshed",
                "label": "Refresh investments",
                "why": "Powers invested net worth, allocation, and forecast base.",
                "required": True,
                "done": checklist["investments_refreshed"],
            },
            {
                "key": "actionables_reviewed",
                "label": "Review important actionables",
                "why": "Keeps the executive summary honest.",
                "required": False,
                "done": checklist["actionables_reviewed"],
            },
            {
                "key": "period_complete",
                "label": "Month is complete",
                "why": "Prevents locking an incomplete current-month trend.",
                "required": True,
                "done": checklist["period_complete"],
            },
        ],
        "metrics": {
            "income": income,
            "expenses": expenses,
            "savings": round(income - expenses, 2),
            "transaction_count": tx_count,
            "net_worth": parts["total"],
            "liquid": parts["liquid"],
            "invested": parts["invested"],
            "pending_actions": pending_actions,
        },
        "notes": close.notes,
        "closed_at": close.closed_at.isoformat() if close.closed_at else None,
    }


@router.get("/current")
def current_month_status(db: Session = Depends(get_db)):
    return _status_payload(db, _current_month())


@router.get("/{month_year}")
def month_status(month_year: str, db: Session = Depends(get_db)):
    return _status_payload(db, month_year)


@router.patch("/{month_year}")
def update_month_close(month_year: str, body: MonthClosePatch, db: Session = Depends(get_db)):
    close = _get_or_create(db, month_year)
    for key in ("bank_statement_imported", "balances_updated", "investments_refreshed", "actionables_reviewed"):
        value = getattr(body, key)
        if value is not None:
            setattr(close, key, value)
    if body.notes is not None:
        close.notes = body.notes
    close.updated_at = datetime.utcnow()
    db.commit()
    return _status_payload(db, month_year)


@router.post("/{month_year}/snapshot")
def capture_month_snapshot(month_year: str, db: Session = Depends(get_db)):
    status = _status_payload(db, month_year)
    if not status["can_capture_snapshot"]:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Month snapshot is locked until required ingestion steps are complete.",
                "missing": status["missing"],
            },
        )

    close = _get_or_create(db, month_year)
    parts = _net_worth_parts(db)
    snap = db.query(HistoricalWealth).filter_by(month_year=month_year).first()
    if snap:
        snap.total_net_worth = parts["total"]
        snap.total_liquid = parts["liquid"]
        snap.total_invested = parts["invested"]
        snap.updated_at = datetime.utcnow()
    else:
        db.add(HistoricalWealth(
            month_year=month_year,
            total_net_worth=parts["total"],
            total_liquid=parts["liquid"],
            total_invested=parts["invested"],
        ))

    for asset_type, value in _asset_values(db).items():
        existing = db.query(AssetSnapshot).filter_by(month_year=month_year, asset_type=asset_type).first()
        if existing:
            existing.value = value
            existing.updated_at = datetime.utcnow()
        else:
            db.add(AssetSnapshot(month_year=month_year, asset_type=asset_type, value=value, source="month_close"))

    close.snapshot_captured = True
    close.closed_at = datetime.utcnow()
    close.updated_at = datetime.utcnow()
    db.commit()
    return _status_payload(db, month_year)


@router.get("/{month_year}/review")
def month_review(month_year: str, db: Session = Depends(get_db)):
    status = _status_payload(db, month_year)
    prev_month = _previous_month(month_year)
    prev_income, prev_expenses, prev_count = _cashflow(db, prev_month)
    expenses = _category_breakdown(db, month_year, "Debit")
    income = _category_breakdown(db, month_year, "Credit")
    start, end = _month_bounds(month_year)
    bills = (
        db.query(Bill)
        .filter(Bill.is_paid == False, Bill.due_date >= start, Bill.due_date <= end)
        .order_by(Bill.due_date.asc())
        .all()
    )
    actionables = (
        db.query(Actionable)
        .filter(Actionable.status == "Pending")
        .order_by(Actionable.priority.asc(), Actionable.due_date.asc().nullslast())
        .limit(8)
        .all()
    )
    rules = db.query(CategoryRule).count()
    previous = {"month_year": prev_month, "income": prev_income, "expenses": prev_expenses, "transaction_count": prev_count}
    return {
        "month_year": month_year,
        "status": status,
        "previous": previous,
        "income_breakdown": income,
        "expense_breakdown": expenses,
        "insights": _review_insights(status, expenses, previous, rules),
        "bills": [
            {
                "id": bill.id,
                "name": bill.name,
                "amount": bill.amount,
                "due_date": bill.due_date.isoformat(),
            }
            for bill in bills
        ],
        "actionables": [
            {
                "id": item.id,
                "task": item.task_description,
                "priority": item.priority,
                "due_date": item.due_date.isoformat() if item.due_date else None,
                "source": item.source,
            }
            for item in actionables
        ],
        "categorisation": {
            "saved_rules": rules,
            "ambiguous_buckets": [
                cat for cat in expenses["categories"] if cat["category"] in {"Transfers Out", "Miscellaneous"}
            ],
        },
    }
