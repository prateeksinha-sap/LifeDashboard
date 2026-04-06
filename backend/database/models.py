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


# ── Stock holdings (Zerodha — entered manually or via CSV import) ────
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


# ── Weekly priorities ────────────────────────────────────────────────
class Priority(Base):
    __tablename__ = "priorities"

    id   = Column(Integer, primary_key=True, autoincrement=True)
    rank = Column(Integer, nullable=False, unique=True)
    text = Column(String,  nullable=False)


# ── Upcoming bills ───────────────────────────────────────────────────
class Bill(Base):
    __tablename__ = "bills"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    name            = Column(String,  nullable=False)
    amount          = Column(Float,   nullable=False)   # ₹
    due_date        = Column(Date,    nullable=False)
    is_paid         = Column(Boolean, default=False)
    is_recurring    = Column(Boolean, default=True)
    recurrence_days = Column(Integer, nullable=True)    # 30 = monthly
