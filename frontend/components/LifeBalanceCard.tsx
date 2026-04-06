"use client";

import { useEffect, useState } from "react";
import { fetchLifeLog, LifeLogData } from "@/lib/api";

const CATEGORY_META: Record<string, { color: string; icon: string }> = {
  Work:       { color: "#0a84ff", icon: "💼" },
  Upskilling: { color: "#bf5af2", icon: "🎯" },
  Leisure:    { color: "#30d158", icon: "🎸" },
  Family:     { color: "#ff9f0a", icon: "🏠" },
  Health:     { color: "#ff375f", icon: "🏸" },
};

// Fallback color for unknown categories
const DEFAULT_COLOR = "#8e8e93";

export default function LifeBalanceCard() {
  const [data,    setData]    = useState<LifeLogData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLifeLog(7)
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
      <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>No data</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em]"
          style={{ color: "rgba(255,255,255,0.35)" }}>
          Life Balance
        </p>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
          style={{
            background: "rgba(48,209,88,0.1)",
            color:      "#30d158",
            border:     "1px solid rgba(48,209,88,0.2)",
          }}>
          {data.days}d · {data.total_hours.toFixed(0)}h
        </span>
      </div>

      {/* Category bars */}
      <div className="flex flex-col gap-2.5">
        {data.categories.map((cat) => {
          const meta  = CATEGORY_META[cat.category] ?? { color: DEFAULT_COLOR, icon: "●" };
          const pct   = Math.min(cat.percentage, 100);
          const hours = cat.hours.toFixed(1);
          return (
            <div key={cat.category}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px]">{meta.icon}</span>
                  <span className="text-[12px] font-medium"
                    style={{ color: "rgba(255,255,255,0.65)" }}>
                    {cat.category}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] tabular-nums font-semibold"
                    style={{ color: meta.color }}>
                    {pct.toFixed(0)}%
                  </span>
                  <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                    {hours}h
                  </span>
                </div>
              </div>

              {/* Progress track */}
              <div className="h-1.5 rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.07)" }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width:      `${pct}%`,
                    background: `linear-gradient(90deg, ${meta.color}cc, ${meta.color})`,
                    boxShadow:  `0 0 6px ${meta.color}55`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Divider */}
      <div className="h-px shrink-0 mt-auto" style={{ background: "rgba(255,255,255,0.06)" }} />

      {/* Top subcategories */}
      <div className="flex flex-wrap gap-1.5">
        {data.subcategories.slice(0, 5).map((s) => {
          // Find parent color
          const parentCat = data.categories.find((c) =>
            s.label.toLowerCase().includes(c.category.toLowerCase()) ||
            c.category.toLowerCase().includes(s.label.toLowerCase())
          );
          const color = parentCat
            ? (CATEGORY_META[parentCat.category]?.color ?? DEFAULT_COLOR)
            : DEFAULT_COLOR;
          return (
            <span key={s.label}
              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{
                background: `${color}14`,
                color:      `${color}cc`,
                border:     `1px solid ${color}25`,
              }}>
              {s.label} · {(s.minutes / 60).toFixed(1)}h
            </span>
          );
        })}
      </div>
    </div>
  );
}
