@echo off
setlocal
title Life Dashboard

set "ROOT=%~dp0"
set "FRONTEND=%ROOT%frontend"
set "BACKEND=%ROOT%backend"

if not exist "%FRONTEND%\node_modules" (
  echo Installing frontend dependencies...
  pushd "%FRONTEND%"
  call npm install
  if errorlevel 1 (
    echo Frontend dependency install failed.
    pause
    exit /b 1
  )
  popd
)

echo Starting backend on http://localhost:8003
start "Life Dashboard - Backend" cmd /k "cd /d "%BACKEND%" && python -m uvicorn main:app --reload --port 8003"

echo Starting frontend on http://localhost:3001
start "Life Dashboard - Frontend" cmd /k "cd /d "%FRONTEND%" && set "NEXT_PUBLIC_API_BASE=http://127.0.0.1:8003" && npx next dev -p 3001"

timeout /t 5 /nobreak >nul
start "" "http://localhost:3001"
