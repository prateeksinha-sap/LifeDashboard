"""
scripts/import_active_statement.py
────────────────────────────────────────────────────────────
Parses CAMS ActiveStatement PDF (the kind sent as Gmail attachment)
and populates the MF holdings in dashboard.db.

Usage (from the backend/ folder):
    python scripts/import_active_statement.py
    python scripts/import_active_statement.py path/to/cas.pdf
────────────────────────────────────────────────────────────
"""

import sys
import re
import os
import html as html_mod
from pathlib import Path
from datetime import date, timedelta

# Allow imports from backend root
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()

import fitz  # PyMuPDF

from database.db import create_tables, SessionLocal
from database.models import MFHolding, ManualAsset, Bill, Priority, Todo


# ── Default seed data ─────────────────────────────────────────────────
DEFAULT_PRIORITIES = [
    "Review Q2 financial plan",
    "Pay Axis Bank PPF contribution",
    "Rebalance MF portfolio",
    "Book annual health checkup",
    "Review Zerodha holdings",
    "File advance tax if applicable",
    "Family outing plan",
]

def _today_plus(days):
    return date.today() + timedelta(days=days)

DEFAULT_BILLS = [
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
    if db.query(Priority).count() == 0:
        print("  Seeding priorities...")
        for i, text in enumerate(DEFAULT_PRIORITIES, 1):
            db.add(Priority(rank=i, text=text))

    if db.query(Bill).count() == 0:
        print("  Seeding bills...")
        for name, amount, days, recurrence in DEFAULT_BILLS:
            db.add(Bill(
                name=name, amount=amount,
                due_date=_today_plus(days),
                is_recurring=True, recurrence_days=recurrence,
            ))

    if db.query(Todo).count() == 0:
        print("  Seeding todos...")
        for text in DEFAULT_TODOS:
            db.add(Todo(text=text))

    for asset_type in ("EPF", "PPF", "NPS", "BANK", "GOLD_GRAMS"):
        if not db.query(ManualAsset).filter_by(asset_type=asset_type).first():
            db.add(ManualAsset(asset_type=asset_type, value=0))

    db.commit()


def extract_html_from_pdf(pdf_path: str, password: str) -> bytes:
    """Extract the embedded HTML file from the CAMS ActiveStatement PDF."""
    doc = fitz.open(pdf_path)
    if doc.needs_pass:
        if not doc.authenticate(password):
            raise ValueError("Wrong password for PDF")

    for page_num in range(len(doc)):
        page = doc[page_num]
        for annot in page.annots():
            if annot.type[0] == 17:  # FileAttachment annotation
                data = annot.get_file()
                print(f"  Found embedded HTML: {len(data):,} bytes on page {page_num + 1}")
                return data

    raise ValueError(
        "No embedded HTML file found in PDF.\n"
        "  This script requires the CAMS 'ActiveStatement' email attachment.\n"
        "  Request it via email from: https://www.camsonline.com\n"
        "  Subject: Consolidated Account Statement - CAMS Mailback Request"
    )


def parse_holdings_from_html(html_bytes: bytes) -> list:
    """
    Parse MF holdings from CAMS ActiveStatement embedded HTML.

    The HTML uses document.writeln() in <script> tags.
    Portfolio Composition rows contain:
      Folio | Scheme | Asset Class | Unit Balance | NAV | Market Value | Cost Value
    """
    content = html_bytes.decode("utf-8", errors="replace")
    scripts = re.findall(r"<script[^>]*>(.*?)</script>", content, re.DOTALL | re.IGNORECASE)

    holdings = []

    for script in scripts:
        if "Unit Balance" not in script:
            continue

        # Each scheme is in a segment starting with 'var test2 = AMC_NAME'
        segments = re.split(r"(?=var\s+test2\s*=)", script)

        for seg in segments:
            amc_m   = re.search(r"var\s+test2\s*=\s*'([^']+)'", seg)
            folio_m = re.search(r"var\s+test5\s*=\s*'([^']+)'", seg)

            if not amc_m:
                continue

            amc_name = amc_m.group(1).strip()
            folio    = folio_m.group(1).strip() if folio_m else ""

            # Row line 1: folio | scheme | asset class | units | nav
            inline_pat = (
                r"document\.writeln\('\s*"
                r"<td[^>]*>([^<]*)</td>"           # folio cell
                r"<td[^>]*title=\"([^\"]*)\"[^>]*>"
                r"(.*?)"                            # scheme raw (may contain repApos)
                r"</td>"
                r"<td[^>]*>([^<]*)</td>"            # asset class
                r"<td[^>]*>([\d,]+\.?\d*)</td>"     # unit balance
                r"<td[^>]*>([\d,]+\.?\d*)</td>"     # nav
            )
            inline_rows = re.findall(inline_pat, seg, re.DOTALL)

            # Row line 2: market value | cost value | gain/loss
            mv_pat = (
                r"document\.writeln\('\s*"
                r"<td[^>]*>([\d,]+)</td>"    # market value (INR, rounded)
                r"<td[^>]*>([\d,]+)</td>"    # cost value
            )
            mv_rows = re.findall(mv_pat, seg)

            for j, row in enumerate(inline_rows):
                raw_folio, _broker, raw_scheme, asset_class, raw_units, raw_nav = row

                # Decode scheme name (may be wrapped in repApos("..."))
                scheme_m = re.search(r'repApos\("(.*?)"\)', raw_scheme)
                if scheme_m:
                    scheme_name = html_mod.unescape(scheme_m.group(1)).strip()
                else:
                    scheme_name = html_mod.unescape(raw_scheme).strip()
                scheme_name = re.sub(r"'\s*\+.*?\+\s*'", "", scheme_name).strip()

                actual_folio = raw_folio.strip() or folio
                units = float(raw_units.replace(",", "").strip())
                nav   = float(raw_nav.replace(",", "").strip())

                if units <= 0 or not scheme_name:
                    continue

                # Prefer market value from line 2; fall back to units * nav
                value = round(units * nav, 2)
                if j < len(mv_rows):
                    mv_str = mv_rows[j][0].replace(",", "").strip()
                    if mv_str:
                        value = float(mv_str)

                holdings.append({
                    "folio":       actual_folio,
                    "amc":         amc_name,
                    "scheme_name": scheme_name,
                    "asset_class": asset_class.strip(),
                    "units":       units,
                    "nav":         nav,
                    "value":       value,
                })

    return holdings


def import_active_statement(pdf_path: str, password: str, db) -> int:
    print(f"\n  Parsing: {pdf_path}")

    html_bytes = extract_html_from_pdf(pdf_path, password)

    holdings = parse_holdings_from_html(html_bytes)
    print(f"\n  Found {len(holdings)} holdings in Portfolio Composition\n")

    if not holdings:
        print("  WARNING: No holdings found.")
        print("  Tip: Save cas_extracted.html from backend/ to debug the HTML structure.")
        return 0

    # Fresh import
    db.query(MFHolding).delete()

    for h in holdings:
        db.add(MFHolding(
            folio       = h["folio"],
            amc         = h["amc"],
            scheme_name = h["scheme_name"],
            isin        = None,
            units       = h["units"],
            nav         = h["nav"],
            value       = h["value"],
            nav_date    = date.today(),
        ))
        print(f"  + {h['amc'][:22]:<22}  {h['scheme_name'][:40]:<40}  "
              f"{h['units']:>10.3f} units  Rs{h['value']:>10,.0f}")

    db.commit()
    return len(holdings)


def main():
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
    else:
        # Auto-detect in Downloads
        downloads = Path.home() / "Downloads"
        candidates = sorted(
            list(downloads.glob("*CA*.pdf")) + list(downloads.glob("*CAS*.pdf")),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if candidates:
            pdf_path = str(candidates[0])
            print(f"  Auto-detected PDF: {pdf_path}")
        else:
            pdf_path = str(Path(__file__).parent.parent / "cas.pdf")

    if not Path(pdf_path).exists():
        print(f"\nERROR: PDF not found: {pdf_path}")
        print("  Usage: python scripts/import_active_statement.py path/to/statement.pdf")
        sys.exit(1)

    password = os.getenv("CAS_PASSWORD")
    if not password:
        print("\nERROR: CAS_PASSWORD not set in .env")
        print("  Add: CAS_PASSWORD=YOURPAN01011990")
        sys.exit(1)

    print("\n" + "-" * 70)
    print("  Life Dashboard -- CAMS ActiveStatement Import")
    print("-" * 70)

    create_tables()
    db = SessionLocal()

    try:
        count = import_active_statement(pdf_path, password, db)
        if count > 0:
            print("\n" + "-" * 70)
            print("  Seeding default data (if first run)...")
            seed_defaults(db)
            print("\n  Done! Run the backend and open the dashboard.")
            print("  POST /api/wealth/manual  -- set EPF/PPF/NPS/Bank balances")
            print("  POST /api/wealth/refresh-nav  -- refresh live NAVs")
            print("-" * 70 + "\n")
    finally:
        db.close()


if __name__ == "__main__":
    main()
