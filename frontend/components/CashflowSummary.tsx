"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Percent, PiggyBank } from "lucide-react";
import { CoachOverview, fetchCoachOverview } from "@/lib/api";
import EmptyState from "@/components/EmptyState";

function money(value: number) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_00_000) return `${sign}INR ${(abs / 1_00_000).toFixed(1)}L`;
  return `${sign}INR ${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function Metric({ label, value, color, icon }: { label: string; value: string; color: string; icon: ReactNode }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.32)" }}>{icon}{label}</p>
      <p className="mt-1 text-[15px] font-bold tabular-nums" style={{ color }}>{value}</p>
    </div>
  );
}

export default function CashflowSummary() {
  const [summary, setSummary] = useState<CoachOverview | null>(null);
  const [error, setError] = useState(false);

  const load = () => fetchCoachOverview()
    .then((data) => { setSummary(data); setError(false); })
    .catch(() => setError(true));

  useEffect(() => {
    load();
    window.addEventListener("wealth-updated", load);
    return () => window.removeEventListener("wealth-updated", load);
  }, []);

  if (error) return <EmptyState title="Cashflow unavailable" detail="The dashboard summary endpoint is not reachable." />;
  if (!summary) return <div className="flex h-full items-center justify-center"><div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "rgba(10,132,255,0.25)", borderTopColor: "#0a84ff" }} /></div>;

  const savingsColor = summary.metrics.bank_surplus >= 0 ? "#30d158" : "#ff453a";
  const wealthRateColor = summary.metrics.wealth_creation_rate_pct >= 30
      ? "#30d158"
      : summary.metrics.wealth_creation_rate_pct >= 15
        ? "#ff9f0a"
        : "#ff453a";

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>Money Flow</p>
        <p className="mt-1 text-[11px]" style={{ color: "rgba(255,255,255,0.32)" }}>{summary.month}</p>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-2">
        <Metric label="Income" value={money(summary.metrics.income)} color="#30d158" icon={<ArrowDownRight size={12} />} />
        <Metric label="Real Spend" value={money(summary.metrics.true_expenses)} color="rgba(255,255,255,0.82)" icon={<ArrowUpRight size={12} />} />
        <Metric label="Invested" value={money(summary.metrics.investment_outflow)} color="#30d158" icon={<PiggyBank size={12} />} />
        <Metric
          label="Wealth Rate"
          value={`${summary.metrics.wealth_creation_rate_pct}%`}
          color={wealthRateColor}
          icon={<Percent size={12} />}
        />
      </div>

      <p className="text-[10.5px]" style={{ color: savingsColor }}>
        Cash change after all debits: {money(summary.metrics.bank_surplus)}
      </p>
    </div>
  );
}
