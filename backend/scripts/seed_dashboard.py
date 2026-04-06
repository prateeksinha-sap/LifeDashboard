"""
scripts/seed_dashboard.py
────────────────────────────────────────────────────────────────────
Populates the database with realistic test data for all new Phase 2
models. Safe to run multiple times — fully idempotent.

Usage (from backend/ folder):
    python scripts/seed_dashboard.py
────────────────────────────────────────────────────────────────────
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from database.db import create_tables, SessionLocal
from database.models import (
    Priority, Bill, LifeLog, PersonalCRM,
    HealthMetric, MedicalReport,
)

today = date.today()


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def upsert_priority(db, rank, text, quadrant):
    existing = db.query(Priority).filter_by(rank=rank).first()
    if existing:
        existing.text                = text
        existing.eisenhower_quadrant = quadrant
        print(f"    updated  rank {rank}: [{quadrant}] {text}")
    else:
        db.add(Priority(rank=rank, text=text, eisenhower_quadrant=quadrant))
        print(f"    added    rank {rank}: [{quadrant}] {text}")


def upsert_health(db, metric_date, steps, sleep_h, resting_hr, active_mins, calories):
    existing = db.query(HealthMetric).filter_by(date=metric_date).first()
    if existing:
        existing.steps       = steps
        existing.sleep_hours = sleep_h
        existing.resting_hr  = resting_hr
        existing.active_mins = active_mins
        existing.calories    = calories
    else:
        db.add(HealthMetric(
            date        = metric_date,
            steps       = steps,
            sleep_hours = sleep_h,
            resting_hr  = resting_hr,
            active_mins = active_mins,
            calories    = calories,
        ))


def upsert_crm(db, name, relationship, last_contact, interval_days, notes):
    existing = db.query(PersonalCRM).filter_by(contact_name=name).first()
    if existing:
        existing.relationship           = relationship
        existing.last_contact_date      = last_contact
        existing.check_in_interval_days = interval_days
        existing.notes                  = notes
        print(f"    updated  CRM: {name}")
    else:
        db.add(PersonalCRM(
            contact_name           = name,
            relationship           = relationship,
            last_contact_date      = last_contact,
            check_in_interval_days = interval_days,
            notes                  = notes,
        ))
        print(f"    added    CRM: {name}")


def add_life_log(db, log_date, category, subcategory, duration_mins, notes):
    # LifeLogs are events — allow multiple per day, don't deduplicate
    existing = db.query(LifeLog).filter_by(
        log_date=log_date, category=category, subcategory=subcategory
    ).first()
    if not existing:
        db.add(LifeLog(
            log_date         = log_date,
            category         = category,
            subcategory      = subcategory,
            duration_minutes = duration_mins,
            notes            = notes,
        ))
        print(f"    added    LifeLog: {category}/{subcategory} — {duration_mins}m")
    else:
        print(f"    exists   LifeLog: {category}/{subcategory} (skipped)")


def upsert_bill(db, name, amount, due_date, recurring, recurrence_days):
    existing = db.query(Bill).filter_by(name=name).first()
    if not existing:
        db.add(Bill(
            name            = name,
            amount          = amount,
            due_date        = due_date,
            is_paid         = False,
            is_recurring    = recurring,
            recurrence_days = recurrence_days,
        ))
        print(f"    added    Bill: {name}  Rs{amount:,}  due {due_date}")
    else:
        print(f"    exists   Bill: {name} (skipped)")


# ─────────────────────────────────────────────────────────────────
# 1. PRIORITIES — correct Eisenhower quadrants for all 10 entries
# ─────────────────────────────────────────────────────────────────

PRIORITIES = [
    # rank  text                                         quadrant
    (1,  "Finalize S/4HANA migration strategy",         "Q1"),  # Urgent & Important
    (2,  "Setup Agentic AI workflow",                   "Q2"),  # Important, Not Urgent
    (3,  "Pay Axis Bank PPF contribution",              "Q1"),  # Urgent & Important
    (4,  "Plan Child's 4th Birthday (16 Sept)",        "Q2"),  # Important, Not Urgent
    (5,  "Rebalance MF portfolio",                      "Q2"),  # Important, Not Urgent
    (6,  "Review Q2 financial plan",                    "Q2"),  # Important, Not Urgent
    (7,  "File advance tax if applicable",              "Q1"),  # Urgent & Important
    (8,  "Book annual health checkup",                  "Q2"),  # Important, Not Urgent
    (9,  "Review Zerodha holdings P&L",                 "Q2"),  # Important, Not Urgent
    (10, "Family outing plan",                          "Q3"),  # Urgent, Not Important
]


# ─────────────────────────────────────────────────────────────────
# 2. LIFE LOGS — today's schedule
# ─────────────────────────────────────────────────────────────────
#  (date, category, subcategory, minutes, notes)

LIFE_LOGS = [
    (today, "Work",       "My Company - S/4HANA",    180, "Migration strategy workshop with client team"),
    (today, "Work",       "My Company - Admin",        30, "Timesheets, email triage"),
    (today, "Upskilling", "Agentic AI",         60, "LangGraph multi-agent tutorial"),
    (today, "Leisure",    "Badminton",          60, "Morning doubles session at complex"),
    (today, "Leisure",    "Guitar",             45, "Opeth — Blackwater Park covers"),
    (today, "Family",     "Child",             90, "Evening playtime and bedtime story"),
    # Yesterday for graph variety
    (today - timedelta(days=1), "Work",       "My Company - Client Delivery", 240, "On-site at client"),
    (today - timedelta(days=1), "Upskilling", "SAP BTP",               90,  "BTP CAP model workshop"),
    (today - timedelta(days=1), "Health",     "Gym",                   50,  "Chest + shoulders"),
    (today - timedelta(days=1), "Family",     "Child",                60,  "School pickup + homework"),
    # Day before
    (today - timedelta(days=2), "Work",       "My Company - S/4HANA",        210, "Sprint planning"),
    (today - timedelta(days=2), "Leisure",    "Guitar",                45,  "Scale practice"),
    (today - timedelta(days=2), "Upskilling", "RAG / AI",              75,  "Vector DB deep-dive"),
    (today - timedelta(days=2), "Health",     "Meditation",            20,  "Morning mindfulness"),
]


# ─────────────────────────────────────────────────────────────────
# 3. PERSONAL CRM
# ─────────────────────────────────────────────────────────────────
# (name, relationship, last_contact_date, check_in_interval_days, notes)

CRM_CONTACTS = [
    (
        "Partner",
        "Family",
        today - timedelta(days=1),    # yesterday — should NOT trigger alert
        7,
        "Wife. Daily touchpoints fine; log only intentional quality conversations.",
    ),
    (
        "College Friend 1",
        "Friend",
        today - timedelta(days=38),   # 38 days ago > 30 day interval → triggers alert
        30,
        "Close friend from college. Lives in Bangalore. Last spoke about his startup.",
    ),
    (
        "Friend 2",
        "Friend",
        today - timedelta(days=35),   # 35 days ago > 30 day interval → triggers alert
        30,
        "Friend from My Company. Switched to Amazon last year. Owe him a catch-up call.",
    ),
    (
        "Mum & Dad",
        "Family",
        today - timedelta(days=8),    # 8 days ago > 7 day interval → triggers alert
        7,
        "Call every Sunday. Missed last weekend.",
    ),
    (
        "Rohan",
        "Colleague",
        today - timedelta(days=12),
        30,
        "SAP BTP architect at My Company. Collaborating on Agentic AI PoC.",
    ),
]


# ─────────────────────────────────────────────────────────────────
# 4. BILLS — new entries only
# ─────────────────────────────────────────────────────────────────
# (name, amount, due_date, is_recurring, recurrence_days)

NEW_BILLS = [
    (
        "School — Junior KG Fees",
        47500,
        date(2026, 6, 10),   # Due June
        False,               # One-time per term
        None,
    ),
    (
        "Term Life Insurance Premium",
        28000,
        date(2026, 8, 1),
        True,
        365,                 # Annual
    ),
]


# ─────────────────────────────────────────────────────────────────
# 5. HEALTH METRICS — last 10 days (realistic Indian professional)
# ─────────────────────────────────────────────────────────────────
# (date, steps, sleep_hours, resting_hr, active_mins, calories)

HEALTH_DATA = [
    (today - timedelta(days=9),  7234, 6.8, 69,  30, 2100),
    (today - timedelta(days=8),  9102, 7.2, 67,  55, 2350),
    (today - timedelta(days=7),  4321, 5.9, 74,  15, 1980),   # poor sleep/rest day
    (today - timedelta(days=6), 11567, 7.5, 65,  70, 2450),   # badminton day
    (today - timedelta(days=5),  6788, 7.0, 68,  35, 2200),
    (today - timedelta(days=4),  8912, 7.3, 66,  60, 2300),
    (today - timedelta(days=3),  5234, 6.1, 72,  20, 2050),   # long work day
    (today - timedelta(days=2), 10234, 7.8, 64,  65, 2400),   # gym day
    (today - timedelta(days=1),  7891, 6.5, 70,  40, 2150),
    (today,                      3200,  None, 71,  15, 1200),  # day in progress
]


# ─────────────────────────────────────────────────────────────────
# 6. MEDICAL REPORT — sample Apollo Diagnostics report
# ─────────────────────────────────────────────────────────────────

MEDICAL_REPORT = {
    "report_date":  date(2026, 3, 15),
    "source":       "Annual Health Screening",
    "summary": (
        "Annual health screening shows generally good metabolic health. "
        "Vitamin D is deficient (18 ng/mL, normal >30). "
        "LDL cholesterol is borderline high at 142 mg/dL. "
        "All other markers including HbA1c, thyroid, kidney, and liver function are within normal range."
    ),
    "status_flags": {
        "HbA1c":       "optimal",    # 5.4%
        "cholesterol":  "warning",   # LDL 142
        "bp":           "optimal",   # 118/76
        "vitamin_d":    "warning",   # 18 ng/mL
        "tsh":          "optimal",   # 2.1 mIU/L
        "creatinine":   "optimal",
        "sgpt":         "optimal",
        "haemoglobin":  "optimal",
    },
    "action_items": [
        "Start Vitamin D3 2000 IU supplement daily for 3 months",
        "Reduce refined carbohydrates and trans fats in diet",
        "Retest LDL cholesterol in 3 months",
        "Increase weekly aerobic activity to 150+ minutes",
        "Schedule follow-up with physician if LDL doesn't improve",
    ],
    "overall": "warning",
}


# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────

def main():
    create_tables()
    db = SessionLocal()

    try:
        print("\n" + "-" * 60)
        print("  Life Dashboard — Seed Script")
        print("-" * 60)

        # 1. Priorities
        print("\n[1] Priorities (with Eisenhower quadrants)")
        for rank, text, quadrant in PRIORITIES:
            upsert_priority(db, rank, text, quadrant)
        db.commit()

        # 2. Life Logs
        print("\n[2] Life Logs")
        for args in LIFE_LOGS:
            add_life_log(db, *args)
        db.commit()

        # 3. Personal CRM
        print("\n[3] Personal CRM")
        for args in CRM_CONTACTS:
            upsert_crm(db, *args)
        db.commit()

        # 4. Bills
        print("\n[4] Bills")
        for args in NEW_BILLS:
            upsert_bill(db, *args)
        db.commit()

        # 5. Health metrics
        print("\n[5] Health Metrics (last 10 days)")
        for row in HEALTH_DATA:
            upsert_health(db, *row)
        print(f"    upserted {len(HEALTH_DATA)} daily records")
        db.commit()

        # 6. Medical report
        print("\n[6] Medical Report")
        existing_report = db.query(MedicalReport).filter_by(
            report_date=MEDICAL_REPORT["report_date"]
        ).first()
        if not existing_report:
            db.add(MedicalReport(
                report_date  = MEDICAL_REPORT["report_date"],
                source       = MEDICAL_REPORT["source"],
                summary      = MEDICAL_REPORT["summary"],
                status_flags = json.dumps(MEDICAL_REPORT["status_flags"]),
                action_items = json.dumps(MEDICAL_REPORT["action_items"]),
            ))
            db.commit()
            print(f"    added    Report: {MEDICAL_REPORT['source']} ({MEDICAL_REPORT['report_date']})")
        else:
            print(f"    exists   Report: {MEDICAL_REPORT['source']} (skipped)")

        # ── Summary ──────────────────────────────────────────────
        print("\n" + "-" * 60)
        print("  Seed complete. Verification:")
        print(f"    Priorities   : {db.query(Priority).count()}")
        print(f"    Life Logs    : {db.query(LifeLog).count()}")
        print(f"    CRM contacts : {db.query(PersonalCRM).count()}")
        print(f"    Bills        : {db.query(Bill).count()}")
        print(f"    Health days  : {db.query(HealthMetric).count()}")
        print(f"    Med reports  : {db.query(MedicalReport).count()}")

        # Check-in alerts
        overdue = [
            c for c in db.query(PersonalCRM).all()
            if c.last_contact_date and
               (today - c.last_contact_date).days > c.check_in_interval_days
        ]
        print(f"\n    Contacts needing check-in ({len(overdue)}):")
        for c in overdue:
            days_overdue = (today - c.last_contact_date).days - c.check_in_interval_days
            print(f"      {c.contact_name:<15} {days_overdue}d overdue")

        print("-" * 60 + "\n")

    finally:
        db.close()


if __name__ == "__main__":
    main()
