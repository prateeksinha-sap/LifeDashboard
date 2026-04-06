"""
Life Dashboard — FastAPI Backend
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database.db import create_tables
from routers import wealth, todos, priorities, bills, analytics, health
from routers.todos import action_router

app = FastAPI(title="Life Dashboard API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Bootstrap SQLite tables on startup
@app.on_event("startup")
def startup():
    create_tables()

# Routers
app.include_router(wealth.router)
app.include_router(todos.router)
app.include_router(priorities.router)
app.include_router(bills.router)
app.include_router(analytics.router)
app.include_router(health.router)
app.include_router(action_router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
