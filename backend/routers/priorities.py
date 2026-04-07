"""
routers/priorities.py
GET  /api/priorities
PUT  /api/priorities        — replace full list (ranked)
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List

from database.db import get_db
from database.models import Priority

router = APIRouter(prefix="/api/priorities", tags=["priorities"])


class PriorityItem(BaseModel):
    rank:                int
    text:                str
    eisenhower_quadrant: str = "Q2"


@router.get("")
def list_priorities(db: Session = Depends(get_db)):
    return db.query(Priority).order_by(Priority.rank).all()


@router.put("")
def replace_priorities(items: List[PriorityItem], db: Session = Depends(get_db)):
    """Replace the full priority list."""
    db.query(Priority).delete()
    for item in items:
        db.add(Priority(
            rank=item.rank,
            text=item.text,
            eisenhower_quadrant=item.eisenhower_quadrant,
        ))
    db.commit()
    return db.query(Priority).order_by(Priority.rank).all()
