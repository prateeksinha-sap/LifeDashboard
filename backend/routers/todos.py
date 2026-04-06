"""
routers/todos.py
GET    /api/todos
POST   /api/todos
PATCH  /api/todos/{id}
DELETE /api/todos/{id}
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from database.db import get_db
from database.models import Todo

router = APIRouter(prefix="/api/todos", tags=["todos"])


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
