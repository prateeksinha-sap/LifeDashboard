"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Lock, Unlock } from "lucide-react";
import { fetchCurrentMonthClose, MonthCloseStatus } from "@/lib/api";
import EmptyState from "@/components/EmptyState";

export default function MonthCloseSummary() {
  const [status, setStatus] = useState<MonthCloseStatus | null>(null);
  const [error, setError] = useState(false);

  const load = () => fetchCurrentMonthClose()
    .then((data) => {
      setStatus(data);
      setError(false);
    })
    .catch(() => setError(true));

  useEffect(() => {
    load();
    window.addEventListener("wealth-updated", load);
    return () => window.removeEventListener("wealth-updated", load);
  }, []);

  if (error) return <EmptyState title="Month close unavailable" detail="The backend month-close endpoint is not reachable." />;
  if (!status) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "rgba(255,159,10,0.25)", borderTopColor: "#ff9f0a" }} />
      </div>
    );
  }

  const complete = status.status === "Closed";
  const required = status.required_steps.filter((step) => step.required);
  const doneRequired = required.filter((step) => step.done).length;
  const progress = required.length ? Math.round((doneRequired / required.length) * 100) : 100;
  const tone = complete ? "#30d158" : status.due ? "#ff453a" : "#ff9f0a";
  const snapshotCaptured = Boolean(status.checklist.snapshot_captured);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>
            Month Close
          </p>
          <p className="mt-1 text-[11px]" style={{ color: "rgba(255,255,255,0.32)" }}>
            {status.month_year} data completeness
          </p>
        </div>
        <span className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold" style={{ background: `${tone}18`, border: `1px solid ${tone}42`, color: tone }}>
          {complete ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
          {complete ? "Closed" : status.due ? "Due now" : "Open"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          ["Quality", `${status.data_quality_score}/100`, tone],
          ["Required", `${doneRequired}/${required.length}`, progress === 100 ? "#30d158" : "#ff9f0a"],
          ["Snapshot", snapshotCaptured ? "Captured" : status.can_capture_snapshot ? "Ready" : "Locked", status.can_capture_snapshot ? "#30d158" : "#ff9f0a"],
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-lg px-2.5 py-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-[9.5px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.28)" }}>{label}</p>
            <p className="mt-0.5 text-[12px] font-bold tabular-nums" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.3)" }}>
          <span>Monthly readiness</span>
          <span style={{ color: tone }}>{progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div className="h-full rounded-full" style={{ width: `${progress}%`, background: tone }} />
        </div>
      </div>

      <ul className="grid gap-1.5">
        {status.required_steps.slice(0, 4).map((step) => {
          const done = Boolean(step.done);
          return (
            <li key={step.key} className="flex items-center gap-2 text-[11px]" style={{ color: done ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.42)" }}>
              {done ? <CheckCircle2 size={12} style={{ color: "#30d158" }} /> : <Circle size={12} style={{ color: "rgba(255,255,255,0.24)" }} />}
              <span className="min-w-0 flex-1 truncate">{step.label}</span>
              {step.required && !done && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style={{ background: "rgba(255,159,10,0.12)", color: "#ff9f0a" }}>Required</span>}
            </li>
          );
        })}
      </ul>

      <p className="mt-auto flex items-center gap-1 text-[10.5px]" style={{ color: "rgba(255,255,255,0.34)" }}>
        {status.can_capture_snapshot ? <Unlock size={11} /> : <Lock size={11} />}
        Use Data Setup for imports and month-end snapshot capture.
      </p>
    </div>
  );
}
