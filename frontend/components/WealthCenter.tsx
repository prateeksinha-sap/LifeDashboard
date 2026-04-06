"use client";

import { useEffect, useRef, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import { fetchWealth, fetchXIRR, fetchSavingsRate, WealthData, XIRRData, SavingsRateData } from "@/lib/api";

function formatNetWorth(value: number): string {
  if (value >= 1_00_00_000) return `₹${(value / 1_00_00_000).toFixed(2)}Cr`;
  if (value >= 1_00_000)    return `₹${(value / 1_00_000).toFixed(2)}L`;
  if (value >= 1_000)       return `₹${(value / 1_000).toFixed(1)}K`;
  return `₹${value.toFixed(0)}`;
}

function formatLakh(v: number) {
  return `₹${(v / 1_00_000).toFixed(1)}L`;
}

// Custom tooltip for Recharts
const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { name: string; value: number; payload: { color: string } }[] }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div style={{
      background:    "rgba(22,22,26,0.96)",
      border:        "1px solid rgba(255,255,255,0.1)",
      borderRadius:  12,
      padding:       "8px 12px",
      backdropFilter:"blur(20px)",
    }}>
      <p style={{ color: d.payload.color, fontSize: 12, fontWeight: 600, margin: 0 }}>{d.name}</p>
      <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, margin: "2px 0 0" }}>
        {d.value.toFixed(1)}%
      </p>
    </div>
  );
};

export default function WealthCenter() {
  const [wealth,       setWealth]       = useState<WealthData    | null>(null);
  const [xirr,         setXirr]         = useState<XIRRData      | null>(null);
  const [savings,      setSavings]      = useState<SavingsRateData | null>(null);
  const [displayValue, setDisplayValue] = useState(0);
  const [error,        setError]        = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadWealth = () => {
    fetchWealth()
      .then((d) => { setWealth(d); setError(false); })
      .catch(() => setError(true));
    fetchXIRR().then(setXirr).catch(() => {});
    fetchSavingsRate().then(setSavings).catch(() => {});
  };

  useEffect(() => {
    loadWealth();
    window.addEventListener("wealth-updated", loadWealth);
    return () => window.removeEventListener("wealth-updated", loadWealth);
  }, []);

  // Count-up animation
  useEffect(() => {
    if (!wealth) return;
    const target = wealth.total_net_worth;
    const steps  = 72;
    const inc    = target / steps;
    let cur      = 0;
    timerRef.current = setInterval(() => {
      cur += inc;
      if (cur >= target) {
        setDisplayValue(target);
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setDisplayValue(Math.round(cur));
      }
    }, 1600 / steps);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [wealth?.total_net_worth]);

  if (error) return (
    <div className="flex flex-col h-full items-center justify-center gap-2">
      <p className="text-[13px]" style={{ color: "rgba(255,255,255,0.35)" }}>Backend offline</p>
      <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>Run start.bat</p>
    </div>
  );

  if (!wealth) return (
    <div className="flex h-full items-center justify-center">
      <div className="w-5 h-5 rounded-full border-2 animate-spin"
        style={{ borderColor: "rgba(191,90,242,0.3)", borderTopColor: "#bf5af2" }} />
    </div>
  );

  const gainPct   = xirr?.gain_pct ?? 0;
  const gainAbs   = xirr?.absolute_gain ?? 0;
  const isUp      = gainAbs >= 0;
  // Detailed slices: MF / Stocks / EPF / PPF / NPS / Cash / Gold
  const chartData = wealth.slices ?? [];
  // High-level type allocation for the sub-label row
  const typeSlices = wealth.asset_type_slices ?? [];

  return (
    <div className="flex flex-col h-full gap-4">

      {/* ── Net Worth ── */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] mb-1.5"
          style={{ color: "rgba(255,255,255,0.35)" }}>
          Total Net Worth
        </p>
        <p className="tabular-nums"
          style={{
            fontSize: "clamp(1.9rem,3.2vw,2.6rem)", fontWeight: 700,
            letterSpacing: "-0.03em", color: "rgba(255,255,255,0.95)", lineHeight: 1.1,
            fontFamily: "-apple-system, 'SF Pro Display', var(--font-inter-var), sans-serif",
          }}>
          {formatNetWorth(displayValue)}
        </p>

        {/* Gain row */}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="flex items-center gap-1 text-[12px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: isUp ? "rgba(48,209,88,0.12)"  : "rgba(255,69,58,0.12)",
              color:      isUp ? "#30d158"                : "#ff453a",
              border:     `1px solid ${isUp ? "rgba(48,209,88,0.22)" : "rgba(255,69,58,0.22)"}`,
            }}>
            {isUp ? <TrendingUp size={11} strokeWidth={2.5} /> : <TrendingDown size={11} strokeWidth={2.5} />}
            {gainPct >= 0 ? "+" : ""}{gainPct.toFixed(1)}%
          </span>
          <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.28)" }}>
            {isUp ? "+" : ""}{formatLakh(gainAbs)} unrealised
          </span>
        </div>
      </div>

      <div className="h-px shrink-0" style={{ background: "rgba(255,255,255,0.06)" }} />

      {/* ── Donut chart — Portfolio Breakdown ── */}
      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.1em] mb-2"
          style={{ color: "rgba(255,255,255,0.25)" }}>
          Portfolio Breakdown
        </p>
        <div className="relative" style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="percentage"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius="52%"
                outerRadius="78%"
                paddingAngle={2}
                startAngle={90}
                endAngle={-270}
                strokeWidth={0}
              >
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>

          {/* Centre label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[10px] font-medium uppercase tracking-widest"
              style={{ color: "rgba(255,255,255,0.28)" }}>
              Portfolio
            </span>
            <span className="text-[18px] font-bold tabular-nums"
              style={{ color: "rgba(255,255,255,0.9)", letterSpacing: "-0.02em" }}>
              {wealth.mf_count + wealth.stock_count}
            </span>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.28)" }}>
              holdings
            </span>
          </div>
        </div>
      </div>

      {/* ── Holdings legend (3-col grid) ── */}
      <div className="grid grid-cols-3 gap-1.5">
        {chartData.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl"
            style={{ background: `${s.color}10`, border: `1px solid ${s.color}22` }}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: s.color, boxShadow: `0 0 5px ${s.color}88` }} />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-medium truncate leading-tight"
                style={{ color: "rgba(255,255,255,0.5)" }}>{s.label}</p>
              <p className="text-[11px] font-bold tabular-nums leading-tight"
                style={{ color: s.color }}>{s.percentage.toFixed(0)}%</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Asset-class allocation bar (Equity / Debt / Gold / Cash) ── */}
      {typeSlices.length > 0 && (
        <div>
          <p className="text-[9.5px] font-medium uppercase tracking-[0.1em] mb-1.5"
            style={{ color: "rgba(255,255,255,0.2)" }}>
            Asset Class
          </p>
          {/* Stacked bar */}
          <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
            {typeSlices.map((t) => (
              <div key={t.label} style={{ width: `${t.percentage}%`, background: t.color }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
            {typeSlices.map((t) => (
              <span key={t.label} className="flex items-center gap-1 text-[10px]"
                style={{ color: "rgba(255,255,255,0.4)" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />
                {t.label} <span style={{ color: t.color, fontWeight: 600 }}>{t.percentage.toFixed(0)}%</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="h-px shrink-0" style={{ background: "rgba(255,255,255,0.06)" }} />

      {/* ── XIRR / Gain metrics row ── */}
      <div className={`grid gap-2 mt-auto ${savings?.has_data ? "grid-cols-4" : "grid-cols-3"}`}>
        {[
          {
            label: "Invested",
            value: formatLakh(xirr?.total_invested ?? 0),
            color: "rgba(255,255,255,0.5)",
          },
          {
            label: "Current",
            value: formatLakh(xirr?.current_value ?? wealth.total_net_worth),
            color: "rgba(255,255,255,0.5)",
          },
          {
            label: xirr?.xirr_pct != null ? "XIRR" : "Gain",
            value: xirr?.xirr_pct != null
              ? `${xirr.xirr_pct > 0 ? "+" : ""}${xirr.xirr_pct.toFixed(1)}%`
              : `${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(1)}%`,
            color: isUp ? "#30d158" : "#ff453a",
          },
          ...(savings?.has_data
            ? [{
                label: "Saved",
                value: `${savings.savings_rate_pct.toFixed(0)}%`,
                color: savings.savings_rate_pct >= 20 ? "#30d158" : savings.savings_rate_pct >= 10 ? "#ff9f0a" : "#ff453a",
              }]
            : []),
        ].map(({ label, value, color }) => (
          <div key={label} className="flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <span className="text-[10px] uppercase tracking-wide"
              style={{ color: "rgba(255,255,255,0.28)" }}>{label}</span>
            <span className="text-[12px] font-bold tabular-nums" style={{ color }}>{value}</span>
          </div>
        ))}
      </div>

    </div>
  );
}
