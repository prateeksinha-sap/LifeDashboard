"""
routers/analytics.py
────────────────────────────────────────────────────────────────────
GET  /api/analytics/xirr                — portfolio XIRR / CAGR
GET  /api/analytics/ai/status           — Ollama health check
POST /api/analytics/ai/parse-medical    — parse medical report text
POST /api/analytics/ai/extract-email    — extract todos/bills from email
────────────────────────────────────────────────────────────────────
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.db import get_db
from services.xirr_calculator import portfolio_xirr_from_db
from services.ai_service import (
    ollama_status,
    parse_medical_text,
    extract_email_tasks,
    MedicalParseResult,
    EmailExtractResult,
)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


# ── XIRR ─────────────────────────────────────────────────────────

@router.get("/xirr")
def get_portfolio_xirr(db: Session = Depends(get_db)):
    """
    Calculate XIRR (or CAGR fallback) across MF + Stock holdings.
    Returns gain metrics, method used, and any caveats.
    """
    return portfolio_xirr_from_db(db)


# ── AI: Ollama status ─────────────────────────────────────────────

@router.get("/ai/status")
async def get_ai_status():
    """Check if Ollama is running and the configured model is available."""
    return await ollama_status()


# ── AI: Medical report parser ─────────────────────────────────────

class MedicalTextIn(BaseModel):
    text:   str
    source: str | None = None   # e.g. "Apollo Diagnostics"


@router.post("/ai/parse-medical", response_model=MedicalParseResult)
async def parse_medical(body: MedicalTextIn, db: Session = Depends(get_db)):
    """
    Parse raw medical report text with AI and persist to medical_reports table.
    Returns the structured result immediately; also saves to DB.
    """
    import json
    from datetime import date
    from database.models import MedicalReport

    result = await parse_medical_text(body.text)

    # Persist to DB
    report = MedicalReport(
        report_date  = date.today(),
        source       = body.source,
        summary      = result.summary,
        status_flags = json.dumps(result.status_flags),
        action_items = json.dumps(result.action_items),
        raw_text     = body.text if result.is_ai_parsed else None,
    )
    db.add(report)
    db.commit()

    return result


# ── AI: Email task extractor ──────────────────────────────────────

class EmailBodyIn(BaseModel):
    body:    str
    subject: str | None = None
    sender:  str | None = None
    auto_save: bool = False   # if True, persist extracted todos/bills directly to DB


@router.post("/ai/extract-email", response_model=EmailExtractResult)
async def extract_from_email(body: EmailBodyIn, db: Session = Depends(get_db)):
    """
    Extract action items and payment reminders from an email.
    Set auto_save=true to automatically add todos and bills to the DB.
    """
    full_text = ""
    if body.subject:
        full_text += f"Subject: {body.subject}\n\n"
    if body.sender:
        full_text += f"From: {body.sender}\n\n"
    full_text += body.body

    result = await extract_email_tasks(full_text)

    if body.auto_save and result.is_ai_parsed:
        from datetime import date as date_cls
        from database.models import Todo, Bill

        for todo in result.todos:
            db.add(Todo(text=todo.text))

        for bill in result.bills:
            try:
                due = date_cls.fromisoformat(bill.due_date) if bill.due_date else date_cls.today()
            except ValueError:
                due = date_cls.today()
            db.add(Bill(
                name       = bill.name,
                amount     = bill.amount or 0,
                due_date   = due,
                is_recurring = False,
            ))

        db.commit()

    return result
