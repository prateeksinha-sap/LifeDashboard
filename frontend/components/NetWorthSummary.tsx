"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, WalletCards } from "lucide-react";
import { DashboardSummary, fetchDashboardSummary } from "@/lib/api";
import EmptyState from "@/components/EmptyState";

function money(value: number) {
  if (value >= 1_00_00_000) return `INR ${(value / 1_00_00_000).toFixed(2)}Cr`;
  if (value >= 1_00_000) return `INR ${(value / 1_00_000).toFixed(1)}L`;
  return `INR ${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default function NetWorthSummary() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState(false);

  const load = () => fetchDashboardSummary()
    .then((data) => { setSummary(data); setError(false); })
    .catch(() => setError(true));

  useEffect(() => {
    load();
    window.addEventListener("wealth-updated", load);
    return () => window.removeEventListener("wealth-updated", load);
  }, []);

  if (error) return <EmptyState title="Net worth unavailable" detail="The backend summary endpoint is not reachable." />;
  if (!summary) {
    return <div className="flex h-full items-center justify-center"><div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "rgba(48,209,88,0.25)", borderTopColor: "#30d158" }} /></div>;
  }

  const ready = summary.net_worth > 0;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>Net Worth</p>
          <p className="mt-1 text-[11px]" style={{ color: "rgba(255,255,255,0.32)" }}>Current position</p>
        </div>
        <span className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold"
          style={{
            background: ready ? "rgba(48,209,88,0.12)" : "rgba(255,159,10,0.12)",
            border: `1px solid ${ready ? "rgba(48,209,88,0.24)" : "rgba(255,159,10,0.24)"}`,
            color: ready ? "#30d158" : "#ff9f0a",
          }}>
          {ready ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
          {ready ? "Live" : "Needs data"}
        </span>
      </div>

      <div>
        <p className="text-[30px] font-bold leading-none tabular-nums md:text-[34px]" style={{ color: ready ? "rgba(255,255,255,0.95)" : "#ff9f0a" }}>
          {money(summary.net_worth)}
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-[12px]" style={{ color: "rgba(255,255,255,0.44)" }}>
          <WalletCards size={13} /> Cash available: <strong style={{ color: "rgba(255,255,255,0.72)" }}>{money(summary.cash)}</strong>
        </p>
      </div>

      <div className="mt-auto rounded-lg p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.3)" }}>Transparency</span>
          <span className="text-[12px] font-bold" style={{ color: summary.transparency_score >= 80 ? "#30d158" : "#ff9f0a" }}>{summary.transparency_score}/100</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div className="h-full rounded-full" style={{ width: `${summary.transparency_score}%`, background: summary.transparency_score >= 80 ? "#30d158" : "#ff9f0a" }} />
        </div>
      </div>
    </div>
  );
}
