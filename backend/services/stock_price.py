"""
stock_price.py — Fetch live NSE stock prices via yfinance.
Also fetches live gold price (MCX via COMEX futures + USD/INR).

yfinance uses Yahoo Finance data (15-min delayed, free, no API key).
NSE symbols require the ".NS" suffix.
"""

import yfinance as yf
from typing import Optional


def get_stock_price(nse_symbol: str) -> Optional[float]:
    """
    Fetch the latest price for an NSE-listed stock.
    nse_symbol: e.g. "RELIANCE", "INFY", "HDFCBANK"
    """
    try:
        ticker = yf.Ticker(f"{nse_symbol.upper()}.NS")
        price = ticker.fast_info.last_price
        if price and price > 0:
            return round(float(price), 2)
        return None
    except Exception:
        return None


def get_gold_price_inr_per_gram() -> Optional[float]:
    """
    Live gold price in ₹ per gram.
    Uses COMEX Gold Futures (GC=F in USD/troy oz) × USD/INR rate.
    1 troy ounce = 31.1035 grams
    """
    try:
        gold_usd_per_oz = yf.Ticker("GC=F").fast_info.last_price
        usd_inr         = yf.Ticker("USDINR=X").fast_info.last_price

        if not gold_usd_per_oz or not usd_inr:
            return None

        inr_per_gram = (float(gold_usd_per_oz) * float(usd_inr)) / 31.1035
        return round(inr_per_gram, 2)
    except Exception:
        return None


def get_multiple_prices(nse_symbols: list[str]) -> dict[str, Optional[float]]:
    """
    Batch-fetch prices for a list of NSE symbols.
    More efficient than individual calls.
    """
    if not nse_symbols:
        return {}

    tickers_str = " ".join(f"{s.upper()}.NS" for s in nse_symbols)
    try:
        data = yf.download(tickers_str, period="1d", progress=False)
        close = data["Close"].iloc[-1]
        return {
            sym: round(float(close[f"{sym.upper()}.NS"]), 2)
            if f"{sym.upper()}.NS" in close else None
            for sym in nse_symbols
        }
    except Exception:
        # Fallback to individual fetches
        return {sym: get_stock_price(sym) for sym in nse_symbols}
