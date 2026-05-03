from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database.db import create_tables
from main import app


def main() -> None:
    create_tables()
    client = TestClient(app)
    paths = [
        "/api/wealth",
        "/api/wealth/equity-allocation",
        "/api/wealth/forecast",
        "/api/coach/overview",
        "/api/planning/overview",
        "/api/planning/briefing",
        "/api/planning/scenario?monthly_extra_investment=20000&spend_cut_pct=10",
        "/api/ingestion/status",
        "/api/ingestion/automation/status",
        "/api/gmail/status",
    ]
    for path in paths:
        response = client.get(path)
        if response.status_code != 200:
            raise AssertionError(f"{path} returned {response.status_code}: {response.text[:500]}")

    forecast = client.get("/api/wealth/forecast").json()
    assert forecast["current_net_worth"] >= 0
    assert forecast["salary_growth_pct"] >= 5
    assert forecast["data_points"]

    scenario = client.get("/api/planning/scenario?monthly_extra_investment=20000&spend_cut_pct=10").json()
    assert "incremental_wealth" in scenario

    equity = client.get("/api/wealth/equity-allocation").json()
    assert "buckets" in equity
    assert "total_equity" in equity
    assert [bucket["label"] for bucket in equity["buckets"]] == ["Large Cap", "Mid Cap", "Small Cap"]
    assert "coverage_pct" in equity
    assert "sector_allocation" in equity
    if equity["total_equity"] > 0:
        assert equity["sector_allocation"]
        assert {"label", "value", "percentage", "count", "color"} <= set(equity["sector_allocation"][0])
        assert all(bucket["label"] != "ETF / Index" for bucket in equity["sector_allocation"])
        assert "sector_coverage_pct" in equity
    assert "missing_fund_composition" in equity["unmapped"]

    coach = client.get("/api/coach/overview").json()
    assert all(cat["category"] != "Cash Withdrawal" for cat in coach["cashflow"]["categories"])

    ingestion_automation = client.get("/api/ingestion/automation/status").json()
    assert "drop_folder" in ingestion_automation
    assert "automated_inputs" in ingestion_automation

    trends = client.get("/api/wealth/trends").json()
    visible_month = next((row["month"] for row in reversed(trends["months"]) if row["has_data"]), None)
    if visible_month:
        breakdown = client.get(f"/api/wealth/transactions/month-breakdown/{visible_month}?direction=Debit").json()
        assert all(cat["category"] != "Cash Withdrawal" for cat in breakdown["categories"])
        assert all(txn["category"] != "Cash Withdrawal" for txn in breakdown["transactions"])

    print("Smoke test passed.")


if __name__ == "__main__":
    main()
