"use client";

import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

const BASE = "http://localhost:8000";

interface DataPoint {
  year:  number;
  label: string;
  value: number;
}

interface ForecastData {
  current_net_worth:       number;
  monthly_savings_assumed: number;
  annual_return_pct:       number;
  projection_years:        number;
  data_points:             DataPoint[];
}

function fmtCr(v: number): string {
  if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(2)}Cr`;
  if (v >= 1_00_000)    return `₹${(v / 1_00_000).toFixed(1)}L`;
  return `₹${(v / 1000).toFixed(0)}K`;
}

const CustomTooltip = ({
  active, payload, label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background:    "rgba(18,18,22,0.97)",
      border:        "1px solid rgba(255,255,255,0.1)",
      borderRadius:  12,
      padding:       "10px 14px",
      backdropFilter:"blur(20px)",
    }}>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, marginBottom: 4 }}>{label}</p>
      <p style={{ color: "#bf5af2", fontSize: 13, fontWeight: 700 }}>
        {fmtCr(payload[0].value)}
      </p>
    </div>
  );
};

export default function WealthForecast() {
  const [data,    setData]    = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE}/api/wealth/forecast`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <div className="w-4 h-4 rounded-full border-2 animate-spin"
        style={{ borderColor: "rgba(191,90,242,0.3)", borderTopColor: "#bf5af2" }} />
    </div>
  );

  if (!data) return (
    <div className="flex h-full items-center justify-center">
      <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>Backend offline</p>
    </div>
  );

  const points       = data.data_points ?? [];
  const finalValue   = points.at(-1)?.value ?? data.current_net_worth;
  const multiplier   = data.current_net_worth > 0
    ? (finalValue / data.current_net_worth).toFixed(1)
    : "—";

  return (
    <div className="flex flex-col h-full gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em]"
            style={{ color: "rgba(255,255,255,0.35)" }}>
            5-Year Forecast
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>
            8% return + ₹{(data.monthly_savings_assumed / 1000).toFixed(0)}K/mo savings
          </p>
        </div>
        <div className="text-right">
          <p className="text-[15px] font-bold tabular-nums"
            style={{ color: "#bf5af2", letterSpacing: "-0.02em" }}>
            {fmtCr(finalValue)}
          </p>
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
            {multiplier}× in 5 yrs
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0" style={{ minHeight: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#bf5af2" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#bf5af2" stopOpacity={0}   />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.05)"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={fmtCr}
              tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} />
            {/* Today reference */}
            <ReferenceLine
              x={String(points[0]?.label ?? "")}
              stroke="rgba(255,255,255,0.12)"
              strokeDasharray="4 4"
              label={{
                value: "Today",
                position: "insideTopRight",
                fill: "rgba(255,255,255,0.25)",
                fontSize: 9,
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#bf5af2"
              strokeWidth={2}
              fill="url(#forecastGrad)"
              dot={(props) => {
                const { cx, cy, index } = props;
                if (index === 0) return (
                  <circle key={`dot-${index}`} cx={cx} cy={cy} r={4}
                    fill="#bf5af2" stroke="rgba(191,90,242,0.4)" strokeWidth={4} />
                );
                return (
                  <circle key={`dot-${index}`} cx={cx} cy={cy} r={3}
                    fill="#bf5af2" stroke="none" />
                );
              }}
              activeDot={{ r: 5, fill: "#bf5af2", stroke: "rgba(191,90,242,0.4)", strokeWidth: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Assumption pills */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { label: "Now",    value: fmtCr(data.current_net_worth), color: "rgba(255,255,255,0.4)" },
          { label: "Return", value: `${data.annual_return_pct}% p.a.`, color: "#30d158" },
          { label: "Savings",value: `₹${(data.monthly_savings_assumed / 1000).toFixed(0)}K/mo`, color: "#0a84ff" },
        ].map(({ label, value, color }) => (
          <span key={label}
            className="text-[10px] px-2 py-0.5 rounded-full"
            style={{
              background: `${color}12`,
              color,
              border:     `1px solid ${color}22`,
            }}>
            {label}: <strong>{value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
