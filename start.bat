@echo off
setlocal EnableExtensions

title Life Dashboard - Launcher
color 0A

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "BACKEND_PORT=8003"
set "FRONTEND_PORT=3001"
set "API_BASE=http://127.0.0.1:%BACKEND_PORT%"
set "FRONTEND_URL=http://localhost:%FRONTEND_PORT%"

echo.
echo ==================================================
echo              LIFE DASHBOARD LAUNCHER
echo ==================================================
echo Project: %ROOT%
echo Backend: %API_BASE%
echo Frontend: %FRONTEND_URL%
echo.

if not exist "%BACKEND%\main.py" (
  echo ERROR: backend\main.py was not found.
  echo Expected project root: %ROOT%
  pause
  exit /b 1
)

if not exist "%FRONTEND%\package.json" (
  echo ERROR: frontend\package.json was not found.
  echo Expected project root: %ROOT%
  pause
  exit /b 1
)

if not exist "%FRONTEND%\node_modules" (
  echo Installing frontend dependencies...
  pushd "%FRONTEND%"
  call npm install
  if errorlevel 1 (
    popd
    echo ERROR: frontend dependency install failed.
    pause
    exit /b 1
  )
  popd
)

call :CheckUrl "%API_BASE%/api/health"
if errorlevel 1 (
  echo [1/3] Starting backend on :%BACKEND_PORT%...
  start "LifeDash Backend" cmd /k "cd /d ""%BACKEND%"" && python -m uvicorn main:app --reload --port %BACKEND_PORT%"
) else (
  echo [1/3] Backend already running on :%BACKEND_PORT%.
)

call :CheckUrl "%FRONTEND_URL%"
if errorlevel 1 (
  echo [2/3] Starting frontend on :%FRONTEND_PORT%...
  start "LifeDash Frontend" cmd /k "cd /d ""%FRONTEND%"" && npx next dev -p %FRONTEND_PORT%"
) else (
  echo [2/3] Frontend already running on :%FRONTEND_PORT%.
)

echo [3/3] Waiting for services...
call :WaitFor "backend" "%API_BASE%/api/health" 40
if errorlevel 1 goto FAILED

call :WaitFor "frontend" "%FRONTEND_URL%" 40
if errorlevel 1 goto FAILED

echo.
echo OK: Dashboard is live.
echo Opening %FRONTEND_URL%
start "" "%FRONTEND_URL%"
echo.
echo You can close this launcher window. The backend/frontend windows keep running.
pause
exit /b 0

:CheckUrl
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%~1' -TimeoutSec 2; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }"
exit /b %errorlevel%

:WaitFor
set "NAME=%~1"
set "URL=%~2"
set /a "TRIES=%~3"
:WAIT_LOOP
call :CheckUrl "%URL%"
if not errorlevel 1 (
  echo     %NAME% ready.
  exit /b 0
)
set /a TRIES-=1
if %TRIES% LEQ 0 (
  echo ERROR: %NAME% did not become ready at %URL%.
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto WAIT_LOOP

:FAILED
echo.
echo Launcher could not confirm that both services are ready.
echo Check the backend and frontend windows for the actual error.
pause
exit /b 1
