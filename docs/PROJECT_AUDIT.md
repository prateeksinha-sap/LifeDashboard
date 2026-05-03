# Project Audit

Date: 2026-04-29

## Executive View

Life Dashboard has moved from a visual dashboard into a local Personal CFO
system. The strongest parts are now the canonical finance engine, bank
transaction categorization, month-close workflow, asset allocation, equity
look-through, Gmail extraction path, and grounded assistant design.

The next level is less about adding more widgets and more about increasing data
trust, reducing manual work, and making every recommendation explain its basis.

## What Is Working Well

- Net worth is calculated from persisted holdings and manual balances.
- Bank statements persist and feed monthly cashflow trends.
- Investment transfers are separated from true consumption spend.
- Month-end snapshots create the base for historical trends.
- Zerodha holdings and CAS mutual funds are ingested.
- Mutual funds can be broken into underlying stocks through `mfdata.in`.
- Common Nifty ETFs can be broken into underlying index constituents.
- Large, mid, small-cap and sector exposure are now visible.
- Gmail OAuth sync exists and can populate bills/actionables.
- AI chat is grounded in deterministic dashboard data.
- Cloud LLM calls have deterministic fallback paths.

## Performance Findings

- Sector guidance previously had a high risk of repeated RSS and LLM calls on
  page load. This has been fixed with TTL caching.
- ETF/index constituents use in-process caching to avoid repeated NSE calls.
- The dashboard still performs many independent widget fetches. This is fine for
  local use, but a production version should add a single dashboard bootstrap
  endpoint that returns the common summary payload in one response.
- `backend/routers/wealth.py` is too large. It contains imports, valuation,
  trends, forecasts, equity allocation, and guidance. Splitting this will improve
  maintainability and startup/reload ergonomics.
- SQLite is acceptable for local use. For multi-device or hosted use, move to
  Postgres and add migrations.

## Functional Gaps

- Full bank automation is not solved. CSV import is reliable, but real
  automation needs Account Aggregator, bank API access, or email attachment
  ingestion.
- EPF, PPF, NPS, FD, and real estate are still mostly manual.
- Gmail sync depends on Google Cloud OAuth setup and runs only while the backend
  is running.
- News and sector guidance rely on RSS search and source filtering. This is good
  enough for a local assistant, but not equivalent to paid analyst research APIs.
- Health data is still not core to the financial mirror and should remain lower
  priority until finance workflows are fully trustworthy.

## Technical Debt

- Add database migrations instead of relying only on `create_all`.
- Split wealth router into smaller route modules.
- Add unit tests for bank statement parsing, CAS import, equity look-through,
  forecast math, and Gmail extraction.
- Add a dashboard bootstrap API to reduce frontend waterfalls.
- Add structured logging for automation, Gmail sync, and external data syncs.
- Persist external sync audit history instead of keeping only the last state.
- Add source freshness timestamps for AMFI, mfdata, NSE, and news guidance.

## Product Recommendations

- Make Data Freshness the control center for all automation.
- Make every dashboard recommendation show its data basis and confidence.
- Keep the dashboard focused on decisions:
  - Am I spending too much?
  - Am I investing enough?
  - Am I too concentrated?
  - What must I act on this week?
  - What data is stale or missing?
- Move noisy detail into drill-down pages.
- Treat AI as an analyst layer, not the calculator.

## Suggested Next Builds

1. Add a dashboard bootstrap endpoint to fetch summary, month close, freshness,
   actions, and coach overview together.
2. Add a data-source audit table for sync runs and freshness history.
3. Add email attachment ingestion for bank statements and CAS PDFs.
4. Add a monthly review page that turns the snapshot into a narrative:
   cashflow, spend changes, wealth movement, allocation drift, and actions.
5. Add scenario planning: change salary growth, SIP step-up, spend cuts, loan
   prepayment, and asset allocation return assumptions.
6. Add user-editable target allocation and show drift against it.
7. Add regression tests around all financial math.

## Current Verification Commands

```powershell
python -m compileall backend
python backend\tests\smoke_test.py
cd frontend
npm run lint
npm run build
```

## Architecture Direction

The system should evolve into four layers:

1. Ingestion layer: bank, CAS, Zerodha, Gmail, manual balances.
2. Canonical finance engine: net worth, cashflow, forecast, allocation, trends.
3. Intelligence layer: deterministic opportunities plus optional LLM summaries.
4. UI layer: dashboard, drill-downs, setup, and monthly review.

This keeps calculations explainable and lets the LLM improve communication
without becoming the source of truth.
