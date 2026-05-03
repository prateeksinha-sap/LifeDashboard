"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchWealth, WealthData, WealthSlice } from "@/lib/api";
import EmptyState from "@/components/EmptyState";

function money(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_00_00_000) return `${sign}INR ${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}INR ${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}INR ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}INR ${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function shortMoney(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_00_00_000) return `${sign}${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function percent(value: number): string {
  if (value < 1 && value > 0) return "<1%";
  return `${value.toFixed(0)}%`;
}

function allocationMessage(largest?: WealthSlice) {
  if (!largest) return "No allocation data yet";
  if (largest.percentage >= 50) return `${largest.label} concentration needs attention`;
  if (largest.percentage >= 35) return `${largest.label} is the largest driver`;
  return "Allocation is reasonably spread";
}

function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.46)" }}>
        {title}
      </p>
      {detail && (
        <p className="truncate text-[10px] font-medium tabular-nums" style={{ color: "rgba(255,255,255,0.34)" }}>
          {detail}
        </p>
      )}
    </div>
  );
}

function AllocationRow({ slice, total }: { slice: WealthSlice; total: number }) {
  const width = total > 0 ? Math.max((slice.value / total) * 100, 1) : 0;

  return (
    <div className="rounded-md px-2.5 py-1.5" style={{ background: "rgba(255,255,255,0.026)" }}>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
          <span className="truncate text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.76)" }}>
            {slice.label}
          </span>
        </div>
        <span className="text-[12px] font-semibold tabular-nums" style={{ color: "rgba(255,255,255,0.78)" }}>
          {shortMoney(slice.value)}
        </span>
        <span className="w-10 text-right text-[11px] font-semibold tabular-nums" style={{ color: slice.color }}>
          {percent(slice.percentage)}
        </span>
      </div>
      <span className="sr-only">{width.toFixed(1)} percent of total net worth</span>
    </div>
  );
}

export default function WealthCenter() {
  const [wealth, setWealth] = useState<WealthData | null>(null);
  const [error, setError] = useState(false);

  const loadWealth = () => {
    fetchWealth()
      .then((data) => {
        setWealth(data);
        setError(false);
      })
      .catch(() => setError(true));
  };

  useEffect(() => {
    loadWealth();
    window.addEventListener("wealth-updated", loadWealth);
    return () => window.removeEventListener("wealth-updated", loadWealth);
  }, []);

  if (error) {
    return <EmptyState title="Wealth unavailable" detail="Check that the backend is running." />;
  }

  if (!wealth) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2" style={{ borderColor: "rgba(191,90,242,0.3)", borderTopColor: "#bf5af2" }} />
      </div>
    );
  }

  const sourceRows = [...(wealth.slices ?? [])].filter((slice) => slice.value > 0).sort((a, b) => b.value - a.value);
  const classRows = [...(wealth.asset_type_slices ?? [])].filter((slice) => slice.value > 0).sort((a, b) => b.value - a.value);
  const largest = sourceRows[0];

  if (wealth.total_net_worth <= 0 && sourceRows.length === 0) {
    return (
      <EmptyState
        title="No wealth data yet"
        detail="Import stocks and CAS, then add cash, FD, PF, PPF, NPS, gold and real estate in Data Setup."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.52)" }}>
            Wealth Allocation
          </p>
          <p className="mt-1 truncate text-[10.5px]" style={{ color: "rgba(255,255,255,0.36)" }}>
            {sourceRows.length} populated asset groups
          </p>
        </div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(48,209,88,0.12)", color: "#30d158", border: "1px solid rgba(48,209,88,0.25)" }}>
          Live
        </span>
      </div>

      <div className="shrink-0 rounded-lg p-3.5" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.28)" }}>
              Concentration
            </p>
            <p className="mt-1.5 truncate text-[14px] font-bold leading-snug" style={{ color: "rgba(255,255,255,0.86)" }}>
              {allocationMessage(largest)}
            </p>
          </div>
          {largest && (
            <div className="max-w-[148px] shrink-0 rounded-md px-2 py-1.5 text-right" style={{ background: `${largest.color}18`, border: `1px solid ${largest.color}30` }}>
              <p className="text-[9px] font-semibold uppercase tracking-[0.08em]" style={{ color: "rgba(255,255,255,0.42)" }}>Largest bucket</p>
              <p className="mt-0.5 truncate text-[11px] font-bold" style={{ color: largest.color }}>
                {largest.label} {percent(largest.percentage)}
              </p>
            </div>
          )}
        </div>

        <div className="mt-3.5 flex h-2.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
          {sourceRows.map((slice) => (
            <div
              key={slice.label}
              title={`${slice.label}: ${money(slice.value)} (${slice.percentage.toFixed(1)}%)`}
              style={{ width: `${Math.max(slice.percentage, 0.8)}%`, background: slice.color }}
            />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg p-3" style={{ background: "rgba(0,0,0,0.12)", border: "1px solid rgba(255,255,255,0.045)" }}>
        <SectionTitle title="Asset Accounts" detail={`${sourceRows.length} groups`} />
        <div className="mt-2 grid content-start gap-1">
          {sourceRows.map((slice) => (
            <AllocationRow key={slice.label} slice={slice} total={wealth.total_net_worth} />
          ))}
        </div>
      </div>

      <div className="shrink-0 rounded-lg p-3" style={{ background: "rgba(255,255,255,0.026)", border: "1px solid rgba(255,255,255,0.055)" }}>
        <SectionTitle title="Asset Class Split" detail="risk view" />
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {classRows.map((slice) => (
            <Link
              key={slice.label}
              href={slice.label === "Equity" ? "/equity-allocation" : "#"}
              aria-label={slice.label === "Equity" ? "Open equity allocation drill-down" : `${slice.label} allocation`}
              onClick={(event) => {
                if (slice.label !== "Equity") event.preventDefault();
              }}
              className={`min-w-0 rounded-md px-2.5 py-1.5 transition ${slice.label === "Equity" ? "cursor-pointer hover:brightness-125" : "cursor-default"}`}
              style={{ background: `${slice.color}10`, border: `1px solid ${slice.color}20` }}
              title={slice.label === "Equity" ? "View large, mid and small-cap allocation" : undefined}
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: slice.color }} />
                  <span className="truncate text-[10.5px] font-semibold" style={{ color: "rgba(255,255,255,0.72)" }}>
                    {slice.label}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] font-semibold tabular-nums" style={{ color: slice.color }}>
                  {percent(slice.percentage)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.8)" }}>
                {shortMoney(slice.value)}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
