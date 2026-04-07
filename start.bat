@echo off
title Life Dashboard

:: ── Start Frontend ───────────────────────────────────
start "Life Dashboard - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

:: ── Start Backend ────────────────────────────────────
start "Life Dashboard - Backend" cmd /k "cd /d "%~dp0backend" && uvicorn main:app --reload --port 8001"

:: ── Wait 4 seconds then open browser ─────────────────
timeout /t 4 /nobreak >nul
start "" "http://localhost:3000"
