"""
scripts/import_bank_statement.py
─────────────────────────────────────────────────────────────────────
Imports a bank statement CSV into the `transactions` table, using the
local Ollama LLM to auto-categorise each transaction description.

Usage:
    cd backend
    python scripts/import_bank_statement.py path/to/statement.csv \\
        --account "HDFC Savings"

Supported CSV formats (auto-detected):
  • HDFC Bank  : Date, Narration, Value Dat, Debit Amount, Credit Amount, ...
  • Axis Bank  : Tran Date, CHQNO, PARTICULARS, DR, CR, BAL
  • ICICI Bank : Value Date, Transaction Remarks, Withdrawal Amount, Deposit Amount, ...
  • Generic    : date, description, amount, type  (debit/credit)

All amounts are stored as positive floats; transaction_type marks direction.
─────────────────────────────────────────────────────────────────────
"""

import argparse
import asyncio
import sys
import os
from datetime import date, datetime
from pathlib import Path

# Allow running from the backend/ directory directly
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd
from sqlalchemy.orm import Session

from database.db import SessionLocal, create_tables
from database.models import Transaction
from services.ai_service import categorize_transaction


# ── Column-name normaliser ────────────────────────────────────────────

def _norm(s: str) -> str:
    """Lowercase, strip spaces/underscores/% for fuzzy header matching."""
    return s.strip().lower().replace(" ", "").replace("_", "").replace("%", "")


# Keywords that are highly likely to appear in a bank statement header row
_HEADER_HINTS = {
    "date", "trandate", "transactiondate", "valuedate",
    "narration", "particulars", "description", "transactionremarks",
    "dr", "cr", "debit", "credit", "amount", "withdrawalamount", "depositamount",
    "chqno", "balance", "bal",
}


def _find_header_row(path: str) -> int:
    """
    Scan the file line-by-line to find the 0-based row index that contains the
    actual column headers (some banks prepend account-info rows before the data).
    Returns 0 if no metadata rows are detected.
    """
    encodings = ("utf-8-sig", "cp1252")
    for enc in encodings:
        try:
            with open(path, encoding=enc, errors="replace") as fh:
                for idx, raw_line in enumerate(fh):
                    line = raw_line.strip()
                    if not line:
                        continue
                    # Normalise each comma-separated token and count header hits
                    tokens = [_norm(t) for t in line.split(",")]
                    hits = sum(1 for t in tokens if t in _HEADER_HINTS)
                    if hits >= 2:          # at least 2 recognisable header words
                        return idx
            break
        except Exception:
            continue
    return 0


def _detect_columns(df: pd.DataFrame) -> dict:
    """
    Detect column roles from header names.
    Returns dict with keys: date, description, debit, credit, amount, txn_type.
    Raises ValueError if required columns cannot be found.
    """
    headers = {_norm(c): c for c in df.columns}

    def find(*candidates) -> str | None:
        for c in candidates:
            if c in headers:
                return headers[c]
        return None

    date_col = find("date", "trandate", "transactiondate", "valuedate", "valuedat")
    desc_col = find("narration", "particulars", "description", "transactionremarks",
                    "remarks", "details", "txndescription")
    dr_col   = find("dr", "debitamount", "withdrawalamount", "debit")
    cr_col   = find("cr", "creditamount", "depositamount", "credit")
    amt_col  = find("amount", "txnamount")
    type_col = find("type", "txntype", "transactiontype", "crdr")

    if not date_col:
        raise ValueError(f"Cannot detect date column. Found: {list(df.columns)}")
    if not desc_col:
        raise ValueError(f"Cannot detect description column. Found: {list(df.columns)}")

    return {
        "date":     date_col,
        "desc":     desc_col,
        "debit":    dr_col,
        "credit":   cr_col,
        "amount":   amt_col,
        "txn_type": type_col,
    }


def _parse_amount(val) -> float:
    """Parse a possibly comma-formatted or ₹-prefixed amount string to float."""
    if pd.isna(val) or val == "" or val is None:
        return 0.0
    return float(str(val).replace(",", "").replace("₹", "").replace(" ", "").strip() or 0)


def _parse_date(val) -> date | None:
    """Try common Indian bank date formats."""
    if pd.isna(val) or not str(val).strip():
        return None
    s = str(val).strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d %b %Y", "%Y-%m-%d",
                "%d/%m/%y", "%d-%m-%y", "%d %b %y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


# ── Core import function ──────────────────────────────────────────────

async def import_csv(
    csv_path: str,
    account_source: str = "Bank Account",
    skip_duplicates: bool = True,
    use_llm: bool = True,
    ollama_batch: bool = True,
) -> dict:
    """
    Read a bank statement CSV, categorise each row with Ollama (if available),
    and insert new transactions into the SQLite DB.

    Returns: {"imported": int, "skipped": int, "errors": int}
    """
    create_tables()

    # ── Read CSV ──────────────────────────────────────────────────────
    header_row = _find_header_row(csv_path)
    print(f"  Header row detected at index: {header_row}")
    read_kwargs = dict(skip_blank_lines=True, skiprows=header_row, on_bad_lines="skip")
    try:
        df = pd.read_csv(csv_path, encoding="utf-8-sig", **read_kwargs)
    except Exception:
        df = pd.read_csv(csv_path, encoding="cp1252", **read_kwargs)

    # Drop fully empty rows
    df.dropna(how="all", inplace=True)
    df.reset_index(drop=True, inplace=True)

    if df.empty:
        print(f"  CSV is empty: {csv_path}")
        return {"imported": 0, "skipped": 0, "errors": 0}

    cols = _detect_columns(df)
    print(f"  Detected columns: {cols}")
    print(f"  Rows to process : {len(df)}")

    # ── Build transaction rows ────────────────────────────────────────
    rows = []
    for _, row in df.iterrows():
        txn_date = _parse_date(row[cols["date"]])
        if txn_date is None:
            continue

        description = str(row[cols["desc"]]).strip()
        if not description or description.lower() in ("nan", ""):
            continue

        # Determine amount and type
        if cols["debit"] and cols["credit"]:
            debit  = _parse_amount(row.get(cols["debit"],  0))
            credit = _parse_amount(row.get(cols["credit"], 0))
            if credit > 0 and debit == 0:
                amount, txn_type = credit, "Credit"
            elif debit > 0 and credit == 0:
                amount, txn_type = debit, "Debit"
            elif credit > 0 and debit > 0:
                # Both filled (some ICICI formats) — use net
                amount   = abs(credit - debit)
                txn_type = "Credit" if credit > debit else "Debit"
            else:
                continue    # zero row
        elif cols["amount"] and cols["txn_type"]:
            amount   = abs(_parse_amount(row.get(cols["amount"], 0)))
            raw_type = str(row.get(cols["txn_type"], "")).strip().lower()
            txn_type = "Credit" if raw_type in ("cr", "credit", "c", "+") else "Debit"
        else:
            continue   # can't determine amount

        if amount <= 0:
            continue

        rows.append({
            "date":        txn_date,
            "description": description,
            "amount":      amount,
            "txn_type":    txn_type,
        })

    if not rows:
        print("  No valid transaction rows found.")
        return {"imported": 0, "skipped": 0, "errors": 0}

    # ── LLM categorisation ────────────────────────────────────────────
    categories: list[str] = []
    if use_llm:
        print(f"  Categorising {len(rows)} transactions with Ollama…")
        # Process in small batches with progress indicator
        for i, r in enumerate(rows):
            cat = await categorize_transaction(r["description"])
            categories.append(cat)
            if (i + 1) % 10 == 0 or (i + 1) == len(rows):
                print(f"    {i + 1}/{len(rows)} categorised", end="\r")
        print()
    else:
        categories = ["Misc"] * len(rows)

    # ── DB insert ─────────────────────────────────────────────────────
    imported = skipped = errors = 0
    db: Session = SessionLocal()
    try:
        for row_data, category in zip(rows, categories):
            try:
                if skip_duplicates:
                    exists = db.query(Transaction).filter_by(
                        date        = row_data["date"],
                        description = row_data["description"],
                        amount      = row_data["amount"],
                    ).first()
                    if exists:
                        skipped += 1
                        continue

                db.add(Transaction(
                    date             = row_data["date"],
                    description      = row_data["description"],
                    amount           = row_data["amount"],
                    transaction_type = row_data["txn_type"],
                    category         = category,
                    account_source   = account_source,
                ))
                imported += 1

                if imported % 50 == 0:
                    db.commit()   # periodic commit

            except Exception as e:
                errors += 1
                print(f"  Error on row {row_data}: {e}")

        db.commit()
    finally:
        db.close()

    return {"imported": imported, "skipped": skipped, "errors": errors}


# ── CLI entry point ───────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Import a bank statement CSV into Life Dashboard"
    )
    parser.add_argument("csv_path",       help="Path to the CSV file")
    parser.add_argument("--account",      default="Bank Account",
                        help='Account label, e.g. "HDFC Savings" (default: Bank Account)')
    parser.add_argument("--no-llm",       action="store_true",
                        help="Skip Ollama categorisation (assigns Misc to all)")
    parser.add_argument("--allow-dupes",  action="store_true",
                        help="Allow duplicate rows (skipped by default)")
    args = parser.parse_args()

    if not os.path.exists(args.csv_path):
        print(f"File not found: {args.csv_path}")
        sys.exit(1)

    print(f"\nImporting: {args.csv_path}")
    print(f"Account  : {args.account}")
    print(f"LLM      : {'disabled' if args.no_llm else 'enabled (Ollama)'}")
    print()

    result = asyncio.run(import_csv(
        csv_path        = args.csv_path,
        account_source  = args.account,
        skip_duplicates = not args.allow_dupes,
        use_llm         = not args.no_llm,
    ))

    print(f"\nDone.")
    print(f"  Imported : {result['imported']}")
    print(f"  Skipped  : {result['skipped']} (duplicates)")
    print(f"  Errors   : {result['errors']}")


if __name__ == "__main__":
    main()
