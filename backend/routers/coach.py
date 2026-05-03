from __future__ import annotations

import asyncio
import json
import os

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database.db import get_db
from services.ai_service import (
    ANTHROPIC_MODEL,
    OLLAMA_MODEL,
    OPENAI_MODEL,
    generate_anthropic_text,
    generate_openai_text,
    generate_text,
    ollama_status,
)
from services.financial_coach import build_coach_overview, compact_coach_context, money

router = APIRouter(prefix="/api/coach", tags=["financial-coach"])

COACH_REPORT_TIMEOUT_SECONDS = float(os.getenv("COACH_REPORT_TIMEOUT_SECONDS", "35"))
COACH_PROVIDER = os.getenv("COACH_PROVIDER", os.getenv("ASSISTANT_PROVIDER", "auto")).strip().lower()


@router.get("/overview")
def get_coach_overview(db: Session = Depends(get_db)):
    """Deterministic Personal CFO overview built from the dashboard data."""
    return build_coach_overview(db)


def _deterministic_report(overview: dict) -> str:
    metrics = overview["metrics"]
    targets = overview["targets"]
    top_opps = overview["opportunities"][:5]
    lines = [
        f"Financial mirror for {overview['month']}: score {overview['health_score']}/100 ({overview['health_band']}).",
        "",
        "What the data says:",
    ]
    for item in overview["mirror"]:
        lines.append(f"- {item}")

    lines.extend([
        "",
        "Core numbers:",
        f"- Net worth: {money(metrics['net_worth'])}",
        f"- Income: {money(metrics['income'])}",
        f"- True expenses: {money(metrics['true_expenses'])}",
        f"- Investments/savings outflow: {money(metrics['investment_outflow'])}",
        f"- Unclear transfers: {money(metrics['unclear_transfers'])}",
        f"- Wealth creation rate: {metrics['wealth_creation_rate_pct']:.1f}%",
        "",
        "Highest-value actions:",
    ])
    for opp in top_opps:
        impact = money(opp["impact_monthly"]) if opp["impact_monthly"] else "data quality / risk control"
        lines.append(f"- {opp['title']} - {opp['action']} Impact: {impact}.")

    lines.extend([
        "",
        "Targets:",
        f"- {targets[0]['label']}: required contribution {money(targets[0]['required_monthly_contribution'])}/month.",
        f"- {targets[1]['label']}: required contribution {money(targets[1]['required_monthly_contribution'])}/month.",
    ])
    if overview["data_gaps"]:
        lines.append("")
        lines.append("Fix these data gaps first:")
        for gap in overview["data_gaps"][:4]:
            lines.append(f"- {gap}")
    return "\n".join(lines)


def _report_prompt(overview: dict) -> str:
    context = compact_coach_context(overview)
    return f"""You are a Personal CFO for one private user in India.

Use ONLY the JSON facts below. Do not invent transactions, balances, emails, or investment products.

Write a practical CFO memo with these sections:
1. The mirror
2. What is helping wealth creation
3. What is hurting wealth creation
4. Top 5 actions ranked by ROI
5. What data must be cleaned before trusting the advice

Rules:
- Be direct and specific.
- Use INR notation.
- Distinguish true expenses, investments, and unclear transfers.
- Every recommendation must cite evidence from the JSON.
- Do not give regulated buy/sell recommendations or guarantee returns.
- Keep it under 650 words.

FACTS:
{json.dumps(context, ensure_ascii=True, indent=2)}
"""


async def _generate_report(prompt: str) -> tuple[str, str, str | None]:
    has_openai = bool(os.getenv("OPENAI_API_KEY"))
    has_anthropic = bool(os.getenv("ANTHROPIC_API_KEY"))
    provider = COACH_PROVIDER
    attempts: list[tuple[str, str | None]] = []
    if provider in {"openai", "premium"} and has_openai:
        attempts.append(("openai", OPENAI_MODEL))
    elif provider in {"anthropic", "claude"} and has_anthropic:
        attempts.append(("anthropic", ANTHROPIC_MODEL))
    elif provider in {"ollama", "local"}:
        attempts.append(("ollama", OLLAMA_MODEL))
    else:
        if has_openai:
            attempts.append(("openai", OPENAI_MODEL))
        if has_anthropic:
            attempts.append(("anthropic", ANTHROPIC_MODEL))
        status = await ollama_status()
        if status.get("online"):
            attempts.append(("ollama", OLLAMA_MODEL))

    last_error: Exception | None = None
    for selected_provider, model in attempts:
        try:
            if selected_provider == "openai":
                return "openai", OPENAI_MODEL, await generate_openai_text(prompt, max_tokens=1300, model=OPENAI_MODEL, reasoning_effort="medium")
            if selected_provider == "anthropic":
                return "anthropic", ANTHROPIC_MODEL, await generate_anthropic_text(prompt, max_tokens=1300, model=ANTHROPIC_MODEL)
            return "ollama", model, await generate_text(prompt, max_tokens=1300, temperature=0.2, model=model)
        except Exception as exc:
            last_error = exc
            continue
    if last_error:
        raise last_error
    return "deterministic", None, ""


@router.post("/report")
async def generate_coach_report(db: Session = Depends(get_db)):
    """
    Generate a CFO memo. This uses a cloud LLM only when configured; otherwise
    it returns the deterministic report so the feature always works.
    """
    overview = build_coach_overview(db)
    prompt = _report_prompt(overview)
    try:
        provider, model, text = await asyncio.wait_for(_generate_report(prompt), timeout=COACH_REPORT_TIMEOUT_SECONDS)
        if text and text.strip():
            return {
                "report": text.strip(),
                "provider": provider,
                "model": model,
                "fallback": False,
                "data_used": [
                    "Net worth allocation",
                    "Categorized bank transactions",
                    "Monthly cashflow",
                    "Forecast targets",
                    "Bills and actionables",
                ],
            }
    except (httpx.HTTPError, TimeoutError, asyncio.TimeoutError):
        pass

    return {
        "report": _deterministic_report(overview),
        "provider": "deterministic",
        "model": None,
        "fallback": True,
        "data_used": [
            "Net worth allocation",
            "Categorized bank transactions",
            "Monthly cashflow",
            "Forecast targets",
            "Bills and actionables",
        ],
    }
