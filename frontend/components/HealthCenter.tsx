"use client";

import { useEffect, useState } from "react";
import {
  AreaChart, Area, Tooltip, YAxis,
} from "recharts";
import { fetchHealthMetrics, fetchMedical, HealthMetricsData, MedicalData } from "@/lib/api";
import EmptyState from "@/components/EmptyState";
import SafeResponsiveContainer from "@/components/SafeResponsiveContainer";

// Overall status pill styles
const STATUS_STYLE: Record<string, { color: string; bg: string; border: string; label: string }> = {
  optimal:  { color: "#30d158", bg: "rgba(48,209,88,0.12)",   border: "rgba(48,209,88,0.28)",   label: "Optimal"  },
  warning:  { color: "#ff9f0a", bg: "rgba(255,159,10,0.12)",  border: "rgba(255,159,10,0.28)",  label: "Warning"  },
  critical: { color: "#ff453a", bg: "rgba(255,69,58,0.12)",   border: "rgba(255,69,58,0.28)",   label: "Critical" },
};

// Tooltip for the sparkline
const SparkTooltip = ({
  active, payload,
}: {
  active?: boolean;
  payload?: { value: number; payload: { date: string } }[];
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background:   "rgba(22,22,26,0.95)",
      border:       "1px solid rgba(255,255,255,0.1)",
      borderRadius: 8,
      padding:      "5px 9px",
    }}>
      <p style={{ color: "#0a84ff", fontSize: 11, fontWeight: 600, margin: 0 }}>
        {payload[0].value.toLocaleString()} steps
      </p>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, margin: "2px 0 0" }}>
        {payload[0].payload.date}
      </p>
    </div>
  );
};

function StatPill({ label, value, unit, color }: {
  label: string; value: string | number; unit?: string; color: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <span className="text-[9.5px] uppercase tracking-wide"
        style={{ color: "rgba(255,255,255,0.28)" }}>{label}</span>
      <span className="text-[13px] font-bold tabular-nums" style={{ color }}>
        {value}{unit && <span className="text-[10px] font-normal ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

export default function HealthCenter() {
  const [metrics, setMetrics] = useState<HealthMetricsData | null>(null);
  const [medical, setMedical] = useState<MedicalData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchHealthMetrics(10).catch(() => null),
      fetchMedical().catch(() => null),
    ]).then(([m, med]) => {
      setMetrics(m);
      setMedical(med);
      setLoading(false);
    });
  }, []);

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <div className="w-4 h-4 rounded-full border-2 animate-spin"
        style={{ borderColor: "rgba(10,132,255,0.3)", borderTopColor: "#0a84ff" }} />
    </div>
  );

  const overallKey = (medical?.overall ?? "optimal") as keyof typeof STATUS_STYLE;
  const status = STATUS_STYLE[overallKey] ?? STATUS_STYLE.optimal;

  // Sparkline data: last 10 days step counts
  const sparkData = (metrics?.records ?? []).map((r) => ({
    date:  r.date,
    steps: r.steps ?? 0,
  }));

  if (!medical && sparkData.length === 0) {
    return (
      <EmptyState
        title="No health data yet"
        detail="Seed sample data or import health metrics and medical summaries to make this card useful."
      />
    );
  }

  return (
    <div className="flex flex-col h-full gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em]"
          style={{ color: "rgba(255,255,255,0.35)" }}>
          Health
        </p>
        {medical && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: status.bg, color: status.color, border: `1px solid ${status.border}` }}>
            {status.label}
          </span>
        )}
      </div>

      {/* Medical summary */}
      {medical?.summary && (
        <p className="text-[12px] leading-relaxed"
          style={{ color: "rgba(255,255,255,0.5)" }}>
          {medical.summary}
        </p>
      )}

      {/* Action items */}
      {(medical?.action_items?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1">
          {medical!.action_items.slice(0, 2).map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="w-1 h-1 rounded-full mt-1.5 shrink-0"
                style={{ background: status.color }} />
              <span className="text-[11.5px] leading-snug"
                style={{ color: "rgba(255,255,255,0.45)" }}>
                {item}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="h-px shrink-0" style={{ background: "rgba(255,255,255,0.06)" }} />

      {/* Steps sparkline */}
      {sparkData.length > 0 && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.1em] mb-1.5"
            style={{ color: "rgba(255,255,255,0.25)" }}>
            Daily Steps - 10 days
          </p>
          <div style={{ height: 52 }}>
            <SafeResponsiveContainer>
              <AreaChart data={sparkData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="stepsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#0a84ff" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#0a84ff" stopOpacity={0}    />
                  </linearGradient>
                </defs>
                <YAxis hide domain={["auto", "auto"]} />
                <Tooltip content={<SparkTooltip />} />
                <Area
                  type="monotone"
                  dataKey="steps"
                  stroke="#0a84ff"
                  strokeWidth={1.5}
                  fill="url(#stepsGrad)"
                  dot={false}
                  activeDot={{ r: 3, fill: "#0a84ff", stroke: "none" }}
                />
              </AreaChart>
            </SafeResponsiveContainer>
          </div>
        </div>
      )}

      {/* Avg stats row */}
      {metrics && (
        <div className="grid grid-cols-3 gap-1.5 mt-auto">
          <StatPill
            label="Avg Steps"
            value={metrics.avg_steps >= 1000
              ? `${(metrics.avg_steps / 1000).toFixed(1)}k`
              : metrics.avg_steps}
            color="#0a84ff"
          />
          <StatPill
            label="Sleep"
            value={metrics.avg_sleep.toFixed(1)}
            unit="h"
            color="#bf5af2"
          />
          <StatPill
            label="Resting HR"
            value={metrics.avg_hr > 0 ? Math.round(metrics.avg_hr) : "—"}
            unit={metrics.avg_hr > 0 ? "bpm" : undefined}
            color="#ff375f"
          />
        </div>
      )}
    </div>
  );
}
