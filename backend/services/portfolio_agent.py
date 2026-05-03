from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from database.models import (
    Actionable,
    PortfolioAgentDecision,
    PortfolioAgentRecommendation,
    PortfolioAgentRun,
)


DECISION_STATUSES = {"Review", "Accepted", "Stalling", "Dismissed", "Executed"}
TASK_STATUSES = {"Accepted", "Stalling", "Executed"}


class DecisionNotAllowed(RuntimeError):
    pass


def default_report_dir() -> Path:
    configured = os.getenv("PORTFOLIO_AGENT_REPORT_DIR", "").strip()
    if configured:
        return Path(configured)
    return Path.home() / "Downloads" / "The A Team" / "portfolio-agent" / "logs" / "reports"


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True)


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
        return parsed.replace(tzinfo=None)
    except ValueError:
        parsed_date = _parse_date(value)
        if parsed_date:
            return datetime.combine(parsed_date, datetime.min.time())
    return None


def _safe_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _canonical_text(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    return re.sub(r"\s+", " ", text)


def _action_verb(text: str) -> str:
    canonical = _canonical_text(text)
    for verb in ("accumulate", "buy", "add", "trim", "reduce", "sell", "exit", "hold", "watch", "keep"):
        if re.search(rf"\b{verb}\b", canonical):
            return verb
    return canonical.split(" ", 1)[0] if canonical else "review"


def _ticker_base(ticker: str | None) -> str | None:
    if not ticker:
        return None
    return ticker.upper().split(".", 1)[0].strip()


def _infer_ticker(action_text: str, validated: list[dict[str, Any]]) -> str | None:
    text = _canonical_text(action_text)
    for item in validated:
        ticker = str(item.get("ticker") or "").strip().upper()
        base = _ticker_base(ticker)
        name = _canonical_text(str(item.get("name") or ""))
        name_tokens = [token for token in name.split() if len(token) >= 5]
        if base and base.lower() in text:
            return ticker
        if name_tokens and any(token in text for token in name_tokens[:2]):
            return ticker
    return None


def _fingerprint(source_type: str, ticker: str | None, action_text: str, timing: str | None = None) -> str:
    base = _ticker_base(ticker)
    verb = _action_verb(action_text)
    if base:
        return f"{source_type}:{base}:{verb}"
    digest = hashlib.sha1(f"{source_type}|{timing or ''}|{_canonical_text(action_text)}".encode("utf-8")).hexdigest()
    return f"{source_type}:{digest[:16]}"


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _dict_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _dict_obj(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _run_id_for(path: Path, report: dict[str, Any]) -> str:
    if path.name != "latest_report.json":
        return path.name.removesuffix("_report.json")
    generated = _parse_dt(report.get("generated_at")) or _parse_dt(report.get("report_date")) or datetime.utcnow()
    return generated.strftime("%Y%m%d_%H%M%S")


def _cost_path_for(path: Path) -> Path:
    if path.name == "latest_report.json":
        return path.with_name("latest_cost.json")
    return path.with_name(path.name.replace("_report.json", "_cost.json"))


def discover_report_paths(report_dir: Path | None = None) -> list[Path]:
    directory = report_dir or default_report_dir()
    if not directory.exists():
        return []
    timestamped = sorted(
        [path for path in directory.glob("*_report.json") if path.name != "latest_report.json"],
        key=lambda item: item.stat().st_mtime,
    )
    if timestamped:
        return timestamped
    latest = directory / "latest_report.json"
    return [latest] if latest.exists() else []


def _normalise_recommendations(report: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    action_plan = _dict_list(report.get("action_plan"))
    validated = _dict_list(report.get("validated_recommendations"))
    rejected = _dict_list(report.get("rejected_recommendations"))
    known_tickers = [*validated, *rejected]

    for item in action_plan:
        action_text = str(item.get("action") or "Review portfolio action").strip()
        ticker = _infer_ticker(action_text, known_tickers)
        timing = str(item.get("timing") or "").strip() or None
        rows.append(
            {
                "source_type": "action_plan",
                "priority": _safe_int(item.get("priority")),
                "ticker": ticker,
                "name": None,
                "action": action_text,
                "timing": timing,
                "source_agent": None,
                "conviction": None,
                "estimated_amount_inr": _safe_float(item.get("estimated_amount_inr")),
                "suggested_allocation_pct": None,
                "target_price": None,
                "rationale": item.get("rationale"),
                "raw": item,
                "fingerprint": _fingerprint("action_plan", ticker, action_text, timing),
            }
        )

    for item in validated:
        action_text = str(item.get("action") or "Review recommendation").strip()
        ticker = str(item.get("ticker") or "").strip().upper() or None
        rows.append(
            {
                "source_type": "validated",
                "priority": None,
                "ticker": ticker,
                "name": item.get("name"),
                "action": action_text,
                "timing": None,
                "source_agent": item.get("source_agent"),
                "conviction": item.get("conviction"),
                "estimated_amount_inr": _safe_float(item.get("suggested_amount_inr")),
                "suggested_allocation_pct": _safe_float(item.get("suggested_allocation_pct")),
                "target_price": _safe_float(item.get("target_price")),
                "rationale": item.get("orchestrator_commentary") or item.get("validation_notes"),
                "raw": item,
                "fingerprint": _fingerprint("validated", ticker, action_text),
            }
        )

    for item in rejected:
        ticker = str(item.get("ticker") or "").strip().upper() or None
        action_text = f"Rejected {ticker or 'recommendation'}"
        rows.append(
            {
                "source_type": "rejected",
                "priority": None,
                "ticker": ticker,
                "name": item.get("name"),
                "action": action_text,
                "timing": None,
                "source_agent": item.get("source_agent"),
                "conviction": None,
                "estimated_amount_inr": None,
                "suggested_allocation_pct": None,
                "target_price": None,
                "rationale": item.get("rejection_reason"),
                "raw": item,
                "fingerprint": _fingerprint("rejected", ticker, action_text),
            }
        )

    futures = _dict_obj(report.get("futures_advisory"))
    if futures.get("recommended_action") and futures.get("recommended_action") != "NO_TRADE":
        action_text = str(futures.get("recommended_action") or "Review futures advisory")
        rows.append(
            {
                "source_type": "futures",
                "priority": None,
                "ticker": futures.get("symbol"),
                "name": "Futures satellite",
                "action": action_text,
                "timing": futures.get("status"),
                "source_agent": "FuturesAdvisor",
                "conviction": str(futures.get("confidence") or ""),
                "estimated_amount_inr": _safe_float(futures.get("risk_budget_inr")),
                "suggested_allocation_pct": None,
                "target_price": None,
                "rationale": futures.get("expected_role_in_5yr_goal") or futures.get("rejection_reason"),
                "raw": futures,
                "fingerprint": _fingerprint("futures", futures.get("symbol"), action_text, futures.get("status")),
            }
        )

    return rows


def _upsert_decision_shell(db: Session, recommendation: PortfolioAgentRecommendation) -> None:
    if recommendation.source_type not in {"action_plan", "validated", "futures"}:
        return
    decision = db.query(PortfolioAgentDecision).filter_by(fingerprint=recommendation.fingerprint).first()
    if not decision:
        decision = PortfolioAgentDecision(fingerprint=recommendation.fingerprint, status="Review")
        db.add(decision)
    decision.last_recommendation_id = recommendation.id
    decision.last_run_id = recommendation.run_id
    decision.updated_at = datetime.utcnow()


def _build_run(run_id: str, path: Path, report: dict[str, Any], cost: dict[str, Any] | None) -> PortfolioAgentRun:
    summary = _dict_obj(report.get("portfolio_summary"))
    roadmap = _dict_obj(report.get("five_year_roadmap"))
    market = _dict_obj(report.get("market_pulse"))
    delivery = _dict_obj(report.get("delivery_status"))
    action_plan = _dict_list(report.get("action_plan"))
    top_action = None
    if action_plan:
        top_action = str(action_plan[0].get("action") or "") or None

    return PortfolioAgentRun(
        run_id=run_id,
        report_date=_parse_date(report.get("report_date")),
        generated_at=_parse_dt(report.get("generated_at")),
        source_path=str(path),
        source_mtime=datetime.fromtimestamp(path.stat().st_mtime),
        report_json=_json_dump(report),
        cost_json=_json_dump(cost) if cost else None,
        run_mode=report.get("run_mode"),
        data_mode=report.get("data_mode"),
        delivery_mode=report.get("delivery_mode"),
        email_status=delivery.get("email"),
        slack_status=delivery.get("slack"),
        model=(cost or {}).get("model"),
        estimated_cost_usd=_safe_float((cost or {}).get("estimated_total_cost_usd")),
        total_invested=_safe_float(summary.get("total_invested")),
        total_current_value=_safe_float(summary.get("total_current_value")),
        total_pnl=_safe_float(summary.get("total_pnl")),
        total_pnl_pct=_safe_float(summary.get("total_pnl_pct")),
        required_annual_return_pct=_safe_float(roadmap.get("required_annual_return_pct") or summary.get("cagr_required_to_double")),
        estimated_portfolio_cagr=_safe_float(summary.get("estimated_portfolio_cagr")),
        target_portfolio_value=_safe_float(roadmap.get("target_portfolio_value")),
        on_track_to_double=summary.get("on_track_to_double"),
        capital_growth_verdict=report.get("capital_growth_verdict"),
        overall_sentiment=market.get("overall_sentiment"),
        top_action=top_action,
    )


def _sync_existing_run_metadata(existing: PortfolioAgentRun, cost: dict[str, Any] | None) -> bool:
    if not cost:
        return False

    changed = False
    if not existing.cost_json:
        existing.cost_json = _json_dump(cost)
        changed = True
    model = cost.get("model")
    if model and existing.model != model:
        existing.model = str(model)
        changed = True
    estimated_cost = _safe_float(cost.get("estimated_total_cost_usd"))
    if estimated_cost is not None and existing.estimated_cost_usd != estimated_cost:
        existing.estimated_cost_usd = estimated_cost
        changed = True
    if changed:
        existing.updated_at = datetime.utcnow()
    return changed


def import_reports(db: Session, report_dir: Path | None = None) -> dict[str, Any]:
    directory = report_dir or default_report_dir()
    result = {
        "status": "ok",
        "report_dir": str(directory),
        "report_dir_exists": directory.exists(),
        "imported_runs": 0,
        "imported_recommendations": 0,
        "updated_runs": 0,
        "skipped_runs": 0,
        "errors": [],
    }
    if not directory.exists():
        result["status"] = "missing"
        return result

    for path in discover_report_paths(directory):
        report = _read_json(path)
        if not report:
            result["errors"].append({"path": str(path), "error": "invalid_json"})
            continue
        run_id = _run_id_for(path, report)
        existing = db.query(PortfolioAgentRun).filter_by(run_id=run_id).first()
        if existing:
            cost_path = _cost_path_for(path)
            cost = _read_json(cost_path) if cost_path.exists() else None
            if _sync_existing_run_metadata(existing, cost):
                result["updated_runs"] += 1
            result["skipped_runs"] += 1
            continue

        cost_path = _cost_path_for(path)
        cost = _read_json(cost_path) if cost_path.exists() else None
        run = _build_run(run_id, path, report, cost)
        db.add(run)
        db.flush()

        for row in _normalise_recommendations(report):
            rec = PortfolioAgentRecommendation(
                run_id=run_id,
                run_db_id=run.id,
                source_type=row["source_type"],
                fingerprint=row["fingerprint"],
                priority=row["priority"],
                ticker=row["ticker"],
                name=row["name"],
                action=row["action"],
                timing=row["timing"],
                source_agent=row["source_agent"],
                conviction=row["conviction"],
                estimated_amount_inr=row["estimated_amount_inr"],
                suggested_allocation_pct=row["suggested_allocation_pct"],
                target_price=row["target_price"],
                rationale=row["rationale"],
                raw_json=_json_dump(row["raw"]),
            )
            db.add(rec)
            db.flush()
            _upsert_decision_shell(db, rec)
            result["imported_recommendations"] += 1

        result["imported_runs"] += 1

    db.commit()
    return result


def _raw_json(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def _run_is_live(run: PortfolioAgentRun | None) -> bool:
    return bool(run and run.run_mode == "LIVE" and run.data_mode == "LIVE")


def _decision_for(db: Session, fingerprint: str) -> PortfolioAgentDecision | None:
    return db.query(PortfolioAgentDecision).filter_by(fingerprint=fingerprint).first()


def serialize_decision(decision: PortfolioAgentDecision | None) -> dict[str, Any] | None:
    if not decision:
        return None
    return {
        "id": decision.id,
        "fingerprint": decision.fingerprint,
        "status": decision.status,
        "notes": decision.notes,
        "review_date": decision.review_date.isoformat() if decision.review_date else None,
        "dismissed_until": decision.dismissed_until.isoformat() if decision.dismissed_until else None,
        "actionable_id": decision.actionable_id,
        "last_recommendation_id": decision.last_recommendation_id,
        "last_run_id": decision.last_run_id,
        "decided_at": decision.decided_at.isoformat() if decision.decided_at else None,
        "updated_at": decision.updated_at.isoformat() if decision.updated_at else None,
    }


def serialize_recommendation(db: Session, rec: PortfolioAgentRecommendation) -> dict[str, Any]:
    return {
        "id": rec.id,
        "run_id": rec.run_id,
        "source_type": rec.source_type,
        "fingerprint": rec.fingerprint,
        "priority": rec.priority,
        "ticker": rec.ticker,
        "name": rec.name,
        "action": rec.action,
        "timing": rec.timing,
        "source_agent": rec.source_agent,
        "conviction": rec.conviction,
        "estimated_amount_inr": rec.estimated_amount_inr,
        "suggested_allocation_pct": rec.suggested_allocation_pct,
        "target_price": rec.target_price,
        "rationale": rec.rationale,
        "raw": _raw_json(rec.raw_json),
        "decision": serialize_decision(_decision_for(db, rec.fingerprint)),
    }


def serialize_run(run: PortfolioAgentRun, include_report: bool = False) -> dict[str, Any]:
    payload = {
        "id": run.id,
        "run_id": run.run_id,
        "report_date": run.report_date.isoformat() if run.report_date else None,
        "generated_at": run.generated_at.isoformat() if run.generated_at else None,
        "imported_at": run.imported_at.isoformat() if run.imported_at else None,
        "source_path": run.source_path,
        "run_mode": run.run_mode,
        "data_mode": run.data_mode,
        "delivery_mode": run.delivery_mode,
        "delivery_status": {"email": run.email_status, "slack": run.slack_status},
        "model": run.model,
        "estimated_cost_usd": run.estimated_cost_usd,
        "summary": {
            "total_invested": run.total_invested,
            "total_current_value": run.total_current_value,
            "total_pnl": run.total_pnl,
            "total_pnl_pct": run.total_pnl_pct,
            "required_annual_return_pct": run.required_annual_return_pct,
            "estimated_portfolio_cagr": run.estimated_portfolio_cagr,
            "target_portfolio_value": run.target_portfolio_value,
            "on_track_to_double": run.on_track_to_double,
        },
        "capital_growth_verdict": run.capital_growth_verdict,
        "overall_sentiment": run.overall_sentiment,
        "top_action": run.top_action,
    }
    if include_report:
        payload["report"] = _raw_json(run.report_json)
        payload["cost"] = _raw_json(run.cost_json)
    return payload


def _latest_run(db: Session) -> PortfolioAgentRun | None:
    return (
        db.query(PortfolioAgentRun)
        .order_by(PortfolioAgentRun.generated_at.desc(), PortfolioAgentRun.id.desc())
        .first()
    )


def _recommendations_for_run(db: Session, run_id: str, source_type: str | None = None) -> list[PortfolioAgentRecommendation]:
    query = db.query(PortfolioAgentRecommendation).filter_by(run_id=run_id)
    if source_type:
        query = query.filter_by(source_type=source_type)
    return query.order_by(
        PortfolioAgentRecommendation.priority.asc(),
        PortfolioAgentRecommendation.id.asc(),
    ).all()


def _is_suppressed(decision: PortfolioAgentDecision | None) -> bool:
    return bool(decision and decision.status == "Dismissed" and decision.dismissed_until and decision.dismissed_until >= date.today())


def get_brief(db: Session) -> dict[str, Any]:
    latest = _latest_run(db)
    history = (
        db.query(PortfolioAgentRun)
        .order_by(PortfolioAgentRun.generated_at.desc(), PortfolioAgentRun.id.desc())
        .limit(12)
        .all()
    )
    if not latest:
        return {
            "status": "empty",
            "report_dir": str(default_report_dir()),
            "report_dir_exists": default_report_dir().exists(),
            "latest_run": None,
            "action_plan": [],
            "validated_recommendations": [],
            "rejected_recommendations": [],
            "unresolved_count": 0,
            "recent_decisions": [],
            "history": [],
        }

    action_plan = _recommendations_for_run(db, latest.run_id, "action_plan")
    validated = _recommendations_for_run(db, latest.run_id, "validated")
    rejected = _recommendations_for_run(db, latest.run_id, "rejected")
    unresolved_count = 0
    for rec in action_plan:
        decision = _decision_for(db, rec.fingerprint)
        if _is_suppressed(decision):
            continue
        if not decision or decision.status == "Review":
            unresolved_count += 1

    recent_decisions = (
        db.query(PortfolioAgentDecision)
        .filter(PortfolioAgentDecision.status != "Review")
        .order_by(PortfolioAgentDecision.updated_at.desc(), PortfolioAgentDecision.id.desc())
        .limit(12)
        .all()
    )

    return {
        "status": "ok",
        "report_dir": str(default_report_dir()),
        "report_dir_exists": default_report_dir().exists(),
        "is_live": _run_is_live(latest),
        "latest_run": serialize_run(latest, include_report=True),
        "action_plan": [serialize_recommendation(db, rec) for rec in action_plan],
        "validated_recommendations": [serialize_recommendation(db, rec) for rec in validated],
        "rejected_recommendations": [serialize_recommendation(db, rec) for rec in rejected],
        "unresolved_count": unresolved_count,
        "recent_decisions": [serialize_decision(item) for item in recent_decisions],
        "history": [serialize_run(item) for item in history],
    }


def get_runs(db: Session) -> list[dict[str, Any]]:
    runs = (
        db.query(PortfolioAgentRun)
        .order_by(PortfolioAgentRun.generated_at.desc(), PortfolioAgentRun.id.desc())
        .all()
    )
    return [serialize_run(run) for run in runs]


def get_run_detail(db: Session, run_id: str) -> dict[str, Any] | None:
    run = db.query(PortfolioAgentRun).filter_by(run_id=run_id).first()
    if not run:
        return None
    recs = _recommendations_for_run(db, run_id)
    payload = serialize_run(run, include_report=True)
    payload["recommendations"] = [serialize_recommendation(db, rec) for rec in recs]
    return payload


def _business_days_from(start: date, days: int) -> date:
    current = start
    remaining = days
    while remaining > 0:
        current += timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current


def _priority_for(rec: PortfolioAgentRecommendation, status: str) -> str:
    if status == "Stalling":
        return "Medium"
    if rec.priority == 1 or (rec.timing or "").upper() in {"IMMEDIATE", "NEAR-TERM"}:
        return "High"
    return "Medium"


def _task_text(rec: PortfolioAgentRecommendation, status: str) -> str:
    prefix = "Review stalled portfolio action" if status == "Stalling" else "Portfolio action"
    amount = f" INR {rec.estimated_amount_inr:,.0f}" if rec.estimated_amount_inr else ""
    ticker = f" [{_ticker_base(rec.ticker)}]" if rec.ticker else ""
    return f"{prefix}{ticker}: {rec.action}{amount}"


def _upsert_actionable(
    db: Session,
    decision: PortfolioAgentDecision,
    rec: PortfolioAgentRecommendation,
    status: str,
    due_date: date | None,
) -> Actionable:
    item = None
    if decision.actionable_id:
        item = db.query(Actionable).filter_by(id=decision.actionable_id).first()
    if not item:
        item = Actionable(source="PortfolioAgent", task_description=_task_text(rec, status))
        db.add(item)
        db.flush()
        decision.actionable_id = item.id
    item.source = "PortfolioAgent"
    item.task_description = _task_text(rec, status)
    item.due_date = due_date
    item.priority = _priority_for(rec, status)
    item.status = "Pending"
    item.sender = "Portfolio Agent"
    item.subject = rec.run_id
    item.updated_at = datetime.utcnow()
    return item


def record_decision(
    db: Session,
    recommendation_id: int,
    status: str,
    notes: str | None = None,
    review_date: date | None = None,
) -> dict[str, Any]:
    if status not in DECISION_STATUSES:
        raise ValueError(f"Unsupported decision status: {status}")

    rec = db.query(PortfolioAgentRecommendation).filter_by(id=recommendation_id).first()
    if not rec:
        raise LookupError("Recommendation not found")
    run = db.query(PortfolioAgentRun).filter_by(run_id=rec.run_id).first()
    if status in TASK_STATUSES and not _run_is_live(run):
        raise DecisionNotAllowed("Task-generating decisions require a LIVE portfolio-agent report.")

    decision = _decision_for(db, rec.fingerprint)
    if not decision:
        decision = PortfolioAgentDecision(fingerprint=rec.fingerprint)
        db.add(decision)
        db.flush()

    today = date.today()
    decision.status = status
    decision.notes = notes.strip() if notes else None
    decision.review_date = review_date
    decision.last_recommendation_id = rec.id
    decision.last_run_id = rec.run_id
    decision.decided_at = datetime.utcnow()
    decision.updated_at = datetime.utcnow()
    decision.dismissed_until = today + timedelta(days=30) if status == "Dismissed" else None

    if status == "Accepted":
        _upsert_actionable(db, decision, rec, status, None)
    elif status == "Stalling":
        due = review_date or _business_days_from(today, 3)
        decision.review_date = due
        _upsert_actionable(db, decision, rec, status, due)
    elif status == "Executed" and decision.actionable_id:
        item = db.query(Actionable).filter_by(id=decision.actionable_id).first()
        if item:
            item.status = "Completed"
            item.updated_at = datetime.utcnow()
    elif status in {"Dismissed", "Review"} and decision.actionable_id:
        item = db.query(Actionable).filter_by(id=decision.actionable_id).first()
        if item and item.source == "PortfolioAgent":
            item.status = "Completed" if status == "Dismissed" else "Pending"
            item.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(decision)
    return {
        "decision": serialize_decision(decision),
        "recommendation": serialize_recommendation(db, rec),
    }


def assistant_context(db: Session) -> dict[str, Any] | None:
    latest = _latest_run(db)
    if not latest:
        return None
    actions = _recommendations_for_run(db, latest.run_id, "action_plan")[:5]
    decisions = (
        db.query(PortfolioAgentDecision)
        .filter(PortfolioAgentDecision.status != "Review")
        .order_by(PortfolioAgentDecision.updated_at.desc(), PortfolioAgentDecision.id.desc())
        .limit(8)
        .all()
    )
    return {
        "latest_run": serialize_run(latest),
        "is_live": _run_is_live(latest),
        "action_plan": [serialize_recommendation(db, rec) for rec in actions],
        "recent_decisions": [serialize_decision(item) for item in decisions],
    }
