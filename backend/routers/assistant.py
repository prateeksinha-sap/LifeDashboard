from __future__ import annotations

import asyncio
import json
import os
import re
import time
from collections import defaultdict
from datetime import date
from typing import Literal

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.db import get_db
from database.models import (
    Actionable,
    AssetSnapshot,
    Bill,
    CategoryRule,
    ManualAsset,
    MFHolding,
    PersonalCRM,
    Priority,
    StockHolding,
    Transaction,
)
from routers.wealth import (
    _latest_cashflow_months,
    _month_income_expenses,
)
from services.ai_service import (
    ANTHROPIC_MODEL,
    OLLAMA_MODEL,
    OPENAI_MODEL,
    generate_anthropic_text,
    generate_openai_text,
    generate_text,
    ollama_status,
)
from services.cashflow_rules import is_hidden_cashflow_category
from services.financial_coach import build_coach_overview, compact_coach_context, money as coach_money
from services.finance_engine import build_finance_profile, build_scenario
from services.portfolio_agent import assistant_context as portfolio_agent_context
from services.transaction_categorizer import categorize_transaction_rule, extract_merchant

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

ASSISTANT_LLM_TIMEOUT_SECONDS = float(os.getenv("ASSISTANT_LLM_TIMEOUT_SECONDS", "45"))
ASSISTANT_PROVIDER = os.getenv("ASSISTANT_PROVIDER", "auto").strip().lower()
ASSISTANT_LOCAL_MODEL = os.getenv("ASSISTANT_LOCAL_MODEL", "llama3.2")
OPENAI_STATUS_CACHE_SECONDS = float(os.getenv("OPENAI_STATUS_CACHE_SECONDS", "300"))
OPENAI_STATUS_TIMEOUT_SECONDS = float(os.getenv("OPENAI_STATUS_TIMEOUT_SECONDS", "8"))

_OPENAI_STATUS_CACHE: dict[str, object] = {"ts": 0.0, "status": None}


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=12)


class ChatResponse(BaseModel):
    answer: str
    provider: str
    model: str | None
    grounded: bool
    data_used: list[str]
    suggested_questions: list[str]
    fallback: bool = False


MONTH_NAMES = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}


def _money(value: float) -> str:
    sign = "-" if value < 0 else ""
    abs_value = abs(float(value or 0))
    if abs_value >= 1_00_00_000:
        return f"{sign}INR {abs_value / 1_00_00_000:.2f}Cr"
    if abs_value >= 1_00_000:
        return f"{sign}INR {abs_value / 1_00_000:.1f}L"
    if abs_value >= 1_000:
        return f"{sign}INR {abs_value / 1_000:.1f}K"
    return f"{sign}INR {abs_value:,.0f}"


def _latest_transaction_month(db: Session) -> str | None:
    row = db.query(func.max(func.strftime("%Y-%m", Transaction.date))).scalar()
    return str(row) if row else None


def _normalise_month_from_question(message: str, db: Session) -> str | None:
    text = message.lower()
    iso_match = re.search(r"\b(20\d{2})[-/](0?[1-9]|1[0-2])\b", text)
    if iso_match:
        return f"{iso_match.group(1)}-{int(iso_match.group(2)):02d}"

    month_match = re.search(
        r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+'?(\d{2,4}))?",
        text,
    )
    if not month_match:
        return _latest_transaction_month(db)

    month = MONTH_NAMES[month_match.group(1)]
    year_text = month_match.group(2)
    if year_text:
        year = int(year_text)
        if year < 100:
            year += 2000
        return f"{year}-{month:02d}"

    available = {
        row[0]
        for row in db.query(func.strftime("%Y-%m", Transaction.date).label("month")).group_by("month").all()
        if row[0]
    }
    for candidate in sorted(available, reverse=True):
        if int(candidate[-2:]) == month:
            return candidate
    return f"{date.today().year}-{month:02d}"


def _category_for_question(message: str) -> str | None:
    text = message.lower()
    if any(word in text for word in ["salary paid", "salaries paid", "pay salary", "paid salary", "house help", "househelp", "maid", "cook", "driver", "domestic help"]):
        return "Household Help"
    aliases = {
        "Utilities": ["utility", "utilities", "electricity", "power", "broadband", "mobile", "phone", "water", "gas"],
        "Bills & Utilities": ["bill", "bills"],
        "Food & Delivery": ["food", "swiggy", "zomato", "restaurant", "dining"],
        "Household Help": ["househelp", "maid", "cook", "driver", "domestic help", "house help"],
        "Education & Child": ["school", "education", "child", "tuition", "class"],
        "Investments & Savings": ["investment", "investments", "sip", "mutual fund", "stocks", "nps", "ppf"],
        "Transfers Out": ["transfer", "sent", "paid to"],
        "Salary": ["salary", "income"],
    }
    for category, words in aliases.items():
        if any(word in text for word in words):
            return category
    return None


def _category_for_row(row: Transaction) -> tuple[str, float]:
    saved_category = (row.category or "").strip()
    rule_category, confidence = categorize_transaction_rule(row.description, row.transaction_type)
    if (
        saved_category
        and saved_category.lower() not in {"misc", "miscellaneous", "uncategorized", "transfers out"}
        and not (saved_category == "Food & Delivery" and rule_category == "Household Help")
    ):
        return saved_category, 1.0
    return rule_category, confidence


def _amount_hints_from_question(message: str) -> list[float]:
    hints: list[float] = []
    for match in re.finditer(r"\b(?:inr|rs\.?|₹)?\s*(\d+(?:\.\d+)?)\s*(cr|crore|l|lac|lakh|k|thousand)?\b", message.lower()):
        value = float(match.group(1))
        unit = match.group(2) or ""
        # Ignore years and tiny ordinals.
        if 1900 <= value <= 2100 and not unit:
            continue
        if unit in {"cr", "crore"}:
            value *= 1_00_00_000
        elif unit in {"l", "lac", "lakh"}:
            value *= 1_00_000
        elif unit in {"k", "thousand"}:
            value *= 1_000
        elif value < 100:
            continue
        hints.append(value)
    return hints


def _category_from_amount(message: str, summary: dict) -> str | None:
    hints = _amount_hints_from_question(message)
    if not hints:
        return None
    categories = summary.get("categories", [])
    for hint in hints:
        closest = None
        closest_delta = float("inf")
        for category in categories:
            total = float(category.get("total") or 0)
            delta = abs(total - hint)
            tolerance = max(total * 0.08, 2_500)
            if delta <= tolerance and delta < closest_delta:
                closest = category
                closest_delta = delta
        if closest:
            return str(closest["category"])
    return None


_PAYEE_STOPWORDS = {
    "about", "already", "amount", "analyze", "analyse", "around", "every", "have", "month", "months",
    "paid", "pay", "payee", "question", "salary", "salaries", "should", "spend", "spent", "usually", "which",
    "with", "what", "when", "where", "please", "house", "help", "household", "domestic", "maid", "cook", "driver",
    "any", "are", "cash", "last", "other", "recurring", "since", "the", "there", "transfer", "transfers",
}


def _message_tokens(message: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-zA-Z][a-zA-Z0-9]{2,}", message.lower())
        if token not in _PAYEE_STOPWORDS
    }


def _month_range(start_month: str, end_month: str) -> list[str]:
    start_year, start_num = [int(part) for part in start_month.split("-", 1)]
    end_year, end_num = [int(part) for part in end_month.split("-", 1)]
    months = []
    year, month = start_year, start_num
    while (year, month) <= (end_year, end_num):
        months.append(f"{year}-{month:02d}")
        month += 1
        if month == 13:
            year += 1
            month = 1
    return months


def _payee_detail(db: Session, message: str) -> dict | None:
    if _is_recurring_transfer_question(message):
        return None

    tokens = _message_tokens(message)
    if not tokens:
        return None

    rows = db.query(Transaction).filter(Transaction.transaction_type == "Debit").order_by(Transaction.date.asc()).all()
    merchant_rows: dict[str, list[Transaction]] = defaultdict(list)
    for row in rows:
        merchant = extract_merchant(row.description).strip()
        if merchant:
            merchant_rows[merchant].append(row)

    best_merchant = None
    best_score = 0
    for merchant in merchant_rows:
        merchant_tokens = set(re.findall(r"[a-zA-Z][a-zA-Z0-9]{2,}", merchant.lower()))
        score = len(tokens & merchant_tokens)
        if score > best_score:
            best_merchant = merchant
            best_score = score

    # Avoid treating generic category questions like "how much do I pay to house help"
    # as payee questions. A payee needs either a distinctive multi-token name or a
    # strong single-token merchant match.
    if not best_merchant or best_score == 0 or (best_score == 1 and len(tokens) < 2):
        return None

    matched_rows = merchant_rows[best_merchant]
    amounts = _amount_hints_from_question(message)
    target_amount = amounts[0] if amounts else None

    by_month: dict[str, dict] = defaultdict(lambda: {"total": 0.0, "count": 0, "transactions": [], "near_target": False})
    for row in matched_rows:
        month = row.date.strftime("%Y-%m")
        amount = float(row.amount or 0)
        category, confidence = _category_for_row(row)
        near_target = False
        if target_amount:
            tolerance = max(target_amount * 0.15, 1_000)
            near_target = abs(amount - target_amount) <= tolerance
        by_month[month]["total"] += amount
        by_month[month]["count"] += 1
        by_month[month]["near_target"] = by_month[month]["near_target"] or near_target
        by_month[month]["transactions"].append({
            "id": row.id,
            "date": row.date.isoformat(),
            "amount": round(amount, 2),
            "category": category,
            "confidence": round(confidence, 2),
            "description": row.description,
        })

    month_expr = func.strftime("%Y-%m", Transaction.date)
    imported_months = [
        row[0]
        for row in db.query(month_expr.label("month")).group_by(month_expr).order_by(month_expr).all()
        if row[0]
    ]
    full_months = _month_range(imported_months[0], imported_months[-1]) if imported_months else sorted(by_month)
    payment_months = []
    for month in sorted(by_month):
        bucket = by_month[month]
        target_total_match = False
        if target_amount:
            tolerance = max(target_amount * 0.15, 1_000)
            target_total_match = abs(bucket["total"] - target_amount) <= tolerance
        payment_months.append({
            "month": month,
            "total": round(bucket["total"], 2),
            "count": bucket["count"],
            "matches_target_amount": bool(bucket["near_target"] or target_total_match) if target_amount else True,
            "transactions": bucket["transactions"],
        })

    paid_set = {
        item["month"]
        for item in payment_months
        if item["matches_target_amount"] or not target_amount
    }
    missed_months = [month for month in full_months if month not in paid_set]
    categories: dict[str, float] = defaultdict(float)
    for row in matched_rows:
        category, _ = _category_for_row(row)
        categories[category] += float(row.amount or 0)

    return {
        "merchant": best_merchant,
        "target_amount": target_amount,
        "first_month": min(by_month) if by_month else None,
        "last_month": max(by_month) if by_month else None,
        "total": round(sum(float(row.amount or 0) for row in matched_rows), 2),
        "count": len(matched_rows),
        "months": payment_months,
        "paid_months": sorted(paid_set),
        "missed_months": missed_months,
        "categories": [
            {"category": category, "total": round(total, 2)}
            for category, total in sorted(categories.items(), key=lambda item: item[1], reverse=True)
        ],
    }


def _is_recurring_transfer_question(message: str) -> bool:
    text = message.lower()
    return (
        any(word in text for word in ["recurring", "repeat", "repeating", "monthly", "every month"])
        and any(word in text for word in ["transfer", "transfers", "payee", "payees", "cash"])
    )


def _months_back_from_question(message: str, default: int = 6) -> int:
    text = message.lower()
    match = re.search(r"\blast\s+(\d{1,2})\s+months?\b", text)
    if match:
        return max(1, min(int(match.group(1)), 24))
    match = re.search(r"\b(\d{1,2})\s+months?\b", text)
    if match:
        return max(1, min(int(match.group(1)), 24))
    return default


def _recurring_transfer_candidates(db: Session, message: str) -> dict | None:
    if not _is_recurring_transfer_question(message):
        return None

    lookback_months = _months_back_from_question(message)
    available_months = [
        row[0]
        for row in db.query(func.strftime("%Y-%m", Transaction.date).label("month"))
        .filter(Transaction.transaction_type == "Debit")
        .group_by("month")
        .order_by("month")
        .all()
        if row[0]
    ]
    if not available_months:
        return None

    target_months = available_months[-lookback_months:]
    rows = (
        db.query(Transaction)
        .filter(Transaction.transaction_type == "Debit")
        .filter(func.strftime("%Y-%m", Transaction.date).in_(target_months))
        .all()
    )

    buckets: dict[str, dict] = defaultdict(lambda: {"total": 0.0, "count": 0, "months": defaultdict(float), "categories": defaultdict(float)})
    for row in rows:
        category, _confidence = _category_for_row(row)
        merchant = extract_merchant(row.description)
        if not merchant or is_hidden_cashflow_category(category):
            continue
        text = f"{row.description or ''} {merchant}".lower()
        looks_like_transfer = (
            category in {"Transfers Out", "Household Help", "Rent & Housing", "Subscriptions", "Utilities & Bills"}
            or any(rail in text for rail in ["upi/p2a", "neft", "imps", "rtgs", "transfer"])
        )
        if not looks_like_transfer:
            continue
        amount = float(row.amount or 0)
        month = row.date.strftime("%Y-%m")
        bucket = buckets[merchant]
        bucket["total"] += amount
        bucket["count"] += 1
        bucket["months"][month] += amount
        bucket["categories"][category] += amount

    candidates = []
    for merchant, bucket in buckets.items():
        month_totals = dict(bucket["months"])
        active_months = sorted(month_totals)
        if len(active_months) < 2:
            continue
        totals = sorted(month_totals.values())
        median = totals[len(totals) // 2]
        category = max(bucket["categories"].items(), key=lambda item: item[1])[0]
        candidates.append({
            "merchant": merchant,
            "category": category,
            "active_months": len(active_months),
            "months": [{"month": month, "total": round(month_totals[month], 2)} for month in active_months],
            "total": round(bucket["total"], 2),
            "median_monthly": round(median, 2),
            "count": bucket["count"],
        })

    candidates.sort(key=lambda item: (item["active_months"], item["median_monthly"], item["total"]), reverse=True)
    return {
        "lookback_months": lookback_months,
        "months_scanned": target_months,
        "candidates": candidates[:12],
    }


def _category_month_history(
    db: Session,
    *,
    category: str | None,
    direction: str = "Debit",
) -> dict | None:
    if not category or is_hidden_cashflow_category(category):
        return None

    rows = db.query(Transaction).filter(Transaction.transaction_type == direction).order_by(Transaction.date.asc()).all()
    wanted = category.strip().lower()
    by_month: dict[str, dict] = defaultdict(lambda: {"total": 0.0, "count": 0, "merchants": defaultdict(float)})
    for row in rows:
        row_category, _confidence = _category_for_row(row)
        row_category_norm = row_category.lower()
        if wanted not in row_category_norm and row_category_norm not in wanted:
            continue
        month = row.date.strftime("%Y-%m")
        amount = float(row.amount or 0)
        merchant = extract_merchant(row.description)
        by_month[month]["total"] += amount
        by_month[month]["count"] += 1
        by_month[month]["merchants"][merchant] += amount

    if not by_month:
        return None

    months = []
    for month, bucket in sorted(by_month.items()):
        merchants = sorted(bucket["merchants"].items(), key=lambda item: item[1], reverse=True)
        months.append({
            "month": month,
            "total": round(bucket["total"], 2),
            "count": bucket["count"],
            "top_merchants": [
                {"merchant": merchant, "total": round(total, 2)}
                for merchant, total in merchants[:4]
            ],
        })

    totals = [item["total"] for item in months]
    return {
        "category": category,
        "months": months,
        "month_count": len(months),
        "average": round(sum(totals) / len(totals), 2),
        "latest": months[-1],
        "total": round(sum(totals), 2),
    }


def _category_summary(
    db: Session,
    *,
    direction: str = "Debit",
    month_year: str | None = None,
    limit: int = 12,
) -> dict:
    query = db.query(Transaction).filter(Transaction.transaction_type == direction)
    if month_year:
        query = query.filter(func.strftime("%Y-%m", Transaction.date) == month_year)
    rows = query.order_by(Transaction.amount.desc()).all()

    total = 0.0
    buckets: dict[str, dict] = defaultdict(lambda: {"total": 0.0, "count": 0, "merchants": defaultdict(float)})
    for row in rows:
        amount = float(row.amount or 0)
        category, _confidence = _category_for_row(row)
        if direction == "Debit" and is_hidden_cashflow_category(category):
            continue
        total += amount
        merchant = extract_merchant(row.description)
        buckets[category]["total"] += amount
        buckets[category]["count"] += 1
        buckets[category]["merchants"][merchant] += amount

    categories = []
    for category, bucket in buckets.items():
        merchants = sorted(bucket["merchants"].items(), key=lambda item: item[1], reverse=True)
        categories.append({
            "category": category,
            "total": round(bucket["total"], 2),
            "count": bucket["count"],
            "percentage": round((bucket["total"] / total) * 100, 1) if total else 0,
            "top_merchants": [
                {"merchant": merchant, "total": round(value, 2)}
                for merchant, value in merchants[:4]
            ],
        })
    categories.sort(key=lambda item: item["total"], reverse=True)
    return {
        "month": month_year,
        "direction": direction,
        "total": round(total, 2),
        "transaction_count": len(rows),
        "categories": categories[:limit],
    }


def _category_detail(
    db: Session,
    *,
    category: str | None,
    direction: str = "Debit",
    month_year: str | None = None,
    limit: int = 40,
) -> dict | None:
    if not category:
        return None
    if is_hidden_cashflow_category(category):
        return None

    query = db.query(Transaction).filter(Transaction.transaction_type == direction)
    if month_year:
        query = query.filter(func.strftime("%Y-%m", Transaction.date) == month_year)
    rows = query.order_by(Transaction.amount.desc(), Transaction.date.desc()).all()

    wanted = category.strip().lower()
    matched = []
    merchant_totals: dict[str, dict] = defaultdict(lambda: {"total": 0.0, "count": 0})
    confidence_sum = 0.0

    for row in rows:
        row_category, confidence = _category_for_row(row)
        if direction == "Debit" and is_hidden_cashflow_category(row_category):
            continue
        row_category_norm = row_category.lower()
        if wanted not in row_category_norm and row_category_norm not in wanted:
            continue
        amount = float(row.amount or 0)
        merchant = extract_merchant(row.description)
        merchant_totals[merchant]["total"] += amount
        merchant_totals[merchant]["count"] += 1
        confidence_sum += confidence
        matched.append({
            "id": row.id,
            "date": row.date.isoformat(),
            "merchant": merchant,
            "description": row.description,
            "amount": round(amount, 2),
            "category": row_category,
            "account_source": row.account_source,
            "confidence": round(confidence, 2),
        })

    if not matched:
        return None

    total = round(sum(item["amount"] for item in matched), 2)
    merchants = [
        {
            "merchant": merchant,
            "total": round(bucket["total"], 2),
            "count": bucket["count"],
            "percentage": round((bucket["total"] / total) * 100, 1) if total else 0,
        }
        for merchant, bucket in merchant_totals.items()
    ]
    merchants.sort(key=lambda item: item["total"], reverse=True)

    return {
        "category": matched[0]["category"],
        "month": month_year,
        "direction": direction,
        "total": total,
        "count": len(matched),
        "average": round(total / len(matched), 2) if matched else 0,
        "avg_confidence": round(confidence_sum / len(matched), 2) if matched else 0,
        "top_merchants": merchants[:15],
        "transactions": matched[:limit],
    }


def _asset_values_saved(db: Session) -> dict[str, float]:
    manual = {row.asset_type: float(row.value or 0) for row in db.query(ManualAsset).all()}
    mf_value = sum(float(row.value or 0) for row in db.query(MFHolding).all())
    stock_value = sum(
        float((row.current_price or row.avg_price or 0) * (row.quantity or 0))
        for row in db.query(StockHolding).all()
    )
    latest_gold_snapshot = (
        db.query(AssetSnapshot)
        .filter(AssetSnapshot.asset_type == "Gold")
        .order_by(AssetSnapshot.month_year.desc(), AssetSnapshot.updated_at.desc())
        .first()
    )
    gold_value = (
        float(latest_gold_snapshot.value or 0)
        if latest_gold_snapshot
        else manual.get("GOLD_GRAMS", 0) * 9000
    )
    return {
        "Cash / Bank": round(manual.get("BANK", 0), 2),
        "Mutual Funds": round(mf_value, 2),
        "Stocks": round(stock_value, 2),
        "Gold": round(gold_value, 2),
        "Real Estate": round(manual.get("REAL_ESTATE", 0), 2),
        "Fixed Deposits": round(manual.get("FD", 0), 2),
        "PPF": round(manual.get("PPF", 0), 2),
        "PF": round(manual.get("EPF", 0), 2),
        "NPS": round(manual.get("NPS", 0), 2),
    }


def _forecast_saved(db: Session, current_net_worth: float) -> dict:
    profile = build_finance_profile(db)
    return profile["forecast"]

    months = _latest_cashflow_months(db, 6)
    rows = []
    for month in months:
        income, all_debits = _month_income_expenses(db, month)
        _, true_expenses = _month_income_expenses(db, month, exclude_investments=True)
        rows.append((income, all_debits, true_expenses))
    months_with_data = sum(1 for income, all_debits, _ in rows if income > 0 or all_debits > 0)
    monthly_savings = max(sum(income - true_expenses for income, _, true_expenses in rows) / months_with_data, 0) if months_with_data else 0.0
    value = float(current_net_worth or 0)
    monthly_rate = 0.08 / 12
    points = [{"year": date.today().year, "value": round(value, 0)}]
    for month in range(1, 61):
        value = value * (1 + monthly_rate) + monthly_savings
        if month % 12 == 0:
            points.append({"year": date.today().year + month // 12, "value": round(value, 0)})
    return {
        "current_net_worth": round(current_net_worth, 0),
        "monthly_savings_assumed": round(monthly_savings, 0),
        "savings_basis": "income_minus_true_spend",
        "annual_return_pct": 8.0,
        "projection_years": 5,
        "data_points": points,
        "months_of_cashflow_data": months_with_data,
        "confidence": "high" if months_with_data >= 6 else "medium" if months_with_data >= 3 else "low",
    }


def _cashflow_trends_saved(db: Session, current_net_worth: float) -> dict:
    months = _latest_cashflow_months(db, 12)
    current_month = date.today().strftime("%Y-%m")
    rows = []
    for month in months:
        income, expenses = _month_income_expenses(db, month)
        rows.append({
            "month": month,
            "income": income,
            "expenses": expenses,
            "savings": round(income - expenses, 2),
            "net_worth": round(current_net_worth, 2) if month == current_month else None,
            "has_data": income > 0 or expenses > 0,
        })
    stats = db.query(
        func.count(Transaction.id),
        func.min(Transaction.date),
        func.max(Transaction.date),
    ).one()
    return {
        "months": rows,
        "total_transaction_count": int(stats[0] or 0),
        "earliest_transaction_date": stats[1].isoformat() if stats[1] else None,
        "latest_transaction_date": stats[2].isoformat() if stats[2] else None,
    }


def _recent_actionables(db: Session) -> list[dict]:
    rows = (
        db.query(Actionable)
        .filter(Actionable.status == "Pending")
        .order_by(Actionable.priority.asc(), Actionable.due_date.asc().nullslast(), Actionable.created_at.desc())
        .limit(8)
        .all()
    )
    return [
        {
            "task": row.task_description,
            "priority": row.priority,
            "due_date": row.due_date.isoformat() if row.due_date else None,
            "source": row.source,
            "subject": row.subject,
        }
        for row in rows
    ]


def _upcoming_bills(db: Session) -> list[dict]:
    rows = (
        db.query(Bill)
        .filter(Bill.is_paid == False)
        .order_by(Bill.due_date.asc())
        .limit(8)
        .all()
    )
    return [
        {
            "name": row.name,
            "amount": round(row.amount or 0, 2),
            "due_date": row.due_date.isoformat(),
            "recurring": bool(row.is_recurring),
        }
        for row in rows
    ]


def _priorities(db: Session) -> list[dict]:
    return [
        {"rank": row.rank, "text": row.text, "quadrant": row.eisenhower_quadrant}
        for row in db.query(Priority).order_by(Priority.rank.asc()).limit(8).all()
    ]


def _contacts(db: Session) -> list[dict]:
    today = date.today()
    contacts = []
    for row in db.query(PersonalCRM).all():
        days_since = (today - row.last_contact_date).days if row.last_contact_date else None
        overdue = days_since is not None and days_since > row.check_in_interval_days
        contacts.append({
            "name": row.contact_name,
            "relationship": row.relationship,
            "days_since_contact": days_since,
            "overdue": overdue,
        })
    return sorted(contacts, key=lambda item: item["days_since_contact"] or -1, reverse=True)[:8]


def _build_context(db: Session, message: str) -> tuple[dict, list[str]]:
    month_year = _normalise_month_from_question(message, db)

    asset_values = _asset_values_saved(db)
    total_net_worth = round(sum(asset_values.values()), 2)
    wealth_slices = [
        {
            "label": label,
            "value": round(value, 2),
            "percentage": round((value / total_net_worth) * 100, 1) if total_net_worth else 0,
        }
        for label, value in sorted(asset_values.items(), key=lambda item: item[1], reverse=True)
        if value > 0
    ]

    trends = _cashflow_trends_saved(db, total_net_worth)
    forecast = _forecast_saved(db, total_net_worth)
    month_expenses = _category_summary(db, direction="Debit", month_year=month_year)
    month_income = _category_summary(db, direction="Credit", month_year=month_year, limit=8)
    all_expenses = _category_summary(db, direction="Debit", limit=14)
    category_hint = _category_for_question(message) or _category_from_amount(message, month_expenses)
    category_detail = _category_detail(db, category=category_hint, direction="Debit", month_year=month_year)
    payee_detail = _payee_detail(db, message)
    category_history = _category_month_history(db, category=category_hint, direction="Debit")
    recurring_transfers = _recurring_transfer_candidates(db, message)

    coach = build_coach_overview(db)
    finance_profile = build_finance_profile(db)
    portfolio_agent = portfolio_agent_context(db)
    question_text = message.lower()
    scenario_context = None
    if "what if" in question_text or "scenario" in question_text or "increase sip" in question_text or "cut spend" in question_text:
        amount = (_amount_hints_from_question(message) or [0])[0]
        spend_cut = 10.0 if "cut" in question_text or "reduce" in question_text else 0.0
        scenario_context = build_scenario(
            db,
            monthly_extra_investment=amount if "sip" in question_text or "invest" in question_text else 0,
            spend_cut_pct=spend_cut,
        )

    context = {
        "as_of": date.today().isoformat(),
        "question_month": month_year,
        "category_hint": category_hint,
        "net_worth": {
            "total": round(total_net_worth, 2),
            "slices": wealth_slices,
            "counts": {
                "mutual_funds": db.query(MFHolding).count(),
                "stocks": db.query(StockHolding).count(),
                "manual_assets": db.query(ManualAsset).count(),
                "transactions": db.query(Transaction).count(),
            },
        },
        "cashflow_trends": trends,
        "forecast": forecast,
        "month_expenses": month_expenses,
        "month_income": month_income,
        "category_detail": category_detail,
        "payee_detail": payee_detail,
        "category_history": category_history,
        "recurring_transfers": recurring_transfers,
        "expense_categories_all_imported": all_expenses,
        "upcoming_bills": _upcoming_bills(db),
        "pending_actionables": _recent_actionables(db),
        "priorities": _priorities(db),
        "people_attention": _contacts(db),
        "categorisation": {
            "saved_rules": db.query(CategoryRule).count(),
            "ambiguous_buckets": [
                cat for cat in month_expenses["categories"] if cat["category"] in {"Transfers Out", "Miscellaneous"}
            ],
        },
        "financial_coach": compact_coach_context(coach),
        "planning": {
            "liabilities": finance_profile["liabilities"],
            "goals": finance_profile["goals"],
            "assumptions": finance_profile["assumptions"],
        },
        "portfolio_agent": portfolio_agent,
        "scenario": scenario_context,
    }

    data_used = [
        "Net worth and asset allocation",
        "Imported bank transactions",
        "Monthly income and expense categories",
        "Wealth forecast assumptions",
    ]
    if context["upcoming_bills"]:
        data_used.append("Upcoming bills")
    if context["pending_actionables"]:
        data_used.append("Gmail/manual actionables")
    if context["priorities"]:
        data_used.append("Top priorities")
    if context["people_attention"]:
        data_used.append("People check-ins")
    if context["categorisation"]["saved_rules"]:
        data_used.append("Saved category rules")
    if category_detail:
        data_used.append(f"{category_detail['category']} transaction drill-down")
    if payee_detail:
        data_used.append(f"{payee_detail['merchant']} payee history")
    if category_history:
        data_used.append(f"{category_history['category']} monthly history")
    if recurring_transfers:
        data_used.append("Recurring transfer scan")
    data_used.append("Personal CFO opportunity engine")
    if finance_profile["liabilities"]["count"]:
        data_used.append("Liabilities")
    if finance_profile["goals"]:
        data_used.append("Financial goals")
    if portfolio_agent:
        data_used.append("Portfolio Agent CIO brief and decision ledger")
    if scenario_context:
        data_used.append("Scenario simulation")
    return context, data_used


def _deterministic_answer(message: str, context: dict) -> str:
    expenses = context["month_expenses"]
    all_expenses = context["expense_categories_all_imported"]
    forecast = context["forecast"]
    net_worth = context["net_worth"]
    category_hint = context.get("category_hint")
    category_detail = context.get("category_detail")
    payee_detail = context.get("payee_detail")
    category_history = context.get("category_history")
    recurring_transfers = context.get("recurring_transfers")
    coach = context.get("financial_coach") or {}
    planning = context.get("planning") or {}
    portfolio_agent = context.get("portfolio_agent")
    question = message.lower()

    def category_line(item: dict) -> str:
        return f"{item['category']} {_money(item['total'])} ({item['percentage']}%)"

    def merchant_line(item: dict) -> str:
        merchants = item.get("top_merchants", [])[:3]
        if not merchants:
            return "no clear merchant detail"
        return ", ".join(f"{m['merchant']} {_money(m['total'])}" for m in merchants)

    def is_money_destination_question() -> bool:
        phrases = [
            "where is most",
            "where's most",
            "where my money",
            "money going",
            "where is my money",
            "overspending",
            "spending on",
            "spend on",
            "expense breakdown",
            "break down",
        ]
        return any(phrase in question for phrase in phrases)

    lines = []

    if portfolio_agent and any(term in question for term in ["portfolio agent", "cio", "stock", "stocks", "buy", "sell", "recommend", "kaynes", "dixon", "decision"]):
        latest = portfolio_agent.get("latest_run") or {}
        summary = latest.get("summary") or {}
        mode = "/".join(part for part in [latest.get("run_mode"), latest.get("data_mode")] if part) or "unknown mode"
        actions = portfolio_agent.get("action_plan") or []
        decisions = portfolio_agent.get("recent_decisions") or []
        lines.append(
            f"Latest Portfolio Agent report is {mode}, generated {latest.get('generated_at') or 'unknown time'}."
        )
        if summary:
            lines.append(
                "Portfolio health: "
                f"value {_money(summary.get('total_current_value') or 0)}, "
                f"P&L {_money(summary.get('total_pnl') or 0)} ({summary.get('total_pnl_pct') or 0}%), "
                f"estimated CAGR {summary.get('estimated_portfolio_cagr') or 'n/a'}% vs required {summary.get('required_annual_return_pct') or 'n/a'}%."
            )
        if latest.get("capital_growth_verdict"):
            lines.append(str(latest["capital_growth_verdict"]))
        if actions:
            lines.append(
                "Current action plan:\n"
                + "\n".join(
                    f"- {item['action']} ({item.get('timing') or 'timing n/a'}; decision {(item.get('decision') or {}).get('status', 'Review')})"
                    for item in actions[:5]
                )
            )
        if decisions:
            lines.append(
                "Recent decisions: "
                + "; ".join(f"{item['fingerprint']} -> {item['status']}" for item in decisions[:5])
            )
        if mode != "LIVE/LIVE":
            lines.append("This is not a LIVE/LIVE report, so treat it as a review artifact, not an execution prompt.")
        return "\n\n".join(lines)

    if recurring_transfers:
        candidates = recurring_transfers.get("candidates", [])
        months = recurring_transfers.get("months_scanned", [])
        if not candidates:
            return (
                f"I scanned the last {recurring_transfers['lookback_months']} imported month(s)"
                + (f" ({', '.join(months)})" if months else "")
                + " and did not find a debit transfer/payee recurring in 2 or more months."
            )
        lines.append(
            f"I scanned the last {recurring_transfers['lookback_months']} imported month(s)"
            + (f" ({', '.join(months)})" if months else "")
            + f" and found {len(candidates)} recurring transfer-like payee(s)."
        )
        lines.append(
            "Top recurring transfer/payee candidates:\n"
            + "\n".join(
                f"- {item['merchant']}: median {_money(item['median_monthly'])}/mo, "
                f"{item['active_months']} month(s), total {_money(item['total'])}, current category {item['category']}"
                for item in candidates[:10]
            )
        )
        unclear = [item for item in candidates if item["category"] in {"Transfers Out", "Miscellaneous"}]
        if unclear:
            lines.append(
                "Needs classification: "
                + "; ".join(f"{item['merchant']} ({_money(item['median_monthly'])}/mo)" for item in unclear[:6])
                + ". These are the rows most likely to be house help, rent, family support, services, or one-off transfers."
            )
        return "\n\n".join(lines)

    if payee_detail and any(word in question for word in ["paid", "pay", "salary", "salaries", "month", "months"]):
        months = payee_detail.get("months", [])
        paid_months = payee_detail.get("paid_months", [])
        target_amount = payee_detail.get("target_amount")
        if target_amount:
            lines.append(
                f"For {payee_detail['merchant']}, I found {len(paid_months)} month(s) with a payment around {_money(target_amount)}: "
                + (", ".join(paid_months) if paid_months else "none")
                + "."
            )
        else:
            lines.append(
                f"For {payee_detail['merchant']}, I found payments in {len(paid_months)} month(s): "
                + (", ".join(paid_months) if paid_months else "none")
                + "."
            )

        if months:
            lines.append(
                "Month detail:\n"
                + "\n".join(
                    f"- {item['month']}: {_money(item['total'])} across {item['count']} txn"
                    + (" target-like" if item.get("matches_target_amount") and target_amount else "")
                    for item in months[-14:]
                )
            )

        categories = payee_detail.get("categories", [])
        if categories:
            top_category = categories[0]["category"]
            if top_category.lower() in {"transfers out", "miscellaneous", "food & delivery"}:
                lines.append(
                    f"This payee is currently categorized as {top_category}. If this is salary/house help, recategorize this payee to Household Help once; the dashboard will then move every matching month out of the wrong bucket."
                )
            else:
                lines.append(f"Current category used by the dashboard: {top_category}.")

        missed = payee_detail.get("missed_months", [])
        if missed and target_amount:
            lines.append("Months without a target-sized payment in the imported range: " + ", ".join(missed[-12:]) + ".")
        return "\n\n".join(lines)

    if category_history and any(phrase in question for phrase in ["every month", "monthly", "per month", "each month", "month-wise", "month wise"]):
        latest = category_history["latest"]
        lines.append(
            f"{category_history['category']} averages {_money(category_history['average'])}/month across "
            f"{category_history['month_count']} imported month(s). Latest month {latest['month']} is {_money(latest['total'])}."
        )
        lines.append(
            "Month detail:\n"
            + "\n".join(
                f"- {item['month']}: {_money(item['total'])} across {item['count']} txn"
                + (
                    " | " + ", ".join(f"{m['merchant']} {_money(m['total'])}" for m in item.get("top_merchants", [])[:2])
                    if item.get("top_merchants")
                    else ""
                )
                for item in category_history["months"][-14:]
            )
        )
        return "\n\n".join(lines)

    if any(phrase in question for phrase in ["become wealthy", "become richer", "wealthier", "optimize", "optimise", "what should i change", "top actions", "personal cfo"]):
        metrics = coach.get("metrics", {})
        opportunities = coach.get("top_opportunities", [])
        lines.append(
            f"Your Personal CFO score is {coach.get('health_score', 'n/a')}/100 ({coach.get('health_band', 'unknown')})."
        )
        if metrics:
            lines.append(
                "The mirror: "
                f"net worth {coach_money(metrics.get('net_worth', 0))}, "
                f"true expenses {coach_money(metrics.get('true_expenses', 0))}, "
                f"investments/savings {coach_money(metrics.get('investment_outflow', 0))}, "
                f"unclear transfers {coach_money(metrics.get('unclear_transfers', 0))}, "
                f"wealth creation rate {metrics.get('wealth_creation_rate_pct', 0):.1f}%."
            )
        if opportunities:
            lines.append(
                "Highest ROI actions: "
                + "; ".join(
                    f"{item['title']} ({coach_money(item['impact_monthly'])}/mo impact)"
                    if item.get("impact_monthly")
                    else f"{item['title']} (risk/data quality)"
                    for item in opportunities[:5]
                )
                + "."
            )
        targets = coach.get("targets", [])
        if targets:
            lines.append(
                "Target math: "
                + "; ".join(
                    f"{target['label']} needs {coach_money(target['required_monthly_contribution'])}/mo"
                    for target in targets[:2]
                )
                + "."
            )
        gaps = coach.get("data_gaps", [])
        if gaps:
            lines.append("Clean this first: " + " ".join(gaps[:2]))
        return "\n\n".join(lines)

    if expenses["transaction_count"]:
        month_label = expenses["month"] or "the latest imported month"
        categories = expenses["categories"]

        if category_detail and any(word in question for word in ["breakdown", "break down", "full", "detail", "details", "list", "88k", "88.1k"]):
            total_expenses = float(expenses.get("total") or 0)
            category_pct = (category_detail["total"] / total_expenses * 100) if total_expenses else 0
            lines.append(
                f"Full breakdown of {category_detail['category']} for {month_label}: "
                f"{_money(category_detail['total'])} across {category_detail['count']} transactions "
                f"({category_pct:.1f}% of debit outflow)."
            )

            merchants = category_detail.get("top_merchants", [])
            if merchants:
                lines.append(
                    "Merchant/person split:\n"
                    + "\n".join(
                        f"- {item['merchant']}: {_money(item['total'])} ({item['percentage']}%, {item['count']} txn)"
                        for item in merchants[:12]
                    )
                )

            transactions = category_detail.get("transactions", [])
            if transactions:
                lines.append(
                    "Largest transactions:\n"
                    + "\n".join(
                        f"- {item['date']}: {item['merchant']} - {_money(item['amount'])} | {item['description'][:90]}"
                        for item in transactions[:20]
                    )
                )

            if category_detail["category"].lower() == "transfers out":
                lines.append(
                    "Important: Transfers Out is an ambiguity bucket. It usually means the bank narration shows a person/account transfer, "
                    "not the real purpose. Reclassify the recurring names once, and I will remember them as rent, house help, services, family transfer, etc."
                )
            return "\n\n".join(lines)

        if "month-end review" in question or "month review" in question:
            income_total = context["month_income"]["total"]
            savings = income_total - expenses["total"]
            lines.append(
                f"Month review for {month_label}: income {_money(income_total)}, expenses {_money(expenses['total'])}, savings {_money(savings)}."
            )
            if categories:
                lines.append("Top expense buckets: " + "; ".join(category_line(item) for item in categories[:4]) + ".")
            if context["categorisation"]["ambiguous_buckets"]:
                lines.append(
                    "Clean-up needed: "
                    + "; ".join(category_line(item) for item in context["categorisation"]["ambiguous_buckets"][:2])
                    + ". Use the monthly breakdown dropdowns to teach the app."
                )
            if context["pending_actionables"] or context["upcoming_bills"]:
                lines.append(
                    f"Open items: {len(context['pending_actionables'])} actionables and {len(context['upcoming_bills'])} bills are visible in the dashboard."
                )
            return "\n\n".join(lines)

        if "changed from last month" in question or "vs last month" in question or "previous month" in question:
            trend_months = context["cashflow_trends"]["months"]
            current = next((item for item in trend_months if item["month"] == month_label), trend_months[-1] if trend_months else None)
            previous = None
            if current:
                current_index = trend_months.index(current)
                if current_index > 0:
                    previous = trend_months[current_index - 1]
            if current and previous:
                exp_delta = current["expenses"] - previous["expenses"]
                inc_delta = current["income"] - previous["income"]
                lines.append(
                    f"From {previous['month']} to {current['month']}: expenses changed by {_money(exp_delta)} and income changed by {_money(inc_delta)}."
                )
                lines.append(
                    f"Current month savings is {_money(current['income'] - current['expenses'])}; previous month savings was {_money(previous['income'] - previous['expenses'])}."
                )
            else:
                lines.append("I need at least two imported months to compare month-on-month changes.")
            return "\n\n".join(lines)

        if "leak" in question or "save better" in question or "improve my savings" in question:
            controllable = [
                item for item in categories
                if item["category"] not in {"Investments & Savings", "Education & Child", "Taxes", "Insurance"}
            ]
            if controllable:
                lines.append(
                    "The first savings opportunities are: "
                    + "; ".join(category_line(item) for item in controllable[:4])
                    + "."
                )
                lines.append(f"Start with {controllable[0]['category']}: top entries are {merchant_line(controllable[0])}.")
            if context["categorisation"]["ambiguous_buckets"]:
                lines.append("Before making decisions, clean up ambiguous Transfers Out so household help, rent, and one-off transfers are separated.")
            return "\n\n".join(lines)

        if is_money_destination_question() and not category_hint:
            investment = next(
                (item for item in categories if item["category"].lower() == "investments & savings"),
                None,
            )
            consumption = [
                item for item in categories
                if item["category"].lower() not in {"investments & savings"}
            ]
            living_spend = [
                item for item in consumption
                if item["category"].lower() not in {"transfers out"}
            ]

            lines.append(
                f"For {month_label}, the biggest outflow is "
                f"{category_line(investment) if investment else category_line(categories[0])}."
            )

            if investment:
                lines.append(
                    "That looks like wealth movement, not day-to-day spending. "
                    f"Top entries: {merchant_line(investment)}."
                )

            if consumption:
                lines.append(
                    "Excluding investments/savings, the largest money destinations are: "
                    + "; ".join(category_line(item) for item in consumption[:4])
                    + "."
                )

            transfer = next((item for item in consumption if item["category"].lower() == "transfers out"), None)
            if transfer:
                lines.append(
                    f"The bucket to clean up first is Transfers Out: {_money(transfer['total'])}. "
                    f"Top entries: {merchant_line(transfer)}. Some of these may be household help, rent, services, or manual transfers, but the bank narration is not specific enough yet."
                )

            if living_spend:
                lines.append(
                    "Clear consumption spend is led by: "
                    + "; ".join(category_line(item) for item in living_spend[:3])
                    + "."
                )

            return "\n\n".join(lines)

        lines.append(
            f"For {month_label}, imported expenses total {_money(expenses['total'])} across {expenses['transaction_count']} transactions."
        )

        if category_hint:
            hint = category_hint.lower()
            matched = [
                item for item in categories
                if hint in item["category"].lower() or item["category"].lower() in hint
            ]
            if not matched:
                matched = [
                    item for item in all_expenses["categories"]
                    if hint in item["category"].lower() or item["category"].lower() in hint
                ]
            if matched:
                item = matched[0]
                merchants = ", ".join(
                    f"{m['merchant']} {_money(m['total'])}" for m in item.get("top_merchants", [])[:3]
                )
                lines.append(
                    f"{item['category']} is {_money(item['total'])} ({item['percentage']}%). Top entries: {merchants or 'not enough merchant detail'}."
                )
                if category_detail:
                    lines.append(
                        f"Ask for 'full breakdown of {item['category']}' to list all {category_detail['count']} transactions and merchant totals."
                    )
            else:
                lines.append(
                    f"I do not see a separate {category_hint} bucket in the imported transactions for this period. "
                    "It may be absent, or it may be sitting under Transfers Out if the bank narration is ambiguous."
                )
        else:
            top = categories[:4]
            if top:
                lines.append(
                    "Largest buckets: "
                    + "; ".join(category_line(item) for item in top)
                    + "."
                )
    else:
        lines.append("I do not yet have imported transactions for the requested month.")

    if "net worth" in question:
        liability_total = (planning.get("liabilities") or {}).get("total", 0)
        if liability_total:
            lines.append(
                f"Your current net worth in the dashboard is {_money(net_worth['total'])} after subtracting {_money(liability_total)} of liabilities."
            )
        else:
            lines.append(f"Your current net worth in the dashboard is {_money(net_worth['total'])}.")

    if "liabil" in question or "loan" in question or "debt" in question:
        liabilities = planning.get("liabilities") or {}
        if liabilities.get("count"):
            items = liabilities.get("items", [])[:5]
            lines.append(
                f"You have {_money(liabilities.get('total', 0))} in recorded liabilities and {_money(liabilities.get('monthly_emi', 0))}/month EMI."
            )
            lines.append("Top liabilities: " + "; ".join(f"{item['name']} {_money(item['outstanding_amount'])}" for item in items) + ".")
        else:
            lines.append("No liabilities are recorded yet, so net worth is currently an asset-only view. Add loans or card dues in the planning section for true net worth.")

    if "goal" in question or "target" in question:
        goals = planning.get("goals") or []
        if goals:
            lines.append(
                "Goals: "
                + "; ".join(
                    f"{goal['name']} gap {_money(goal['gap'])}, needs {_money(goal['required_monthly'])}/mo"
                    for goal in goals[:4]
                )
                + "."
            )
        else:
            lines.append("No financial goals are recorded yet. Add targets such as emergency fund, school corpus, house, or retirement so the app can judge whether your current path is enough.")

    if "forecast" in question or "projection" in question:
        savings = forecast.get("monthly_savings_assumed", 0)
        confidence = forecast.get("confidence", "low")
        income = forecast.get("monthly_income_assumed", 0)
        spend = forecast.get("monthly_true_expenses", 0)
        salary_growth = forecast.get("salary_growth_pct", 0)
        spend_inflation = forecast.get("spend_inflation_pct", 0)
        annual_return = forecast.get("annual_return_pct", 0)
        points = forecast.get("data_points") or []
        final = points[-1] if points else {}
        lines.append(
            f"The 5-year forecast starts from {_money(net_worth['total'])}, assumes {_money(income)}/month salary income, "
            f"{_money(spend)}/month true spend, {salary_growth}% salary growth, {spend_inflation}% spend inflation, "
            f"and {annual_return}% weighted asset return. Current investable surplus is {_money(savings)}/month. "
            f"Base 5-year net worth is {_money(final.get('base_net_worth', 0))}; MF step-up path is {_money(final.get('step_net_worth', 0))}. "
            f"Confidence: {confidence}."
        )

    if "what if" in question or "scenario" in question or "increase sip" in question or "cut spend" in question:
        scenario = context.get("scenario")
        if scenario:
            inputs = scenario.get("inputs", {})
            lines.append(
                f"Scenario result: 5-year net worth moves from {_money(scenario['base_final_net_worth'])} "
                f"to {_money(scenario['scenario_final_net_worth'])}, an incremental {_money(scenario['incremental_wealth'])}. "
                f"Inputs: extra investment {_money(inputs.get('monthly_extra_investment', 0))}/mo, "
                f"spend cut {inputs.get('spend_cut_pct', 0)}%, salary growth {inputs.get('salary_growth_pct', 0)}%."
            )

    if not lines:
        lines.append("I need a more specific question about spending, income, net worth, bills, priorities, or forecast.")

    return "\n\n".join(lines)


def _suggested_questions(context: dict) -> list[str]:
    month = context.get("question_month") or "last month"
    return [
        f"Break down my expenses for {month}",
        "Where am I overspending?",
        "How can I improve my savings rate?",
        "What needs my attention this week?",
    ]


def _should_use_exact_ledger_answer(message: str, context: dict) -> bool:
    question = message.lower()
    if context.get("recurring_transfers"):
        return True
    if context.get("payee_detail") and any(word in question for word in ["paid", "pay", "salary", "salaries", "month", "months"]):
        return True
    if context.get("category_history") and any(phrase in question for phrase in ["every month", "monthly", "per month", "each month", "month-wise", "month wise"]):
        return True
    if not context.get("category_detail"):
        return False
    exact_words = ["breakdown", "break down", "full", "detail", "details", "list", "transactions", "entries"]
    return any(word in question for word in exact_words) or bool(_amount_hints_from_question(question))


def _build_prompt(message: str, history: list[ChatMessage], context: dict) -> str:
    compact_history = [
        {"role": item.role, "content": item.content[:700]}
        for item in history[-6:]
    ]
    compact_context = {
        "as_of": context["as_of"],
        "question_month": context["question_month"],
        "category_hint": context["category_hint"],
        "net_worth": {
            "total": context["net_worth"]["total"],
            "top_slices": context["net_worth"]["slices"][:8],
            "counts": context["net_worth"]["counts"],
        },
        "cashflow_trends": {
            "months": context["cashflow_trends"]["months"][-12:],
            "transaction_count": context["cashflow_trends"]["total_transaction_count"],
            "period": [
                context["cashflow_trends"]["earliest_transaction_date"],
                context["cashflow_trends"]["latest_transaction_date"],
            ],
        },
        "forecast": context["forecast"],
        "month_expenses": {
            **context["month_expenses"],
            "categories": context["month_expenses"]["categories"][:10],
        },
        "category_detail": (
            {
                **context["category_detail"],
                "top_merchants": context["category_detail"]["top_merchants"][:12],
                "transactions": context["category_detail"]["transactions"][:25],
            }
            if context.get("category_detail")
            else None
        ),
        "payee_detail": (
            {
                **context["payee_detail"],
                "months": context["payee_detail"]["months"][-14:],
                "missed_months": context["payee_detail"]["missed_months"][-14:],
            }
            if context.get("payee_detail")
            else None
        ),
        "category_history": (
            {
                **context["category_history"],
                "months": context["category_history"]["months"][-14:],
            }
            if context.get("category_history")
            else None
        ),
        "recurring_transfers": context.get("recurring_transfers"),
        "month_income": {
            **context["month_income"],
            "categories": context["month_income"]["categories"][:6],
        },
        "upcoming_bills": context["upcoming_bills"][:6],
        "pending_actionables": context["pending_actionables"][:6],
        "priorities": context["priorities"][:6],
        "people_attention": context["people_attention"][:4],
        "categorisation": context["categorisation"],
        "financial_coach": context["financial_coach"],
        "planning": context["planning"],
        "portfolio_agent": context.get("portfolio_agent"),
        "scenario": context["scenario"],
    }
    facts = json.dumps(compact_context, ensure_ascii=True, indent=2, default=str)
    return f"""You are the Life Dashboard assistant for one private user.

Answer the user's question using ONLY the FACTS JSON below. If a fact is missing, say exactly what is missing and how to add it.

Style:
- Be direct, practical, and concise.
- Use INR notation.
- Prefer numbers over vague advice.
- Answer the actual question first, then add supporting detail.
- For expense questions, mention category totals and the biggest merchants where available.
- If category_detail exists, use it to answer full breakdown/detail questions with merchant split and largest transactions.
- If payee_detail exists, answer exact payee/month/payment-status questions from payee_detail before giving broader category advice.
- If category_history exists, use it for category monthly run-rate questions.
- Distinguish investments/savings transfers from true consumption spend.
- Cash Withdrawal transactions are intentionally hidden from expense totals, categories, and recommendations.
- If a bucket is ambiguous, say so and name the entries that need recategorisation.
- For savings advice, separate what is certain from what is a suggestion.
- Do not invent transactions, balances, bills, emails, or news.
- Do not claim to be a financial advisor or guarantee returns.
- If the user asks about health, legal, tax, or investments, give high-level operational guidance and suggest professional review for decisions.
- For wealth-building questions, use financial_coach.top_opportunities first and show expected monthly/annual impact when available.
- For goal, debt, liability, or scenario questions, use planning and scenario facts instead of generic advice.
- For stock recommendation, portfolio health, CIO brief, buy/sell, and decision-ledger questions, use portfolio_agent first. Always say when its latest report is MOCK/DRY_RUN instead of LIVE.

RECENT CHAT:
{json.dumps(compact_history, ensure_ascii=True)}

FACTS:
{facts}

USER QUESTION:
{message}

ANSWER:"""


async def _select_provider() -> dict:
    """Choose the best available model without sending data to cloud unless a key exists."""
    mode = ASSISTANT_PROVIDER
    has_openai = bool(os.getenv("OPENAI_API_KEY"))
    has_anthropic = bool(os.getenv("ANTHROPIC_API_KEY"))
    ollama = await ollama_status()
    available = ollama.get("available", [])
    local_model = ASSISTANT_LOCAL_MODEL
    if local_model not in available and available:
        local_model = next((model for model in available if "gemma" in model.lower()), available[0])

    if mode in {"openai", "premium"} and has_openai:
        return {"provider": "openai", "model": OPENAI_MODEL, "online": True, "ollama": ollama}
    if mode == "anthropic" and has_anthropic:
        return {"provider": "anthropic", "model": ANTHROPIC_MODEL, "online": True, "ollama": ollama}
    if mode in {"ollama", "local"} and ollama.get("online"):
        return {"provider": "ollama", "model": local_model, "online": True, "ollama": ollama}
    if mode == "fast":
        return {"provider": "deterministic", "model": None, "online": True, "ollama": ollama}

    if has_openai:
        return {"provider": "openai", "model": OPENAI_MODEL, "online": True, "ollama": ollama}
    if has_anthropic:
        return {"provider": "anthropic", "model": ANTHROPIC_MODEL, "online": True, "ollama": ollama}
    return {"provider": "deterministic", "model": None, "online": True, "ollama": ollama}


def _provider_error_message(exc: Exception) -> str:
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return "OpenAI status check timed out."
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status == 429:
            return "OpenAI returned 429 Too Many Requests. Check API billing/credits, quota, or rate limits."
        if status == 401:
            return "OpenAI returned 401 Unauthorized. Check the API key."
        if status == 403:
            return "OpenAI returned 403 Forbidden. Check project/model access."
        return f"OpenAI returned HTTP {status}."
    return str(exc)[:240]


async def _openai_status(force: bool = False) -> dict:
    configured = bool(os.getenv("OPENAI_API_KEY"))
    if not configured:
        return {
            "configured": False,
            "working": False,
            "model": OPENAI_MODEL,
            "status": "missing_key",
            "message": "OPENAI_API_KEY is not set.",
            "next_step": "Add a valid OpenAI API key in backend/.env if you want premium cloud answers.",
        }

    now = time.time()
    cached = _OPENAI_STATUS_CACHE.get("status")
    if cached and not force and now - float(_OPENAI_STATUS_CACHE.get("ts") or 0) < OPENAI_STATUS_CACHE_SECONDS:
        return dict(cached)

    try:
        text = await asyncio.wait_for(
            generate_openai_text(
                "Reply with exactly: ok",
                max_tokens=16,
                model=OPENAI_MODEL,
                reasoning_effort="low",
            ),
            timeout=OPENAI_STATUS_TIMEOUT_SECONDS,
        )
        status = {
            "configured": True,
            "working": True,
            "model": OPENAI_MODEL,
            "status": "ok",
            "message": "OpenAI responded successfully.",
            "reply_preview": text[:80],
            "next_step": None,
        }
    except Exception as exc:
        message = _provider_error_message(exc)
        status = {
            "configured": True,
            "working": False,
            "model": OPENAI_MODEL,
            "status": "unavailable",
            "message": message,
            "next_step": (
                "Open the OpenAI platform billing/usage page, add credits or raise quota, then restart or refresh the backend."
                if "429" in message
                else "Fix the OpenAI API configuration in backend/.env, then restart or refresh the backend."
            ),
        }
    _OPENAI_STATUS_CACHE["ts"] = now
    _OPENAI_STATUS_CACHE["status"] = status
    return status


def _local_model(ollama: dict) -> str | None:
    available = ollama.get("available", [])
    if ASSISTANT_LOCAL_MODEL in available:
        return ASSISTANT_LOCAL_MODEL
    if available:
        return next((model for model in available if "llama3.2" in model.lower()), available[0])
    return None


async def _runtime_status() -> dict:
    ollama = await ollama_status()
    openai = await _openai_status()
    has_anthropic = bool(os.getenv("ANTHROPIC_API_KEY"))
    local_model = _local_model(ollama)
    if openai["working"]:
        active = {"provider": "openai", "model": OPENAI_MODEL, "enabled": True}
    elif has_anthropic:
        active = {"provider": "anthropic", "model": ANTHROPIC_MODEL, "enabled": True}
    elif ollama.get("online") and local_model:
        active = {"provider": "ollama", "model": local_model, "enabled": True}
    else:
        active = {"provider": "deterministic", "model": None, "enabled": False}
    return {
        **active,
        "mode": ASSISTANT_PROVIDER,
        "local_preferred_model": ASSISTANT_LOCAL_MODEL,
        "openai": openai,
        "anthropic": {
            "configured": has_anthropic,
            "model": ANTHROPIC_MODEL,
            "working": None,
            "status": "configured_not_probed" if has_anthropic else "missing_key",
        },
        "ollama": ollama,
        "online": active["provider"] != "deterministic",
        "model_present": bool(local_model) if active["provider"] == "ollama" else active["provider"] != "deterministic",
        "available_local_models": ollama.get("available", []),
        "fallback_available": True,
    }


async def _provider_candidates() -> list[dict]:
    status = await _runtime_status()
    ollama = status["ollama"]
    local_model = _local_model(ollama)
    has_anthropic = bool(os.getenv("ANTHROPIC_API_KEY"))
    candidates: list[dict] = []

    def add(provider: str, model: str | None) -> None:
        if not any(item["provider"] == provider and item.get("model") == model for item in candidates):
            candidates.append({"provider": provider, "model": model})

    mode = ASSISTANT_PROVIDER
    if mode in {"openai", "premium"}:
        add("openai", OPENAI_MODEL)
    elif mode in {"anthropic", "claude"} and has_anthropic:
        add("anthropic", ANTHROPIC_MODEL)
    elif mode in {"ollama", "local"} and local_model:
        add("ollama", local_model)
    elif mode == "fast":
        return [{"provider": "deterministic", "model": None}]
    else:
        if status["openai"]["working"]:
            add("openai", OPENAI_MODEL)
        elif bool(os.getenv("OPENAI_API_KEY")) and status["openai"]["status"] != "unavailable":
            add("openai", OPENAI_MODEL)
        if has_anthropic:
            add("anthropic", ANTHROPIC_MODEL)
        if local_model:
            add("ollama", local_model)

    if local_model:
        add("ollama", local_model)
    add("deterministic", None)
    return candidates


async def _generate_smart_answer(prompt: str, selected: dict) -> str:
    provider = selected["provider"]
    model = selected.get("model")
    if provider == "openai":
        return await generate_openai_text(prompt, max_tokens=900, model=model, reasoning_effort="low")
    if provider == "anthropic":
        return await generate_anthropic_text(prompt, max_tokens=900, model=model)
    if provider == "ollama":
        return await generate_text(prompt, max_tokens=900, temperature=0.2, model=model)
    raise RuntimeError("No LLM provider selected")


@router.get("/status")
async def assistant_status():
    return await _runtime_status()


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, db: Session = Depends(get_db)):
    context, data_used = _build_context(db, request.message)
    suggested = _suggested_questions(context)

    if _should_use_exact_ledger_answer(request.message, context):
        return ChatResponse(
            answer=_deterministic_answer(request.message, context),
            provider="ledger",
            model=None,
            grounded=True,
            data_used=data_used,
            suggested_questions=suggested,
            fallback=False,
        )

    prompt = _build_prompt(request.message, request.history, context)

    for selected in await _provider_candidates():
        if selected["provider"] == "deterministic":
            continue
        try:
            answer = (
                await asyncio.wait_for(
                    _generate_smart_answer(prompt, selected),
                    timeout=ASSISTANT_LLM_TIMEOUT_SECONDS,
                )
            ).strip()
            if answer:
                return ChatResponse(
                    answer=answer,
                    provider=selected["provider"],
                    model=selected["model"],
                    grounded=True,
                    data_used=data_used,
                    suggested_questions=suggested,
                    fallback=False,
                )
        except (httpx.HTTPError, TimeoutError, asyncio.TimeoutError):
            if selected["provider"] == "openai":
                _OPENAI_STATUS_CACHE["ts"] = time.time()
                _OPENAI_STATUS_CACHE["status"] = {
                    "configured": True,
                    "working": False,
                    "model": OPENAI_MODEL,
                    "status": "unavailable",
                    "message": "OpenAI failed during chat. Check billing/credits, quota, rate limits, or key access.",
                    "next_step": "Open the OpenAI platform billing/usage page, then retry after credits/quota are available.",
                }
            continue

    return ChatResponse(
        answer=_deterministic_answer(request.message, context),
        provider="deterministic",
        model=None,
        grounded=True,
        data_used=data_used,
        suggested_questions=suggested,
        fallback=True,
    )
