from __future__ import annotations

import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database.models import Actionable, Base, PortfolioAgentRecommendation, PortfolioAgentRun
from services.portfolio_agent import DecisionNotAllowed, import_reports, record_decision


def _report(generated_at: str, run_mode: str = "DRY_RUN", data_mode: str = "MOCK") -> dict:
    return {
        "generated_at": generated_at,
        "report_date": generated_at[:10],
        "capital_growth_verdict": "Stock compounding remains the core path.",
        "portfolio_summary": {
            "total_invested": 100000,
            "total_current_value": 112000,
            "total_pnl": 12000,
            "total_pnl_pct": 12,
            "cagr_required_to_double": 14.87,
            "estimated_portfolio_cagr": 13.8,
            "on_track_to_double": False,
        },
        "market_pulse": {"overall_sentiment": "NEUTRAL"},
        "validated_recommendations": [
            {
                "ticker": "KAYNES.NS",
                "name": "Kaynes Technology India",
                "source_agent": "FundamentalQualityAgent",
                "action": "ACCUMULATE",
                "conviction": "HIGH",
                "target_price": 7050,
                "suggested_allocation_pct": 6,
                "suggested_amount_inr": 26000,
                "orchestrator_commentary": "Best fit for the 5-year growth goal.",
            }
        ],
        "rejected_recommendations": [
            {"ticker": "DIXON.NS", "source_agent": "GrowthMomentumAgent", "rejection_reason": "Valuation risk."}
        ],
        "action_plan": [
            {
                "priority": 1,
                "action": "Accumulate Kaynes Technology up to a 6% portfolio allocation.",
                "rationale": "Clear growth visibility.",
                "timing": "NEAR-TERM",
                "estimated_amount_inr": 26000,
            }
        ],
        "five_year_roadmap": {
            "target_portfolio_value": 224000,
            "required_annual_return_pct": 14.87,
            "recommended_strategy": "Keep compounding.",
        },
        "run_mode": run_mode,
        "data_mode": data_mode,
        "delivery_mode": run_mode,
        "delivery_status": {"email": "SIMULATED" if run_mode == "DRY_RUN" else "SENT", "slack": "SIMULATED"},
    }


def _write_pair(report_dir: Path, stem: str, report: dict) -> None:
    (report_dir / f"{stem}_report.json").write_text(json.dumps(report), encoding="utf-8")
    (report_dir / f"{stem}_cost.json").write_text(
        json.dumps({"model": "claude-sonnet-4-20250514", "estimated_total_cost_usd": 0.01}),
        encoding="utf-8",
    )


def main() -> None:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    with TemporaryDirectory() as tmp:
        report_dir = Path(tmp)
        _write_pair(report_dir, "20260503_081500", _report("2026-05-03T08:15:00"))

        first = import_reports(db, report_dir)
        second = import_reports(db, report_dir)
        assert first["imported_runs"] == 1
        assert first["imported_recommendations"] == 3
        assert second["skipped_runs"] == 1
        assert db.query(PortfolioAgentRun).count() == 1

        action = db.query(PortfolioAgentRecommendation).filter_by(source_type="action_plan").first()
        assert action is not None
        try:
            record_decision(db, action.id, "Accepted")
        except DecisionNotAllowed:
            pass
        else:
            raise AssertionError("Mock report accepted a task-generating decision")

        dismissed = record_decision(db, action.id, "Dismissed", notes="Not a live run")
        assert dismissed["decision"]["status"] == "Dismissed"

        _write_pair(report_dir, "20260504_081500", _report("2026-05-04T08:15:00", "LIVE", "LIVE"))
        imported_live = import_reports(db, report_dir)
        assert imported_live["imported_runs"] == 1

        live_action = (
            db.query(PortfolioAgentRecommendation)
            .filter_by(source_type="action_plan", run_id="20260504_081500")
            .first()
        )
        assert live_action is not None
        accepted = record_decision(db, live_action.id, "Accepted", notes="Proceed")
        assert accepted["decision"]["status"] == "Accepted"
        assert db.query(Actionable).filter_by(source="PortfolioAgent", status="Pending").count() == 1

        cost_late_stem = "20260505_081500"
        (report_dir / f"{cost_late_stem}_report.json").write_text(
            json.dumps(_report("2026-05-05T08:15:00", "LIVE", "LIVE")),
            encoding="utf-8",
        )
        imported_without_cost = import_reports(db, report_dir)
        assert imported_without_cost["imported_runs"] == 1
        late_run = db.query(PortfolioAgentRun).filter_by(run_id=cost_late_stem).first()
        assert late_run is not None
        assert late_run.model is None

        (report_dir / f"{cost_late_stem}_cost.json").write_text(
            json.dumps({"model": "claude-haiku-4-5-20251001", "estimated_total_cost_usd": 0.004}),
            encoding="utf-8",
        )
        backfilled = import_reports(db, report_dir)
        assert backfilled["updated_runs"] == 1
        late_run = db.query(PortfolioAgentRun).filter_by(run_id=cost_late_stem).first()
        assert late_run.model == "claude-haiku-4-5-20251001"
        assert late_run.estimated_cost_usd == 0.004

    print("Portfolio agent integration test passed.")


if __name__ == "__main__":
    main()
