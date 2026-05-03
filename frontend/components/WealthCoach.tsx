"use client";

import { useEffect, useMemo, useState } from "react";
import { Brain, CheckCircle2, Loader2, Sparkles, Target, X } from "lucide-react";
import {
  CoachOverview,
  CoachReport,
  fetchCoachOverview,
  generateCoachReport,
} from "@/lib/api";
import EmptyState from "@/components/EmptyState";

function money(value: number) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value || 0);
  if (abs >= 1_00_00_000) return `${sign}INR ${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}INR ${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}INR ${(abs / 1_000).toFixed(0)}K`;
  return `${sign}INR ${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function shortMoney(value: number) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value || 0);
  if (abs >= 1_00_00_000) return `${sign}${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function scoreColor(score: number) {
  if (score >= 80) return "#30d158";
  if (score >= 60) return "#ff9f0a";
  return "#ff453a";
}

function MiniMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="min-w-0 rounded-md px-2 py-1.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <p className="truncate text-[9px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</p>
      <p className="mt-0.5 truncate text-[12px] font-bold tabular-nums" style={{ color }}>{value}</p>
    </div>
  );
}

export default function WealthCoach() {
  const [data, setData] = useState<CoachOverview | null>(null);
  const [report, setReport] = useState<CoachReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = () => {
    fetchCoachOverview()
      .then((overview) => {
        setData(overview);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    window.addEventListener("wealth-updated", load);
    window.addEventListener("gmail-synced", load);
    window.addEventListener("actionables-updated", load);
    return () => {
      window.removeEventListener("wealth-updated", load);
      window.removeEventListener("gmail-synced", load);
      window.removeEventListener("actionables-updated", load);
    };
  }, []);

  const topTarget = data?.targets?.[0];
  const actions = useMemo(() => data?.opportunities.slice(0, 3) ?? [], [data]);

  const createReport = async () => {
    setReportLoading(true);
    try {
      setReport(await generateCoachReport());
    } finally {
      setReportLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "rgba(48,209,88,0.25)", borderTopColor: "#30d158" }} />
      </div>
    );
  }

  if (error || !data) {
    return <EmptyState title="Coach unavailable" detail="The Personal CFO endpoint is not reachable." />;
  }

  const color = scoreColor(data.health_score);
  const surplusColor = data.metrics.bank_surplus >= 0 ? "#30d158" : "#ff453a";

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.44)" }}>
              <Brain size={12} /> Wealth Coach
            </p>
            <p className="mt-1 text-[11px]" style={{ color: "rgba(255,255,255,0.32)" }}>
              Personal CFO mirror for {data.month}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void createReport()}
            disabled={reportLoading}
            className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold transition disabled:opacity-50"
            style={{ color: "#bf5af2", background: "rgba(191,90,242,0.12)", border: "1px solid rgba(191,90,242,0.24)" }}
          >
            {reportLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Memo
          </button>
        </div>

        <div className="grid grid-cols-[72px_1fr] gap-2">
          <div className="relative flex aspect-square items-center justify-center rounded-full" style={{ background: `conic-gradient(${color} ${data.health_score * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}>
            <div className="absolute inset-2 rounded-full" style={{ background: "rgba(10,10,12,0.96)" }} />
            <div className="relative text-center">
              <p className="text-lg font-bold tabular-nums" style={{ color }}>{data.health_score}</p>
              <p className="text-[9px] font-semibold" style={{ color: "rgba(255,255,255,0.44)" }}>{data.health_band}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <MiniMetric label="Spend" value={shortMoney(data.metrics.true_expenses)} color="rgba(255,255,255,0.82)" />
            <MiniMetric label="Invested" value={shortMoney(data.metrics.investment_outflow)} color="#30d158" />
            <MiniMetric label="Cash" value={shortMoney(data.metrics.bank_surplus)} color={surplusColor} />
          </div>
        </div>

        {topTarget && (
          <div className="rounded-lg px-2.5 py-2" style={{ background: "rgba(10,132,255,0.08)", border: "1px solid rgba(10,132,255,0.16)" }}>
            <div className="flex items-center justify-between gap-2">
              <p className="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-semibold" style={{ color: "#0a84ff" }}>
                <Target size={12} /> {topTarget.label}
              </p>
              <p className="shrink-0 text-[11px] font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.84)" }}>
                {money(topTarget.required_monthly_contribution)}/mo
              </p>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto pr-1">
          <div className="grid gap-1.5">
            {actions.map((item, index) => {
              const impact = item.impact_monthly > 0 ? `${money(item.impact_monthly)}/mo` : item.category;
              const impactColor = item.impact_monthly > 0 ? "#30d158" : "#ff9f0a";
              return (
                <div key={item.id} className="rounded-md px-2.5 py-1.5" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold" style={{ color: "#30d158", background: "rgba(48,209,88,0.12)" }}>
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-1 text-[11.5px] font-semibold leading-snug" style={{ color: "rgba(255,255,255,0.82)" }}>{item.title}</p>
                        <p className="shrink-0 text-[10.5px] font-bold tabular-nums" style={{ color: impactColor }}>{impact}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {report && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.72)" }}>
          <section className="flex max-h-[82vh] w-full max-w-[760px] flex-col overflow-hidden rounded-xl" style={{ background: "rgba(14,14,18,0.98)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 24px 90px rgba(0,0,0,0.6)" }}>
            <header className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <div>
                <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#30d158" }}>
                  <CheckCircle2 size={13} /> CFO memo
                </p>
                <p className="mt-1 text-[11px]" style={{ color: "rgba(255,255,255,0.36)" }}>{report.provider}{report.model ? ` - ${report.model}` : ""}</p>
              </div>
              <button
                type="button"
                onClick={() => setReport(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.1)" }}
                aria-label="Close memo"
              >
                <X size={15} />
              </button>
            </header>
            <div className="overflow-auto px-5 py-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.76)" }}>{report.report}</p>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
