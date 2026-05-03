"""
services/ai_service.py
────────────────────────────────────────────────────────────────────
Lightweight async wrapper around a local Ollama instance.

Configure via .env:
    OLLAMA_URL   = http://localhost:11434   (default)
    OLLAMA_MODEL = llama3.2                 (default)

Two public coroutines:
    parse_medical_text(text)      → MedicalParseResult
    extract_email_tasks(body)     → EmailExtractResult

Both return structured Pydantic models. If Ollama is unreachable or
the model produces un-parseable JSON, they return a graceful fallback
with is_ai_parsed=False so the UI can show a "manual review" state.
────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel

logger = logging.getLogger(__name__)

load_dotenv()

OLLAMA_URL   = os.getenv("OLLAMA_URL",   "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
AI_EXTRACTION_PROVIDER = os.getenv("AI_EXTRACTION_PROVIDER", os.getenv("ASSISTANT_PROVIDER", "auto")).strip().lower()
TIMEOUT      = 120.0   # seconds — local LLMs can be slow on first token


# ── Response schemas ──────────────────────────────────────────────

class MedicalParseResult(BaseModel):
    summary:      str
    status_flags: dict[str, str]    # {"HbA1c": "optimal", "cholesterol": "warning"}
    action_items: list[str]
    overall:      str               # "optimal" | "warning" | "critical"
    is_ai_parsed: bool = True
    raw_response: str | None = None


class ExtractedTodo(BaseModel):
    text:     str
    priority: str = "medium"        # "high" | "medium" | "low"


class ExtractedBill(BaseModel):
    name:     str
    amount:   float | None = None
    due_date: str | None = None     # ISO date string "YYYY-MM-DD"


class EmailExtractResult(BaseModel):
    todos:        list[ExtractedTodo]
    bills:        list[ExtractedBill]
    summary:      str
    is_ai_parsed: bool = True
    raw_response: str | None = None


# ── Low-level Ollama call ─────────────────────────────────────────

async def _ollama_generate(prompt: str) -> str:
    """
    POST to /api/generate and return the response string.
    Raises httpx.HTTPError on network failure.
    """
    payload = {
        "model":  OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,     # low temp = more deterministic JSON
            "num_predict": 1024,
        },
    }
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(f"{OLLAMA_URL}/api/generate", json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data.get("response", "")


async def generate_text(prompt: str, *, max_tokens: int = 1400, temperature: float = 0.2, model: str | None = None) -> str:
    """
    Public text-generation helper for dashboard assistant style responses.
    Keeps the rest of the app away from Ollama's wire format.
    """
    payload = {
        "model": model or OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        },
    }
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(f"{OLLAMA_URL}/api/generate", json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data.get("response", "")


async def generate_openai_text(
    prompt: str,
    *,
    max_tokens: int = 900,
    model: str | None = None,
    reasoning_effort: str = "low",
) -> str:
    """Generate a concise assistant answer using OpenAI's Responses API."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    chosen_model = model or OPENAI_MODEL
    payload: dict[str, Any] = {
        "model": chosen_model,
        "input": prompt,
        "max_output_tokens": max_tokens,
    }
    if chosen_model.startswith("gpt-5"):
        payload["reasoning"] = {"effort": reasoning_effort}

    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/responses",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("output_text"):
            return str(data["output_text"])

        parts: list[str] = []
        for item in data.get("output", []):
            for content in item.get("content", []):
                if content.get("type") in {"output_text", "text"} and content.get("text"):
                    parts.append(str(content["text"]))
        return "\n".join(parts).strip()


async def generate_anthropic_text(
    prompt: str,
    *,
    max_tokens: int = 900,
    model: str | None = None,
) -> str:
    """Generate a concise assistant answer using Anthropic's Messages API."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": model or ANTHROPIC_MODEL,
                "max_tokens": max_tokens,
                "temperature": 0.2,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return "\n".join(
            str(item.get("text", ""))
            for item in data.get("content", [])
            if item.get("type") == "text"
        ).strip()


def _extract_json(text: str) -> Any:
    """
    Extract the first valid JSON object or array from a string.
    Handles LLM responses wrapped in ```json ... ``` markdown blocks.
    """
    # Try stripping markdown code fences first
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    candidate   = fence_match.group(1).strip() if fence_match else text.strip()

    # Try full parse
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass

    # Try extracting first {...} or [...] substring
    for pattern in (r"\{[\s\S]*\}", r"\[[\s\S]*\]"):
        m = re.search(pattern, candidate)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                continue

    raise ValueError(f"No valid JSON found in LLM response:\n{text[:500]}")


async def _generate_extraction_text(prompt: str, *, max_tokens: int = 1200) -> tuple[str, str, str | None]:
    """Generate structured extraction text using the best configured provider."""
    has_openai = bool(os.getenv("OPENAI_API_KEY"))
    has_anthropic = bool(os.getenv("ANTHROPIC_API_KEY"))
    provider = AI_EXTRACTION_PROVIDER
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
        attempts.append(("ollama", OLLAMA_MODEL))

    if ("ollama", OLLAMA_MODEL) not in attempts:
        attempts.append(("ollama", OLLAMA_MODEL))

    last_error: Exception | None = None
    for selected_provider, model in attempts:
        try:
            if selected_provider == "openai":
                text = await generate_openai_text(prompt, max_tokens=max_tokens, model=OPENAI_MODEL, reasoning_effort="low")
                return "openai", text, OPENAI_MODEL
            if selected_provider == "anthropic":
                text = await generate_anthropic_text(prompt, max_tokens=max_tokens, model=ANTHROPIC_MODEL)
                return "anthropic", text, ANTHROPIC_MODEL
            return "ollama", await _ollama_generate(prompt), model
        except Exception as exc:
            last_error = exc
            logger.warning("%s extraction provider failed: %s", selected_provider, exc)
            continue
    raise last_error or RuntimeError("No AI extraction provider available")


# ── Medical report parser ─────────────────────────────────────────

_MEDICAL_PROMPT = """\
You are a medical report analyst. Analyse the following diagnostic report text and return ONLY a JSON object — no explanation, no markdown, just the raw JSON.

JSON format:
{{
  "summary": "2-3 sentence plain-English summary of the overall health picture",
  "overall": "optimal" | "warning" | "critical",
  "status_flags": {{
    "<marker_name>": "optimal" | "warning" | "critical"
  }},
  "action_items": [
    "Specific actionable recommendation 1",
    "Specific actionable recommendation 2"
  ]
}}

Rules:
- status_flags should include every test result mentioned (HbA1c, cholesterol, BP, TSH, etc.)
- "optimal" = within normal range, "warning" = borderline or mildly elevated, "critical" = significantly abnormal
- overall = worst of all individual flags
- action_items should be concrete (e.g. "Retest cholesterol in 3 months" not "See a doctor")
- Keep summary under 60 words

REPORT TEXT:
{text}
"""


async def parse_medical_text(text: str) -> MedicalParseResult:
    """
    Use the local Ollama model to parse raw medical report text into
    a structured MedicalParseResult.
    """
    if not text or not text.strip():
        return MedicalParseResult(
            summary="No text provided.",
            status_flags={},
            action_items=[],
            overall="optimal",
            is_ai_parsed=False,
        )

    prompt = _MEDICAL_PROMPT.format(text=text[:4000])   # truncate very long reports

    try:
        raw = await _ollama_generate(prompt)
        data = _extract_json(raw)

        return MedicalParseResult(
            summary      = str(data.get("summary", "")),
            overall      = str(data.get("overall", "optimal")),
            status_flags = {k: str(v) for k, v in data.get("status_flags", {}).items()},
            action_items = [str(i) for i in data.get("action_items", [])],
            is_ai_parsed = True,
            raw_response = raw,
        )

    except httpx.ConnectError:
        logger.warning("Ollama unreachable at %s", OLLAMA_URL)
        return MedicalParseResult(
            summary="AI parsing unavailable — Ollama not running. Upload text saved for manual review.",
            status_flags={},
            action_items=["Start Ollama: run `ollama serve` in a terminal"],
            overall="optimal",
            is_ai_parsed=False,
        )
    except Exception as e:
        logger.exception("Medical parse failed: %s", e)
        return MedicalParseResult(
            summary=f"AI parsing failed: {e}",
            status_flags={},
            action_items=[],
            overall="optimal",
            is_ai_parsed=False,
            raw_response=str(e),
        )


# ── Email task extractor ──────────────────────────────────────────

_EMAIL_PROMPT = """\
You are an executive assistant. Read the following email and extract any action items, deadlines, or payment reminders. Return ONLY a JSON object.

JSON format:
{{
  "summary": "One sentence describing what this email is about",
  "todos": [
    {{
      "text": "Action item description",
      "priority": "high" | "medium" | "low"
    }}
  ],
  "bills": [
    {{
      "name": "Payment or fee name",
      "amount": 1234.56 or null,
      "due_date": "YYYY-MM-DD" or null
    }}
  ]
}}

Rules:
- todos = tasks the recipient must do (meetings to schedule, documents to send, decisions to make)
- bills = any payment, fee, or financial obligation mentioned
- If no todos exist, return empty array []
- If no bills exist, return empty array []
- due_date must be ISO format YYYY-MM-DD; use null if unclear
- Infer the year from context; if ambiguous, use the current year

EMAIL:
{body}
"""


async def extract_email_tasks(email_body: str) -> EmailExtractResult:
    """
    Use the best configured model to extract to-dos and bills from an email body.
    Returns an EmailExtractResult with todos and bills lists.
    """
    if not email_body or not email_body.strip():
        return EmailExtractResult(
            todos=[], bills=[],
            summary="Empty email.",
            is_ai_parsed=False,
        )

    prompt = _EMAIL_PROMPT.format(body=email_body[:3000])

    try:
        provider, raw, model = await _generate_extraction_text(prompt, max_tokens=1200)
        data = _extract_json(raw)

        todos = [
            ExtractedTodo(
                text     = str(t.get("text", "")),
                priority = str(t.get("priority", "medium")),
            )
            for t in data.get("todos", [])
            if t.get("text")
        ]

        bills = [
            ExtractedBill(
                name     = str(b.get("name", "")),
                amount   = float(b["amount"]) if b.get("amount") is not None else None,
                due_date = str(b["due_date"]) if b.get("due_date") else None,
            )
            for b in data.get("bills", [])
            if b.get("name")
        ]

        return EmailExtractResult(
            todos        = todos,
            bills        = bills,
            summary      = str(data.get("summary", "")),
            is_ai_parsed = True,
            raw_response = f"{provider}:{model or 'default'}\n{raw}",
        )

    except httpx.ConnectError:
        logger.warning("AI extraction provider unreachable")
        return EmailExtractResult(
            todos=[], bills=[],
            summary="AI extraction unavailable.",
            is_ai_parsed=False,
        )
    except Exception as e:
        logger.exception("Email extract failed: %s", e)
        return EmailExtractResult(
            todos=[], bills=[],
            summary=f"Extraction failed: {e}",
            is_ai_parsed=False,
            raw_response=str(e),
        )


# ── Transaction categoriser ──────────────────────────────────────

TRANSACTION_CATEGORIES = [
    "Salary", "Investment Income", "Refunds & Reversals", "Transfers In",
    "Investments & Savings", "EMI & Loans", "Rent & Housing", "Household Help",
    "Education & Child", "Healthcare", "Food & Delivery", "Groceries",
    "Insurance", "Travel & Transport", "Utilities & Bills", "Fuel & Vehicle",
    "Shopping", "Subscriptions", "Entertainment", "Alcohol", "Taxes",
    "Cash Withdrawal", "Bank Charges", "Transfers Out", "Miscellaneous",
]

_CATEGORIZE_PROMPT = """\
You are a personal finance assistant. Categorise the following bank transaction description into exactly ONE of these categories:
Salary, Investment Income, Refunds & Reversals, Transfers In, Investments & Savings, EMI & Loans, Rent & Housing, Household Help, Education & Child, Healthcare, Food & Delivery, Groceries, Insurance, Travel & Transport, Utilities & Bills, Fuel & Vehicle, Shopping, Subscriptions, Entertainment, Alcohol, Taxes, Cash Withdrawal, Bank Charges, Transfers Out, Miscellaneous

Rules:
- Salary: payroll credits, salary transfers
- Investment Income: interest, dividends, redemptions, capital payouts
- Transfers In: money received from family, friends, self transfers
- Investments & Savings: SIP, mutual fund, stock purchase, FD, RD, NPS, PPF, EPF
- Utilities & Bills: electricity, water, gas, broadband, mobile recharge
- Groceries: supermarkets, BigBasket, Blinkit, DMart, Zepto
- Food & Delivery: restaurants, Zomato, Swiggy, cafes
- Travel & Transport: flights, hotels, Ola, Uber, fuel, toll
- EMI & Loans: loan EMI, credit card EMI, home loan
- Education & Child: school fees, courses, books
- Healthcare: pharmacy, hospital, lab test, insurance premium
- Miscellaneous: anything that doesn't fit the above

Transaction description: "{description}"

Respond with ONLY the category name. No explanation.
"""


async def categorize_transaction(description: str) -> str:
    """
    Use the best configured model to assign one of the standard categories
    to a bank transaction description.
    Returns the category string (falls back to "Miscellaneous" on any error).
    """
    if not description or not description.strip():
        return "Miscellaneous"

    prompt = _CATEGORIZE_PROMPT.format(description=description[:300])

    try:
        _, raw, _ = await _generate_extraction_text(prompt, max_tokens=80)
        # Parse: take the first word that matches a known category
        cleaned = raw.strip().strip('"').strip("'").split("\n")[0].strip()
        for cat in TRANSACTION_CATEGORIES:
            if cat.lower() in cleaned.lower():
                return cat
        return "Miscellaneous"
    except httpx.ConnectError:
        return "Miscellaneous"
    except Exception:
        return "Miscellaneous"


# ── Actionables extractor (Gmail) ────────────────────────────────

_ACTIONABLES_PROMPT = """\
You are an executive assistant. Read the following email and extract any clear to-dos, action items, or upcoming key dates. Ignore conversational filler and marketing content.

Output ONLY a valid JSON array of objects. Each object must have exactly these keys:
- "task_description": string describing what needs to be done
- "due_date": string in YYYY-MM-DD format, or null if no date mentioned
- "priority": "High", "Medium", or "Low"

Rules for priority:
- High: payment deadlines, urgent requests, same-day or next-day actions
- Medium: scheduled meetings, tasks due within a week
- Low: informational follow-ups, no explicit urgency

Email Subject: "{subject}"
Body:
{body}

JSON array:"""


async def extract_actionables_from_email(subject: str, body: str) -> list[dict]:
    """
    Use the best configured model to extract structured action items from an email.
    Returns a list of dicts with keys: task_description, due_date, priority.
    Returns [] on any failure (provider offline, bad JSON, etc.).
    """
    if not body or not body.strip():
        return []

    prompt = _ACTIONABLES_PROMPT.format(
        subject=subject[:200] if subject else "No Subject",
        body=body[:3000],
    )

    try:
        _, raw, _ = await _generate_extraction_text(prompt, max_tokens=1000)
        data = _extract_json(raw)

        if not isinstance(data, list):
            return []

        results = []
        for item in data:
            if not isinstance(item, dict) or not item.get("task_description"):
                continue
            priority = str(item.get("priority", "Medium")).strip().capitalize()
            if priority not in ("High", "Medium", "Low"):
                priority = "Medium"
            results.append({
                "task_description": str(item["task_description"]).strip(),
                "due_date":         str(item["due_date"]) if item.get("due_date") else None,
                "priority":         priority,
            })
        return results

    except httpx.ConnectError:
        logger.warning("AI provider unreachable; skipping actionable extraction for email")
        return []
    except Exception as e:
        logger.exception("extract_actionables_from_email failed: %s", e)
        return []


# ── Ollama health check ───────────────────────────────────────────

async def ollama_status() -> dict:
    """Check whether Ollama is reachable and which models are available."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            resp.raise_for_status()
            models = [m["name"] for m in resp.json().get("models", [])]
            return {
                "online":        True,
                "url":           OLLAMA_URL,
                "active_model":  OLLAMA_MODEL,
                "available":     models,
                "model_present": OLLAMA_MODEL in models or
                                 any(OLLAMA_MODEL in m for m in models),
            }
    except Exception as e:
        return {
            "online":        False,
            "url":           OLLAMA_URL,
            "active_model":  OLLAMA_MODEL,
            "available":     [],
            "model_present": False,
            "error":         str(e),
        }
