"use client";

import { useEffect, useRef, useState } from "react";
import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip } from "chart.js";
import { TrendingUp } from "lucide-react";
import { fetchWealth, WealthData } from "@/lib/api";

ChartJS.register(ArcElement, Tooltip);

function formatNetWorth(value: number): string {
  if (value >= 1_00_00_000) return `₹${(value / 1_00_00_000).toFixed(2)}Cr`;
  if (value >= 1_00_000)    return `₹${(value / 1_00_000).toFixed(2)}L`;
  if (value >= 1_000)       return `₹${(value / 1_000).toFixed(1)}K`;
  return `₹${value.toFixed(0)}`;
}

export default function WealthCenter() {
  const [data,         setData]        = useState<WealthData | null>(null);
  const [displayValue, setDisplayValue] = useState(0);
  const [error,        setError]        = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadWealth = () => {
    fetchWealth()
      .then((d) => { setData(d); setError(false); })
      .catch(() => setError(true));
  };

  useEffect(() => {
    loadWealth();
    window.addEventListener("wealth-updated", loadWealth);
    return () => window.removeEventListener("wealth-updated", loadWealth);
  }, []);

  // Count-up once data arrives
  useEffect(() => {
    if (!data) return;
    const target = data.total_net_worth;
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
  }, [data]);

  if (error) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-2">
        <p className="text-[13px]" style={{ color: "rgba(255,255,255,0.35)" }}>
          Backend offline
        </p>
        <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>
          Run: uvicorn main:app --reload
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "rgba(191,90,242,0.4)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  const chartData = {
    labels: data.slices.map((s) => s.label),
    datasets: [{
      data:            data.slices.map((s) => s.percentage),
      backgroundColor: data.slices.map((s) => s.color),
      borderColor:     "transparent",
      hoverOffset:     10,
    }],
  };

  const chartOptions = {
    cutout: "72%",
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(28,28,30,0.95)",
        borderColor:     "rgba(255,255,255,0.08)",
        borderWidth:     1,
        titleColor:      "rgba(255,255,255,0.9)",
        bodyColor:       "rgba(255,255,255,0.55)",
        padding:         10,
        callbacks: {
          label: (ctx: { label: string; parsed: number }) =>
            `  ${ctx.label}  ${ctx.parsed.toFixed(1)}%`,
        },
      },
    },
    animation: { animateRotate: true, duration: 1000 },
  };

  const totalAssets = data.mf_count + data.stock_count + data.slices.length;

  return (
    <div className="flex flex-col h-full gap-5">

      {/* ── Header ── */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] mb-2"
          style={{ color: "rgba(255,255,255,0.35)" }}>
          Total Net Worth
        </p>

        <p className="tabular-nums"
          style={{
            fontFamily: "-apple-system, 'SF Pro Display', var(--font-inter-var), sans-serif",
            fontSize:   "clamp(2rem, 3.5vw, 2.75rem)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "rgba(255,255,255,0.95)",
            lineHeight: 1.1,
          }}>
          {formatNetWorth(displayValue)}
        </p>

        <div className="flex items-center gap-2 mt-2">
          <span className="flex items-center gap-1 text-[12px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: "rgba(48,209,88,0.12)",
              color:      "#30d158",
              border:     "1px solid rgba(48,209,88,0.2)",
            }}>
            <TrendingUp size={11} strokeWidth={2.5} />
            Live
          </span>
          <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.28)" }}>
            {data.mf_count} MF · {data.stock_count} stocks · {data.slices.length} categories
          </span>
        </div>
      </div>

      <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />

      {/* ── Donut chart ── */}
      <div className="relative flex justify-center items-center shrink-0" style={{ height: 196 }}>
        <Doughnut data={chartData} options={chartOptions} />

        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-0.5">
          <span className="text-[11px] font-medium uppercase tracking-widest"
            style={{ color: "rgba(255,255,255,0.28)" }}>
            Portfolio
          </span>
          <span className="text-xl font-bold tabular-nums"
            style={{
              color:      "rgba(255,255,255,0.9)",
              fontFamily: "-apple-system, var(--font-inter-var), sans-serif",
              letterSpacing: "-0.02em",
            }}>
            {data.slices.length} assets
          </span>
        </div>
      </div>

      {/* ── Legend ── */}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-3 mt-auto">
        {data.slices.map((slice) => (
          <li key={slice.label} className="flex items-center gap-2.5">
            <span className="shrink-0 w-2 h-2 rounded-full"
              style={{
                background: slice.color,
                boxShadow:  `0 0 6px ${slice.color}88`,
              }} />
            <span className="text-[13px] flex-1 truncate"
              style={{ color: "rgba(255,255,255,0.55)" }}>
              {slice.label}
            </span>
            <span className="text-[13px] font-semibold tabular-nums"
              style={{ color: slice.color }}>
              {slice.percentage.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
