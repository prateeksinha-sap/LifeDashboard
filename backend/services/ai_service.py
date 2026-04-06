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
from pydantic import BaseModel

logger = logging.getLogger(__name__)

OLLAMA_URL   = os.getenv("OLLAMA_URL",   "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
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
    Use the local Ollama model to extract to-dos and bills from an email body.
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
        raw  = await _ollama_generate(prompt)
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
            raw_response = raw,
        )

    except httpx.ConnectError:
        logger.warning("Ollama unreachable at %s", OLLAMA_URL)
        return EmailExtractResult(
            todos=[], bills=[],
            summary="AI extraction unavailable — Ollama not running.",
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
    "Salary", "Utilities", "Groceries", "Dining", "Investments",
    "Travel", "EMI", "Education", "Healthcare", "Misc",
]

_CATEGORIZE_PROMPT = """\
You are a personal finance assistant. Categorise the following bank transaction description into exactly ONE of these categories:
Salary, Utilities, Groceries, Dining, Investments, Travel, EMI, Education, Healthcare, Misc

Rules:
- Salary: payroll credits, salary transfers
- Utilities: electricity, water, gas, broadband, mobile recharge
- Groceries: supermarkets, BigBasket, Blinkit, DMart, Zepto
- Dining: restaurants, Zomato, Swiggy, cafes
- Investments: SIP, mutual fund, stock purchase, FD, RD, NPS
- Travel: flights, hotels, Ola, Uber, fuel, toll
- EMI: loan EMI, credit card EMI, home loan
- Education: school fees, courses, books
- Healthcare: pharmacy, hospital, lab test, insurance premium
- Misc: anything that doesn't fit the above

Transaction description: "{description}"

Respond with ONLY the category name. No explanation.
"""


async def categorize_transaction(description: str) -> str:
    """
    Use the local Ollama model to assign one of the standard categories
    to a bank transaction description.
    Returns the category string (falls back to "Misc" on any error).
    """
    if not description or not description.strip():
        return "Misc"

    prompt = _CATEGORIZE_PROMPT.format(description=description[:300])

    try:
        raw = await _ollama_generate(prompt)
        # Parse: take the first word that matches a known category
        cleaned = raw.strip().strip('"').strip("'").split("\n")[0].strip()
        for cat in TRANSACTION_CATEGORIES:
            if cat.lower() in cleaned.lower():
                return cat
        return "Misc"
    except httpx.ConnectError:
        return "Misc"
    except Exception:
        return "Misc"


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
    Use the local Ollama model to extract structured action items from an email.
    Returns a list of dicts with keys: task_description, due_date, priority.
    Returns [] on any failure (Ollama offline, bad JSON, etc.).
    """
    if not body or not body.strip():
        return []

    prompt = _ACTIONABLES_PROMPT.format(
        subject=subject[:200] if subject else "No Subject",
        body=body[:3000],
    )

    try:
        raw  = await _ollama_generate(prompt)
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
        logger.warning("Ollama unreachable — skipping actionable extraction for email")
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
