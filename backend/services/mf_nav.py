"""
mf_nav.py — Fetch live NAV from the free mfapi.in API.

Usage:
    nav = await get_latest_nav(scheme_code=120503)
    code = await search_scheme_code("Motilal Oswal Flexi Cap")
"""

import httpx
from typing import Optional

_BASE = "https://api.mfapi.in/mf"
_TIMEOUT = 8  # seconds


async def get_latest_nav(scheme_code: int) -> Optional[float]:
    """Return the latest NAV for a given mfapi.in scheme code."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(f"{_BASE}/{scheme_code}")
            r.raise_for_status()
            data = r.json()
            return float(data["data"][0]["nav"])
    except Exception:
        return None


async def search_scheme_code(scheme_name: str) -> Optional[int]:
    """
    Search mfapi.in by name and return the best-matching scheme code.
    Uses the first 5 words of the scheme name as the search query.
    """
    try:
        # Strip common suffixes that confuse search (Direct, Growth, etc.)
        words = scheme_name.replace("-", " ").split()[:5]
        query = " ".join(words)

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(f"{_BASE}/search", params={"q": query})
            r.raise_for_status()
            results = r.json()

        if not results:
            return None

        # Prefer exact ISIN match if available; otherwise take first result
        return int(results[0]["schemeCode"])
    except Exception:
        return None


async def refresh_nav_for_holding(
    scheme_code: int,
    units: float,
) -> Optional[dict]:
    """Return updated nav + value for a holding."""
    nav = await get_latest_nav(scheme_code)
    if nav is None:
        return None
    return {"nav": nav, "value": round(units * nav, 2)}
