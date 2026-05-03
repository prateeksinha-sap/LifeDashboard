from __future__ import annotations

from fastapi import APIRouter

from services.automation import automation_status, run_automation_once

router = APIRouter(prefix="/api/automation", tags=["automation"])


@router.get("/status")
def get_automation_status():
    return automation_status()


@router.post("/run")
async def run_automation_now(force: bool = True):
    return await run_automation_once(force=force)
