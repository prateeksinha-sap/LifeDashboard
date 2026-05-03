from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.db import get_db
from services.portfolio_agent import (
    DecisionNotAllowed,
    get_brief,
    get_run_detail,
    get_runs,
    import_reports,
    record_decision,
)


router = APIRouter(prefix="/api/portfolio-agent", tags=["portfolio-agent"])


class DecisionPatch(BaseModel):
    status: str
    notes: str | None = None
    review_date: date | None = None


@router.post("/sync")
def sync_portfolio_agent_reports(db: Session = Depends(get_db)):
    return import_reports(db)


@router.get("/brief")
def portfolio_agent_brief(db: Session = Depends(get_db)):
    return get_brief(db)


@router.get("/runs")
def portfolio_agent_runs(db: Session = Depends(get_db)):
    return get_runs(db)


@router.get("/runs/{run_id}")
def portfolio_agent_run_detail(run_id: str, db: Session = Depends(get_db)):
    detail = get_run_detail(db, run_id)
    if not detail:
        raise HTTPException(404, "Portfolio-agent run not found")
    return detail


@router.patch("/recommendations/{recommendation_id}/decision")
def update_recommendation_decision(
    recommendation_id: int,
    body: DecisionPatch,
    db: Session = Depends(get_db),
):
    try:
        return record_decision(
            db,
            recommendation_id=recommendation_id,
            status=body.status,
            notes=body.notes,
            review_date=body.review_date,
        )
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except DecisionNotAllowed as exc:
        raise HTTPException(409, str(exc)) from exc
