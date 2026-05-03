"""
Deterministic bank transaction categorisation.

This is intentionally rule-first: bank narrations are repetitive, local rules are
fast/private, and LLMs should only be used later for genuinely unclear rows.
"""

from __future__ import annotations

import re
from collections.abc import Iterable


CategoryRule = tuple[str, tuple[str, ...]]


INCOME_RULES: tuple[CategoryRule, ...] = (
    ("Salary", ("salary", "payroll", "pwc", "tcs", "infosys", "wipro", "accenture", "cognizant", "capgemini")),
    ("Investment Income", ("dividend", "interest", "int.pd", "int pd", "redemption", "sip reversal", "mf redemption", "zerodha", "groww")),
    ("Refunds & Reversals", ("refund", "reversal", "cashback", "chargeback", "return")),
    ("Transfers In", ("imps", "neft", "rtgs", "upi", "from", "received", "deposit")),
)


EXPENSE_RULES: tuple[CategoryRule, ...] = (
    ("Investments & Savings", ("sip", "mutual fund", "mf utility", "zerodha", "groww", "coin", "nps", "ppf", "epfo", "smallcase", "investment", "indian clearing corp", "centricity")),
    ("EMI & Loans", ("emi", "loan", "hdfc ltd", "bajaj finance", "capital float", "loan repayment")),
    ("Rent & Housing", ("rent", "maintenance", "society", "housing", "brokerage")),
    ("Household Help", ("house help", "househelp", "domestic help", "maid", "cook salary", "driver salary", "salary paid", "wages")),
    ("Education & Child", ("school", "vibgyor", "tuition", "fees", "kindergarten", "book", "uniform")),
    ("Healthcare", ("pharmacy", "medical", "apollo", "clinic", "hospital", "diagnostic", "doctor", "medplus", "1mg", "pharmeasy", "medical stores")),
    ("Groceries", ("blinkit", "dmart", "bigbasket", "reliance fresh", "grocery", "supermart", "zepto", "more retail", "nature's basket", "fresh mart")),
    ("Food & Delivery", ("swiggy", "zomato", "eatclub", "dominos", "mcdonald", "kfc", "pizza", "restaurant", "cafe", "food")),
    ("Insurance", ("insurance", "policy", "lic ", "hdfc ergo", "icici lombard", "star health", "term plan")),
    ("Travel & Transport", ("uber", "ola", "rapido", "irctc", "makemytrip", "goibibo", "indigo", "air india", "metro", "fastag", "toll")),
    ("Utilities & Bills", ("electricity", "tata power", "mseb", "msedcl", "broadband", "wifi", "postpaid", "prepaid", "recharge", "gas", "water", "billdesk", "www airte", "airtel", "jio", "tata play")),
    ("Fuel & Vehicle", ("petrol", "diesel", "fuel", "hpcl", "bpcl", "iocl", "shell", "parking", "service center", "petroleum")),
    ("Shopping", ("amazon", "flipkart", "myntra", "nykaa", "ajio", "meesho", "croma", "reliance digital", "westside", "furnishing", "furniture", "craft india", "shopping")),
    ("Subscriptions", ("netflix", "spotify", "prime", "hotstar", "youtube", "google pl", "google play", "apple", "microsoft", "vivish technologies", "subscription")),
    ("Entertainment", ("bookmyshow", "pvr", "inox", "movie", "gaming", "steam")),
    ("Alcohol", ("wine", "liquor", "beer", "whisky", "bar ")),
    ("Taxes", ("tax", "tds", "gst", "challan", "income tax")),
    ("Cash Withdrawal", ("atm", "cash withdrawal", "nwd")),
    ("Bank Charges", ("charges", "fee", "penalty", "sms charge", "annual charge", "gst chg")),
    ("Transfers Out", ("upi", "imps", "neft", "rtgs", "transfer", "paytm", "phonepe", "gpay")),
)


def _clean(text: str | None) -> str:
    cleaned = str(text or "").lower()
    for bank_token in (
        "airtel payments bank",
        "axis bank",
        "hdfc bank",
        "icici bank",
        "state bank of india",
        "yes bank limited",
        "punjab national bank",
        "india post payments",
        "phonepe pvt ltd",
        "yesbank_yespay",
    ):
        cleaned = cleaned.replace(bank_token, " ")
    return re.sub(r"\s+", " ", cleaned).strip()


def _match_rule(text: str, rules: Iterable[CategoryRule]) -> tuple[str, float] | None:
    for category, keywords in rules:
        if any(keyword in text for keyword in keywords):
            return category, 0.88
    return None


def categorize_transaction_rule(description: str | None, transaction_type: str | None) -> tuple[str, float]:
    """Return ``(category, confidence)`` for a transaction narration."""
    text = _clean(description)
    direction = str(transaction_type or "").strip().lower()
    rules = INCOME_RULES if direction == "credit" else EXPENSE_RULES

    matched = _match_rule(text, rules)
    if matched:
        return matched

    if direction == "credit":
        return "Other Income", 0.35
    return "Miscellaneous", 0.35


def extract_merchant(description: str | None) -> str:
    """Best-effort human label for repeated bank narration patterns."""
    text = str(description or "").strip()
    if not text:
        return "Unknown"

    cleaned = re.sub(r"\s+", " ", text)
    upper = cleaned.upper()

    parts = [part.strip() for part in re.split(r"[/\\]", cleaned) if part.strip()]
    if parts:
        rail = parts[0].upper()
        if rail == "UPI" and len(parts) >= 4:
            return parts[3][:42]
        if rail in {"NEFT", "RTGS", "IMPS"} and len(parts) >= 4:
            return parts[3][:42]
        if rail in {"POS", "ECOM"} and len(parts) >= 2:
            return parts[1][:42]

    token = re.split(r"[/\\|-]", cleaned, maxsplit=1)[0].strip()
    return token[:42] if token else cleaned[:42]
