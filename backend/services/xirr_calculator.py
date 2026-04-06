"""
services/xirr_calculator.py
────────────────────────────────────────────────────────────────────
Pure-math utilities for portfolio return calculations.

  calculate_xirr(cashflows)  — Extended IRR for irregular cashflows
  calculate_cagr(...)        — Simpler point-to-point annualised return
  portfolio_xirr_from_db(db) — Assembles cashflows from live DB state

XIRR definition
───────────────
Given a list of (date, amount) pairs where:
  • Investments are NEGATIVE (money leaving your pocket)
  • Redemptions / current value are POSITIVE (money coming back)

Find rate r such that:  Σ  amount_i / (1 + r)^t_i  =  0
where t_i = (date_i - date_0).days / 365.25

Solved via Brent's method (scipy.optimize.brentq) — guaranteed to
converge when a sign change exists in [-99%, +10000%].
Falls back to Newton–Raphson if Brent's bracket search fails.
────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import NamedTuple

import numpy as np
from scipy.optimize import brentq, newton

logger = logging.getLogger(__name__)


# ── Data structures ────────────────────────────────────────────────

class CashFlow(NamedTuple):
    date:   date
    amount: float   # negative = outflow (buy), positive = inflow (sell / current value)


class XIRRResult(NamedTuple):
    xirr:         float | None    # annualised rate, e.g. 0.142 means 14.2 %
    xirr_pct:     float | None    # same, as percentage string-ready float
    cagr:         float | None    # simple point-to-point CAGR
    total_invested: float
    current_value:  float
    absolute_gain:  float
    gain_pct:       float
    years:          float
    method:         str           # "xirr" | "cagr_fallback" | "insufficient_data"
    error:          str | None


# ── Core XIRR math ────────────────────────────────────────────────

def _npv(rate: float, cashflows: list[CashFlow]) -> float:
    """Net present value at the given rate."""
    t0 = cashflows[0].date
    total = 0.0
    for cf in cashflows:
        t = (cf.date - t0).days / 365.25
        total += cf.amount / (1.0 + rate) ** t
    return total


def _dnpv(rate: float, cashflows: list[CashFlow]) -> float:
    """Derivative of NPV w.r.t. rate (used by Newton–Raphson)."""
    t0 = cashflows[0].date
    total = 0.0
    for cf in cashflows:
        t = (cf.date - t0).days / 365.25
        if t == 0:
            continue
        total -= t * cf.amount / (1.0 + rate) ** (t + 1)
    return total


def calculate_xirr(cashflows: list[CashFlow]) -> XIRRResult:
    """
    Calculate XIRR for a series of cashflows.

    Rules for valid input:
      • At least 2 cashflows
      • At least one negative (investment) and one positive (return)
      • Dates must span at least 1 day

    Returns XIRRResult with xirr=None and an error message on failure.
    """
    if len(cashflows) < 2:
        return XIRRResult(
            xirr=None, xirr_pct=None, cagr=None,
            total_invested=0, current_value=0, absolute_gain=0,
            gain_pct=0, years=0, method="insufficient_data",
            error="Need at least 2 cashflows",
        )

    # Sort chronologically
    cashflows = sorted(cashflows, key=lambda c: c.date)

    # All dates identical → can't compute a time-based return
    unique_dates = {c.date for c in cashflows}
    if len(unique_dates) == 1:
        investments = sum(-c.amount for c in cashflows if c.amount < 0)
        returns     = sum( c.amount for c in cashflows if c.amount > 0)
        abs_gain    = returns - investments
        gain_pct    = (abs_gain / investments * 100) if investments else 0
        return XIRRResult(
            xirr=None, xirr_pct=None, cagr=None,
            total_invested=round(investments, 2),
            current_value=round(returns, 2),
            absolute_gain=round(abs_gain, 2),
            gain_pct=round(gain_pct, 2),
            years=0,
            method="insufficient_data",
            error="All cashflows share the same date — purchase date history required for XIRR.",
        )

    investments = sum(-c.amount for c in cashflows if c.amount < 0)
    returns     = sum( c.amount for c in cashflows if c.amount > 0)

    if investments == 0 or returns == 0:
        return XIRRResult(
            xirr=None, xirr_pct=None, cagr=None,
            total_invested=investments, current_value=returns,
            absolute_gain=returns - investments,
            gain_pct=((returns / investments) - 1) * 100 if investments else 0,
            years=0, method="insufficient_data",
            error="Need both inflows and outflows",
        )

    years       = (cashflows[-1].date - cashflows[0].date).days / 365.25
    abs_gain    = returns - investments
    gain_pct    = (abs_gain / investments) * 100

    # Simple CAGR as fallback
    cagr = ((returns / investments) ** (1 / years) - 1) if years > 0 else None

    # ── Try Brent's method first ──
    xirr_val = None
    method   = "insufficient_data"
    error    = None

    try:
        # Bracket search: XIRR must lie in (-0.999, +100.0) for realistic portfolios
        lo, hi = -0.999, 100.0
        npv_lo = _npv(lo, cashflows)
        npv_hi = _npv(hi, cashflows)

        if npv_lo * npv_hi < 0:
            xirr_val = brentq(_npv, lo, hi, args=(cashflows,), xtol=1e-8, maxiter=1000)
            method   = "xirr"
        else:
            raise ValueError(f"No sign change in bracket: NPV({lo})={npv_lo:.2f}, NPV({hi})={npv_hi:.2f}")

    except Exception as brent_err:
        # ── Fall back to Newton–Raphson ──
        logger.debug("Brent failed (%s), trying Newton–Raphson", brent_err)
        try:
            guess    = cagr if cagr is not None else 0.10
            xirr_val = newton(
                _npv, x0=guess,
                fprime=_dnpv,
                args=(cashflows,),
                tol=1e-8, maxiter=500,
            )
            method = "xirr"
        except Exception as newton_err:
            logger.warning("XIRR both methods failed: %s | %s", brent_err, newton_err)
            method = "cagr_fallback"
            error  = f"XIRR solver failed; showing CAGR. ({newton_err})"

    return XIRRResult(
        xirr         = xirr_val,
        xirr_pct     = round(xirr_val * 100, 2) if xirr_val is not None else None,
        cagr         = round(cagr * 100, 2)      if cagr      is not None else None,
        total_invested = round(investments, 2),
        current_value  = round(returns, 2),
        absolute_gain  = round(abs_gain, 2),
        gain_pct       = round(gain_pct, 2),
        years          = round(years, 2),
        method         = method,
        error          = error,
    )


def calculate_cagr(
    start_value: float,
    end_value:   float,
    start_date:  date,
    end_date:    date,
) -> float | None:
    """Simple Compound Annual Growth Rate."""
    years = (end_date - start_date).days / 365.25
    if years <= 0 or start_value <= 0:
        return None
    return round(((end_value / start_value) ** (1 / years) - 1) * 100, 2)


# ── DB-aware assembler ────────────────────────────────────────────

def portfolio_xirr_from_db(db) -> dict:
    """
    Assemble portfolio cashflows from the live database and calculate XIRR.

    Limitation: we store current holdings (units × NAV) but not individual
    transaction dates. Strategy:
      • MF holdings  → use nav_date as the single "purchase" proxy date
      • Stock holdings → use updated_at date
      • Current value → today, positive cashflow

    This gives an approximation. True XIRR requires full transaction history
    (available once we parse the transaction section of the CAMS statement).
    """
    from database.models import MFHolding, StockHolding
    from datetime import date as date_cls

    today       = date_cls.today()
    cashflows   = []
    total_cost  = 0.0
    total_value = 0.0

    # ── MF holdings ──
    mf_holdings = db.query(MFHolding).filter(MFHolding.units > 0).all()
    for h in mf_holdings:
        # Cost value from the CAMS statement (market value at import time)
        # We treat it as investment on nav_date (proxy for purchase)
        proxy_date = h.nav_date or today
        # Units > 0 means money was put in — use current value as cost proxy
        # (true cost requires transaction history)
        cost = h.value   # best approximation without transaction data
        total_cost  += cost
        total_value += h.value
        cashflows.append(CashFlow(date=proxy_date, amount=-cost))

    # ── Stock holdings ──
    stock_holdings = db.query(StockHolding).all()
    for s in stock_holdings:
        cost  = s.avg_price * s.quantity
        value = (s.current_price or s.avg_price) * s.quantity
        proxy_date = s.updated_at.date() if s.updated_at else today
        total_cost  += cost
        total_value += value
        cashflows.append(CashFlow(date=proxy_date, amount=-cost))

    # ── Current value as terminal positive cashflow (today) ──
    cashflows.append(CashFlow(date=today, amount=total_value))

    result = calculate_xirr(cashflows)

    return {
        "xirr_pct":        result.xirr_pct,
        "cagr_pct":        result.cagr,
        "total_invested":  result.total_invested,
        "current_value":   result.current_value,
        "absolute_gain":   result.absolute_gain,
        "gain_pct":        result.gain_pct,
        "years":           result.years,
        "method":          result.method,
        "note": (
            "XIRR is approximate — individual transaction dates not yet available. "
            "Import full CAMS transaction history for precise XIRR."
            if result.method != "xirr" or not mf_holdings else None
        ),
        "error": result.error,
    }
