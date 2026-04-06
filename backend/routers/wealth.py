"""
routers/wealth.py
─────────────────────────────────────────────────────────────
GET  /api/wealth            — aggregate net worth + breakdown
POST /api/wealth/manual     — upsert a manual asset (EPF/PPF/NPS/BANK/GOLD_GRAMS)
POST /api/wealth/stocks     — add / update a stock holding
POST /api/wealth/refresh-nav — refresh MF NAVs from mfapi.in
─────────────────────────────────────────────────────────────
"""

import os
import io
import csv
import sys
import time
import tempfile
from datetime import datetime, date
from typing import Optional
from pathlib import Path

from sqlalchemy import func

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.db import get_db
from database.models import MFHolding, StockHolding, ManualAsset, Transaction, HistoricalWealth
from services.mf_nav import search_scheme_code, refresh_nav_for_holding
from services.stock_price import get_stock_price, get_gold_price_inr_per_gram, get_multiple_prices

# ── Simple in-memory price cache (5-minute TTL) ───────────────────────
_price_cache: dict[str, float] = {}
_price_cache_ts: float = 0.0
_PRICE_TTL = 300  # seconds

router = APIRouter(prefix="/api/wealth", tags=["wealth"])

# ── Colour palettes ───────────────────────────────────────────────────
SLICE_COLORS = {
    "Mutual Funds": "#bf5af2",
    "Stocks":       "#0a84ff",
    "EPF":          "#5ac8fa",
    "PPF":          "#30d158",
    "NPS":          "#ff375f",
    "Cash / Bank":  "#ffd60a",
    "Gold":         "#ff9f0a",
}

ASSET_TYPE_COLORS = {
    "Equity": "#0a84ff",
    "Debt":   "#5ac8fa",
    "Gold":   "#ff9f0a",
    "Cash":   "#ffd60a",
}

# Keywords that mark a MF scheme as Debt (everything else → Equity)
_DEBT_KEYWORDS = [
    "ultra short", "short duration", "short term fund", "liquid",
    "money market", "overnight", "low duration", "floater",
    "floating rate", "debt", "bond", "gilt", "credit risk",
    "arbitrage", "savings fund", "conservative",
]

def _classify_mf(scheme_name: str) -> str:
    name = scheme_name.lower()
    return "Debt" if any(kw in name for kw in _DEBT_KEYWORDS) else "Equity"


# ── Pydantic schemas ──────────────────────────────────────────────────
class ManualAssetIn(BaseModel):
    asset_type: str   # EPF | PPF | NPS | BANK | GOLD_GRAMS
    value: float
    notes: Optional[str] = None


class StockHoldingIn(BaseModel):
    symbol:       str
    company_name: Optional[str] = None
    quantity:     int
    avg_price:    float


# ── Helpers ───────────────────────────────────────────────────────────
def _gold_value_inr(grams: float) -> float:
    price = get_gold_price_inr_per_gram()
    if price:
        return round(grams * price, 2)
    # Fallback: use approximate ₹9,000/gram if yfinance unavailable
    return round(grams * 9000, 2)


# ── Endpoints ─────────────────────────────────────────────────────────
@router.get("")
def get_wealth(db: Session = Depends(get_db)):
    """
    Aggregate net worth from:
      1. MF holdings  (CAS import → units × live NAV)
      2. Stock holdings (yfinance)
      3. Manual assets (EPF, PPF, NPS, Bank, Gold)
    """
    # 1. Mutual Funds
    mf_holdings = db.query(MFHolding).all()
    mf_value = round(sum(h.value for h in mf_holdings), 2)

    # 2. Stocks — batch-fetch prices from yfinance (cached for 5 min)
    stocks = db.query(StockHolding).all()
    stock_value = 0.0
    if stocks:
        global _price_cache, _price_cache_ts
        now = time.time()
        if (now - _price_cache_ts) > _PRICE_TTL or not _price_cache:
            symbols = [s.symbol for s in stocks]
            _price_cache = {k: v for k, v in get_multiple_prices(symbols).items() if v}
            _price_cache_ts = now
            # Persist fresh prices to DB
            for s in stocks:
                price = _price_cache.get(s.symbol)
                if price:
                    s.current_price = price
                    s.updated_at    = datetime.utcnow()
            db.commit()
        for s in stocks:
            price = _price_cache.get(s.symbol) or s.current_price or 0.0
            stock_value += price * s.quantity
    stock_value = round(stock_value, 2)

    # 3. Manual assets
    manual = {a.asset_type: a.value for a in db.query(ManualAsset).all()}
    epf_value  = manual.get("EPF",        0)
    ppf_value  = manual.get("PPF",        0)
    nps_value  = manual.get("NPS",        0)
    bank_value = manual.get("BANK",       0)
    gold_grams = manual.get("GOLD_GRAMS", 0)
    gold_value = _gold_value_inr(gold_grams) if gold_grams > 0 else 0

    total = mf_value + stock_value + epf_value + ppf_value + nps_value + bank_value + gold_value

    # Build slices (skip zero-value slices)
    raw_slices = [
        ("Mutual Funds", mf_value),
        ("Stocks",       stock_value),
        ("EPF",          epf_value),
        ("PPF",          ppf_value),
        ("NPS",          nps_value),
        ("Cash / Bank",  bank_value),
        ("Gold",         gold_value),
    ]

    slices = []
    for label, value in raw_slices:
        if value > 0 and total > 0:
            slices.append({
                "label":      label,
                "value":      value,
                "percentage": round((value / total) * 100, 1),
                "color":      SLICE_COLORS.get(label, "#888"),
            })

    # ── Asset-type breakdown (Equity / Debt / Gold / Cash) ────────────
    equity_mf = sum(h.value for h in mf_holdings if _classify_mf(h.scheme_name) == "Equity")
    debt_mf   = sum(h.value for h in mf_holdings if _classify_mf(h.scheme_name) == "Debt")

    asset_buckets = {
        "Equity": round(equity_mf + stock_value,              2),
        "Debt":   round(debt_mf + epf_value + ppf_value + nps_value, 2),
        "Gold":   round(gold_value,                            2),
        "Cash":   round(bank_value,                            2),
    }
    asset_type_slices = [
        {
            "label":      label,
            "value":      value,
            "percentage": round((value / total) * 100, 1) if total else 0,
            "color":      ASSET_TYPE_COLORS[label],
        }
        for label, value in asset_buckets.items()
        if value > 0
    ]

    return {
        "total_net_worth":   total,
        "slices":            slices,
        "asset_type_slices": asset_type_slices,
        "mf_count":          len(mf_holdings),
        "stock_count":       len(stocks),
        "last_updated":      datetime.utcnow().isoformat(),
    }


@router.get("/manual")
def get_manual_assets(db: Session = Depends(get_db)):
    """Return all manual asset balances as a flat dict."""
    assets = db.query(ManualAsset).all()
    return {a.asset_type: a.value for a in assets}


@router.post("/manual")
def upsert_manual_asset(body: ManualAssetIn, db: Session = Depends(get_db)):
    """Create or update a manual asset balance."""
    asset = db.query(ManualAsset).filter_by(asset_type=body.asset_type).first()
    if asset:
        asset.value      = body.value
        asset.notes      = body.notes
        asset.updated_at = datetime.utcnow()
    else:
        db.add(ManualAsset(
            asset_type=body.asset_type,
            value=body.value,
            notes=body.notes,
        ))
    db.commit()
    return {"status": "ok", "asset_type": body.asset_type, "value": body.value}


@router.get("/stocks")
def list_stocks(db: Session = Depends(get_db)):
    """Return all stock holdings with live prices."""
    holdings = db.query(StockHolding).all()
    result = []
    for s in holdings:
        price = s.current_price or s.avg_price
        result.append({
            "id":            s.id,
            "symbol":        s.symbol,
            "company_name":  s.company_name,
            "quantity":      s.quantity,
            "avg_price":     s.avg_price,
            "current_price": price,
            "value":         round(price * s.quantity, 2),
            "gain_loss":     round((price - s.avg_price) * s.quantity, 2),
            "gain_pct":      round(((price - s.avg_price) / s.avg_price) * 100, 2) if s.avg_price else 0,
        })
    return result


@router.post("/stocks")
def upsert_stock(body: StockHoldingIn, db: Session = Depends(get_db)):
    """Add or update a Zerodha stock holding."""
    holding = db.query(StockHolding).filter_by(symbol=body.symbol.upper()).first()
    if holding:
        holding.quantity     = body.quantity
        holding.avg_price    = body.avg_price
        holding.company_name = body.company_name
        holding.updated_at   = datetime.utcnow()
    else:
        db.add(StockHolding(
            symbol=body.symbol.upper(),
            company_name=body.company_name,
            quantity=body.quantity,
            avg_price=body.avg_price,
        ))
    db.commit()
    return {"status": "ok", "symbol": body.symbol.upper()}


@router.delete("/stocks/{symbol}")
def delete_stock(symbol: str, db: Session = Depends(get_db)):
    holding = db.query(StockHolding).filter_by(symbol=symbol.upper()).first()
    if not holding:
        raise HTTPException(404, "Stock not found")
    db.delete(holding)
    db.commit()
    return {"status": "ok"}


@router.post("/stocks/import-csv")
async def import_stocks_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Import Zerodha holdings CSV.
    Zerodha Console export columns:
      Instrument, Qty, Avg cost, LTP, Cur val, P&L, Net chg%, Day chg%
    Also handles alternate headers like: Symbol, Quantity, Average Price, ...
    """
    content = await file.read()
    text = content.decode("utf-8-sig", errors="replace")  # strip BOM if present
    reader = csv.DictReader(io.StringIO(text))

    # Normalise header names
    def norm(s: str) -> str:
        return s.strip().lower().replace(" ", "").replace("_", "").replace("%", "")

    rows = list(reader)
    if not rows:
        raise HTTPException(400, "Empty CSV file")

    # Map flexible column names
    sample = {norm(k): k for k in rows[0].keys()}

    def col(*candidates):
        for c in candidates:
            if c in sample:
                return sample[c]
        return None

    symbol_col  = col("instrument", "symbol", "tradingsymbol", "stock")
    qty_col     = col("qty", "quantity", "shares")
    avgcost_col = col("avgcost", "avgprice", "averageprice", "purchaseprice", "buyprice")
    ltp_col     = col("ltp", "lastprice", "currentprice", "closingprice", "price")
    name_col    = col("companyname", "name", "company")

    if not symbol_col or not qty_col or not avgcost_col:
        raise HTTPException(400,
            f"Could not find required columns. Found: {list(rows[0].keys())}. "
            "Expected: Instrument/Symbol, Qty/Quantity, Avg cost/Average Price")

    def parse_num(s: str) -> float:
        return float(str(s).replace(",", "").replace("₹", "").strip() or 0)

    imported, skipped = 0, 0
    for row in rows:
        symbol = str(row.get(symbol_col, "")).strip().upper()
        if not symbol or symbol in ("", "INSTRUMENT", "SYMBOL"):
            skipped += 1
            continue

        qty = int(parse_num(row.get(qty_col, 0)))
        if qty <= 0:
            skipped += 1
            continue

        avg_price = parse_num(row.get(avgcost_col, 0))
        ltp       = parse_num(row.get(ltp_col, 0)) if ltp_col else 0
        name      = str(row.get(name_col, "")).strip() if name_col else None

        holding = db.query(StockHolding).filter_by(symbol=symbol).first()
        if holding:
            holding.quantity      = qty
            holding.avg_price     = avg_price
            holding.current_price = ltp if ltp > 0 else holding.current_price
            holding.company_name  = name or holding.company_name
            holding.updated_at    = datetime.utcnow()
        else:
            db.add(StockHolding(
                symbol=symbol,
                company_name=name,
                quantity=qty,
                avg_price=avg_price,
                current_price=ltp if ltp > 0 else None,
            ))
        imported += 1

    db.commit()
    return {"status": "ok", "imported": imported, "skipped": skipped}


@router.post("/refresh-nav")
async def refresh_mf_nav(db: Session = Depends(get_db)):
    """
    Refresh live NAV for all MF holdings from mfapi.in.
    Automatically resolves scheme_code if not yet stored.
    Returns count of successfully updated holdings.
    """
    holdings = db.query(MFHolding).all()
    updated = 0

    for h in holdings:
        # Resolve scheme_code once if not stored
        if not h.scheme_code:
            code = await search_scheme_code(h.scheme_name)
            if code:
                h.scheme_code = code

        if h.scheme_code:
            result = await refresh_nav_for_holding(h.scheme_code, h.units)
            if result:
                h.nav        = result["nav"]
                h.value      = result["value"]
                h.nav_date   = datetime.utcnow().date()
                h.updated_at = datetime.utcnow()
                updated += 1

    db.commit()
    return {"status": "ok", "updated": updated, "total": len(holdings)}


# ════════════════════════════════════════════════════════════════════
#  Financial Analytics — Trends, Savings Rate, Forecast, Snapshot
# ════════════════════════════════════════════════════════════════════

def _last_n_months(n: int) -> list[str]:
    """Return the last n month strings in YYYY-MM format, oldest first."""
    today  = date.today()
    months = []
    for i in range(n - 1, -1, -1):
        m = (today.month - i - 1) % 12 + 1
        y = today.year - ((i - today.month + 1 + 12) // 12 if (today.month - i - 1) < 0 else 0)
        months.append(f"{y}-{m:02d}")
    return months


def _month_income_expenses(db: Session, month_year: str) -> tuple[float, float]:
    """Sum Credit and Debit transactions for a given YYYY-MM."""
    income = db.query(func.sum(Transaction.amount)).filter(
        Transaction.transaction_type == "Credit",
        func.strftime("%Y-%m", Transaction.date) == month_year,
    ).scalar() or 0.0

    expenses = db.query(func.sum(Transaction.amount)).filter(
        Transaction.transaction_type == "Debit",
        func.strftime("%Y-%m", Transaction.date) == month_year,
    ).scalar() or 0.0

    return round(float(income), 2), round(float(expenses), 2)


def _current_net_worth_simple(db: Session) -> float:
    """Fast net-worth estimate from DB values (no live yfinance calls)."""
    manual   = {a.asset_type: a.value for a in db.query(ManualAsset).all()}
    mf_val   = sum(h.value for h in db.query(MFHolding).all())
    stk_val  = sum(
        (s.current_price or s.avg_price) * s.quantity
        for s in db.query(StockHolding).all()
    )
    gold_g   = manual.get("GOLD_GRAMS", 0)
    gold_val = gold_g * 9_000 if gold_g > 0 else 0   # ₹9k/g fallback
    return round(
        mf_val + stk_val +
        manual.get("EPF", 0) + manual.get("PPF", 0) +
        manual.get("NPS", 0) + manual.get("BANK", 0) + gold_val,
        2,
    )


@router.get("/trends")
def get_wealth_trends(db: Session = Depends(get_db)):
    """
    Returns 12 months of income, expenses, and net-worth snapshots.
    Net worth comes from historical_wealth snapshots if available;
    falls back to the latest known value for months without a snapshot.
    """
    months  = _last_n_months(12)
    latest_nw = _current_net_worth_simple(db)

    result = []
    for my in months:
        income, expenses = _month_income_expenses(db, my)
        snapshot = db.query(HistoricalWealth).filter_by(month_year=my).first()
        result.append({
            "month":     my,
            "income":    income,
            "expenses":  expenses,
            "net_worth": round(snapshot.total_net_worth, 2) if snapshot else (
                latest_nw if my == months[-1] else None
            ),
            "has_data":  income > 0 or expenses > 0,
        })

    return {"months": result, "has_transactions": any(r["has_data"] for r in result)}


@router.get("/savings-rate")
def get_savings_rate(db: Session = Depends(get_db)):
    """
    Current-month savings rate and trailing 6-month average.
    Returns zero rates when no transaction data exists yet.
    """
    today    = date.today()
    curr_my  = f"{today.year}-{today.month:02d}"

    income_now, expenses_now = _month_income_expenses(db, curr_my)
    savings_now = income_now - expenses_now
    rate_now    = (savings_now / income_now * 100) if income_now > 0 else 0.0

    # Trailing 6 months (excluding current)
    past_months = _last_n_months(7)[:-1]   # 6 complete past months
    total_inc_6m = total_exp_6m = 0.0
    for my in past_months:
        inc, exp = _month_income_expenses(db, my)
        total_inc_6m += inc
        total_exp_6m += exp

    avg_savings_6m = (total_inc_6m - total_exp_6m) / 6
    rate_6m        = (
        (total_inc_6m - total_exp_6m) / total_inc_6m * 100
        if total_inc_6m > 0 else 0.0
    )

    return {
        "current_month":              curr_my,
        "income_this_month":          income_now,
        "expenses_this_month":        expenses_now,
        "savings_this_month":         round(savings_now, 2),
        "savings_rate_pct":           round(rate_now, 1),
        "trailing_6m_avg_income":     round(total_inc_6m / 6, 2),
        "trailing_6m_avg_expenses":   round(total_exp_6m / 6, 2),
        "trailing_6m_avg_savings":    round(avg_savings_6m, 2),
        "trailing_6m_savings_rate_pct": round(rate_6m, 1),
        "has_data":                   income_now > 0 or total_inc_6m > 0,
    }


@router.get("/forecast")
def get_wealth_forecast(db: Session = Depends(get_db)):
    """
    5-year wealth projection.
    Assumes 8% annualised return (compounded monthly) + trailing-6m avg savings.
    Falls back to ₹30,000/month savings if no transaction history exists.
    """
    # Get current net worth (prefer latest snapshot, fall back to live estimate)
    latest_snap = (
        db.query(HistoricalWealth)
        .order_by(HistoricalWealth.month_year.desc())
        .first()
    )
    current_nw = latest_snap.total_net_worth if latest_snap else _current_net_worth_simple(db)

    # Get monthly savings from trailing 6-month average
    past_months = _last_n_months(7)[:-1]
    total_savings_6m = sum(
        _month_income_expenses(db, my)[0] - _month_income_expenses(db, my)[1]
        for my in past_months
    )
    monthly_savings = max(total_savings_6m / 6, 0)
    if monthly_savings < 1000:          # no data yet — use ₹30k default
        monthly_savings = 30_000.0

    monthly_rate = 0.08 / 12           # 8% annualised → monthly

    today       = date.today()
    data_points = [{"year": today.year, "label": str(today.year), "value": round(current_nw, 0)}]

    value = current_nw
    for month in range(1, 61):         # 60 months = 5 years
        value = value * (1 + monthly_rate) + monthly_savings
        if month % 12 == 0:
            yr = today.year + month // 12
            data_points.append({"year": yr, "label": str(yr), "value": round(value, 0)})

    return {
        "current_net_worth":      round(current_nw, 0),
        "monthly_savings_assumed": round(monthly_savings, 0),
        "annual_return_pct":      8.0,
        "projection_years":       5,
        "data_points":            data_points,
    }


@router.post("/snapshot")
def take_wealth_snapshot(db: Session = Depends(get_db)):
    """
    Capture a net-worth snapshot for the current month and persist it.
    Call this at month-end (or manually) to build historical_wealth data.
    Upserts — safe to call multiple times in the same month.
    """
    today      = date.today()
    month_year = f"{today.year}-{today.month:02d}"

    manual   = {a.asset_type: a.value for a in db.query(ManualAsset).all()}
    mf_val   = sum(h.value for h in db.query(MFHolding).all())
    stk_val  = sum(
        (s.current_price or s.avg_price) * s.quantity
        for s in db.query(StockHolding).all()
    )
    gold_g   = manual.get("GOLD_GRAMS", 0)
    gold_val = gold_g * 9_000 if gold_g > 0 else 0

    liquid   = manual.get("BANK", 0)
    invested = round(mf_val + stk_val + manual.get("EPF", 0) +
                     manual.get("PPF", 0) + manual.get("NPS", 0) + gold_val, 2)
    total    = round(liquid + invested, 2)

    snap = db.query(HistoricalWealth).filter_by(month_year=month_year).first()
    if snap:
        snap.total_net_worth = total
        snap.total_liquid    = liquid
        snap.total_invested  = invested
        snap.updated_at      = datetime.utcnow()
    else:
        db.add(HistoricalWealth(
            month_year      = month_year,
            total_net_worth = total,
            total_liquid    = liquid,
            total_invested  = invested,
        ))
    db.commit()

    return {
        "status":     "ok",
        "month_year": month_year,
        "total_net_worth": total,
        "total_liquid":    liquid,
        "total_invested":  invested,
    }


@router.post("/import-statement")
async def import_statement(
    file:    UploadFile = File(...),
    account: str        = Form(default="Bank Account"),
    no_llm:  bool       = Form(default=False),
):
    """
    Upload a bank statement CSV and import transactions into the DB.
    Returns { imported, skipped, errors }.
    """
    # Add scripts/ dir to path so we can import import_csv
    scripts_dir = str(Path(__file__).resolve().parents[1] / "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)

    try:
        from import_bank_statement import import_csv
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"Import module unavailable: {e}")

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    # Save upload to a temp file
    contents = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        result = await import_csv(
            csv_path       = tmp_path,
            account_source = account,
            skip_duplicates= True,
            use_llm        = not no_llm,
        )
    finally:
        os.unlink(tmp_path)

    return {
        "status":   "ok",
        "imported": result["imported"],
        "skipped":  result["skipped"],
        "errors":   result["errors"],
        "filename": file.filename,
    }
