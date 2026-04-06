# Life Dashboard

A personal life command center — bento-grid dashboard built with Next.js 16 + FastAPI.

## Structure

```
LifeDashboard/
  frontend/   ← Next.js 16 (App Router) · TypeScript · Tailwind v4 · Framer Motion
  backend/    ← Python FastAPI (Phase 1: health check)
```

## Run the frontend

```bash
cd frontend
npm run dev
```

Open http://localhost:3000

## Run the backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

API at http://localhost:8000
