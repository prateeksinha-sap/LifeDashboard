"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Mail, WalletCards } from "lucide-react";
import { DashboardSummary, fetchDashboardSummary } from "@/lib/api";
import EmptyState from "@/components/EmptyState";

function money(value: number) {
  if (value >= 1_00_00_000) return `₹${(value / 1_00_00_000).toFixed(2)}Cr`;
  if (value >= 1_00_000) return `₹${(value / 1_00_000).toFixed(1)}L`;
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "warn" }) {
  const color = tone === "good" ? "#30d158" : tone === "warn" ? "#ff9f0a" : "rgba(255,255,255,0.72)";
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.28)" }}>{label}</p>
      <p className="mt-0.5 text-[13px] font-bold tabular-nums" style={{ color }}>{value}</p>
    </div>
  );
}

export default function ExecutiveSummary() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchDashboardSummary()
      .then((data) => {
        setSummary(data);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  if (error) {
    return <EmptyState title="Summary unavailable" detail="The backend summary endpoint is not reachable." />;
  }

  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "rgba(48,209,88,0.25)", borderTopColor: "#30d158" }} />
      </div>
    );
  }

  const incomplete = summary.missing_inputs.length > 0;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.35)" }}>
            Executive Summary
          </p>
          <p className="mt-1 text-[12px]" style={{ color: "rgba(255,255,255,0.36)" }}>
            Transparency score: {summary.transparency_score}/100
          </p>
        </div>
        <span className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold"
          style={{
            background: incomplete ? "rgba(255,159,10,0.13)" : "rgba(48,209,88,0.13)",
            border: `1px solid ${incomplete ? "rgba(255,159,10,0.28)" : "rgba(48,209,88,0.28)"}`,
            color: incomplete ? "#ff9f0a" : "#30d158",
          }}>
          {incomplete ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
          {incomplete ? "Needs data" : "Current"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Net Worth" value={money(summary.net_worth)} tone={summary.net_worth > 0 ? "good" : "warn"} />
        <Metric label="Cash" value={money(summary.cash)} />
        <Metric label="Savings MTD" value={money(summary.savings_this_month)} tone={summary.savings_this_month >= 0 ? "good" : "warn"} />
        <Metric label="Savings Rate" value={summary.savings_rate_pct == null ? "No data" : `${summary.savings_rate_pct}%`} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "rgba(10,132,255,0.08)", border: "1px solid rgba(10,132,255,0.16)" }}>
          <Mail size={14} style={{ color: "#0a84ff" }} />
          <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.62)" }}>{summary.pending_actions} actionables</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "rgba(255,159,10,0.08)", border: "1px solid rgba(255,159,10,0.16)" }}>
          <WalletCards size={14} style={{ color: "#ff9f0a" }} />
          <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.62)" }}>{summary.bills_due_7d} bills due</span>
        </div>
      </div>

      <div className="mt-auto rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.28)" }}>
          Missing Inputs
        </p>
        {summary.missing_inputs.length === 0 ? (
          <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.5)" }}>All primary inputs are present.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {summary.missing_inputs.slice(0, 4).map((item) => (
              <li key={item} className="text-[11.5px] leading-snug" style={{ color: "rgba(255,255,255,0.45)" }}>
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
