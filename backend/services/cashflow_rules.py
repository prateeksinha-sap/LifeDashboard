"""Shared cashflow category rules.

Cash withdrawals are stored for auditability, but they are hidden from dashboard
spend views because the bank narration only says cash moved out, not where it
was actually spent.
"""

HIDDEN_CASHFLOW_CATEGORIES = {"Cash Withdrawal"}
INVESTMENT_CATEGORIES = {"Investments & Savings"}
TRANSFER_CATEGORIES = {"Transfers Out"}
TRUE_SPEND_EXCLUDED_CATEGORIES = (
    HIDDEN_CASHFLOW_CATEGORIES | INVESTMENT_CATEGORIES | TRANSFER_CATEGORIES
)


def is_hidden_cashflow_category(category: str | None) -> bool:
    return (category or "").strip() in HIDDEN_CASHFLOW_CATEGORIES


def is_true_spend_excluded_category(category: str | None) -> bool:
    return (category or "").strip() in TRUE_SPEND_EXCLUDED_CATEGORIES
