"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import EmptyState from "@/components/EmptyState";
import SafeResponsiveContainer from "@/components/SafeResponsiveContainer";
import { API_BASE } from "@/lib/config";

type AssetTrendResponse = {
  months: Record<string, string | number>[];
  asset_types: string[];
  has_snapshots: boolean;
};

const COLORS: Record<string, string> = {
  Cash: "#ffd60a",
  "Mutual Funds": "#bf5af2",
  Stocks: "#0a84ff",
  Gold: "#ff9f0a",
  "Real Estate": "#ac8e68",
  "Fixed Deposits": "#64d2ff",
  PPF: "#30d158",
  PF: "#5ac8fa",
  NPS: "#ff375f",
};

function money(v: number) {
  if (v >= 1_00_00_000) return `INR ${(v / 1_00_00_000).toFixed(1)}Cr`;
  if (v >= 1_00_000) return `INR ${(v / 1_00_000).toFixed(0)}L`;
  return `INR ${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function shortMoney(v: number) {
  if (v >= 1_00_00_000) return `${(v / 1_00_00_000).toFixed(1)}Cr`;
  if (v >= 1_00_000) return `${(v / 1_00_000).toFixed(0)}L`;
  return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fmtMonth(month: string) {
  const [year, m] = month.split("-");
  return `${new Date(Number(year), Number(m) - 1).toLocaleString("en-IN", { month: "short" })} '${year.slice(2)}`;
}

function currentSnapshot(data: AssetTrendResponse) {
  const latest = data.months[data.months.length - 1];
  if (!latest) return [];
  return data.asset_types
    .map((asset) => ({ asset, value: Number(latest[asset] || 0), color: COLORS[asset] ?? "#ffffff" }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
}

export default function AssetTrends() {
  const [data, setData] = useState<AssetTrendResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/wealth/asset-trends`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex h-full items-center justify-center"><div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "rgba(191,90,242,0.25)", borderTopColor: "#bf5af2" }} /></div>;
  if (!data || !data.has_snapshots) {
    return <EmptyState title="No asset trends yet" detail="Capture month-end snapshots to track cash, MF, stocks, gold, FD, real estate, PF, PPF and NPS over time." />;
  }

  const hasTrend = data.months.length >= 2;
  const snapshot = currentSnapshot(data);
  const total = snapshot.reduce((sum, item) => sum + item.value, 0);
  const latestMonth = String(data.months[data.months.length - 1]?.month || "");

  if (!hasTrend) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>Asset Snapshot</p>
          <p className="mt-0.5 text-[10px]" style={{ color: "rgba(255,255,255,0.24)" }}>
            {latestMonth ? `${fmtMonth(latestMonth)} captured. Trend starts after 2 month-end snapshots.` : "Trend starts after 2 month-end snapshots."}
          </p>
        </div>

        <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.34)" }}>Trend Readiness</p>
              <p className="mt-1 text-[13px] font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.72)" }}>
                {data.months.length} of 2 needed for trend
              </p>
            </div>
            <p className="text-right text-[10.5px] leading-snug" style={{ color: "rgba(255,255,255,0.4)" }}>
              Total is used internally: {shortMoney(total)}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-2">
            {snapshot.map((item) => {
              const pct = total ? Math.round((item.value / total) * 100) : 0;
              return (
                <div key={item.asset} className="rounded-lg p-2.5" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.055)" }}>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
                      <p className="truncate text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.72)" }}>{item.asset}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-[12px] font-bold tabular-nums">
                      <span style={{ color: "rgba(255,255,255,0.76)" }}>{money(item.value)}</span>
                      <span style={{ color: item.color }}>{pct}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: item.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>Detailed Asset Trends</p>
        <p className="mt-0.5 text-[10px]" style={{ color: "rgba(255,255,255,0.24)" }}>Monthly snapshots by asset class</p>
      </div>

      <div className="min-h-0 flex-1" style={{ minHeight: 220 }}>
        <SafeResponsiveContainer>
          <LineChart data={data.months} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fill: "rgba(255,255,255,0.32)", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => money(Number(v))} tick={{ fill: "rgba(255,255,255,0.26)", fontSize: 10 }} axisLine={false} tickLine={false} width={74} />
            <Tooltip formatter={(value) => money(Number(value))} labelFormatter={(label) => fmtMonth(String(label))} contentStyle={{ background: "rgba(18,18,22,0.97)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
            {data.asset_types.map((asset) => (
              <Line key={asset} type="monotone" dataKey={asset} stroke={COLORS[asset] ?? "#ffffff"} strokeWidth={2} dot={{ r: 2 }} connectNulls />
            ))}
          </LineChart>
        </SafeResponsiveContainer>
      </div>
    </div>
  );
}
