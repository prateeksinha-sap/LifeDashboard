from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.db import get_db
from database.models import (
    Actionable,
    Bill,
    HealthMetric,
    LifeLog,
    ManualAsset,
    MFHolding,
    PersonalCRM,
    Priority,
    StockHolding,
    Transaction,
)
from routers.wealth import get_wealth
from services.cashflow_rules import is_hidden_cashflow_category
from services.transaction_categorizer import categorize_transaction_rule

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _manual_values(db: Session) -> dict[str, float]:
    return {a.asset_type: float(a.value or 0) for a in db.query(ManualAsset).all()}


def _current_net_worth(db: Session) -> float:
    # Keep the summary card aligned with /api/wealth so the dashboard never
    # shows two different net-worth totals.
    return round(float(get_wealth(db)["total_net_worth"]), 2)


def _current_month_cashflow(db: Session) -> tuple[float, float]:
    ym = date.today().strftime("%Y-%m")
    income = db.query(func.sum(Transaction.amount)).filter(
        Transaction.transaction_type == "Credit",
        func.strftime("%Y-%m", Transaction.date) == ym,
    ).scalar() or 0.0
    debit_rows = db.query(Transaction).filter(
        Transaction.transaction_type == "Debit",
        func.strftime("%Y-%m", Transaction.date) == ym,
    ).all()
    expenses = 0.0
    for row in debit_rows:
        category = (row.category or "").strip()
        if not category or category.lower() in {"misc", "miscellaneous", "uncategorized"}:
            category, _confidence = categorize_transaction_rule(row.description, row.transaction_type)
        if is_hidden_cashflow_category(category):
            continue
        expenses += float(row.amount or 0)
    return round(float(income), 2), round(float(expenses), 2)


@router.get("/summary")
def get_dashboard_summary(db: Session = Depends(get_db)):
    today = date.today()
    manual = _manual_values(db)
    income, expenses = _current_month_cashflow(db)
    savings = income - expenses
    savings_rate = round((savings / income) * 100, 1) if income > 0 else None

    pending_actions = db.query(Actionable).filter(Actionable.status == "Pending").count()
    urgent_actions = db.query(Actionable).filter(
        Actionable.status == "Pending",
        Actionable.priority == "High",
    ).count()
    bills_due_7d = db.query(Bill).filter(
        Bill.is_paid == False,
        Bill.due_date <= today + timedelta(days=7),
    ).count()

    overdue_contacts = 0
    for contact in db.query(PersonalCRM).all():
        if contact.last_contact_date and (
            today - contact.last_contact_date
        ).days > contact.check_in_interval_days:
            overdue_contacts += 1

    counts = {
        "manual_assets": len([v for v in manual.values() if v > 0]),
        "mutual_funds": db.query(MFHolding).count(),
        "stocks": db.query(StockHolding).count(),
        "transactions": db.query(Transaction).count(),
        "priorities": db.query(Priority).count(),
        "pending_actions": pending_actions,
        "health_days": db.query(HealthMetric).count(),
        "life_logs": db.query(LifeLog).count(),
        "contacts": db.query(PersonalCRM).count(),
    }

    net_worth = _current_net_worth(db)
    missing = []
    if net_worth <= 0:
        missing.append("Add balances, investments, or holdings to calculate net worth.")
    if counts["transactions"] == 0:
        missing.append("Import bank statements to calculate income, expenses, and savings trend.")
    if pending_actions == 0:
        missing.append("Sync Gmail or add manual actionables for the executive summary.")
    if counts["priorities"] == 0:
        missing.append("Add weekly priorities so important work is visible.")

    return {
        "as_of": today.isoformat(),
        "net_worth": net_worth,
        "cash": manual.get("BANK", 0),
        "income_this_month": income,
        "expenses_this_month": expenses,
        "savings_this_month": round(savings, 2),
        "savings_rate_pct": savings_rate,
        "pending_actions": pending_actions,
        "urgent_actions": urgent_actions,
        "bills_due_7d": bills_due_7d,
        "overdue_contacts": overdue_contacts,
        "data_counts": counts,
        "missing_inputs": missing,
        "transparency_score": max(0, 100 - len(missing) * 20),
    }
