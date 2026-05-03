from __future__ import annotations

import math
import os
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.models import (
    Actionable,
    Bill,
    CategoryRule,
    HistoricalWealth,
    ManualAsset,
    MFHolding,
    MonthClose,
    StockHolding,
    Transaction,
)
from services.cashflow_rules import (
    INVESTMENT_CATEGORIES,
    TRANSFER_CATEGORIES,
    is_hidden_cashflow_category,
)
from services.finance_engine import build_finance_profile
from services.transaction_categorizer import categorize_transaction_rule, extract_merchant

load_dotenv()


UNCLEAR_CATEGORIES = {"Transfers Out", "Miscellaneous", "Misc"}
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


def _safe(value: Any) -> float:
    try:
        number = float(value or 0)
        return 0.0 if math.isnan(number) or math.isinf(number) else number
    except (TypeError, ValueError):
        return 0.0


def _gold_value_inr(grams: float) -> float:
    env_price = _safe(os.getenv("GOLD_PRICE_INR_PER_GRAM"))
    price = env_price if env_price > 0 else 9000
    return round(_safe(grams) * price, 2)


def _pct(numerator: float, denominator: float) -> float:
    return round((numerator / denominator) * 100, 1) if denominator else 0.0


def _latest_transaction_month(db: Session) -> str | None:
    row = db.query(func.max(func.strftime("%Y-%m", Transaction.date))).scalar()
    return str(row) if row else None


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
    derived_category, derived_confidence = categorize_transaction_rule(row.description, row.transaction_type)
    if (
        saved
        and saved.lower() not in {"misc", "miscellaneous", "uncategorized", "transfers out"}
        and not (saved == "Food & Delivery" and derived_category == "Household Help")
    ):
        return saved, 1.0, False

    return derived_category, derived_confidence, True


def _manual_assets(db: Session) -> dict[str, float]:
    return {row.asset_type: _safe(row.value) for row in db.query(ManualAsset).all()}


def asset_values(db: Session) -> dict[str, float]:
    manual = _manual_assets(db)
    mf_value = sum(_safe(row.value) for row in db.query(MFHolding).all())
    stock_value = sum(
        _safe(row.quantity) * (_safe(row.current_price) or _safe(row.avg_price))
        for row in db.query(StockHolding).all()
    )
    gold_value = _gold_value_inr(manual.get("GOLD_GRAMS", 0))
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


def _month_rows(db: Session, month_year: str) -> list[Transaction]:
    return (
        db.query(Transaction)
        .filter(func.strftime("%Y-%m", Transaction.date) == month_year)
        .order_by(Transaction.amount.desc(), Transaction.date.desc())
        .all()
    )


def month_cashflow(db: Session, month_year: str) -> dict:
    rows = _month_rows(db, month_year)
    income = 0.0
    debit_total = 0.0
    hidden_debit_total = 0.0
    derived_count = 0
    categories: dict[str, dict] = defaultdict(lambda: {"total": 0.0, "count": 0, "merchants": defaultdict(float)})

    for row in rows:
        amount = round(_safe(row.amount), 2)
        if row.transaction_type == "Credit":
            income += amount
            continue

        debit_total += amount
        category, _confidence, derived = transaction_category(db, row)
        derived_count += 1 if derived else 0
        if is_hidden_cashflow_category(category):
            hidden_debit_total += amount
            continue

        merchant = extract_merchant(row.description)
        categories[category]["total"] += amount
        categories[category]["count"] += 1
        categories[category]["merchants"][merchant] += amount

    visible_debit_total = max(debit_total - hidden_debit_total, 0.0)
    category_list = []
    for category, bucket in categories.items():
        merchants = sorted(bucket["merchants"].items(), key=lambda item: item[1], reverse=True)
        total = round(bucket["total"], 2)
        category_list.append({
            "category": category,
            "total": total,
            "count": bucket["count"],
            "percentage_of_debits": _pct(total, visible_debit_total),
            "top_merchants": [
                {"merchant": merchant, "total": round(value, 2)}
                for merchant, value in merchants[:4]
            ],
        })
    category_list.sort(key=lambda item: item["total"], reverse=True)

    investment_outflow = sum(item["total"] for item in category_list if item["category"] in INVESTMENT_CATEGORIES)
    unclear_transfers = sum(item["total"] for item in category_list if item["category"] in TRANSFER_CATEGORIES)
    fixed_obligations = sum(item["total"] for item in category_list if item["category"] in FIXED_OBLIGATION_CATEGORIES)
    controllable = sum(item["total"] for item in category_list if item["category"] in CONTROLLABLE_CATEGORIES)
    true_expenses = max(visible_debit_total - investment_outflow - unclear_transfers, 0)
    bank_surplus = income - visible_debit_total
    lifestyle_surplus = income - true_expenses
    wealth_creation = max(investment_outflow + max(bank_surplus, 0), 0)

    return {
        "month": month_year,
        "income": round(income, 2),
        "debits_total": round(visible_debit_total, 2),
        "true_expenses": round(true_expenses, 2),
        "investment_outflow": round(investment_outflow, 2),
        "unclear_transfers": round(unclear_transfers, 2),
        "fixed_obligations": round(fixed_obligations, 2),
        "controllable_spend": round(controllable, 2),
        "bank_surplus": round(bank_surplus, 2),
        "lifestyle_surplus": round(lifestyle_surplus, 2),
        "wealth_creation": round(wealth_creation, 2),
        "true_expense_rate_pct": _pct(true_expenses, income),
        "bank_savings_rate_pct": _pct(bank_surplus, income),
        "wealth_creation_rate_pct": _pct(wealth_creation, income),
        "transaction_count": len(rows),
        "derived_category_count": derived_count,
        "categories": category_list,
    }


def _trailing_cashflow(db: Session, latest_month: str | None, count: int = 6) -> list[dict]:
    if not latest_month:
        return []
    return [month_cashflow(db, month) for month in _month_range(latest_month, count)]


def _required_monthly_contribution(current: float, target: float, months: int, annual_return: float = 0.08) -> float:
    if months <= 0:
        return 0.0
    monthly_rate = annual_return / 12
    future_current = current * ((1 + monthly_rate) ** months)
    gap = target - future_current
    if gap <= 0:
        return 0.0
    factor = (((1 + monthly_rate) ** months) - 1) / monthly_rate if monthly_rate else months
    return round(gap / factor, 2)


def _project_value(current: float, monthly_contribution: float, years: int, annual_return: float = 0.08) -> float:
    value = current
    monthly_rate = annual_return / 12
    for _ in range(years * 12):
        value = value * (1 + monthly_rate) + monthly_contribution
    return round(value, 2)


def _score_band(score: int) -> str:
    if score >= 85:
        return "Excellent"
    if score >= 70:
        return "Good"
    if score >= 55:
        return "Watch"
    if score >= 40:
        return "At risk"
    return "Critical"


def _opportunity(
    *,
    oid: str,
    category: str,
    title: str,
    why: str,
    action: str,
    impact_monthly: float,
    confidence: str,
    difficulty: str,
    evidence: list[str],
    priority: int,
) -> dict:
    return {
        "id": oid,
        "category": category,
        "title": title,
        "why": why,
        "action": action,
        "impact_monthly": round(max(impact_monthly, 0), 2),
        "impact_annual": round(max(impact_monthly, 0) * 12, 2),
        "confidence": confidence,
        "difficulty": difficulty,
        "evidence": evidence,
        "priority": priority,
        "status": "Open",
    }


def build_opportunities(cashflow: dict, allocation: list[dict], quality: dict, bills_due: int, actions_due: int) -> list[dict]:
    opportunities: list[dict] = []
    income = cashflow["income"]
    true_expenses = cashflow["true_expenses"]
    unclear = cashflow["unclear_transfers"]
    bank_surplus = cashflow["bank_surplus"]
    wealth_rate = cashflow["wealth_creation_rate_pct"]

    if income > 0 and bank_surplus < 0 and true_expenses > income:
        opportunities.append(_opportunity(
            oid="stop-negative-cashflow",
            category="Cashflow",
            title="Stop the household spending deficit",
            why=f"True expenses exceed income by {money(true_expenses - income)} in {cashflow['month']}.",
            action="Cut or defer non-essential spending before the next salary cycle.",
            impact_monthly=abs(bank_surplus),
            confidence="High",
            difficulty="Medium",
            evidence=[
                f"Income {money(income)}",
                f"True expenses {money(true_expenses)}",
                f"Bank surplus {money(bank_surplus)}",
            ],
            priority=1,
        ))
    elif income > 0 and bank_surplus < 0:
        opportunities.append(_opportunity(
            oid="make-investment-drawdown-deliberate",
            category="Cash planning",
            title="Make the investment drawdown deliberate",
            why=(
                f"Your true expenses are covered, but cash still fell by {money(abs(bank_surplus))} "
                "because investments and unclear transfers exceeded this month's surplus."
            ),
            action="Confirm whether this was a planned one-off investment. If not, cap next month's investment transfer to the amount left after true expenses and emergency cash.",
            impact_monthly=0,
            confidence="High" if cashflow["unclear_transfers"] < 25_000 else "Medium",
            difficulty="Low",
            evidence=[
                f"Income {money(income)}",
                f"True expenses {money(true_expenses)}",
                f"Investments {money(cashflow['investment_outflow'])}",
                f"Unclear transfers {money(cashflow['unclear_transfers'])}",
            ],
            priority=1,
        ))

    if income > 0 and wealth_rate < 30:
        target = income * 0.30
        gap = max(target - cashflow["wealth_creation"], 0)
        opportunities.append(_opportunity(
            oid="raise-wealth-creation-rate",
            category="Wealth building",
            title="Raise wealth creation rate toward 30%",
            why=f"Current wealth creation rate is {wealth_rate:.1f}% of income.",
            action="Increase automated investing or retained cash by the gap after cleaning ambiguous transfers.",
            impact_monthly=gap,
            confidence="Medium" if unclear else "High",
            difficulty="Medium",
            evidence=[
                f"Wealth creation {money(cashflow['wealth_creation'])}",
                f"Income {money(income)}",
                f"Target at 30% {money(target)}",
            ],
            priority=2,
        ))

    if unclear > max(income * 0.10, 25_000):
        opportunities.append(_opportunity(
            oid="clean-transfer-bucket",
            category="Data quality",
            title="Clean up ambiguous transfers",
            why=f"{money(unclear)} is sitting in Transfers Out, so the app cannot tell what is household spend versus money movement.",
            action="Open the latest expense breakdown and recategorize the top transfer merchants. This directly improves every future recommendation.",
            impact_monthly=0,
            confidence="High",
            difficulty="Low",
            evidence=[f"Transfers Out {money(unclear)}", f"{cashflow['transaction_count']} transactions in month"],
            priority=3,
        ))

    top_controllable = [
        item for item in cashflow["categories"]
        if item["category"] in CONTROLLABLE_CATEGORIES and item["total"] >= 5_000
    ]
    for index, item in enumerate(top_controllable[:2], start=1):
        reduction = item["total"] * (0.12 if item["category"] in {"Food & Delivery", "Shopping", "Subscriptions", "Entertainment"} else 0.08)
        merchants = ", ".join(m["merchant"] for m in item["top_merchants"][:3])
        opportunities.append(_opportunity(
            oid=f"trim-{item['category'].lower().replace(' ', '-').replace('&', 'and')}",
            category="Spend optimization",
            title=f"Trim {item['category']} by 8-12%",
            why=f"{item['category']} is {money(item['total'])} this month.",
            action=f"Audit the top merchants ({merchants or 'largest rows'}) and set a weekly cap.",
            impact_monthly=reduction,
            confidence="Medium",
            difficulty="Low",
            evidence=[f"{item['category']} {money(item['total'])}", f"{item['count']} transactions"],
            priority=4 + index,
        ))

    if allocation:
        largest = allocation[0]
        if largest["percentage"] >= 50:
            opportunities.append(_opportunity(
                oid="reduce-concentration-risk",
                category="Risk",
                title=f"Reduce {largest['label']} concentration risk",
                why=f"{largest['label']} is {largest['percentage']:.0f}% of net worth.",
                action="Set a target allocation and direct new investments toward underweight liquid assets before adding more to the largest bucket.",
                impact_monthly=0,
                confidence="High",
                difficulty="Medium",
                evidence=[f"{largest['label']} {money(largest['value'])}", f"Share {largest['percentage']:.1f}%"],
                priority=7,
            ))

    if quality["months_with_transactions"] < 6:
        opportunities.append(_opportunity(
            oid="build-six-month-history",
            category="Data quality",
            title="Build six months of reliable history",
            why="Forecasts and savings advice become much more reliable after 6 complete months.",
            action="Import the missing bank statement months and lock month-end snapshots.",
            impact_monthly=0,
            confidence="High",
            difficulty="Low",
            evidence=[f"Months with transactions {quality['months_with_transactions']}"],
            priority=8,
        ))

    if bills_due == 0 and actions_due == 0:
        opportunities.append(_opportunity(
            oid="activate-gmail-actions",
            category="Actionability",
            title="Make Gmail sync prove no bills are missing",
            why="There are no visible bills or urgent communications, which is unlikely unless Gmail has been fully reviewed.",
            action="Run initial Gmail sync for the full month, then review extracted school, bank, card, electricity, and renewal items.",
            impact_monthly=0,
            confidence="Medium",
            difficulty="Low",
            evidence=["0 bills due", "0 urgent actionables"],
            priority=9,
        ))

    opportunities.sort(key=lambda item: (item["priority"], -item["impact_monthly"]))
    return opportunities[:8]


def build_coach_overview(db: Session) -> dict:
    today = date.today()
    profile = build_finance_profile(db)
    latest_month = _latest_transaction_month(db) or today.strftime("%Y-%m")
    cashflow = month_cashflow(db, latest_month)
    trailing = _trailing_cashflow(db, latest_month, 6)

    assets = profile["assets"]["values"]
    net_worth = round(profile["assets"]["net_worth"], 2)
    allocation = profile["assets"]["allocation"]

    avg_income = sum(row["income"] for row in trailing if row["transaction_count"]) / max(
        sum(1 for row in trailing if row["transaction_count"]),
        1,
    )
    avg_true_expenses = sum(row["true_expenses"] for row in trailing if row["transaction_count"]) / max(
        sum(1 for row in trailing if row["transaction_count"]),
        1,
    )
    avg_wealth_creation = profile["cashflow"]["monthly_savings_assumed"]

    months_with_transactions = sum(1 for row in trailing if row["transaction_count"])
    snapshots = db.query(HistoricalWealth).count()
    latest_tx_date = db.query(func.max(Transaction.date)).scalar()
    stale_days = (today - latest_tx_date).days if latest_tx_date else None
    bills_due = db.query(Bill).filter(Bill.is_paid == False, Bill.due_date <= today + timedelta(days=14)).count()
    urgent_actions = db.query(Actionable).filter(Actionable.status == "Pending", Actionable.priority == "High").count()
    pending_actions = db.query(Actionable).filter(Actionable.status == "Pending").count()
    close = db.query(MonthClose).filter_by(month_year=today.strftime("%Y-%m")).first()

    cash = assets.get("Cash / Bank", 0)
    monthly_burn = cashflow["true_expenses"] or avg_true_expenses
    runway_months = round(cash / monthly_burn, 1) if monthly_burn > 0 else None

    required_2cr_24 = _required_monthly_contribution(net_worth, 2_00_00_000, 24)
    required_3cr_60 = _required_monthly_contribution(net_worth, 3_00_00_000, 60)
    forecast_points = profile["forecast"]["data_points"]
    projected_2y = next(
        (point["base_net_worth"] for point in forecast_points if point["year"] == today.year + 2),
        _project_value(net_worth, avg_wealth_creation, 2, profile["forecast"]["annual_return_pct"] / 100),
    )
    projected_5y = profile["forecast"]["base_final"]["net_worth"]

    quality = {
        "months_with_transactions": months_with_transactions,
        "snapshots": snapshots,
        "latest_transaction_date": latest_tx_date.isoformat() if latest_tx_date else None,
        "stale_days": stale_days,
        "month_close_status": close.status if close else "Open",
    }
    opportunities = build_opportunities(cashflow, allocation, quality, bills_due, urgent_actions)
    for goal in profile["goals"][:3]:
        if goal.get("required_monthly") and goal["required_monthly"] > profile["cashflow"]["monthly_savings_assumed"]:
            opportunities.append(_opportunity(
                oid=f"goal-gap-{goal['id']}",
                category="Goals",
                title=f"Close goal gap for {goal['name']}",
                why=f"The goal needs {money(goal['required_monthly'])}/month, above current surplus {money(profile['cashflow']['monthly_savings_assumed'])}.",
                action="Either extend the target date, increase income/investment allocation, or define a specific spend-cut amount.",
                impact_monthly=goal["required_monthly"] - profile["cashflow"]["monthly_savings_assumed"],
                confidence="Medium",
                difficulty="Medium",
                evidence=[f"Goal gap {money(goal['gap'])}", f"Target {goal.get('target_date') or 'no date'}"],
                priority=2,
            ))
    opportunities.sort(key=lambda item: (item["priority"], -item["impact_monthly"]))
    opportunities = opportunities[:8]

    data_score = min(100, (months_with_transactions * 10) + min(snapshots * 10, 20) + (20 if net_worth > 0 else 0) + (10 if pending_actions else 0))
    savings_score = max(0, min(100, int(50 + cashflow["bank_savings_rate_pct"] * 1.6)))
    wealth_score = max(0, min(100, int(cashflow["wealth_creation_rate_pct"] * 2.2)))
    runway_score = 40 if runway_months is None else max(0, min(100, int(runway_months / 6 * 100)))
    allocation_score = 100
    if allocation and allocation[0]["percentage"] >= 65:
        allocation_score = 45
    elif allocation and allocation[0]["percentage"] >= 50:
        allocation_score = 65
    elif allocation and allocation[0]["percentage"] >= 40:
        allocation_score = 78
    action_score = max(35, 100 - urgent_actions * 15 - bills_due * 10)

    score = round(
        data_score * 0.18
        + savings_score * 0.24
        + wealth_score * 0.24
        + runway_score * 0.14
        + allocation_score * 0.12
        + action_score * 0.08
    )

    data_gaps = []
    if months_with_transactions < 6:
        data_gaps.append("Import at least 6 complete months of bank statements for reliable trend advice.")
    if snapshots < 2:
        data_gaps.append("Capture month-end snapshots to turn asset values into real trends.")
    if stale_days is None or stale_days > 35:
        data_gaps.append("Refresh bank statements; transaction data is missing or stale.")
    if bills_due == 0:
        data_gaps.append("Run Gmail sync or add bills so upcoming obligations are visible.")
    if cashflow["unclear_transfers"] > 0:
        data_gaps.append("Recategorize Transfers Out to separate real spend from money movement.")
    if profile["liabilities"]["count"] == 0:
        data_gaps.append("Add loans and credit-card dues so net worth is net of debt.")
    if not profile["goals"]:
        data_gaps.append("Add financial goals so the app can judge whether the current path is enough.")

    mirror = []
    if cashflow["bank_surplus"] < 0:
        mirror.append(f"You are cashflow negative in {latest_month}: {money(cashflow['bank_surplus'])}.")
    else:
        mirror.append(f"You are cashflow positive in {latest_month}: {money(cashflow['bank_surplus'])}.")
    mirror.append(
        f"True household spend is {money(cashflow['true_expenses'])}; investments are {money(cashflow['investment_outflow'])}; unclear transfers are {money(cashflow['unclear_transfers'])}."
    )
    if allocation:
        mirror.append(f"Largest net-worth bucket is {allocation[0]['label']} at {allocation[0]['percentage']:.0f}%.")
    if profile["liabilities"]["total"] > 0:
        mirror.append(f"Liabilities reduce gross assets by {money(profile['liabilities']['total'])}.")
    mirror.append(
        f"With {profile['assumptions']['salary_growth_pct']}% salary growth, "
        f"{profile['assumptions']['spend_inflation_pct']}% spend inflation, and "
        f"{profile['forecast']['annual_return_pct']}% weighted asset return, "
        f"the base 5-year projection is {money(projected_5y)}."
    )

    return {
        "as_of": today.isoformat(),
        "month": latest_month,
        "health_score": score,
        "health_band": _score_band(score),
        "scores": {
            "data_quality": data_score,
            "cash_savings": savings_score,
            "wealth_creation": wealth_score,
            "runway": runway_score,
            "allocation": allocation_score,
            "actions": action_score,
        },
        "metrics": {
            "net_worth": net_worth,
            "gross_assets": profile["assets"]["gross_assets"],
            "liabilities": profile["liabilities"]["total"],
            "monthly_emi": profile["liabilities"]["monthly_emi"],
            "cash": cash,
            "income": cashflow["income"],
            "total_debits": cashflow["debits_total"],
            "true_expenses": cashflow["true_expenses"],
            "investment_outflow": cashflow["investment_outflow"],
            "unclear_transfers": cashflow["unclear_transfers"],
            "bank_surplus": cashflow["bank_surplus"],
            "lifestyle_surplus": cashflow["lifestyle_surplus"],
            "wealth_creation": cashflow["wealth_creation"],
            "bank_savings_rate_pct": cashflow["bank_savings_rate_pct"],
            "wealth_creation_rate_pct": cashflow["wealth_creation_rate_pct"],
            "cash_runway_months": runway_months,
            "avg_income_6m": round(avg_income, 2),
            "avg_true_expenses_6m": round(avg_true_expenses, 2),
            "avg_wealth_creation_6m": round(avg_wealth_creation, 2),
        },
        "targets": [
            {
                "label": "INR 2Cr in 2 years",
                "target_value": 2_00_00_000,
                "months": 24,
                "required_monthly_contribution": required_2cr_24,
                "current_gap_per_month": round(max(required_2cr_24 - avg_wealth_creation, 0), 2),
            },
            {
                "label": "INR 3Cr in 5 years",
                "target_value": 3_00_00_000,
                "months": 60,
                "required_monthly_contribution": required_3cr_60,
                "current_gap_per_month": round(max(required_3cr_60 - avg_wealth_creation, 0), 2),
            },
        ],
        "forecast": {
            "projected_2y": projected_2y,
            "projected_5y": projected_5y,
            "assumed_return_pct": profile["forecast"]["annual_return_pct"],
            "monthly_contribution_used": round(avg_wealth_creation, 2),
            "salary_growth_pct": profile["assumptions"]["salary_growth_pct"],
            "spend_inflation_pct": profile["assumptions"]["spend_inflation_pct"],
            "mf_step_up_pct": profile["forecast"]["investment_step_up_pct"],
            "step_up_projected_5y": profile["forecast"]["step_final"]["net_worth"],
            "cash_projected_5y": profile["forecast"]["base_final"]["cash"],
            "step_up_cash_projected_5y": profile["forecast"]["step_final"]["cash"],
        },
        "finance_engine": {
            "assumptions": profile["assumptions"],
            "cashflow": {
                "analyzed_months": profile["cashflow"]["analyzed_months"],
                "monthly_income_baseline": profile["cashflow"]["monthly_income_baseline"],
                "monthly_true_expenses": profile["cashflow"]["monthly_true_expenses"],
                "monthly_mutual_fund_investment": profile["cashflow"]["monthly_mutual_fund_investment"],
                "monthly_other_investment_outflow": profile["cashflow"]["monthly_other_investment_outflow"],
            },
            "asset_return_components": profile["assets"]["returns"]["components"],
        },
        "expense_intelligence": profile["expense_intelligence"],
        "goals": profile["goals"],
        "liabilities": profile["liabilities"],
        "allocation": allocation,
        "cashflow": cashflow,
        "opportunities": opportunities,
        "mirror": mirror,
        "data_gaps": data_gaps,
        "quality": quality,
        "attention": {
            "bills_due_14d": bills_due,
            "urgent_actions": urgent_actions,
            "pending_actions": pending_actions,
        },
    }


def compact_coach_context(overview: dict) -> dict:
    """Small context intended for LLM prompts and UI diagnostics."""
    return {
        "as_of": overview["as_of"],
        "month": overview["month"],
        "health_score": overview["health_score"],
        "health_band": overview["health_band"],
        "metrics": overview["metrics"],
        "top_allocation": overview["allocation"][:6],
        "top_expense_categories": overview["cashflow"]["categories"][:8],
        "targets": overview["targets"],
        "forecast": overview["forecast"],
        "finance_engine": overview.get("finance_engine"),
        "expense_intelligence": overview.get("expense_intelligence"),
        "top_opportunities": overview["opportunities"][:6],
        "data_gaps": overview["data_gaps"],
        "mirror": overview["mirror"],
    }
