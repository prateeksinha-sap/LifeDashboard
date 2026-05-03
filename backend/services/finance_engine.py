from __future__ import annotations

import math
import os
from collections import defaultdict
from datetime import date
from statistics import median
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.models import (
    CategoryRule,
    FinancialGoal,
    Liability,
    ManualAsset,
    MFHolding,
    StockHolding,
    Transaction,
)
from services.cashflow_rules import (
    INVESTMENT_CATEGORIES,
    TRANSFER_CATEGORIES,
    is_hidden_cashflow_category,
)
from services.transaction_categorizer import categorize_transaction_rule, extract_merchant

load_dotenv()


FIXED_OBLIGATION_CATEGORIES = {
    "Education & Child",
    "EMI & Loans",
    "Insurance",
    "Rent & Housing",
    "Utilities & Bills",
}
CONTROLLABLE_CATEGORIES = {
    "Food & Delivery",
    "Shopping",
    "Travel & Transport",
    "Fuel & Vehicle",
    "Subscriptions",
    "Entertainment",
    "Alcohol",
    "Groceries",
}
MUTUAL_FUND_INVESTMENT_KEYWORDS = (
    "sip",
    "mutual fund",
    "mf utility",
    "mfutility",
    "mf util",
    "mf/",
    "cams",
    "kfin",
    "kfintech",
    "amfi",
    "amc",
    "indian clearing corp",
    "iccl",
    "groww",
    "coin",
)
DEBT_MF_KEYWORDS = (
    "ultra short",
    "short duration",
    "short term fund",
    "liquid",
    "money market",
    "overnight",
    "low duration",
    "floater",
    "floating rate",
    "debt",
    "bond",
    "gilt",
    "credit risk",
    "arbitrage",
    "savings fund",
    "conservative",
)


DEFAULT_RETURN_RATES = {
    "cash": 3.0,
    "equity": 11.0,
    "debt": 6.5,
    "mf_equity": 11.0,
    "mf_debt": 6.5,
    "stocks": 11.0,
    "gold": 6.0,
    "real_estate": 6.0,
    "fd": 6.5,
    "epf": 8.15,
    "ppf": 7.1,
    "nps": 9.0,
    "other": 6.0,
}


def safe_float(value: Any) -> float:
    try:
        number = float(value or 0)
        return 0.0 if math.isnan(number) or math.isinf(number) else number
    except (TypeError, ValueError):
        return 0.0


def pct(numerator: float, denominator: float) -> float:
    return round((numerator / denominator) * 100, 1) if denominator else 0.0


def money(value: float) -> str:
    sign = "-" if value < 0 else ""
    amount = abs(float(value or 0))
    if amount >= 1_00_00_000:
        return f"{sign}INR {amount / 1_00_00_000:.2f}Cr"
    if amount >= 1_00_000:
        return f"{sign}INR {amount / 1_00_000:.1f}L"
    if amount >= 1_000:
        return f"{sign}INR {amount / 1_000:.1f}K"
    return f"{sign}INR {amount:,.0f}"


def _env_float(name: str, default: float) -> float:
    return safe_float(os.getenv(name)) or default


def finance_assumptions(step_up_pct: float = 10.0) -> dict[str, Any]:
    monthly_salary = (
        safe_float(os.getenv("USER_MONTHLY_SALARY_INR"))
        or safe_float(os.getenv("MONTHLY_SALARY_INR"))
        or 2_18_000.0
    )
    salary_growth_pct = max(_env_float("SALARY_GROWTH_PCT", 5.0), 5.0)
    return {
        "monthly_salary_inr": round(monthly_salary, 2),
        "salary_growth_pct": round(salary_growth_pct, 2),
        "spend_inflation_pct": round(_env_float("SPEND_INFLATION_PCT", 6.0), 2),
        "default_mf_step_up_pct": round(max(0.0, min(float(step_up_pct or 0), 100.0)), 2),
        "projection_years": 5,
        "return_rates_pct": {
            key: round(_env_float(f"RETURN_{key.upper()}_PCT", value), 2)
            for key, value in DEFAULT_RETURN_RATES.items()
        },
        "gold_price_inr_per_gram": round(_env_float("GOLD_PRICE_INR_PER_GRAM", 9000.0), 2),
    }


def _manual_assets(db: Session) -> dict[str, float]:
    return {row.asset_type: safe_float(row.value) for row in db.query(ManualAsset).all()}


def _is_debt_mf(scheme_name: str) -> bool:
    name = str(scheme_name or "").lower()
    return any(keyword in name for keyword in DEBT_MF_KEYWORDS)


def asset_values(db: Session, assumptions: dict[str, Any] | None = None) -> dict[str, float]:
    assumptions = assumptions or finance_assumptions()
    manual = _manual_assets(db)
    mf_value = sum(safe_float(row.value) for row in db.query(MFHolding).all())
    stock_value = sum(
        safe_float(row.quantity) * (safe_float(row.current_price) or safe_float(row.avg_price))
        for row in db.query(StockHolding).all()
    )
    gold_value = manual.get("GOLD", 0.0)
    if gold_value <= 0:
        gold_value = manual.get("GOLD_GRAMS", 0.0) * safe_float(assumptions["gold_price_inr_per_gram"])
    return {
        "Cash / Bank": round(manual.get("BANK", 0.0), 2),
        "Mutual Funds": round(mf_value, 2),
        "Stocks": round(stock_value, 2),
        "Gold": round(gold_value, 2),
        "Real Estate": round(manual.get("REAL_ESTATE", 0.0), 2),
        "Fixed Deposits": round(manual.get("FD", 0.0), 2),
        "PPF": round(manual.get("PPF", 0.0), 2),
        "PF": round(manual.get("EPF", 0.0), 2),
        "NPS": round(manual.get("NPS", 0.0), 2),
    }


def liability_values(db: Session) -> dict[str, Any]:
    rows = db.query(Liability).all()
    total = round(sum(safe_float(row.outstanding_amount) for row in rows), 2)
    emi_total = round(sum(safe_float(row.emi_amount) for row in rows), 2)
    return {
        "total": total,
        "monthly_emi": emi_total,
        "count": len(rows),
        "items": [
            {
                "id": row.id,
                "name": row.name,
                "type": row.liability_type,
                "outstanding_amount": round(safe_float(row.outstanding_amount), 2),
                "interest_rate_pct": safe_float(row.interest_rate_pct),
                "emi_amount": round(safe_float(row.emi_amount), 2),
                "due_day": row.due_day,
                "notes": row.notes,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            }
            for row in rows
        ],
    }


def financial_goals(db: Session, current_net_worth: float, monthly_surplus: float) -> list[dict[str, Any]]:
    today = date.today()
    goals = []
    for row in db.query(FinancialGoal).order_by(FinancialGoal.target_date.asc().nullslast(), FinancialGoal.id.asc()).all():
        current_amount = safe_float(row.current_amount)
        target_amount = safe_float(row.target_amount)
        gap = max(target_amount - current_amount, 0.0)
        months_left = None
        required_monthly = 0.0
        if row.target_date:
            months_left = max((row.target_date.year - today.year) * 12 + row.target_date.month - today.month, 1)
            required_monthly = round(gap / months_left, 2) if gap else 0.0
        on_track = required_monthly <= max(monthly_surplus, 0) if months_left else None
        goals.append({
            "id": row.id,
            "name": row.name,
            "target_amount": round(target_amount, 2),
            "target_date": row.target_date.isoformat() if row.target_date else None,
            "current_amount": round(current_amount, 2),
            "priority": row.priority,
            "notes": row.notes,
            "gap": round(gap, 2),
            "months_left": months_left,
            "required_monthly": required_monthly,
            "on_track": on_track,
            "progress_pct": pct(current_amount, target_amount),
        })
    return goals


def asset_return_breakdown(db: Session, assumptions: dict[str, Any], assets: dict[str, float]) -> dict[str, Any]:
    rates = assumptions["return_rates_pct"]
    mf_equity = 0.0
    mf_debt = 0.0
    for row in db.query(MFHolding).all():
        if _is_debt_mf(row.scheme_name):
            mf_debt += safe_float(row.value)
        else:
            mf_equity += safe_float(row.value)

    components = [
        {"label": "MF equity", "value": round(mf_equity, 2), "annual_return_pct": rates["mf_equity"]},
        {"label": "MF debt", "value": round(mf_debt, 2), "annual_return_pct": rates["mf_debt"]},
        {"label": "Stocks", "value": assets.get("Stocks", 0), "annual_return_pct": rates["stocks"]},
        {"label": "Gold", "value": assets.get("Gold", 0), "annual_return_pct": rates["gold"]},
        {"label": "Real Estate", "value": assets.get("Real Estate", 0), "annual_return_pct": rates["real_estate"]},
        {"label": "Fixed Deposits", "value": assets.get("Fixed Deposits", 0), "annual_return_pct": rates["fd"]},
        {"label": "PPF", "value": assets.get("PPF", 0), "annual_return_pct": rates["ppf"]},
        {"label": "PF", "value": assets.get("PF", 0), "annual_return_pct": rates["epf"]},
        {"label": "NPS", "value": assets.get("NPS", 0), "annual_return_pct": rates["nps"]},
    ]
    invested_total = sum(item["value"] for item in components)
    weighted_return = (
        sum(item["value"] * item["annual_return_pct"] for item in components) / invested_total
        if invested_total
        else rates["equity"]
    )
    return {
        "components": [item for item in components if item["value"] > 0],
        "weighted_invested_return_pct": round(weighted_return, 2),
        "cash_return_pct": rates["cash"],
        "mf_new_money_return_pct": rates["mf_equity"],
    }


def _month_range(end_month: str, count: int) -> list[str]:
    year, month = [int(part) for part in end_month.split("-")]
    months: list[str] = []
    for index in range(count - 1, -1, -1):
        y = year
        m = month - index
        while m <= 0:
            m += 12
            y -= 1
        months.append(f"{y}-{m:02d}")
    return months


def latest_transaction_month(db: Session) -> str | None:
    row = db.query(func.max(func.strftime("%Y-%m", Transaction.date))).scalar()
    return str(row) if row else None


def latest_cashflow_months(db: Session, limit: int = 7) -> list[str]:
    month_expr = func.strftime("%Y-%m", Transaction.date)
    rows = (
        db.query(month_expr.label("month"))
        .group_by(month_expr)
        .order_by(month_expr.desc())
        .limit(limit)
        .all()
    )
    return [row[0] for row in reversed(rows) if row[0]]


def _rule_category(db: Session, row: Transaction) -> tuple[str | None, float]:
    merchant = extract_merchant(row.description).lower()
    description = str(row.description or "").lower()
    rules = (
        db.query(CategoryRule)
        .filter(CategoryRule.transaction_type == row.transaction_type)
        .order_by(CategoryRule.updated_at.desc())
        .all()
    )
    for rule in rules:
        pattern = str(rule.pattern or "").lower().strip()
        if pattern and (pattern in merchant or pattern in description):
            return str(rule.category), 1.0
    return None, 0.0


def transaction_category(db: Session, row: Transaction) -> tuple[str, float, bool]:
    rule_category, rule_confidence = _rule_category(db, row)
    if rule_category:
        return rule_category, rule_confidence, False

    saved = str(row.category or "").strip()
    if saved and saved.lower() not in {"misc", "miscellaneous", "uncategorized"}:
        return saved, 1.0, False

    category, confidence = categorize_transaction_rule(row.description, row.transaction_type)
    return category, confidence, True


def is_mutual_fund_investment(row: Transaction, category: str) -> bool:
    if category not in INVESTMENT_CATEGORIES:
        return False
    text = f"{row.description or ''} {extract_merchant(row.description)}".lower()
    return any(keyword in text for keyword in MUTUAL_FUND_INVESTMENT_KEYWORDS)


def _month_rows(db: Session, month_year: str) -> list[Transaction]:
    return (
        db.query(Transaction)
        .filter(func.strftime("%Y-%m", Transaction.date) == month_year)
        .order_by(Transaction.amount.desc(), Transaction.date.desc())
        .all()
    )


def month_cashflow(db: Session, month_year: str) -> dict[str, Any]:
    rows = _month_rows(db, month_year)
    income = 0.0
    salary_income = 0.0
    debit_total = 0.0
    hidden_debit_total = 0.0
    investment_outflow = 0.0
    mf_investment = 0.0
    other_investment = 0.0
    unclear_transfers = 0.0
    fixed_obligations = 0.0
    controllable = 0.0
    derived_count = 0
    categories: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"total": 0.0, "count": 0, "merchants": defaultdict(float)}
    )

    for row in rows:
        amount = round(safe_float(row.amount), 2)
        category, _confidence, derived = transaction_category(db, row)
        derived_count += 1 if derived else 0

        if row.transaction_type == "Credit":
            income += amount
            if category == "Salary":
                salary_income += amount
            continue

        debit_total += amount
        merchant = extract_merchant(row.description)
        if is_hidden_cashflow_category(category):
            hidden_debit_total += amount
            continue

        categories[category]["total"] += amount
        categories[category]["count"] += 1
        categories[category]["merchants"][merchant] += amount

        if category in INVESTMENT_CATEGORIES:
            investment_outflow += amount
            if is_mutual_fund_investment(row, category):
                mf_investment += amount
            else:
                other_investment += amount
        if category in TRANSFER_CATEGORIES:
            unclear_transfers += amount
        if category in FIXED_OBLIGATION_CATEGORIES:
            fixed_obligations += amount
        if category in CONTROLLABLE_CATEGORIES:
            controllable += amount

    visible_debit_total = max(debit_total - hidden_debit_total, 0.0)
    category_list = []
    for category, bucket in categories.items():
        total = round(bucket["total"], 2)
        merchants = sorted(bucket["merchants"].items(), key=lambda item: item[1], reverse=True)
        category_list.append({
            "category": category,
            "total": total,
            "count": bucket["count"],
            "percentage_of_debits": pct(total, visible_debit_total),
            "top_merchants": [
                {"merchant": merchant, "total": round(value, 2)}
                for merchant, value in merchants[:4]
            ],
        })
    category_list.sort(key=lambda item: item["total"], reverse=True)

    true_expenses = max(visible_debit_total - investment_outflow - unclear_transfers, 0)
    bank_surplus = income - visible_debit_total
    lifestyle_surplus = income - true_expenses
    wealth_creation = max(income - true_expenses, 0)

    return {
        "month": month_year,
        "income": round(income, 2),
        "salary_income": round(salary_income, 2),
        "debits_total": round(visible_debit_total, 2),
        "true_expenses": round(true_expenses, 2),
        "investment_outflow": round(investment_outflow, 2),
        "mf_investment": round(mf_investment, 2),
        "other_investment": round(other_investment, 2),
        "unclear_transfers": round(unclear_transfers, 2),
        "fixed_obligations": round(fixed_obligations, 2),
        "controllable_spend": round(controllable, 2),
        "bank_surplus": round(bank_surplus, 2),
        "lifestyle_surplus": round(lifestyle_surplus, 2),
        "wealth_creation": round(wealth_creation, 2),
        "true_expense_rate_pct": pct(true_expenses, income),
        "bank_savings_rate_pct": pct(bank_surplus, income),
        "wealth_creation_rate_pct": pct(wealth_creation, income),
        "transaction_count": len(rows),
        "derived_category_count": derived_count,
        "categories": category_list,
    }


def trailing_cashflow(db: Session, latest_month: str | None = None, count: int = 6) -> list[dict[str, Any]]:
    latest = latest_month or latest_transaction_month(db)
    if not latest:
        return []
    return [month_cashflow(db, month) for month in _month_range(latest, count)]


def _median_positive(values: list[float]) -> float:
    positive = [safe_float(value) for value in values if safe_float(value) > 0]
    return float(median(positive)) if positive else 0.0


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def expense_intelligence(db: Session, months: list[str]) -> dict[str, Any]:
    if not months:
        return {"recurring_merchants": [], "category_deltas": []}

    merchant_months: dict[tuple[str, str], dict[str, Any]] = defaultdict(
        lambda: {"months": set(), "total": 0.0, "count": 0}
    )
    category_by_month: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    rows = (
        db.query(Transaction)
        .filter(Transaction.transaction_type == "Debit", func.strftime("%Y-%m", Transaction.date).in_(months))
        .all()
    )
    for row in rows:
        month = row.date.strftime("%Y-%m")
        category, _confidence, _derived = transaction_category(db, row)
        if category in INVESTMENT_CATEGORIES or is_hidden_cashflow_category(category):
            continue
        merchant = extract_merchant(row.description)
        amount = safe_float(row.amount)
        key = (category, merchant)
        merchant_months[key]["months"].add(month)
        merchant_months[key]["total"] += amount
        merchant_months[key]["count"] += 1
        category_by_month[month][category] += amount

    recurring = []
    for (category, merchant), bucket in merchant_months.items():
        months_seen = len(bucket["months"])
        if months_seen >= min(3, len(months)):
            recurring.append({
                "category": category,
                "merchant": merchant,
                "months_seen": months_seen,
                "average_monthly": round(bucket["total"] / months_seen, 2),
                "total": round(bucket["total"], 2),
                "count": bucket["count"],
            })
    recurring.sort(key=lambda item: item["average_monthly"], reverse=True)

    deltas = []
    if len(months) >= 2:
        previous_month = months[-2]
        latest_month = months[-1]
        categories = set(category_by_month[previous_month]) | set(category_by_month[latest_month])
        for category in categories:
            previous = category_by_month[previous_month].get(category, 0.0)
            latest = category_by_month[latest_month].get(category, 0.0)
            change = latest - previous
            if abs(change) >= 2_000:
                deltas.append({
                    "category": category,
                    "previous_month": previous_month,
                    "latest_month": latest_month,
                    "previous": round(previous, 2),
                    "latest": round(latest, 2),
                    "change": round(change, 2),
                    "change_pct": pct(change, previous) if previous else None,
                })
    deltas.sort(key=lambda item: abs(item["change"]), reverse=True)
    return {"recurring_merchants": recurring[:10], "category_deltas": deltas[:8]}


def build_finance_profile(db: Session, step_up_pct: float = 10.0) -> dict[str, Any]:
    assumptions = finance_assumptions(step_up_pct)
    today = date.today()
    current_month = today.strftime("%Y-%m")

    assets = asset_values(db, assumptions)
    liabilities = liability_values(db)
    gross_assets = round(sum(assets.values()), 2)
    net_worth = round(gross_assets - liabilities["total"], 2)
    cash = round(assets.get("Cash / Bank", 0.0), 2)
    invested_assets = round(max(gross_assets - cash, 0.0), 2)
    allocation = [
        {"label": label, "value": round(value, 2), "percentage": pct(value, gross_assets)}
        for label, value in sorted(assets.items(), key=lambda item: item[1], reverse=True)
        if value > 0
    ]
    returns = asset_return_breakdown(db, assumptions, assets)

    all_months = latest_cashflow_months(db, 7)
    month_rows = [month_cashflow(db, month) for month in all_months]
    complete_rows = [row for row in month_rows if row["month"] != current_month]
    forecast_rows = (complete_rows[-6:] if complete_rows else month_rows[-6:])
    usable_rows = [row for row in forecast_rows if row["transaction_count"] > 0]
    latest_month = (all_months[-1] if all_months else current_month)
    latest_month_cashflow = month_cashflow(db, latest_month)

    configured_salary = safe_float(assumptions["monthly_salary_inr"])
    observed_salary = _median_positive([row["salary_income"] for row in usable_rows])
    salary_baseline = configured_salary
    salary_source = "configured"
    if observed_salary > configured_salary * 1.15:
        salary_baseline = observed_salary
        salary_source = "detected_salary_credit"

    monthly_true_expenses = round(_median_positive([row["true_expenses"] for row in usable_rows]), 0)
    if monthly_true_expenses <= 0:
        monthly_true_expenses = round(_avg([row["true_expenses"] for row in usable_rows]), 0)
    monthly_mf_investment = round(_median_positive([row["mf_investment"] for row in usable_rows]), 0)
    monthly_other_investment = round(_median_positive([row["other_investment"] for row in usable_rows]), 0)
    monthly_investment_plan = round(monthly_mf_investment + monthly_other_investment, 0)
    observed_monthly_investment = round(_avg([row["investment_outflow"] for row in usable_rows]), 0)
    monthly_income_baseline = round(salary_baseline, 0)
    monthly_savings_assumed = round(max(monthly_income_baseline - monthly_true_expenses, 0), 0)
    monthly_investment_gap = round(max(monthly_investment_plan - monthly_savings_assumed, 0), 0)

    projection_years = int(assumptions["projection_years"])
    step_up_pct = safe_float(assumptions["default_mf_step_up_pct"])
    invested_return_monthly = safe_float(returns["weighted_invested_return_pct"]) / 100 / 12
    cash_return_monthly = safe_float(returns["cash_return_pct"]) / 100 / 12
    salary_growth = safe_float(assumptions["salary_growth_pct"]) / 100
    spend_inflation = safe_float(assumptions["spend_inflation_pct"]) / 100

    def run_path(step_up: bool) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        path_points: list[dict[str, Any]] = []
        path_cash = cash
        path_invested = invested_assets
        unfunded = 0.0
        cash_shortfall = 0.0
        cash_runs_out_month = None
        for month_number in range(1, projection_years * 12 + 1):
            year_index = (month_number - 1) // 12
            monthly_income = monthly_income_baseline * ((1 + salary_growth) ** year_index)
            monthly_spend = monthly_true_expenses * ((1 + spend_inflation) ** year_index)
            mf_multiplier = ((1 + step_up_pct / 100) ** year_index) if step_up else 1.0
            desired_investment = monthly_other_investment + monthly_mf_investment * mf_multiplier

            path_invested *= 1 + invested_return_monthly
            path_cash *= 1 + cash_return_monthly
            path_cash += monthly_income - monthly_spend
            if path_cash < 0:
                cash_shortfall += abs(path_cash)
                path_cash = 0.0

            actual_investment = min(desired_investment, path_cash)
            unfunded += max(desired_investment - actual_investment, 0.0)
            path_cash -= actual_investment
            path_invested += actual_investment
            if path_cash <= 0 and cash_runs_out_month is None and desired_investment > 0:
                cash_runs_out_month = month_number

            if month_number % 12 == 0:
                path_points.append({
                    "year": today.year + month_number // 12,
                    "cash": round(path_cash, 0),
                    "invested": round(path_invested, 0),
                    "net_worth": round(path_cash + path_invested - liabilities["total"], 0),
                    "monthly_income": round(monthly_income, 0),
                    "monthly_true_expenses": round(monthly_spend, 0),
                    "monthly_mf_investment": round(monthly_mf_investment * mf_multiplier, 0),
                    "monthly_other_investment": round(monthly_other_investment, 0),
                    "monthly_investment": round(desired_investment, 0),
                    "actual_monthly_investment": round(actual_investment, 0),
                    "unfunded_investment": round(unfunded, 0),
                    "cash_shortfall": round(cash_shortfall, 0),
                })
        return path_points, {
            "cash": round(path_cash, 0),
            "invested": round(path_invested, 0),
            "net_worth": round(path_cash + path_invested - liabilities["total"], 0),
            "unfunded_investment": round(unfunded, 0),
            "cash_shortfall": round(cash_shortfall, 0),
            "cash_runs_out_month": cash_runs_out_month,
        }

    base_points, base_final = run_path(step_up=False)
    step_points, step_final = run_path(step_up=True)

    data_points = [{
        "year": today.year,
        "label": str(today.year),
        "value": round(net_worth, 0),
        "base_net_worth": round(net_worth, 0),
        "base_cash": round(cash, 0),
        "base_invested": round(invested_assets, 0),
        "step_net_worth": round(net_worth, 0),
        "step_cash": round(cash, 0),
        "step_invested": round(invested_assets, 0),
        "base_monthly_investment": monthly_investment_plan,
        "step_monthly_investment": monthly_investment_plan,
        "base_monthly_mf_investment": monthly_mf_investment,
        "step_monthly_mf_investment": monthly_mf_investment,
        "monthly_other_investment_outflow": monthly_other_investment,
        "base_unfunded_investment": 0,
        "step_unfunded_investment": 0,
        "base_cash_shortfall": 0,
        "step_cash_shortfall": 0,
        "monthly_income": monthly_income_baseline,
        "monthly_true_expenses": monthly_true_expenses,
        "liabilities": round(liabilities["total"], 0),
    }]
    for base, step in zip(base_points, step_points):
        data_points.append({
            "year": base["year"],
            "label": str(base["year"]),
            "value": base["net_worth"],
            "base_net_worth": base["net_worth"],
            "base_cash": base["cash"],
            "base_invested": base["invested"],
            "step_net_worth": step["net_worth"],
            "step_cash": step["cash"],
            "step_invested": step["invested"],
            "base_monthly_investment": base["monthly_investment"],
            "step_monthly_investment": step["monthly_investment"],
            "base_monthly_mf_investment": base["monthly_mf_investment"],
            "step_monthly_mf_investment": step["monthly_mf_investment"],
            "monthly_other_investment_outflow": base["monthly_other_investment"],
            "base_actual_monthly_investment": base["actual_monthly_investment"],
            "step_actual_monthly_investment": step["actual_monthly_investment"],
            "base_unfunded_investment": base["unfunded_investment"],
            "step_unfunded_investment": step["unfunded_investment"],
            "base_cash_shortfall": base["cash_shortfall"],
            "step_cash_shortfall": step["cash_shortfall"],
            "monthly_income": base["monthly_income"],
            "monthly_true_expenses": base["monthly_true_expenses"],
            "liabilities": round(liabilities["total"], 0),
        })

    confidence = "high" if len(usable_rows) >= 6 else "medium" if len(usable_rows) >= 3 else "low"
    goals = financial_goals(db, net_worth, monthly_savings_assumed)
    spend_intel = expense_intelligence(db, [row["month"] for row in usable_rows])
    return {
        "as_of": today.isoformat(),
        "assumptions": assumptions,
        "assets": {
            "values": assets,
            "allocation": allocation,
            "gross_assets": gross_assets,
            "net_worth": round(net_worth, 2),
            "cash": cash,
            "invested_assets": invested_assets,
            "returns": returns,
        },
        "liabilities": liabilities,
        "goals": goals,
        "expense_intelligence": spend_intel,
        "cashflow": {
            "latest_month": latest_month,
            "latest_month_cashflow": latest_month_cashflow,
            "analyzed_months": [row["month"] for row in usable_rows],
            "months_with_data": len(usable_rows),
            "monthly_income_baseline": monthly_income_baseline,
            "monthly_salary_baseline": round(salary_baseline, 0),
            "salary_source": salary_source,
            "observed_salary_median": round(observed_salary, 0),
            "monthly_true_expenses": monthly_true_expenses,
            "monthly_savings_assumed": monthly_savings_assumed,
            "monthly_investment_outflow": monthly_investment_plan,
            "monthly_mutual_fund_investment": monthly_mf_investment,
            "monthly_other_investment_outflow": monthly_other_investment,
            "observed_monthly_investment_outflow_avg": observed_monthly_investment,
            "monthly_investment_gap": monthly_investment_gap,
            "monthly_raw_cash_change": round(_avg([row["bank_surplus"] for row in usable_rows]), 0),
            "trailing": usable_rows,
        },
        "forecast": {
            "current_net_worth": round(net_worth, 0),
            "current_cash": round(cash, 0),
            "current_invested_assets": round(invested_assets, 0),
            "gross_assets": round(gross_assets, 0),
            "liabilities": round(liabilities["total"], 0),
            "monthly_emi": round(liabilities["monthly_emi"], 0),
            "monthly_savings_assumed": monthly_savings_assumed,
            "monthly_income_assumed": monthly_income_baseline,
            "monthly_true_expenses": monthly_true_expenses,
            "monthly_investment_outflow": monthly_investment_plan,
            "monthly_mutual_fund_investment": monthly_mf_investment,
            "monthly_other_investment_outflow": monthly_other_investment,
            "observed_monthly_investment_outflow_avg": observed_monthly_investment,
            "monthly_investment_gap": monthly_investment_gap,
            "monthly_raw_cash_change": round(_avg([row["bank_surplus"] for row in usable_rows]), 0),
            "savings_basis": "configured_salary_minus_true_spend_with_salary_growth",
            "investment_step_up_pct": step_up_pct,
            "step_up_applies_to": "mutual_funds_only",
            "base_unfunded_investment": base_final["unfunded_investment"],
            "step_unfunded_investment": step_final["unfunded_investment"],
            "base_cash_shortfall": base_final["cash_shortfall"],
            "step_cash_shortfall": step_final["cash_shortfall"],
            "base_cash_runs_out_month": base_final["cash_runs_out_month"],
            "step_cash_runs_out_month": step_final["cash_runs_out_month"],
            "annual_return_pct": returns["weighted_invested_return_pct"],
            "cash_return_pct": returns["cash_return_pct"],
            "salary_growth_pct": assumptions["salary_growth_pct"],
            "spend_inflation_pct": assumptions["spend_inflation_pct"],
            "projection_years": projection_years,
            "data_points": data_points,
            "months_of_cashflow_data": len(usable_rows),
            "has_cashflow_data": len(usable_rows) > 0,
            "confidence": confidence,
            "base_final": base_final,
            "step_final": step_final,
            "notes": [
                f"Salary baseline is {money(monthly_income_baseline)}/month with {assumptions['salary_growth_pct']}% annual growth.",
                f"True spend baseline is {money(monthly_true_expenses)}/month with {assumptions['spend_inflation_pct']}% annual inflation.",
                f"Invested assets grow using a weighted asset return of {returns['weighted_invested_return_pct']}% p.a.; cash uses {returns['cash_return_pct']}% p.a.",
                f"MF step-up applies only to detected mutual fund/SIP outflow of {money(monthly_mf_investment)}/month.",
                "Cash is floored at zero; unaffordable investing is shown as an unfunded gap.",
            ],
        },
    }


def build_scenario(
    db: Session,
    *,
    monthly_extra_investment: float = 0.0,
    spend_cut_pct: float = 0.0,
    salary_growth_pct: float | None = None,
    mf_step_up_pct: float = 10.0,
) -> dict[str, Any]:
    base = build_finance_profile(db, step_up_pct=mf_step_up_pct)
    assumptions = dict(base["assumptions"])
    if salary_growth_pct is not None:
        assumptions["salary_growth_pct"] = max(float(salary_growth_pct), 0.0)

    gross_assets = base["assets"]["gross_assets"]
    liabilities = base["liabilities"]["total"]
    cash = base["assets"]["cash"]
    invested = base["assets"]["invested_assets"]
    returns = base["assets"]["returns"]
    monthly_income = base["cashflow"]["monthly_income_baseline"]
    monthly_spend = base["cashflow"]["monthly_true_expenses"] * (1 - max(0.0, min(spend_cut_pct, 80.0)) / 100)
    monthly_mf = base["cashflow"]["monthly_mutual_fund_investment"] + max(0.0, monthly_extra_investment)
    monthly_other = base["cashflow"]["monthly_other_investment_outflow"]

    salary_growth = safe_float(assumptions["salary_growth_pct"]) / 100
    spend_inflation = safe_float(assumptions["spend_inflation_pct"]) / 100
    invested_return = safe_float(returns["weighted_invested_return_pct"]) / 100 / 12
    cash_return = safe_float(returns["cash_return_pct"]) / 100 / 12
    step_up = max(0.0, min(float(mf_step_up_pct or 0), 100.0)) / 100

    points = [{
        "year": date.today().year,
        "net_worth": round(gross_assets - liabilities, 0),
        "cash": round(cash, 0),
        "invested": round(invested, 0),
    }]
    unfunded = 0.0
    for month_number in range(1, 61):
        year_index = (month_number - 1) // 12
        income = monthly_income * ((1 + salary_growth) ** year_index)
        spend = monthly_spend * ((1 + spend_inflation) ** year_index)
        desired_investment = monthly_other + monthly_mf * ((1 + step_up) ** year_index)
        invested *= 1 + invested_return
        cash *= 1 + cash_return
        cash = max(cash + income - spend, 0.0)
        actual_investment = min(desired_investment, cash)
        unfunded += max(desired_investment - actual_investment, 0.0)
        cash -= actual_investment
        invested += actual_investment
        if month_number % 12 == 0:
            points.append({
                "year": date.today().year + month_number // 12,
                "net_worth": round(cash + invested - liabilities, 0),
                "cash": round(cash, 0),
                "invested": round(invested, 0),
                "monthly_income": round(income, 0),
                "monthly_true_expenses": round(spend, 0),
                "monthly_investment": round(desired_investment, 0),
                "unfunded_investment": round(unfunded, 0),
            })

    base_final = base["forecast"]["base_final"]["net_worth"]
    scenario_final = points[-1]["net_worth"] if points else base_final
    return {
        "base_final_net_worth": base_final,
        "scenario_final_net_worth": scenario_final,
        "incremental_wealth": round(scenario_final - base_final, 0),
        "points": points,
        "inputs": {
            "monthly_extra_investment": round(max(0.0, monthly_extra_investment), 0),
            "spend_cut_pct": round(max(0.0, min(spend_cut_pct, 80.0)), 1),
            "salary_growth_pct": assumptions["salary_growth_pct"],
            "mf_step_up_pct": round(mf_step_up_pct, 1),
        },
        "assumptions": assumptions,
    }


def build_daily_briefing(db: Session) -> dict[str, Any]:
    profile = build_finance_profile(db)
    forecast = profile["forecast"]
    cashflow = profile["cashflow"]["latest_month_cashflow"]
    allocation = profile["assets"]["allocation"]
    actions: list[dict[str, Any]] = []

    if cashflow["unclear_transfers"] > max(cashflow["income"] * 0.1, 25_000):
        actions.append({
            "priority": 1,
            "title": "Clean up Transfers Out",
            "detail": f"{money(cashflow['unclear_transfers'])} is still ambiguous; this can hide real spend.",
            "impact": "Improves every spend recommendation.",
        })
    if profile["goals"]:
        urgent_goal = max(profile["goals"], key=lambda goal: goal["required_monthly"] or 0)
        if urgent_goal["required_monthly"] > forecast["monthly_savings_assumed"]:
            actions.append({
                "priority": 2,
                "title": f"Goal gap: {urgent_goal['name']}",
                "detail": f"Needs {money(urgent_goal['required_monthly'])}/month; available surplus is {money(forecast['monthly_savings_assumed'])}.",
                "impact": "Rework target date, spend, or investing plan.",
            })
    if allocation and allocation[0]["percentage"] >= 50:
        actions.append({
            "priority": 3,
            "title": "Reduce concentration risk with future money",
            "detail": f"{allocation[0]['label']} is {allocation[0]['percentage']:.0f}% of gross assets.",
            "impact": "Direct new investments toward underweight liquid buckets.",
        })
    if forecast["monthly_investment_gap"] > 0:
        actions.append({
            "priority": 4,
            "title": "Investment plan is above surplus",
            "detail": f"Plan gap is {money(forecast['monthly_investment_gap'])}/month.",
            "impact": "Avoid accidental cash drawdown.",
        })

    actions.sort(key=lambda item: item["priority"])
    return {
        "as_of": profile["as_of"],
        "headline": (
            f"Net worth is {money(forecast['current_net_worth'])}; "
            f"5-year base path is {money(forecast['base_final']['net_worth'])}."
        ),
        "metrics": {
            "net_worth": forecast["current_net_worth"],
            "gross_assets": forecast["gross_assets"],
            "liabilities": forecast["liabilities"],
            "cash": forecast["current_cash"],
            "monthly_surplus": forecast["monthly_savings_assumed"],
            "true_spend": forecast["monthly_true_expenses"],
            "mf_plan": forecast["monthly_mutual_fund_investment"],
            "confidence": forecast["confidence"],
        },
        "actions": actions[:5],
        "data_quality": {
            "months_of_cashflow_data": forecast["months_of_cashflow_data"],
            "analyzed_months": profile["cashflow"]["analyzed_months"],
            "missing_liabilities": profile["liabilities"]["count"] == 0,
            "missing_goals": len(profile["goals"]) == 0,
        },
    }
