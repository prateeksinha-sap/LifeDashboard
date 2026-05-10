"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldAlert,
  Target,
  X,
  XCircle,
} from "lucide-react";
import {
  fetchPortfolioAgentBrief,
  PortfolioAgentBrief as PortfolioAgentBriefData,
  PortfolioAgentDecision,
  PortfolioAgentRecommendation,
  PortfolioAgentRun,
  syncPortfolioAgentReports,
  updatePortfolioAgentDecision,
} from "@/lib/api";
import EmptyState from "@/components/EmptyState";

type Tab = "brief" | "actions" | "recommendations" | "history" | "decisions";

function money(value?: number | null) {
  const amount = value || 0;
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 1_00_00_000) return `${sign}INR ${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}INR ${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}INR ${(abs / 1_000).toFixed(0)}K`;
  return `${sign}INR ${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function dateTime(value?: string | null) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function shortDate(value?: string | null) {
  if (!value) return "No date";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function pct(value?: number | null) {
  if (value === null || value === undefined) return "n/a";
  return `${value.toFixed(2)}%`;
}

function reportObject(run?: PortfolioAgentRun | null) {
  return (run?.report || {}) as Record<string, unknown>;
}

function nestedObject(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringList(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function statusColor(status?: string | null) {
  if (status === "Accepted" || status === "Executed") return "#30d158";
  if (status === "Stalling") return "#ff9f0a";
  if (status === "Dismissed") return "#ff453a";
  return "#64d2ff";
}

function modeLabel(run?: PortfolioAgentRun | null) {
  if (!run) return "No report";
  return `${run.run_mode || "?"}/${run.data_mode || "?"}`;
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-[11px] font-semibold transition"
      style={{
        color: active ? "#050506" : "rgba(255,255,255,0.58)",
        background: active ? "#64d2ff" : "rgba(255,255,255,0.055)",
        border: `1px solid ${active ? "rgba(100,210,255,0.75)" : "rgba(255,255,255,0.08)"}`,
      }}
    >
      {label}
    </button>
  );
}

function Metric({ label, value, color = "rgba(255,255,255,0.86)" }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0 rounded-md px-2.5 py-1.5" style={{ background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.075)" }}>
      <p className="truncate text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.34)" }}>{label}</p>
      <p className="mt-1 truncate text-[13px] font-bold tabular-nums" style={{ color }}>{value}</p>
    </div>
  );
}

function DecisionControls({
  item,
  isLive,
  notes,
  reviewDate,
  busy,
  onNotes,
  onReviewDate,
  onDecision,
}: {
  item: PortfolioAgentRecommendation;
  isLive: boolean;
  notes: string;
  reviewDate: string;
  busy: boolean;
  onNotes: (value: string) => void;
  onReviewDate: (value: string) => void;
  onDecision: (status: PortfolioAgentDecision["status"]) => void;
}) {
  const current = item.decision?.status || "Review";
  const taskBlocked = !isLive;

  const buttonStyle = (status: PortfolioAgentDecision["status"], disabled: boolean) => ({
    color: disabled ? "rgba(255,255,255,0.28)" : statusColor(status),
    background: disabled ? "rgba(255,255,255,0.035)" : `${statusColor(status)}1f`,
    border: `1px solid ${disabled ? "rgba(255,255,255,0.07)" : `${statusColor(status)}55`}`,
  });

  const actionButton = (status: PortfolioAgentDecision["status"], label: string, blocked = false) => (
    <button
      type="button"
      disabled={busy || blocked}
      onClick={() => onDecision(status)}
      className="rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed"
      style={buttonStyle(status, busy || blocked)}
      title={blocked ? "Task-generating decisions require a LIVE/LIVE report." : label}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-3 rounded-md p-2.5" style={{ background: "rgba(0,0,0,0.22)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ color: statusColor(current), background: `${statusColor(current)}18`, border: `1px solid ${statusColor(current)}35` }}>
          {current}
        </span>
        {actionButton("Accepted", "Accept", taskBlocked)}
        {actionButton("Stalling", "Stall", taskBlocked)}
        {actionButton("Dismissed", "Dismiss")}
        {actionButton("Executed", "Executed", taskBlocked)}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-[1fr_150px]">
        <input
          value={notes}
          onChange={(event) => onNotes(event.target.value)}
          placeholder="Decision note"
          className="rounded-md px-2.5 py-2 text-[12px] outline-none"
          style={{ color: "rgba(255,255,255,0.86)", background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)" }}
        />
        <input
          type="date"
          value={reviewDate}
          onChange={(event) => onReviewDate(event.target.value)}
          className="rounded-md px-2.5 py-2 text-[12px] outline-none"
          style={{ color: "rgba(255,255,255,0.72)", background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)" }}
        />
      </div>
    </div>
  );
}

function RecommendationRow({
  item,
  isLive,
  notes,
  reviewDate,
  busy,
  showControls,
  onNotes,
  onReviewDate,
  onDecision,
}: {
  item: PortfolioAgentRecommendation;
  isLive: boolean;
  notes: string;
  reviewDate: string;
  busy: boolean;
  showControls: boolean;
  onNotes: (value: string) => void;
  onReviewDate: (value: string) => void;
  onDecision: (status: PortfolioAgentDecision["status"]) => void;
}) {
  return (
    <article className="rounded-lg px-3 py-3" style={{ background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {item.priority && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: "#050506", background: "#64d2ff" }}>P{item.priority}</span>}
            {item.ticker && <span className="rounded-md px-2 py-0.5 text-[10px] font-bold" style={{ color: "#30d158", background: "rgba(48,209,88,0.13)" }}>{item.ticker}</span>}
            {item.timing && <span className="rounded-md px-2 py-0.5 text-[10px] font-semibold" style={{ color: "#ff9f0a", background: "rgba(255,159,10,0.12)" }}>{item.timing}</span>}
            {item.conviction && <span className="rounded-md px-2 py-0.5 text-[10px] font-semibold" style={{ color: "#bf5af2", background: "rgba(191,90,242,0.14)" }}>{item.conviction}</span>}
          </div>
          <p className="mt-2 text-[13px] font-semibold leading-snug" style={{ color: "rgba(255,255,255,0.88)" }}>{item.action}</p>
          {item.rationale && <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "rgba(255,255,255,0.52)" }}>{item.rationale}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[12px] font-bold tabular-nums" style={{ color: item.estimated_amount_inr ? "#30d158" : "rgba(255,255,255,0.45)" }}>
            {item.estimated_amount_inr ? money(item.estimated_amount_inr) : item.suggested_allocation_pct ? `${item.suggested_allocation_pct}%` : "Watch"}
          </p>
          {item.target_price && <p className="mt-1 text-[10px]" style={{ color: "rgba(255,255,255,0.38)" }}>Target INR {item.target_price.toLocaleString("en-IN")}</p>}
        </div>
      </div>
      {showControls && (
        <DecisionControls
          item={item}
          isLive={isLive}
          notes={notes}
          reviewDate={reviewDate}
          busy={busy}
          onNotes={onNotes}
          onReviewDate={onReviewDate}
          onDecision={onDecision}
        />
      )}
    </article>
  );
}

export default function PortfolioAgentBrief() {
  const [brief, setBrief] = useState<PortfolioAgentBriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("brief");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [reviewDates, setReviewDates] = useState<Record<number, string>>({});
  const [busyDecision, setBusyDecision] = useState<number | null>(null);

  const load = useCallback(async (syncFirst = true, showInitialLoading = false) => {
    if (showInitialLoading) setLoading(true);
    setError(null);
    let syncError: string | null = null;
    try {
      if (syncFirst) {
        setSyncing(true);
        try {
          await syncPortfolioAgentReports();
        } catch (err) {
          syncError = err instanceof Error ? err.message : "Could not sync portfolio-agent reports";
        }
      }
      setBrief(await fetchPortfolioAgentBrief());
      setError(syncError);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Portfolio Agent unavailable");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void load(true, true);
  }, [load]);

  const latest = brief?.latest_run;
  const report = reportObject(latest);
  const market = nestedObject(report, "market_pulse");
  const roadmap = nestedObject(report, "five_year_roadmap");
  const isLive = Boolean(brief?.is_live);
  const newerNonLiveCount = brief?.newer_non_live_count || 0;
  const topAction = brief?.action_plan?.[0];

  const defaultReviewDate = useMemo(() => {
    const current = new Date();
    current.setDate(current.getDate() + 3);
    return current.toISOString().slice(0, 10);
  }, []);

  const decide = async (item: PortfolioAgentRecommendation, status: PortfolioAgentDecision["status"]) => {
    setBusyDecision(item.id);
    try {
      await updatePortfolioAgentDecision(item.id, {
        status,
        notes: notes[item.id] || undefined,
        review_date: reviewDates[item.id] || undefined,
      });
      window.dispatchEvent(new Event("portfolio-decision-updated"));
      window.dispatchEvent(new Event("actionables-updated"));
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save decision");
    } finally {
      setBusyDecision(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "rgba(100,210,255,0.25)", borderTopColor: "#64d2ff" }} />
      </div>
    );
  }

  if (error && !brief) {
    return <EmptyState title="Portfolio CIO unavailable" detail={error} />;
  }

  if (!latest) {
    return (
      <div className="flex h-full flex-col justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.44)" }}>
            <Bot size={12} /> Portfolio CIO
          </p>
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: "rgba(255,255,255,0.58)" }}>
            No portfolio-agent reports are imported yet.
          </p>
          <p className="mt-2 text-[11px]" style={{ color: "rgba(255,255,255,0.34)" }}>
            {brief?.report_dir_exists ? brief.report_dir : `Missing folder: ${brief?.report_dir || "not configured"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          className="flex items-center justify-center gap-2 rounded-md px-3 py-2 text-[12px] font-semibold"
          style={{ color: "#64d2ff", background: "rgba(100,210,255,0.1)", border: "1px solid rgba(100,210,255,0.22)" }}
        >
          <RefreshCw size={13} className={syncing ? "animate-spin" : ""} /> Sync Reports
        </button>
      </div>
    );
  }

  const pnlColor = (latest.summary.total_pnl || 0) >= 0 ? "#30d158" : "#ff453a";

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.44)" }}>
              <Bot size={12} /> Portfolio CIO
            </p>
            <p className="mt-1 truncate text-[11px]" style={{ color: "rgba(255,255,255,0.32)" }}>
              {dateTime(latest.generated_at)} | {latest.model || "model n/a"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="rounded-full px-2 py-1 text-[10px] font-bold" style={{ color: isLive ? "#30d158" : "#ff9f0a", background: isLive ? "rgba(48,209,88,0.12)" : "rgba(255,159,10,0.12)", border: `1px solid ${isLive ? "rgba(48,209,88,0.28)" : "rgba(255,159,10,0.28)"}` }}>
              {modeLabel(latest)}
            </span>
            <button
              type="button"
              onClick={() => void load(true)}
              className="flex h-7 w-7 items-center justify-center rounded-full"
              style={{ color: "#64d2ff", background: "rgba(100,210,255,0.1)", border: "1px solid rgba(100,210,255,0.18)" }}
              aria-label="Sync portfolio agent reports"
            >
              <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {!isLive && (
          <div className="flex shrink-0 items-start gap-2 rounded-md px-2.5 py-1" style={{ color: "#ffbf69", background: "rgba(255,159,10,0.08)", border: "1px solid rgba(255,159,10,0.18)" }}>
            <ShieldAlert size={13} className="mt-0.5 shrink-0" />
            <p className="text-[10px] leading-snug">Mock report. Task decisions unlock after a LIVE/LIVE run.</p>
          </div>
        )}
        {isLive && newerNonLiveCount > 0 && (
          <div className="flex shrink-0 items-start gap-2 rounded-md px-2.5 py-1" style={{ color: "#64d2ff", background: "rgba(100,210,255,0.07)", border: "1px solid rgba(100,210,255,0.16)" }}>
            <ShieldAlert size={13} className="mt-0.5 shrink-0" />
            <p className="text-[10px] leading-snug">Showing latest LIVE report; {newerNonLiveCount} newer mock run{newerNonLiveCount === 1 ? "" : "s"} remain in History.</p>
          </div>
        )}
        {error && (
          <div className="flex shrink-0 items-start gap-2 rounded-md px-2.5 py-1" style={{ color: "#ffbf69", background: "rgba(255,159,10,0.07)", border: "1px solid rgba(255,159,10,0.16)" }}>
            <ShieldAlert size={13} className="mt-0.5 shrink-0" />
            <p className="line-clamp-2 text-[10px] leading-snug">Showing stored brief; sync failed: {error}</p>
          </div>
        )}

        <div className="grid shrink-0 grid-cols-2 gap-1">
          <Metric label="Value" value={money(latest.summary.total_current_value)} />
          <Metric label="P&L" value={`${money(latest.summary.total_pnl)} (${pct(latest.summary.total_pnl_pct)})`} color={pnlColor} />
          <Metric label="Goal CAGR" value={pct(latest.summary.required_annual_return_pct)} color="#64d2ff" />
          <Metric label="Est CAGR" value={pct(latest.summary.estimated_portfolio_cagr)} color={latest.summary.on_track_to_double ? "#30d158" : "#ff9f0a"} />
        </div>

        {topAction && (
          <button
            type="button"
            onClick={() => {
              setTab("actions");
              setOpen(true);
            }}
            className="min-h-[72px] flex-1 overflow-hidden rounded-lg px-2.5 py-1.5 text-left"
            style={{ background: "rgba(100,210,255,0.07)", border: "1px solid rgba(100,210,255,0.16)" }}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="flex min-w-0 items-center gap-1.5 truncate text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#64d2ff" }}>
                <Target size={12} /> Top action
              </p>
              <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: statusColor(topAction.decision?.status), background: `${statusColor(topAction.decision?.status)}18` }}>
                {topAction.decision?.status || "Review"}
              </span>
            </div>
            <p className="mt-1.5 line-clamp-2 break-words text-[12px] font-semibold leading-snug" style={{ color: "rgba(255,255,255,0.84)" }}>
              {topAction.action}
            </p>
          </button>
        )}

        {!topAction && (
          <div className="mt-auto flex shrink-0 items-center justify-between gap-2">
            <p className="truncate text-[11px]" style={{ color: "rgba(255,255,255,0.34)" }}>
              {brief.unresolved_count} decisions pending | ${latest.estimated_cost_usd?.toFixed(4) ?? "0.0000"}
            </p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold"
              style={{ color: "#050506", background: "#64d2ff", border: "1px solid rgba(255,255,255,0.16)" }}
            >
              Review
            </button>
          </div>
        )}
        {error && <p className="shrink-0 text-[10px]" style={{ color: "#ff453a" }}>{error}</p>}
      </div>

      {open && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.74)", backdropFilter: "blur(10px)" }}>
          <section className="flex max-h-[88vh] w-full max-w-[1040px] flex-col overflow-hidden rounded-xl" style={{ background: "rgba(12,14,18,0.98)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 28px 90px rgba(0,0,0,0.62)" }}>
            <header className="flex flex-col gap-3 border-b px-5 py-4" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#64d2ff" }}>
                    <Bot size={14} /> Portfolio CIO Brief
                  </p>
                  <h2 className="mt-1 truncate text-xl font-bold" style={{ color: "rgba(255,255,255,0.92)" }}>
                    {latest.report_date || latest.run_id}
                  </h2>
                  <p className="mt-1 text-[12px]" style={{ color: "rgba(255,255,255,0.38)" }}>
                    {modeLabel(latest)} | Email {latest.delivery_status.email || "n/a"} | Slack {latest.delivery_status.slack || "n/a"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.1)" }}
                  aria-label="Close Portfolio CIO brief"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <TabButton active={tab === "brief"} label="Brief" onClick={() => setTab("brief")} />
                <TabButton active={tab === "actions"} label="Actions" onClick={() => setTab("actions")} />
                <TabButton active={tab === "recommendations"} label="Recommendations" onClick={() => setTab("recommendations")} />
                <TabButton active={tab === "history"} label="History" onClick={() => setTab("history")} />
                <TabButton active={tab === "decisions"} label="Decision Log" onClick={() => setTab("decisions")} />
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
              {tab === "brief" && (
                <div className="grid gap-4">
                  <div className="grid gap-2 md:grid-cols-4">
                    <Metric label="Current value" value={money(latest.summary.total_current_value)} />
                    <Metric label="Target value" value={money(latest.summary.target_portfolio_value)} color="#64d2ff" />
                    <Metric label="Required CAGR" value={pct(latest.summary.required_annual_return_pct)} color="#ff9f0a" />
                    <Metric label="Estimated CAGR" value={pct(latest.summary.estimated_portfolio_cagr)} color={latest.summary.on_track_to_double ? "#30d158" : "#ff9f0a"} />
                  </div>
                  <div className="rounded-lg px-4 py-3" style={{ background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>Capital verdict</p>
                    <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "rgba(255,255,255,0.82)" }}>{latest.capital_growth_verdict || "No verdict in report."}</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg px-4 py-3" style={{ background: "rgba(48,209,88,0.055)", border: "1px solid rgba(48,209,88,0.14)" }}>
                      <p className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#30d158" }}>Market pulse</p>
                      <p className="mt-2 text-[13px]" style={{ color: "rgba(255,255,255,0.72)" }}>Sentiment: {String(market.overall_sentiment || latest.overall_sentiment || "n/a")}</p>
                      <p className="mt-2 text-[12px]" style={{ color: "rgba(255,255,255,0.48)" }}>Themes: {stringList(market, "key_themes_today").join(", ") || "n/a"}</p>
                      <p className="mt-1 text-[12px]" style={{ color: "rgba(255,255,255,0.48)" }}>Overweight: {stringList(market, "sectors_to_overweight").join(", ") || "n/a"}</p>
                      <p className="mt-1 text-[12px]" style={{ color: "rgba(255,255,255,0.48)" }}>Underweight: {stringList(market, "sectors_to_underweight").join(", ") || "n/a"}</p>
                    </div>
                    <div className="rounded-lg px-4 py-3" style={{ background: "rgba(100,210,255,0.055)", border: "1px solid rgba(100,210,255,0.14)" }}>
                      <p className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#64d2ff" }}>Five-year roadmap</p>
                      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "rgba(255,255,255,0.72)" }}>{String(roadmap.recommended_strategy || "No strategy text in report.")}</p>
                      {roadmap.rebalancing_suggestion ? (
                        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: "rgba(255,255,255,0.48)" }}>{String(roadmap.rebalancing_suggestion)}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}

              {tab === "actions" && (
                <div className="grid gap-3">
                  {!isLive && (
                    <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ color: "#ffbf69", background: "rgba(255,159,10,0.08)", border: "1px solid rgba(255,159,10,0.18)" }}>
                      <AlertTriangle size={14} /> <p className="text-[12px]">This report is {modeLabel(latest)}. Dismiss is allowed; task-generating decisions are locked.</p>
                    </div>
                  )}
                  {brief.action_plan.map((item) => (
                    <RecommendationRow
                      key={`action-${item.id}`}
                      item={item}
                      isLive={isLive}
                      notes={notes[item.id] ?? item.decision?.notes ?? ""}
                      reviewDate={reviewDates[item.id] ?? item.decision?.review_date ?? defaultReviewDate}
                      busy={busyDecision === item.id}
                      showControls
                      onNotes={(value) => setNotes((prev) => ({ ...prev, [item.id]: value }))}
                      onReviewDate={(value) => setReviewDates((prev) => ({ ...prev, [item.id]: value }))}
                      onDecision={(status) => void decide(item, status)}
                    />
                  ))}
                </div>
              )}

              {tab === "recommendations" && (
                <div className="grid gap-5">
                  <section>
                    <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#30d158" }}>
                      <CheckCircle2 size={13} /> Validated
                    </p>
                    <div className="grid gap-3">
                      {brief.validated_recommendations.map((item) => (
                        <RecommendationRow
                          key={`validated-${item.id}`}
                          item={item}
                          isLive={isLive}
                          notes=""
                          reviewDate={defaultReviewDate}
                          busy={false}
                          showControls={false}
                          onNotes={() => undefined}
                          onReviewDate={() => undefined}
                          onDecision={() => undefined}
                        />
                      ))}
                      {brief.validated_recommendations.length === 0 && <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.45)" }}>No validated recommendations in this run.</p>}
                    </div>
                  </section>
                  <section>
                    <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#ff453a" }}>
                      <XCircle size={13} /> Rejected by CIO
                    </p>
                    <div className="grid gap-3">
                      {brief.rejected_recommendations.map((item) => (
                        <RecommendationRow
                          key={`rejected-${item.id}`}
                          item={item}
                          isLive={isLive}
                          notes=""
                          reviewDate={defaultReviewDate}
                          busy={false}
                          showControls={false}
                          onNotes={() => undefined}
                          onReviewDate={() => undefined}
                          onDecision={() => undefined}
                        />
                      ))}
                      {brief.rejected_recommendations.length === 0 && <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.45)" }}>No rejected recommendations in this run.</p>}
                    </div>
                  </section>
                </div>
              )}

              {tab === "history" && (
                <div className="overflow-auto rounded-lg" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                  <table className="w-full min-w-[760px] border-collapse">
                    <thead style={{ background: "rgba(255,255,255,0.045)" }}>
                      <tr>
                        {["Generated", "Mode", "Value", "P&L", "CAGR", "Delivery", "Cost"].map((head) => (
                          <th key={head} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>{head}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {brief.history.map((run) => (
                        <tr key={run.run_id} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                          <td className="px-3 py-2 text-[12px]" style={{ color: "rgba(255,255,255,0.78)" }}>{dateTime(run.generated_at)}</td>
                          <td className="px-3 py-2 text-[12px]" style={{ color: run.run_mode === "LIVE" && run.data_mode === "LIVE" ? "#30d158" : "#ff9f0a" }}>{modeLabel(run)}</td>
                          <td className="px-3 py-2 text-[12px] tabular-nums" style={{ color: "rgba(255,255,255,0.72)" }}>{money(run.summary.total_current_value)}</td>
                          <td className="px-3 py-2 text-[12px] tabular-nums" style={{ color: (run.summary.total_pnl || 0) >= 0 ? "#30d158" : "#ff453a" }}>{money(run.summary.total_pnl)}</td>
                          <td className="px-3 py-2 text-[12px]" style={{ color: "rgba(255,255,255,0.72)" }}>{pct(run.summary.estimated_portfolio_cagr)} / {pct(run.summary.required_annual_return_pct)}</td>
                          <td className="px-3 py-2 text-[12px]" style={{ color: "rgba(255,255,255,0.55)" }}>{run.delivery_status.email || "n/a"} / {run.delivery_status.slack || "n/a"}</td>
                          <td className="px-3 py-2 text-[12px] tabular-nums" style={{ color: "rgba(255,255,255,0.55)" }}>${run.estimated_cost_usd?.toFixed(4) ?? "0.0000"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {tab === "decisions" && (
                <div className="grid gap-3">
                  {brief.recent_decisions.length === 0 ? (
                    <p className="rounded-lg px-3 py-4 text-[12px]" style={{ color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)" }}>No portfolio decisions recorded yet.</p>
                  ) : (
                    brief.recent_decisions.map((item) => (
                      <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2.5" style={{ background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>{item.fingerprint}</p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: "rgba(255,255,255,0.42)" }}>
                            <Clock3 size={11} /> {item.decided_at ? dateTime(item.decided_at) : dateTime(item.updated_at)} {item.review_date ? `| Review ${shortDate(item.review_date)}` : ""}
                          </p>
                          {item.notes && <p className="mt-1 text-[11px]" style={{ color: "rgba(255,255,255,0.52)" }}>{item.notes}</p>}
                        </div>
                        <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ color: statusColor(item.status), background: `${statusColor(item.status)}18`, border: `1px solid ${statusColor(item.status)}35` }}>
                          {item.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
