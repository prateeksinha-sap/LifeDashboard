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
