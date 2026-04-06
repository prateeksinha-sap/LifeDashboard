"""
scripts/import_cas.py
─────────────────────────────────────────────────────────────
Parses your CAMS CAS PDF and populates the dashboard database.

Usage (from the backend/ folder):
    python scripts/import_cas.py                   # looks for cas.pdf + .env
    python scripts/import_cas.py path/to/cas.pdf   # custom path

Also seeds bills, priorities, and todos if the DB is empty.
─────────────────────────────────────────────────────────────
"""

import sys
import os
from pathlib import Path
from datetime import date, timedelta
from decimal import Decimal

# Allow imports from backend root
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()

import casparser
from database.db import create_tables, SessionLocal
from database.models import MFHolding, ManualAsset, Bill, Priority, Todo


# ── Default seed data (used only if DB is empty) ──────────────────────
DEFAULT_PRIORITIES = [
    "Review Q2 financial plan",
    "Pay Axis Bank PPF contribution",
    "Rebalance MF portfolio",
    "Book annual health checkup",
    "Review Zerodha holdings",
    "File advance tax if applicable",
    "Family outing plan",
]

def _today_plus(days: int) -> date:
    return date.today() + timedelta(days=days)

DEFAULT_BILLS = [
    # name, amount, days_from_today, recurrence_days
    ("MSEDCL Electricity",       2500,  5,  30),
    ("Tata Neu HDFC Credit Card",38450, 8,  30),
    ("Axis Bank PPF Deposit",    12500, 15, 30),
    ("NPS Contribution",          5000, 20, 30),
    ("Broadband",                  999, 12, 30),
]

DEFAULT_TODOS = [
    "Check SIP status on ET Money",
    "Review Zerodha P&L",
    "Update EPF balance from EPFO portal",
    "Book dentist appointment",
]


def seed_defaults(db):
    """Seed priorities, bills, and todos on first run."""
    if db.query(Priority).count() == 0:
        print("  - Seeding priorities...")
        for i, text in enumerate(DEFAULT_PRIORITIES, 1):
            db.add(Priority(rank=i, text=text))

    if db.query(Bill).count() == 0:
        print("  - Seeding bills...")
        for name, amount, days, recurrence in DEFAULT_BILLS:
            db.add(Bill(
                name=name,
                amount=amount,
                due_date=_today_plus(days),
                is_recurring=True,
                recurrence_days=recurrence,
            ))

    if db.query(Todo).count() == 0:
        print("  - Seeding todos...")
        for text in DEFAULT_TODOS:
            db.add(Todo(text=text))

    # Seed manual asset placeholders so they show up in wealth API
    for asset_type in ("EPF", "PPF", "NPS", "BANK", "GOLD_GRAMS"):
        if not db.query(ManualAsset).filter_by(asset_type=asset_type).first():
            db.add(ManualAsset(asset_type=asset_type, value=0))

    db.commit()


def import_cas(pdf_path: str, password: str, db):
    """Parse the CAS PDF and upsert all MF holdings."""
    print(f"\n  Parsing: {pdf_path}")
    print(f"  This may take 10-20 seconds for large statements...\n")

    try:
        data = casparser.read_cas_pdf(pdf_path, password)
    except Exception as e:
        print(f"  FAILED to parse PDF: {e}")
        print("  Check that the password is correct (PAN uppercase + DDMMYYYY)")
        return 0

    # Clear existing holdings before fresh import
    db.query(MFHolding).delete()

    count = 0
    skipped = 0

    for folio in data.folios:
        for scheme in folio.schemes:
            units = float(scheme.close or 0)
            if units <= 0:
                skipped += 1
                continue  # zero-unit schemes (fully redeemed)

            nav   = float(scheme.valuation.nav)   if scheme.valuation else 0.0
            value = float(scheme.valuation.value) if scheme.valuation else round(units * nav, 2)

            holding = MFHolding(
                folio       = folio.folio,
                amc         = folio.amc,
                scheme_name = scheme.scheme,
                isin        = scheme.isin or None,
                units       = units,
                nav         = nav,
                value       = value,
                nav_date    = date.today(),
            )
            db.add(holding)
            count += 1

            print(f"  + {folio.amc[:25]:<25}  {scheme.scheme[:40]:<40}  "
                  f"{units:>10.3f} units  Rs{value:>12,.0f}")

    db.commit()
    print(f"\n  Imported: {count} active holdings  |  Skipped: {skipped} zero-unit entries")
    return count


def main():
    # Resolve PDF path
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
    else:
        pdf_path = str(Path(__file__).parent.parent / "cas.pdf")

    if not Path(pdf_path).exists():
        print(f"\n✗  PDF not found at: {pdf_path}")
        print("   Download the CAS attachment from your Gmail and save it as:")
        print(f"   {pdf_path}")
        sys.exit(1)

    password = os.getenv("CAS_PASSWORD")
    if not password:
        print("\n✗  CAS_PASSWORD not set in .env")
        print("   Add: CAS_PASSWORD=YOURPAN01011990")
        sys.exit(1)

    print("\n" + "-" * 70)
    print("  Life Dashboard -- CAS Import")
    print("-" * 70)

    create_tables()
    db = SessionLocal()

    try:
        count = import_cas(pdf_path, password, db)
        if count > 0:
            print("\n" + "-" * 70)
            print("  Seeding default data (if first run)...")
            seed_defaults(db)
            print("\n  Done! Run the backend and open the dashboard.")
            print("  Next: POST /api/wealth/manual to update EPF/PPF/NPS/Bank")
            print("  Next: POST /api/wealth/refresh-nav to refresh live NAVs")
            print("-" * 70 + "\n")
    finally:
        db.close()


if __name__ == "__main__":
    main()
