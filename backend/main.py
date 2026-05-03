"""
Life Dashboard — FastAPI Backend
"""

import asyncio
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database.db import create_tables
from routers import wealth, todos, priorities, bills, analytics, health, dashboard, month_close, ingestion, news, gmail, assistant, coach, automation, planning, portfolio_agent
from routers.todos import action_router
from services.automation import automation_loop

app = FastAPI(title="Life Dashboard API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001",
        ).split(",")
        if origin.strip()
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Bootstrap SQLite tables on startup
@app.on_event("startup")
async def startup():
    create_tables()
    asyncio.create_task(automation_loop())

# Routers
app.include_router(wealth.router)
app.include_router(todos.router)
app.include_router(priorities.router)
app.include_router(bills.router)
app.include_router(analytics.router)
app.include_router(health.router)
app.include_router(dashboard.router)
app.include_router(month_close.router)
app.include_router(ingestion.router)
app.include_router(news.router)
app.include_router(gmail.router)
app.include_router(assistant.router)
app.include_router(coach.router)
app.include_router(automation.router)
app.include_router(planning.router)
app.include_router(portfolio_agent.router)
app.include_router(action_router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
