"""
routers/bills.py
GET    /api/bills          — upcoming unpaid bills, sorted by due_date
POST   /api/bills          — add a bill
PATCH  /api/bills/{id}     — mark paid / update amount
DELETE /api/bills/{id}
"""

from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from database.db import get_db
from database.models import Bill

router = APIRouter(prefix="/api/bills", tags=["bills"])


class BillIn(BaseModel):
    name:             str
    amount:           float
    due_date:         date
    is_recurring:     bool = True
    recurrence_days:  Optional[int] = 30


class BillPatch(BaseModel):
    amount:       Optional[float] = None
    due_date:     Optional[date]  = None
    is_paid:      Optional[bool]  = None


def _bill_to_dict(bill: Bill) -> dict:
    today = date.today()
    days_until_due = (bill.due_date - today).days
    return {
        "id":             bill.id,
        "name":           bill.name,
        "amount":         bill.amount,
        "due_date":       bill.due_date.isoformat(),
        "days_until_due": days_until_due,
        "is_paid":        bill.is_paid,
        "is_recurring":   bill.is_recurring,
        "recurrence_days": bill.recurrence_days,
    }


@router.get("")
def list_bills(db: Session = Depends(get_db)):
    bills = (
        db.query(Bill)
        .filter(Bill.is_paid == False)
        .order_by(Bill.due_date)
        .all()
    )
    return [_bill_to_dict(b) for b in bills]


@router.post("", status_code=201)
def create_bill(body: BillIn, db: Session = Depends(get_db)):
    bill = Bill(
        name=body.name,
        amount=body.amount,
        due_date=body.due_date,
        is_recurring=body.is_recurring,
        recurrence_days=body.recurrence_days,
    )
    db.add(bill)
    db.commit()
    db.refresh(bill)
    return _bill_to_dict(bill)


@router.patch("/{bill_id}")
def update_bill(bill_id: int, body: BillPatch, db: Session = Depends(get_db)):
    bill = db.query(Bill).filter_by(id=bill_id).first()
    if not bill:
        raise HTTPException(404, "Bill not found")

    if body.amount   is not None: bill.amount   = body.amount
    if body.due_date is not None: bill.due_date = body.due_date
    if body.is_paid  is not None:
        bill.is_paid = body.is_paid
        # Auto-advance due_date for recurring bills when marked paid
        if body.is_paid and bill.is_recurring and bill.recurrence_days:
            bill.due_date = bill.due_date + timedelta(days=bill.recurrence_days)
            bill.is_paid  = False   # reset for next cycle

    db.commit()
    db.refresh(bill)
    return _bill_to_dict(bill)


@router.delete("/{bill_id}", status_code=204)
def delete_bill(bill_id: int, db: Session = Depends(get_db)):
    bill = db.query(Bill).filter_by(id=bill_id).first()
    if not bill:
        raise HTTPException(404, "Bill not found")
    db.delete(bill)
    db.commit()
