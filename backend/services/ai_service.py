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
