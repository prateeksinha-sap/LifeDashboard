"""
routers/health.py
────────────────────────────────────────────────────────────────────
GET  /api/health-data/metrics        — latest + weekly health metrics
GET  /api/health-data/medical        — most recent medical report
GET  /api/health-data/lifelog        — life balance breakdown
GET  /api/health-data/crm            — contacts needing check-in
POST /api/health-data/lifelog        — log a new activity
────────────────────────────────────────────────────────────────────
"""

import json
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.db import get_db
from database.models import HealthMetric, MedicalReport, LifeLog, PersonalCRM

router = APIRouter(prefix="/api/health-data", tags=["health"])


# ── Health metrics ────────────────────────────────────────────────

@router.get("/metrics")
def get_health_metrics(days: int = 10, db: Session = Depends(get_db)):
    """Return daily health metrics for the past N days."""
    since = date.today() - timedelta(days=days)
    rows  = (
        db.query(HealthMetric)
        .filter(HealthMetric.date >= since)
        .order_by(HealthMetric.date.asc())
        .all()
    )
    records = [
        {
            "date":        r.date.isoformat(),
            "steps":       r.steps,
            "sleep_hours": r.sleep_hours,
            "resting_hr":  r.resting_hr,
            "active_mins": r.active_mins,
            "calories":    r.calories,
        }
        for r in rows
    ]

    # Averages (exclude today if incomplete)
    complete = [r for r in records if r["steps"] and r["sleep_hours"]]
    avg_steps = round(sum(r["steps"] for r in complete) / len(complete)) if complete else 0
    avg_sleep = round(sum(r["sleep_hours"] for r in complete) / len(complete), 1) if complete else 0
    avg_hr    = round(sum(r["resting_hr"] for r in complete if r["resting_hr"]) / len(complete)) if complete else 0

    return {
        "records":    records,
        "avg_steps":  avg_steps,
        "avg_sleep":  avg_sleep,
        "avg_hr":     avg_hr,
        "days_logged": len(records),
    }


# ── Medical reports ───────────────────────────────────────────────

@router.get("/medical")
def get_latest_medical(db: Session = Depends(get_db)):
    """Return the most recent medical report."""
    report = (
        db.query(MedicalReport)
        .order_by(MedicalReport.report_date.desc())
        .first()
    )
    if not report:
        return None

    return {
        "id":           report.id,
        "report_date":  report.report_date.isoformat(),
        "source":       report.source,
        "summary":      report.summary,
        "status_flags": json.loads(report.status_flags or "{}"),
        "action_items": json.loads(report.action_items or "[]"),
        "overall":      _compute_overall(json.loads(report.status_flags or "{}")),
    }


def _compute_overall(flags: dict) -> str:
    if any(v == "critical" for v in flags.values()):
        return "critical"
    if any(v == "warning" for v in flags.values()):
        return "warning"
    return "optimal"


# ── Life balance ──────────────────────────────────────────────────

@router.get("/lifelog")
def get_life_balance(days: int = 7, db: Session = Depends(get_db)):
    """
    Return time-spent breakdown by category for the past N days.
    Used by the LifeBalanceCard.
    """
    since = date.today() - timedelta(days=days)
    logs  = db.query(LifeLog).filter(LifeLog.log_date >= since).all()

    # Aggregate by category
    by_category: dict[str, int] = {}
    by_subcategory: dict[str, int] = {}
    for log in logs:
        by_category[log.category]   = by_category.get(log.category, 0)   + log.duration_minutes
        key = f"{log.category} / {log.subcategory or 'Other'}"
        by_subcategory[key]         = by_subcategory.get(key, 0)          + log.duration_minutes

    total_mins = sum(by_category.values())

    category_summary = [
        {
            "category":   cat,
            "minutes":    mins,
            "hours":      round(mins / 60, 1),
            "percentage": round((mins / total_mins) * 100, 1) if total_mins else 0,
        }
        for cat, mins in sorted(by_category.items(), key=lambda x: -x[1])
    ]

    return {
        "days":             days,
        "total_hours":      round(total_mins / 60, 1),
        "categories":       category_summary,
        "subcategories":    [
            {"label": k, "minutes": v}
            for k, v in sorted(by_subcategory.items(), key=lambda x: -x[1])
        ],
    }


# ── Personal CRM ──────────────────────────────────────────────────

@router.get("/crm")
def get_crm(db: Session = Depends(get_db)):
    """Return all contacts, flagging those overdue for a check-in."""
    today    = date.today()
    contacts = db.query(PersonalCRM).order_by(PersonalCRM.contact_name).all()

    result = []
    for c in contacts:
        days_since = (today - c.last_contact_date).days if c.last_contact_date else 9999
        overdue    = days_since > c.check_in_interval_days
        result.append({
            "id":                c.id,
            "contact_name":      c.contact_name,
            "relationship":      c.relationship,
            "last_contact_date": c.last_contact_date.isoformat() if c.last_contact_date else None,
            "days_since":        days_since,
            "check_in_interval": c.check_in_interval_days,
            "overdue":           overdue,
            "days_overdue":      max(0, days_since - c.check_in_interval_days),
            "notes":             c.notes,
        })

    # Sort: overdue contacts first, then by days_overdue desc
    result.sort(key=lambda x: (-x["days_overdue"], x["contact_name"]))
    return result


@router.patch("/crm/{contact_id}/checked-in")
def mark_checked_in(contact_id: int, db: Session = Depends(get_db)):
    """Mark a contact as checked-in today — resets the overdue timer."""
    contact = db.query(PersonalCRM).filter_by(id=contact_id).first()
    if not contact:
        from fastapi import HTTPException
        raise HTTPException(404, "Contact not found")
    contact.last_contact_date = date.today()
    db.commit()
    return {"status": "ok", "contact": contact.contact_name, "last_contact_date": date.today().isoformat()}


# ── Log a new activity ────────────────────────────────────────────

class LifeLogIn(BaseModel):
    category:         str
    subcategory:      str | None = None
    duration_minutes: int
    notes:            str | None = None
    log_date:         str | None = None   # ISO date; defaults to today


@router.post("/lifelog")
def add_life_log(body: LifeLogIn, db: Session = Depends(get_db)):
    log_date = date.fromisoformat(body.log_date) if body.log_date else date.today()
    db.add(LifeLog(
        log_date         = log_date,
        category         = body.category,
        subcategory      = body.subcategory,
        duration_minutes = body.duration_minutes,
        notes            = body.notes,
    ))
    db.commit()
    return {"status": "ok", "logged": body.duration_minutes, "category": body.category}
