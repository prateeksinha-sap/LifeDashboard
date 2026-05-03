from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.db import get_db
from database.models import FinancialGoal, Liability
from services.finance_engine import build_daily_briefing, build_finance_profile, build_scenario, safe_float

router = APIRouter(prefix="/api/planning", tags=["planning"])


class LiabilityIn(BaseModel):
    name: str
    liability_type: str = "Loan"
    outstanding_amount: float
    interest_rate_pct: float | None = None
    emi_amount: float | None = None
    due_day: int | None = None
    notes: str | None = None


class GoalIn(BaseModel):
    name: str
    target_amount: float
    target_date: date | None = None
    current_amount: float = 0
    priority: str = "Medium"
    notes: str | None = None


def _liability(row: Liability) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "liability_type": row.liability_type,
        "outstanding_amount": safe_float(row.outstanding_amount),
        "interest_rate_pct": safe_float(row.interest_rate_pct),
        "emi_amount": safe_float(row.emi_amount),
        "due_day": row.due_day,
        "notes": row.notes,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _goal(row: FinancialGoal) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "target_amount": safe_float(row.target_amount),
        "target_date": row.target_date.isoformat() if row.target_date else None,
        "current_amount": safe_float(row.current_amount),
        "priority": row.priority,
        "notes": row.notes,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("/overview")
def planning_overview(db: Session = Depends(get_db)):
    profile = build_finance_profile(db)
    return {
        "as_of": profile["as_of"],
        "liabilities": profile["liabilities"],
        "goals": profile["goals"],
        "forecast": profile["forecast"],
        "data_quality": {
            "has_liabilities": profile["liabilities"]["count"] > 0,
            "has_goals": len(profile["goals"]) > 0,
            "months_of_cashflow_data": profile["forecast"]["months_of_cashflow_data"],
        },
    }


@router.get("/liabilities")
def list_liabilities(db: Session = Depends(get_db)):
    rows = db.query(Liability).order_by(Liability.outstanding_amount.desc()).all()
    return [_liability(row) for row in rows]


@router.post("/liabilities")
def create_liability(body: LiabilityIn, db: Session = Depends(get_db)):
    if not body.name.strip() or body.outstanding_amount < 0:
        raise HTTPException(status_code=400, detail="Enter a liability name and non-negative outstanding amount.")
    row = Liability(**body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _liability(row)


@router.put("/liabilities/{liability_id}")
def update_liability(liability_id: int, body: LiabilityIn, db: Session = Depends(get_db)):
    row = db.get(Liability, liability_id)
    if not row:
        raise HTTPException(status_code=404, detail="Liability not found.")
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return _liability(row)


@router.delete("/liabilities/{liability_id}")
def delete_liability(liability_id: int, db: Session = Depends(get_db)):
    row = db.get(Liability, liability_id)
    if not row:
        raise HTTPException(status_code=404, detail="Liability not found.")
    db.delete(row)
    db.commit()
    return {"status": "ok"}


@router.get("/goals")
def list_goals(db: Session = Depends(get_db)):
    rows = db.query(FinancialGoal).order_by(FinancialGoal.target_date.asc().nullslast(), FinancialGoal.id.asc()).all()
    return [_goal(row) for row in rows]


@router.post("/goals")
def create_goal(body: GoalIn, db: Session = Depends(get_db)):
    if not body.name.strip() or body.target_amount <= 0:
        raise HTTPException(status_code=400, detail="Enter a goal name and positive target amount.")
    row = FinancialGoal(**body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _goal(row)


@router.put("/goals/{goal_id}")
def update_goal(goal_id: int, body: GoalIn, db: Session = Depends(get_db)):
    row = db.get(FinancialGoal, goal_id)
    if not row:
        raise HTTPException(status_code=404, detail="Goal not found.")
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return _goal(row)


@router.delete("/goals/{goal_id}")
def delete_goal(goal_id: int, db: Session = Depends(get_db)):
    row = db.get(FinancialGoal, goal_id)
    if not row:
        raise HTTPException(status_code=404, detail="Goal not found.")
    db.delete(row)
    db.commit()
    return {"status": "ok"}


@router.get("/scenario")
def scenario(
    monthly_extra_investment: float = 0,
    spend_cut_pct: float = 0,
    salary_growth_pct: float | None = None,
    mf_step_up_pct: float = 10,
    db: Session = Depends(get_db),
):
    return build_scenario(
        db,
        monthly_extra_investment=monthly_extra_investment,
        spend_cut_pct=spend_cut_pct,
        salary_growth_pct=salary_growth_pct,
        mf_step_up_pct=mf_step_up_pct,
    )


@router.get("/briefing")
def daily_briefing(db: Session = Depends(get_db)):
    return build_daily_briefing(db)
