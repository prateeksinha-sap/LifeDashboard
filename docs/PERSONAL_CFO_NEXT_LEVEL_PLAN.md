# Life Dashboard: Personal CFO Upgrade Plan

This document is the implementation checklist for turning Life Dashboard from a
collection of widgets into a trustworthy personal finance operating system.

## Product Intent

The app should show the user a clear mirror:

- What is my net worth today?
- Where did money actually go this month?
- What part of spending is lifestyle, what part is investing, and what part is
  unclear money movement?
- Am I on track to become meaningfully wealthier over the next 2-5 years?
- What should I change this week or this month?
- Which bills, school mails, bank alerts, investments, and deadlines need action?
- Which data sources are fresh, stale, missing, automated, or manual?

## Findings To Address

### Calculation Gaps

- Forecast math was split across the wealth endpoint, coach endpoint, and
  assistant context.
- The previous forecast used a single flat return assumption and did not explain
  salary growth, spend inflation, asset-class returns, or MF-only step-up clearly.
- Investment transfers could be confused with consumption expenses.
- One-off investment transfers could distort recurring monthly investing.
- Net worth is a gross asset view; liabilities are not yet modelled.
- Cash and invested assets need separate paths in every projection.
- Current salary should be explicit. The working baseline is INR 2.18L/month with
  at least 5% annual growth.

### Data Ingestion Gaps

- Bank statements are still manual file imports.
- Stock and MF data can be imported and refreshed, but brokerage/CAS ingestion is
  not fully automated.
- Gmail sync was too conservative and could skip important emails in Gmail's
  Updates category.
- Initial Gmail sync should load at least the current and previous month, then
  run deltas.
- Automation only runs while the local backend is running.
- The UI needs to say what is automated, what is stale, and what requires manual
  setup.

### AI Chat And Suggestions

- The assistant should not invent calculations. It should use deterministic
  finance data and only use an LLM for explanation, prioritization, and insight.
- Exact questions such as "break down the 88K transfer" should use ledger data,
  not a generic AI answer.
- Premium cloud LLMs should be used only for high-value summaries or complex
  advisory questions; routine data extraction can use cheaper/local paths.
- The app should expose which provider/model answered and what data was used.

### Dashboard Meaningfulness

- Widgets should reflect decisions, not duplicate large net-worth numbers.
- Useful top-level areas are:
  - Mirror: health score, current cashflow, allocation risk, data trust.
  - Plan: path to wealth, scenario gap, spend optimization.
  - Actions: bills, important emails, priorities.
  - Evidence: category drilldowns, transactions, source freshness.
- Detailed asset trends are only useful after multiple month-end snapshots.

## Finance Expert Approach

The app should use a Personal CFO Engine as the single source of truth.

### Canonical Model

- Net worth = cash + investments + retirement assets + gold + real estate + fixed
  deposits + other manual assets, minus liabilities when liability tracking is
  added.
- Cashflow = income - true consumption spend - planned investment outflows.
- True spend excludes transactions classified as Investments & Savings and keeps
  unclear transfers visible instead of silently treating them as lifestyle spend.
- Salary baseline = configured monthly salary, default INR 2.18L.
- Salary growth = configured annual growth, minimum default 5%.
- Spend inflation = configured annual inflation, default 6%.
- SIP step-up applies only to detected mutual fund/SIP outflows, not all
  investment transfers.
- Asset returns are weighted by actual asset buckets instead of one flat return.

### Forecast Scenarios

- Base path: keep recurring MF SIP and other recurring investing flat.
- MF step-up path: increase MF SIP by user-selected percentage each year,
  default 10%.
- Cash path: cash grows with salary surplus and shrinks only when planned
  investing exceeds available surplus.
- No negative cash display. If a plan is unaffordable, show a funding gap.
- Every projected number should include assumptions and confidence.

### AI Architecture

- Deterministic engine computes net worth, cashflow, categories, and forecasts.
- LLM summarizes and recommends, with the deterministic context attached.
- Local models are acceptable for privacy-first extraction, but premium cloud
  models are preferred for serious financial reasoning if the user permits API
  spend.
- Target monthly LLM budget: under INR 1000 unless explicitly raised.

## Manual Steps That May Remain

- OAuth setup for Gmail requires a one-time Google Cloud credential download and
  user consent.
- Fully automatic bank statement ingestion needs Account Aggregator or bank API
  integration; CSV import remains the fallback.
- Fully automatic Zerodha holdings need Kite Connect or another brokerage
  integration; holdings import plus price refresh is the fallback.
- Mutual fund holdings need CAS import or a future CAS-email/AA integration; NAV
  refresh can be automated after holdings exist.
- Real estate, gold held physically, EPF, PPF, NPS, and FD balances may still
  need manual or statement-based updates until direct integrations are added.

## Implementation Checklist

- Add shared Personal CFO finance engine.
- Wire wealth forecast to the shared engine.
- Wire coach metrics and memo context to the shared engine.
- Wire assistant forecast context to the shared engine.
- Make salary growth, spend inflation, MF step-up, and asset return assumptions
  explicit in API responses.
- Make Gmail initial sync scan current plus previous month.
- Stop skipping Gmail Updates category.
- Surface Gmail sync query, candidate count, skipped count, and last error in the
  dashboard.
- Keep build, lint, and backend compile passing.
