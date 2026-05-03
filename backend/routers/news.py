import os
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import httpx
from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/news", tags=["news"])


IMPACT_RULES = [
    (("rbi", "repo", "interest rate", "inflation", "bond yield"), "Loans, FDs, debt funds, and real-estate affordability may be affected.", "Review loan/FD/debt allocation impact."),
    (("tax", "income tax", "capital gains", "gst", "budget"), "Tax rules can affect investments, salary cashflow, and compliance.", "Check whether this changes tax planning or filing action."),
    (("nifty", "sensex", "market", "earnings", "stock"), "Equity holdings may move with market or sector news.", "Avoid impulsive trades; review portfolio exposure."),
    (("gold", "rupee", "usd", "dollar"), "Gold value and import-sensitive prices may move.", "Review gold allocation and major purchase timing."),
    (("health", "insurance", "hospital", "medical"), "Health costs, insurance, or family-care planning may be affected.", "Check policy cover and any immediate health action."),
    (("school", "education", "fee", "admission"), "Education planning or child-related action may be affected.", "Check deadlines, fees, and documents."),
    (("real estate", "property", "home loan", "stamp duty"), "Property valuation or home-loan economics may change.", "Review real-estate assumptions and loan rates."),
]


def _score_item(title: str, summary: str) -> tuple[int, list[str], list[str]]:
    text = f"{title} {summary}".lower()
    impacts: list[str] = []
    actions: list[str] = []
    score = 0
    for keywords, impact, action in IMPACT_RULES:
        if any(keyword in text for keyword in keywords):
            score += 1
            impacts.append(impact)
            actions.append(action)
    return score, impacts[:2], actions[:2]


def _parse_pub_date(value: str) -> datetime | None:
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


@router.get("/personalized")
async def personalized_news(days: int = Query(7, ge=1, le=30)):
    topics = os.getenv(
        "NEWS_TOPICS",
        "India personal finance RBI tax stock market mutual funds gold real estate health insurance education",
    )
    query = f"{topics} when:{days}d"
    url = f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=en-IN&gl=IN&ceid=IN:en"
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()
    except Exception as exc:
        return {
            "status": "unavailable",
            "message": f"Could not fetch news feed: {exc}",
            "items": [],
        }

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    root = ET.fromstring(response.text)
    items = []
    stale_count = 0
    for item in root.findall(".//item")[:60]:
        title = item.findtext("title") or ""
        link = item.findtext("link") or ""
        pub_date = item.findtext("pubDate") or ""
        description = item.findtext("description") or ""
        source = item.findtext("source") or "Google News"
        published_at = _parse_pub_date(pub_date)
        if published_at and published_at < cutoff:
            stale_count += 1
            continue
        score, impacts, actions = _score_item(title, description)
        if score == 0:
            continue
        items.append({
            "title": title,
            "url": link,
            "source": source,
            "published": pub_date,
            "published_iso": published_at.isoformat() if published_at else None,
            "age_hours": round((now - published_at).total_seconds() / 3600, 1) if published_at else None,
            "impact_score": score,
            "impact": impacts,
            "actions": actions,
        })

    items.sort(key=lambda x: (-(x["published_iso"] is not None), x["published_iso"] or "", x["impact_score"]), reverse=True)
    return {
        "status": "ok",
        "as_of": now.isoformat(),
        "topics": topics,
        "recency_days": days,
        "stale_filtered": stale_count,
        "items": items[:10],
    }
