from __future__ import annotations

import csv
import io
import re
import time
from typing import Any

import httpx


NSE_INDEX_API = "https://www.nseindia.com/api/equity-stockIndices"
NSE_HOME = "https://www.nseindia.com/"
USER_AGENT = "LifeDashboard/1.0 (+local personal finance dashboard)"

INDEX_CONSTITUENT_CSVS = {
    "NIFTY 50": "https://www.niftyindices.com/IndexConstituent/ind_nifty50list.csv",
    "NIFTY NEXT 50": "https://www.niftyindices.com/IndexConstituent/ind_niftynext50list.csv",
    "NIFTY MIDCAP 150": "https://www.niftyindices.com/IndexConstituent/ind_niftymidcap150list.csv",
    "NIFTY SMALLCAP 250": "https://www.niftyindices.com/IndexConstituent/ind_niftysmallcap250list.csv",
}

_CACHE_TTL_SECONDS = 6 * 60 * 60
_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def _norm(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _safe_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def identify_index_for_security(symbol: str | None, name: str | None) -> str | None:
    """Return the underlying index for common Indian index ETFs/funds."""
    symbol_key = _norm(symbol)
    text = _norm(f"{symbol or ''} {name or ''}")

    if symbol_key in {"niftybees", "netfnifty", "niftyietf"}:
        return "NIFTY 50"
    if symbol_key in {"juniorbees", "juniorbeesn"}:
        return "NIFTY NEXT 50"

    if "niftysmallcap250" in text or "smallcap250" in text:
        return "NIFTY SMALLCAP 250"
    if "niftymidcap150" in text or "midcap150" in text:
        return "NIFTY MIDCAP 150"
    if "niftynext50" in text or "juniorbees" in text:
        return "NIFTY NEXT 50"
    if "nifty50" in text or "niftybees" in text:
        return "NIFTY 50"

    return None


def _headers() -> dict[str, str]:
    return {
        "User-Agent": USER_AGENT,
        "Accept": "application/json,text/plain,*/*",
        "Referer": "https://www.nseindia.com/market-data/live-equity-market",
    }


def _from_nse_api(index_name: str) -> list[dict[str, Any]]:
    with httpx.Client(timeout=20.0, follow_redirects=True, headers=_headers()) as client:
        client.get(NSE_HOME)
        response = client.get(NSE_INDEX_API, params={"index": index_name})
        response.raise_for_status()
        payload = response.json()

    rows = [
        row for row in payload.get("data", [])
        if str(row.get("symbol") or "").upper() != index_name.upper()
        and _safe_float(row.get("ffmc")) > 0
    ]
    total_ffmc = sum(_safe_float(row.get("ffmc")) for row in rows)
    if not rows or total_ffmc <= 0:
        return []

    constituents: list[dict[str, Any]] = []
    for row in rows:
        meta = row.get("meta") or {}
        ffmc = _safe_float(row.get("ffmc"))
        constituents.append({
            "symbol": str(row.get("symbol") or meta.get("symbol") or "").strip().upper() or None,
            "stock_name": str(meta.get("companyName") or row.get("symbol") or "").strip(),
            "isin": str(meta.get("isin") or "").strip().upper() or None,
            "sector": str(meta.get("industry") or "").strip() or None,
            "weight_pct": round(ffmc / total_ffmc * 100, 6),
            "source": f"NSE live index ffmc: {index_name}",
            "weight_method": "free_float_market_cap",
        })
    return constituents


def _from_constituent_csv(index_name: str) -> list[dict[str, Any]]:
    url = INDEX_CONSTITUENT_CSVS.get(index_name)
    if not url:
        return []
    response = httpx.get(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/csv,*/*"},
        timeout=20.0,
        follow_redirects=True,
    )
    response.raise_for_status()
    content = response.content.decode("utf-8-sig", errors="replace")
    rows = list(csv.DictReader(io.StringIO(content)))
    if not rows:
        return []
    equal_weight = round(100 / len(rows), 6)
    return [
        {
            "symbol": str(row.get("Symbol") or "").strip().upper() or None,
            "stock_name": str(row.get("Company Name") or row.get("Symbol") or "").strip(),
            "isin": str(row.get("ISIN Code") or "").strip().upper() or None,
            "sector": str(row.get("Industry") or "").strip() or None,
            "weight_pct": equal_weight,
            "source": f"Nifty Indices constituent CSV equal-weight fallback: {index_name}",
            "weight_method": "equal_weight_fallback",
        }
        for row in rows
    ]


def get_index_constituents(index_name: str) -> list[dict[str, Any]]:
    """Fetch index constituents and approximate weights with a short-lived cache."""
    now = time.time()
    cached = _CACHE.get(index_name)
    if cached and now - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]

    constituents: list[dict[str, Any]] = []
    try:
        constituents = _from_nse_api(index_name)
    except Exception:
        constituents = []

    if not constituents:
        try:
            constituents = _from_constituent_csv(index_name)
        except Exception:
            constituents = []

    if constituents:
        _CACHE[index_name] = (now, constituents)
    return constituents
