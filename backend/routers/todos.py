"""
routers/todos.py
GET    /api/todos
POST   /api/todos
PATCH  /api/todos/{id}
DELETE /api/todos/{id}

GET    /api/actionables           — list pending actionables
POST   /api/actionables           — create manual actionable
PUT    /api/actionables/{id}      — update status / priority
DELETE /api/actionables/{id}      — delete an actionable
"""

from datetime import date as date_cls, datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from database.db import get_db
from database.models import Todo, Actionable

router = APIRouter(prefix="/api/todos", tags=["todos"])

# ── Actionables router (separate prefix) ─────────────────────────────
action_router = APIRouter(prefix="/api/actionables", tags=["actionables"])


class TodoIn(BaseModel):
    text: str


class TodoPatch(BaseModel):
    text: Optional[str] = None
    done: Optional[bool] = None


@router.get("")
def list_todos(db: Session = Depends(get_db)):
    return db.query(Todo).order_by(Todo.created_at).all()


@router.post("", status_code=201)
def create_todo(body: TodoIn, db: Session = Depends(get_db)):
    todo = Todo(text=body.text)
    db.add(todo)
    db.commit()
    db.refresh(todo)
    return todo


@router.patch("/{todo_id}")
def update_todo(todo_id: int, body: TodoPatch, db: Session = Depends(get_db)):
    todo = db.query(Todo).filter_by(id=todo_id).first()
    if not todo:
        raise HTTPException(404, "Todo not found")
    if body.text is not None:
        todo.text = body.text
    if body.done is not None:
        todo.done = body.done
    db.commit()
    db.refresh(todo)
    return todo


@router.delete("/{todo_id}", status_code=204)
def delete_todo(todo_id: int, db: Session = Depends(get_db)):
    todo = db.query(Todo).filter_by(id=todo_id).first()
    if not todo:
        raise HTTPException(404, "Todo not found")
    db.delete(todo)
    db.commit()


# ════════════════════════════════════════════════════════════════════
#  Actionables API
# ════════════════════════════════════════════════════════════════════

class ActionableIn(BaseModel):
    task_description: str
    due_date:         Optional[str]  = None   # "YYYY-MM-DD"
    priority:         Optional[str]  = "Medium"
    source:           Optional[str]  = "Manual"


class ActionablePut(BaseModel):
    status:           Optional[str]  = None   # "Pending" | "Completed"
    priority:         Optional[str]  = None
    task_description: Optional[str]  = None
    due_date:         Optional[str]  = None


def _serialize_actionable(a: Actionable) -> dict:
    return {
        "id":               a.id,
        "source":           a.source,
        "task_description": a.task_description,
        "due_date":         a.due_date.isoformat() if a.due_date else None,
        "priority":         a.priority,
        "status":           a.status,
        "sender":           a.sender,
        "subject":          a.subject,
        "original_email_id": a.original_email_id,
        "created_at":       a.created_at.isoformat() if a.created_at else None,
    }


@action_router.get("")
def list_actionables(
    status:   Optional[str] = "Pending",
    source:   Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List actionables. Pass ?status=all to get everything."""
    q = db.query(Actionable)
    if status and status.lower() != "all":
        q = q.filter(Actionable.status == status)
    if source:
        q = q.filter(Actionable.source == source)
    items = q.order_by(
        # High first, then by due_date, then created
        Actionable.priority.desc(),
        Actionable.due_date.asc().nullslast(),
        Actionable.created_at.desc(),
    ).all()
    return [_serialize_actionable(a) for a in items]


@action_router.post("", status_code=201)
def create_actionable(body: ActionableIn, db: Session = Depends(get_db)):
    due = None
    if body.due_date:
        try:
            due = date_cls.fromisoformat(body.due_date)
        except ValueError:
            pass

    a = Actionable(
        source           = body.source or "Manual",
        task_description = body.task_description,
        due_date         = due,
        priority         = body.priority or "Medium",
        status           = "Pending",
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _serialize_actionable(a)


@action_router.put("/{item_id}")
def update_actionable(item_id: int, body: ActionablePut, db: Session = Depends(get_db)):
    a = db.query(Actionable).filter_by(id=item_id).first()
    if not a:
        raise HTTPException(404, "Actionable not found")

    if body.status is not None:
        a.status = body.status
    if body.priority is not None:
        a.priority = body.priority
    if body.task_description is not None:
        a.task_description = body.task_description
    if body.due_date is not None:
        try:
            a.due_date = date_cls.fromisoformat(body.due_date)
        except ValueError:
            pass
    a.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(a)
    return _serialize_actionable(a)


@action_router.delete("/{item_id}", status_code=204)
def delete_actionable(item_id: int, db: Session = Depends(get_db)):
    a = db.query(Actionable).filter_by(id=item_id).first()
    if not a:
        raise HTTPException(404, "Actionable not found")
    db.delete(a)
    db.commit()
