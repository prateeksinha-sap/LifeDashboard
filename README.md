# Life Dashboard

Private local dashboard for personal finance, life admin, and action tracking.

The core idea is simple: show a truthful mirror of net worth, cashflow,
investment allocation, upcoming obligations, important communication, and the
next actions that can improve wealth creation.

## What It Does

- Tracks net worth across cash, stocks, mutual funds, gold, real estate, FD, PF,
  PPF, NPS, and liabilities where configured.
- Imports bank statements and separates income, true expenses, investments, and
  unclear transfers.
- Imports Zerodha holdings and CAS mutual fund statements.
- Builds monthly snapshots for trends and forecasting.
- Expands mutual funds into underlying stocks through a free MF data source.
- Expands common Nifty index ETFs into underlying stocks using NSE index data.
- Shows large, mid, and small-cap equity exposure.
- Shows sector exposure and sourced sector guidance.
- Syncs Gmail for bills, reminders, school messages, and actionables after OAuth
  setup.
- Provides a grounded Life Assistant and Personal CFO style recommendations.

## Quick Start

From the project root:

```bat
start.bat
```

This starts:

- Backend: `http://127.0.0.1:8003`
- Frontend: `http://localhost:3001`

Open the app at:

[http://localhost:3001](http://localhost:3001)

## Manual Start

Backend:

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8003
```

Frontend:

```powershell
cd frontend
npm install
$env:NEXT_PUBLIC_API_BASE="http://127.0.0.1:8003"
npx next dev -p 3001
```

## Configuration

Copy the sample backend config:

```powershell
Copy-Item backend\.env.example backend\.env
```

Important settings:

```env
DATABASE_URL=sqlite:///./dashboard.db
USER_MONTHLY_SALARY_INR=0
SALARY_GROWTH_PCT=5
SPEND_INFLATION_PCT=6
OPENAI_MODEL=gpt-5-mini
ASSISTANT_PROVIDER=auto
SECTOR_GUIDANCE_PROVIDER=auto
SECTOR_NEWS_CACHE_MINUTES=360
SECTOR_GUIDANCE_CACHE_MINUTES=360
AUTO_SYNC_ENABLED=true
GMAIL_AUTO_SYNC_MINUTES=240
INVESTMENT_REFRESH_HOURS=24
EQUITY_LOOKTHROUGH_REFRESH_HOURS=24
```

Secrets stay local in `backend/.env`. Do not commit `.env`, OAuth files, CAS
PDFs, exported spreadsheets, or `dashboard.db`.

## Data Ingestion

### Bank Account Statement

Use the dashboard import button for bank CSV statements. The importer accepts
statement-like CSVs with date, narration/description, debit, credit, and balance
style columns. It stores transactions and updates cash/bank balance from the
latest statement balance when available.

Cash withdrawals are stored in the database for auditability, but are hidden from
dashboard spend totals, category breakdowns, coach suggestions, and AI answers.

Recommended rhythm:

- Initial setup: import the last 12 months.
- Monthly refresh: import the latest month after month end.
- The app de-duplicates already imported transactions.

### Stocks

Use Zerodha holdings export in `.xlsx` or `.csv` form. The app reads symbol,
quantity, average price, current/last price, and sector when available.

The equity drill-down also maps direct stocks to AMFI large/mid/small
classification and sector.

### Mutual Funds

Use CAS PDF import with the CAS password configured in `backend/.env` or entered
through the UI where available. CDSL e-CAS files usually open with PAN uppercase;
some other CAS exports use PAN+DOB. The app stores fund holdings, refreshes NAVs,
and uses `mfdata.in` to get underlying stock portfolios.

### ETF And Index Look-Through

Common Nifty index ETFs are expanded into underlying stocks:

- Nifty 50
- Nifty Next 50
- Nifty Midcap 150
- Nifty Smallcap 250

Primary source: NSE live index endpoint. Fallback source: official Nifty Indices
constituent CSVs. When live weights are unavailable, fallback rows are equal
weighted and marked as such.

### Manual Balances

Use the Balances/Data Setup UI for:

- Real estate
- FD
- PF/EPF
- PPF
- NPS
- Physical gold
- Other manual assets
- Liabilities and goals

### Gmail

Gmail sync needs one-time OAuth setup in Google Cloud:

- Enable Gmail API.
- Create OAuth Desktop App credentials.
- Download the OAuth JSON.
- Upload it in Data Setup/Gmail Sync.
- Authorize the account in the browser.

After setup, the backend can sync current and delta emails while the app is
running. It extracts bills, actionables, and reminders using the configured AI
extraction provider.

## Automation

Automation runs only while the backend is running.

Current automated jobs:

- Gmail sync
- Gmail/local-folder file ingestion for bank CSV, Zerodha holdings, CAS PDFs,
  and health CSVs
- Investment price/NAV refresh
- Equity look-through refresh
- Month-end snapshot capture when required inputs are ready

Use the Data Freshness tile to see what is fresh, stale, missing, or failing.

### Automated File Ingestion

The dashboard scans this local inbox by default:

```text
%USERPROFILE%\Documents\LifeDashboard\IngestionInbox
```

You can override it with `INGESTION_INBOX_DIR` in `backend/.env`. Files dropped
there, or received as matching Gmail attachments, are copied into the backend
audit store and processed idempotently by SHA-256 hash.

Auto-imported when detected with high confidence:

- Bank statement `.csv` / `.txt`
- Zerodha stock holdings `.xlsx` / `.xlsm` / `.csv`
- Mutual fund CAS `.pdf` when `CAS_PASSWORD` is configured
- Health metric `.csv` / `.txt`

Staged for review:

- Credit-card, loan, and EMI statements
- EPF, PPF, NPS, FD, or other manual-balance statements
- Unknown tabular/PDF files

## AI And LLM Usage

The app follows this rule:

1. Deterministic code calculates facts.
2. LLMs summarize, explain, and prioritize.
3. If the premium model is unavailable or rate-limited, the app falls back to
   deterministic grounded logic.

Used for:

- Life Assistant answers
- Gmail extraction
- Personal CFO memo
- Sector guidance

Cost control:

- Routine dashboard facts do not need an LLM.
- Sector guidance and CFO reports are cached.
- Local Ollama can be used for private/cheap extraction.
- Cloud models can be used for better reasoning when configured.

## External APIs And Sources

- `mfapi.in`: mutual fund NAV refresh.
- `mfdata.in`: mutual fund portfolio holdings.
- `amfiindia.com`: AMFI/SEBI large, mid, small-cap security classification.
- `nseindia.com`: live index constituents and free-float market cap.
- `niftyindices.com`: fallback index constituent CSVs.
- Google News RSS: impact news and sector guidance source discovery.
- Gmail API: email actionables, reminders, bills.
- Optional OpenAI/Anthropic/Ollama: AI summary and reasoning.

## Testing

Backend:

```powershell
python -m compileall backend
python backend\tests\smoke_test.py
```

Frontend:

```powershell
cd frontend
npm run lint
npm run build
```

Live checks:

```powershell
Invoke-WebRequest http://127.0.0.1:8003/api/health
Invoke-WebRequest http://127.0.0.1:8003/api/wealth/equity-allocation
Invoke-WebRequest http://localhost:3001/equity-allocation
```

## Current Architecture

- `backend/routers`: FastAPI route layer.
- `backend/services/finance_engine.py`: canonical finance calculations.
- `backend/services/equity_sync.py`: AMFI and MF portfolio sync.
- `backend/services/index_lookthrough.py`: ETF/index constituent expansion.
- `backend/services/financial_coach.py`: deterministic Personal CFO overview.
- `backend/services/ai_service.py`: Ollama/OpenAI/Anthropic adapters.
- `frontend/app/page.tsx`: dashboard shell.
- `frontend/app/equity-allocation/page.tsx`: equity drill-down and sector
  guidance.
- `frontend/components`: dashboard widgets and panels.

## Known Limits

- This is a local app, not a hosted production service.
- Automation stops when the backend stops.
- Bank, EPF, PPF, NPS, FD, and real-estate integrations are not fully automatic.
- Gmail OAuth setup is still a manual Google Cloud step.
- Sector guidance is educational and source-grounded, not regulated investment
  advice.
