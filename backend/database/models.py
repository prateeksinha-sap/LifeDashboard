"""
models.py — SQLAlchemy ORM table definitions
All data for the Life Dashboard lives here.
"""

from datetime import datetime, date
from sqlalchemy import (
    Column, Integer, Float, String, Boolean,
    DateTime, Date, Text, UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# ── Mutual Fund holdings (populated by CAS import) ──────────────────
class MFHolding(Base):
    __tablename__ = "mf_holdings"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    folio       = Column(String,  nullable=False)
    amc         = Column(String,  nullable=False)
    scheme_name = Column(String,  nullable=False)
    isin        = Column(String,  nullable=True)
    scheme_code = Column(Integer, nullable=True)   # mfapi.in code (fetched lazily)
    units       = Column(Float,   nullable=False)
    nav         = Column(Float,   nullable=False)
    value       = Column(Float,   nullable=False)
    nav_date    = Column(Date,    nullable=True)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Stock holdings (Zerodha — entered manually or via CSV/Excel import) ─
class StockHolding(Base):
    __tablename__ = "stock_holdings"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    symbol        = Column(String,  nullable=False, unique=True)  # NSE symbol e.g. RELIANCE
    company_name  = Column(String,  nullable=True)
    quantity      = Column(Integer, nullable=False)
    avg_price     = Column(Float,   nullable=False)
    current_price = Column(Float,   nullable=True)   # refreshed from yfinance
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Manual assets (EPF, PPF, NPS, Bank, Gold) ────────────────────────
class EquitySecurityClassification(Base):
    __tablename__ = "equity_security_classifications"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    security_name = Column(String, nullable=False)
    symbol        = Column(String, nullable=True)
    isin          = Column(String, nullable=True)
    category      = Column(String, nullable=False)
    sector        = Column(String, nullable=True)
    source        = Column(String, nullable=True)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("security_name", "symbol", "isin", name="uq_equity_security_identity"),
    )


class FundPortfolioStock(Base):
    __tablename__ = "fund_portfolio_stocks"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    scheme_name = Column(String, nullable=False)
    amc         = Column(String, nullable=True)
    stock_name  = Column(String, nullable=False)
    symbol      = Column(String, nullable=True)
    isin        = Column(String, nullable=True)
    category    = Column(String, nullable=True)
    sector      = Column(String, nullable=True)
    weight_pct  = Column(Float, nullable=False)
    as_of_date  = Column(Date, nullable=True)
    source      = Column(String, nullable=True)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("scheme_name", "stock_name", "symbol", "isin", name="uq_fund_portfolio_stock_identity"),
    )


class ManualAsset(Base):
    __tablename__ = "manual_assets"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    asset_type = Column(String, nullable=False, unique=True)
    # EPF | PPF | NPS | BANK | GOLD_GRAMS
    value      = Column(Float,  nullable=False, default=0)
    # For GOLD_GRAMS this is grams; for all others it's ₹
    notes      = Column(Text,   nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Todos ────────────────────────────────────────────────────────────
class Todo(Base):
    __tablename__ = "todos"

    id         = Column(Integer,  primary_key=True, autoincrement=True)
    text       = Column(String,   nullable=False)
    done       = Column(Boolean,  default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


# ── Weekly priorities (Eisenhower-aware) ─────────────────────────────
# Quadrants:
#   Q1 — Urgent & Important     (do first — fire-fighting)
#   Q2 — Important, Not Urgent  (schedule  — deep work, growth)
#   Q3 — Urgent, Not Important  (delegate  — interruptions)
#   Q4 — Neither                (eliminate — time-wasters)
class Priority(Base):
    __tablename__ = "priorities"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    rank                = Column(Integer, nullable=False, unique=True)
    text                = Column(String,  nullable=False)
    eisenhower_quadrant = Column(String,  nullable=True, default="Q2")
    # Q1 | Q2 | Q3 | Q4


# ── Upcoming bills / financial events ────────────────────────────────
class Bill(Base):
    __tablename__ = "bills"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    name            = Column(String,  nullable=False)
    amount          = Column(Float,   nullable=False)   # ₹
    due_date        = Column(Date,    nullable=False)
    is_paid         = Column(Boolean, default=False)
    is_recurring    = Column(Boolean, default=True)
    recurrence_days = Column(Integer, nullable=True)    # 30 = monthly


# ── Health metrics (Samsung Health CSV import) ───────────────────────
class HealthMetric(Base):
    __tablename__ = "health_metrics"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    date         = Column(Date,    nullable=False, unique=True)
    steps        = Column(Integer, nullable=True)
    sleep_hours  = Column(Float,   nullable=True)   # e.g. 7.25
    resting_hr   = Column(Integer, nullable=True)   # beats per minute
    active_mins  = Column(Integer, nullable=True)   # active / exercise minutes
    calories     = Column(Integer, nullable=True)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Medical reports (AI-parsed) ───────────────────────────────────────
# Populated by ai_service.parse_medical_text() from uploaded PDF/text.
# status_flags and action_items stored as JSON strings.
#
# status_flags example:
#   {"HbA1c": "optimal", "cholesterol": "warning", "bp": "optimal"}
#
# action_items example:
#   ["Reduce carb intake", "Re-test cholesterol in 3 months"]
class MedicalReport(Base):
    __tablename__ = "medical_reports"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    report_date  = Column(Date,    nullable=False)
    source       = Column(String,  nullable=True)   # e.g. "Apollo Diagnostics"
    summary      = Column(Text,    nullable=True)   # AI-generated plain-English summary
    status_flags = Column(Text,    nullable=True)   # JSON: {marker: "optimal"|"warning"|"critical"}
    action_items = Column(Text,    nullable=True)   # JSON: [str, ...]
    raw_text     = Column(Text,    nullable=True)   # original extracted text for re-parsing
    created_at   = Column(DateTime, default=datetime.utcnow)


# ── Life balance log ──────────────────────────────────────────────────
# Tracks time spent across life domains so the LifeBalanceCard
# can show Work vs. Upskilling vs. Leisure ratios.
#
# category options  : "Work" | "Upskilling" | "Leisure" | "Family" | "Health"
# subcategory examples:
#   Work      → "My Company", "Client Delivery", "Admin"
#   Upskilling→ "SAP BTP", "RAG / AI", "Agentic AI", "Certifications"
#   Leisure   → "Badminton", "Guitar", "Opeth / Music", "Reading"
#   Family    → "Child", "Partner", "Family Outing"
#   Health    → "Gym", "Meditation", "Sleep"
class LifeLog(Base):
    __tablename__ = "life_logs"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    log_date         = Column(Date,    nullable=False, default=date.today)
    category         = Column(String,  nullable=False)   # top-level bucket
    subcategory      = Column(String,  nullable=True)    # specific activity
    duration_minutes = Column(Integer, nullable=False)   # time spent
    notes            = Column(Text,    nullable=True)    # optional free text
    created_at       = Column(DateTime, default=datetime.utcnow)


# ── Personal CRM ──────────────────────────────────────────────────────
# Tracks relationship health — surfaces contacts who haven't been
# reached in a while so they bubble up as "Needs Check-in" alerts.
class PersonalCRM(Base):
    __tablename__ = "personal_crm"

    id                    = Column(Integer, primary_key=True, autoincrement=True)
    contact_name          = Column(String, nullable=False, unique=True)
    relationship          = Column(String, nullable=True)   # "Friend" | "Family" | "Colleague"
    last_contact_date     = Column(Date,   nullable=True)
    check_in_interval_days= Column(Integer, nullable=False, default=30)
    # How many days between expected check-ins (default: monthly)
    notes                 = Column(Text,   nullable=True)
    updated_at            = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Bank transactions (CSV import + LLM categorisation) ───────────────
# Populated by scripts/import_bank_statement.py.
# transaction_type: "Credit" (money in) | "Debit" (money out)
# category: LLM-assigned from {Salary, Utilities, Groceries, Dining,
#            Investments, Travel, EMI, Education, Healthcare, Misc}
class Transaction(Base):
    __tablename__ = "transactions"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    date             = Column(Date,    nullable=False, index=True)
    description      = Column(String,  nullable=False)
    amount           = Column(Float,   nullable=False)   # always positive
    transaction_type = Column(String,  nullable=False)   # "Credit" | "Debit"
    category         = Column(String,  nullable=True)    # LLM-assigned
    account_source   = Column(String,  nullable=True)    # e.g. "HDFC Savings"
    created_at       = Column(DateTime, default=datetime.utcnow)


class CategoryRule(Base):
    __tablename__ = "category_rules"
    __table_args__ = (UniqueConstraint("pattern", "transaction_type", name="uq_category_rule_pattern_type"),)

    id               = Column(Integer, primary_key=True, autoincrement=True)
    pattern          = Column(String, nullable=False)   # merchant/description substring, lower-cased
    category         = Column(String, nullable=False)
    transaction_type = Column(String, nullable=False, default="Debit")  # Debit | Credit
    match_count      = Column(Integer, nullable=False, default=0)
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Monthly net-worth snapshots ────────────────────────────────────────
# Populated by POST /api/wealth/snapshot (call at month-end or manually).
# month_year format: "2026-04"  (YYYY-MM)
class HistoricalWealth(Base):
    __tablename__ = "historical_wealth"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    month_year      = Column(String,  nullable=False, unique=True)
    total_net_worth = Column(Float,   nullable=False)
    total_liquid    = Column(Float,   nullable=True)    # bank + cash balance
    total_invested  = Column(Float,   nullable=True)    # MF + stocks + EPF/PPF/NPS + gold
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AssetSnapshot(Base):
    __tablename__ = "asset_snapshots"
    __table_args__ = (UniqueConstraint("month_year", "asset_type", name="uq_asset_snapshot_month_type"),)

    id         = Column(Integer, primary_key=True, autoincrement=True)
    month_year = Column(String, nullable=False)
    asset_type = Column(String, nullable=False)
    value      = Column(Float, nullable=False, default=0)
    source     = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Liability(Base):
    __tablename__ = "liabilities"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    name               = Column(String, nullable=False)
    liability_type     = Column(String, nullable=False, default="Loan")
    outstanding_amount = Column(Float, nullable=False, default=0)
    interest_rate_pct  = Column(Float, nullable=True)
    emi_amount         = Column(Float, nullable=True)
    due_day            = Column(Integer, nullable=True)
    notes              = Column(Text, nullable=True)
    updated_at         = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FinancialGoal(Base):
    __tablename__ = "financial_goals"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    name           = Column(String, nullable=False)
    target_amount  = Column(Float, nullable=False)
    target_date    = Column(Date, nullable=True)
    current_amount = Column(Float, nullable=False, default=0)
    priority       = Column(String, nullable=False, default="Medium")
    notes          = Column(Text, nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MonthClose(Base):
    __tablename__ = "month_close"

    id                        = Column(Integer, primary_key=True, autoincrement=True)
    month_year                = Column(String, nullable=False, unique=True)
    bank_statement_imported   = Column(Boolean, default=False)
    balances_updated          = Column(Boolean, default=False)
    investments_refreshed     = Column(Boolean, default=False)
    actionables_reviewed      = Column(Boolean, default=False)
    snapshot_captured         = Column(Boolean, default=False)
    status                    = Column(String, nullable=False, default="Open")
    data_quality_score        = Column(Integer, nullable=False, default=0)
    notes                     = Column(Text, nullable=True)
    closed_at                 = Column(DateTime, nullable=True)
    created_at                = Column(DateTime, default=datetime.utcnow)
    updated_at                = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Actionables (Gmail-extracted + manual tasks) ───────────────────────
# Unified task list:
#   • Gmail-extracted action items  (source="Gmail")
#   • Manually added reminders      (source="Manual")
# priority : "High" | "Medium" | "Low"
# status   : "Pending" | "Completed"
class IngestionFile(Base):
    __tablename__ = "ingestion_files"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    source        = Column(String, nullable=False, default="drop_folder")
    source_key    = Column(String, nullable=True)
    filename      = Column(String, nullable=False)
    stored_path   = Column(Text, nullable=False)
    mime_type     = Column(String, nullable=True)
    size_bytes    = Column(Integer, nullable=True)
    sha256        = Column(String, nullable=False, unique=True)
    detected_type = Column(String, nullable=False, default="unknown")
    confidence    = Column(Float, nullable=False, default=0.0)
    status        = Column(String, nullable=False, default="staged")
    reason        = Column(Text, nullable=True)
    error         = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)
    result_json   = Column(Text, nullable=True)
    imported_at   = Column(DateTime, nullable=True)
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Actionable(Base):
    __tablename__ = "actionables"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    source            = Column(String,  nullable=False, default="Manual")  # "Gmail"|"Manual"
    task_description  = Column(Text,    nullable=False)
    due_date          = Column(Date,    nullable=True)
    priority          = Column(String,  nullable=False, default="Medium")  # High|Medium|Low
    status            = Column(String,  nullable=False, default="Pending") # Pending|Completed
    original_email_id = Column(String,  nullable=True)   # Gmail message ID
    sender            = Column(String,  nullable=True)   # email sender display name
    subject           = Column(String,  nullable=True)   # email subject line
    created_at        = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PortfolioAgentRun(Base):
    __tablename__ = "portfolio_agent_runs"

    id                       = Column(Integer, primary_key=True, autoincrement=True)
    run_id                   = Column(String, nullable=False, unique=True)
    report_date              = Column(Date, nullable=True)
    generated_at             = Column(DateTime, nullable=True)
    imported_at              = Column(DateTime, default=datetime.utcnow)
    source_path              = Column(Text, nullable=True)
    source_mtime             = Column(DateTime, nullable=True)
    report_json              = Column(Text, nullable=False)
    cost_json                = Column(Text, nullable=True)
    run_mode                 = Column(String, nullable=True)
    data_mode                = Column(String, nullable=True)
    delivery_mode            = Column(String, nullable=True)
    email_status             = Column(String, nullable=True)
    slack_status             = Column(String, nullable=True)
    model                    = Column(String, nullable=True)
    estimated_cost_usd       = Column(Float, nullable=True)
    total_invested           = Column(Float, nullable=True)
    total_current_value      = Column(Float, nullable=True)
    total_pnl                = Column(Float, nullable=True)
    total_pnl_pct            = Column(Float, nullable=True)
    required_annual_return_pct = Column(Float, nullable=True)
    estimated_portfolio_cagr = Column(Float, nullable=True)
    target_portfolio_value   = Column(Float, nullable=True)
    on_track_to_double       = Column(Boolean, nullable=True)
    capital_growth_verdict   = Column(Text, nullable=True)
    overall_sentiment        = Column(String, nullable=True)
    top_action               = Column(Text, nullable=True)
    created_at               = Column(DateTime, default=datetime.utcnow)
    updated_at               = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PortfolioAgentRecommendation(Base):
    __tablename__ = "portfolio_agent_recommendations"
    __table_args__ = (
        UniqueConstraint("run_id", "source_type", "fingerprint", name="uq_portfolio_agent_run_rec"),
    )

    id                       = Column(Integer, primary_key=True, autoincrement=True)
    run_id                   = Column(String, nullable=False)
    run_db_id                = Column(Integer, nullable=True)
    source_type              = Column(String, nullable=False)  # action_plan | validated | rejected | futures
    fingerprint              = Column(String, nullable=False)
    priority                 = Column(Integer, nullable=True)
    ticker                   = Column(String, nullable=True)
    name                     = Column(String, nullable=True)
    action                   = Column(Text, nullable=False)
    timing                   = Column(String, nullable=True)
    source_agent             = Column(String, nullable=True)
    conviction               = Column(String, nullable=True)
    estimated_amount_inr     = Column(Float, nullable=True)
    suggested_allocation_pct = Column(Float, nullable=True)
    target_price             = Column(Float, nullable=True)
    rationale                = Column(Text, nullable=True)
    raw_json                 = Column(Text, nullable=False)
    created_at               = Column(DateTime, default=datetime.utcnow)
    updated_at               = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PortfolioAgentDecision(Base):
    __tablename__ = "portfolio_agent_decisions"

    id                         = Column(Integer, primary_key=True, autoincrement=True)
    fingerprint                = Column(String, nullable=False, unique=True)
    status                     = Column(String, nullable=False, default="Review")
    notes                      = Column(Text, nullable=True)
    review_date                = Column(Date, nullable=True)
    dismissed_until            = Column(Date, nullable=True)
    actionable_id              = Column(Integer, nullable=True)
    last_recommendation_id     = Column(Integer, nullable=True)
    last_run_id                = Column(String, nullable=True)
    decided_at                 = Column(DateTime, nullable=True)
    created_at                 = Column(DateTime, default=datetime.utcnow)
    updated_at                 = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
