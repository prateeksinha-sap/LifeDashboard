"use client";

import { useEffect, useMemo, useState } from "react";
import { ReceiptText, Search } from "lucide-react";
import { CoachOverview, fetchCoachOverview } from "@/lib/api";
import EmptyState from "@/components/EmptyState";

function money(value: number): string {
  const abs = Math.abs(value || 0);
  if (abs >= 1_00_000) return `INR ${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `INR ${(abs / 1_000).toFixed(0)}K`;
  return `INR ${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const NON_SPEND_CATEGORIES = new Set(["Investments & Savings", "Transfers Out", "Transfers In", "Cash Withdrawal"]);

export default function SpendBreakdown() {
  const [data, setData] = useState<CoachOverview | null>(null);
  const [error, setError] = useState(false);

  const load = () => fetchCoachOverview()
    .then((overview) => { setData(overview); setError(false); })
    .catch(() => setError(true));

  useEffect(() => {
    load();
    window.addEventListener("wealth-updated", load);
    return () => window.removeEventListener("wealth-updated", load);
  }, []);

  const categories = useMemo(() => {
    const rows = (data?.cashflow.categories ?? [])
      .filter((row) => !NON_SPEND_CATEGORIES.has(row.category))
      .sort((a, b) => b.total - a.total);
    return rows.slice(0, 6);
  }, [data]);

  if (error) return <EmptyState title="Spend view unavailable" detail="Could not load categorized transactions." />;
  if (!data) return <div className="flex h-full items-center justify-center"><div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "rgba(255,159,10,0.25)", borderTopColor: "#ff9f0a" }} /></div>;
  if (!categories.length) return <EmptyState title="No spend categories yet" detail="Import a bank statement to see which categories are leaking money." />;

  const totalSpend = data.metrics.true_expenses || categories.reduce((sum, row) => sum + row.total, 0);
  const top = categories[0];
  const transactionCount = data.cashflow.transaction_count ?? categories.reduce((sum, row) => sum + row.count, 0);
  const monthsWithTransactions = Number(data.quality.months_with_transactions ?? 0);
  const hasEnoughSignal = totalSpend >= 15000 && top.count >= 3 && transactionCount >= 8 && monthsWithTransactions >= 2;
  const topShare = totalSpend ? Math.round((top.total / totalSpend) * 100) : 0;
  const headlineLabel = hasEnoughSignal ? "Largest category" : "Early signal";
  const guidance = hasEnoughSignal
    ? topShare >= 35
      ? `${top.category} is ${topShare}% of true spend. Review repeat merchants before cutting.`
      : "Spend is fairly spread out. Look for repeats, not one-off trims."
    : data.month === new Date().toISOString().slice(0, 7)
      ? "Current month has too little spend data for advice yet."
      : "Not enough rows to call this a leak.";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>
            <ReceiptText size={12} /> Spend Breakdown
          </p>
          <p className="mt-1 text-[11px]" style={{ color: "rgba(255,255,255,0.32)" }}>
            True expenses for {data.month}, excluding investments/transfers
          </p>
        </div>
        <div className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: "rgba(255,159,10,0.12)", color: "#ff9f0a", border: "1px solid rgba(255,159,10,0.24)" }}>
          {money(totalSpend)}
        </div>
      </div>

      <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.34)" }}>{headlineLabel}</p>
            <p className="mt-1 text-[15px] font-bold" style={{ color: "rgba(255,255,255,0.84)" }}>{top.category}</p>
          </div>
          <div className="text-right">
            <p className="text-[15px] font-bold tabular-nums" style={{ color: "#ff9f0a" }}>{money(top.total)}</p>
            <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.36)" }}>{top.count} rows</p>
          </div>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: hasEnoughSignal ? "#64d2ff" : "rgba(255,255,255,0.42)" }}>
          <Search size={12} /> {guidance}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        <div className="grid gap-2">
          {categories.map((row) => {
            const pct = totalSpend ? Math.round((row.total / totalSpend) * 100) : 0;
            return (
              <div key={row.category} className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.055)" }}>
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.76)" }}>{row.category}</p>
                  <div className="shrink-0 text-right">
                    <p className="text-[12px] font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.82)" }}>{money(row.total)}</p>
                    <p className="text-[10px] tabular-nums" style={{ color: "#ff9f0a" }}>{pct}%</p>
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: "#ff9f0a" }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
