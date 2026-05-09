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


def _clean_text(value) -> str:
    return (
        str(value or "")
        .replace("\xad", "")
        .replace("\u00ad", "")
        .replace("\n", " ")
        .strip()
    )


def _parse_money(value) -> float:
    text = _clean_text(value).replace(",", "").replace("`", "").replace("₹", "")
    if text in ("", "-", "None"):
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def _metadata_from_cdsl_text(pdf_path: str, password: str) -> dict[tuple[str, str], dict]:
    """Read folio metadata from the account-details section of a CDSL CAS."""
    try:
        import fitz
    except ImportError:
        return {}

    doc = fitz.open(pdf_path)
    if doc.needs_pass and not doc.authenticate(password):
        raise ValueError("Could not open CAS PDF. Please check the password.")

    metadata: dict[tuple[str, str], dict] = {}
    current: dict[str, str] | None = None

    def flush():
        nonlocal current
        if current and current.get("isin") and current.get("folio"):
            key = (current["isin"], current["folio"].replace(" ", ""))
            metadata[key] = dict(current)
        current = None

    for page in doc:
        lines = [line.strip() for line in page.get_text("text").splitlines() if line.strip()]
        i = 0
        while i < len(lines):
            line = lines[i]
            if line.startswith("AMC Name :"):
                flush()
                current = {"amc": line.split(":", 1)[1].strip()}
            elif current is not None and line.startswith("Scheme Name :"):
                parts = [line.split(":", 1)[1].strip()]
                j = i + 1
                while j < len(lines) and not lines[j].startswith("Scheme Code :"):
                    parts.append(lines[j])
                    j += 1
                current["scheme_name"] = " ".join(parts).strip()
                i = j - 1
            elif current is not None and line.startswith("Folio No :"):
                current["folio"] = line.split(":", 1)[1].strip()
            elif current is not None and line.startswith("ISIN :"):
                current["isin"] = line.split(":", 1)[1].strip()
            i += 1
    flush()
    return metadata


def import_cdsl_cas(pdf_path: str, password: str, db):
    """Fallback parser for CDSL consolidated securities CAS PDFs."""
    try:
        import pdfplumber
    except ImportError as exc:
        raise ValueError(f"CDSL CAS import requires pdfplumber: {exc}")

    metadata = _metadata_from_cdsl_text(pdf_path, password)
    holdings = []

    with pdfplumber.open(pdf_path, password=password) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                if not table or not table[0]:
                    continue
                header_text = " ".join(_clean_text(cell).lower() for cell in table[0])
                if "scheme name" not in header_text or "valuation" not in header_text:
                    continue

                for row in table[2:]:
                    if not row or not row[0]:
                        continue
                    scheme = _clean_text(row[0])
                    if not scheme or scheme.lower().startswith("grand total"):
                        continue

                    isin = _clean_text(row[1]) if len(row) > 1 else ""
                    folio = _clean_text(row[2]) if len(row) > 2 else ""
                    units = _parse_money(row[4] if len(row) > 4 else "")
                    nav = _parse_money(row[5] if len(row) > 5 else "")
                    value = _parse_money(row[7] if len(row) > 7 else "")
                    if units <= 0 or value <= 0:
                        continue

                    key = (isin, folio.replace(" ", ""))
                    meta = metadata.get(key) or metadata.get((isin, folio)) or {}
                    holdings.append({
                        "folio": meta.get("folio") or folio.replace(" ", ""),
                        "amc": meta.get("amc") or _infer_amc_from_scheme(scheme),
                        "scheme_name": meta.get("scheme_name") or scheme,
                        "isin": isin or None,
                        "units": units,
                        "nav": nav,
                        "value": value,
                    })

    if not holdings:
        raise ValueError(
            "CDSL CAS opened, but no complete per-scheme holdings valuation table was found. "
            "This is usually a monthly transaction/detail CAS; upload a CAMS/KFintech holdings CAS "
            "or a CAS that includes active units and valuation."
        )

    db.query(MFHolding).delete()
    for item in holdings:
        db.add(MFHolding(
            folio=item["folio"],
            amc=item["amc"],
            scheme_name=item["scheme_name"],
            isin=item["isin"],
            units=item["units"],
            nav=item["nav"],
            value=item["value"],
            nav_date=date.today(),
        ))
    db.commit()
    print(f"\n  Imported CDSL CAS holdings: {len(holdings)} | Value: Rs{sum(h['value'] for h in holdings):,.2f}")
    return len(holdings)


def _infer_amc_from_scheme(scheme_name: str) -> str:
    text = scheme_name.split(" - ", 1)[-1].strip()
    known = [
        "Axis", "HSBC", "Bandhan", "Mahindra Manulife", "Motilal Oswal",
        "Nippon India", "Parag Parikh", "quant", "SBI", "SUNDARAM",
        "Tata", "UTI", "WhiteOak Capital",
    ]
    lower = text.lower()
    for name in known:
        if name.lower() in lower:
            return f"{name} Mutual Fund" if "mutual fund" not in name.lower() else name
    return "Mutual Fund"


def import_cas(pdf_path: str, password: str, db):
    """Parse the CAS PDF and upsert all MF holdings."""
    print(f"\n  Parsing: {pdf_path}")
    print(f"  This may take 10-20 seconds for large statements...\n")

    try:
        data = casparser.read_cas_pdf(pdf_path, password)
    except Exception as e:
        print(f"  casparser could not parse this CAS: {e}")
        print("  Trying CDSL consolidated CAS parser...\n")
        return import_cdsl_cas(pdf_path, password, db)

    skipped = 0
    holdings = []

    for folio in data.folios:
        for scheme in folio.schemes:
            units = float(scheme.close or 0)
            if units <= 0:
                skipped += 1
                continue  # zero-unit schemes (fully redeemed)

            nav   = float(scheme.valuation.nav)   if scheme.valuation else 0.0
            value = float(scheme.valuation.value) if scheme.valuation else round(units * nav, 2)

            holdings.append({
                "folio": folio.folio,
                "amc": folio.amc,
                "scheme_name": scheme.scheme,
                "isin": scheme.isin or None,
                "units": units,
                "nav": nav,
                "value": value,
            })

    if not holdings:
        raise ValueError("Could not find active mutual fund holdings in the CAS PDF.")

    # Clear existing holdings only after the incoming CAS has active holdings.
    db.query(MFHolding).delete()
    for item in holdings:
        db.add(MFHolding(
            folio       = item["folio"],
            amc         = item["amc"],
            scheme_name = item["scheme_name"],
            isin        = item["isin"],
            units       = item["units"],
            nav         = item["nav"],
            value       = item["value"],
            nav_date    = date.today(),
        ))

        print(f"  + {item['amc'][:25]:<25}  {item['scheme_name'][:40]:<40}  "
              f"{item['units']:>10.3f} units  Rs{item['value']:>12,.0f}")

    db.commit()
    print(f"\n  Imported: {len(holdings)} active holdings  |  Skipped: {skipped} zero-unit entries")
    return len(holdings)


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
