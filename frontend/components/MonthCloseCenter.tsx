"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Camera, Check, Lock, Loader2 } from "lucide-react";
import {
  MonthCloseStatus,
  captureMonthSnapshot,
  fetchCurrentMonthClose,
  updateMonthClose,
} from "@/lib/api";
import EmptyState from "@/components/EmptyState";

type EditableMonthCloseStep = "bank_statement_imported" | "balances_updated" | "investments_refreshed" | "actionables_reviewed";

function isEditableStep(key: string): key is EditableMonthCloseStep {
  return ["bank_statement_imported", "balances_updated", "investments_refreshed", "actionables_reviewed"].includes(key);
}

function money(value: number) {
  if (value >= 1_00_00_000) return `INR ${(value / 1_00_00_000).toFixed(2)}Cr`;
  if (value >= 1_00_000) return `INR ${(value / 1_00_000).toFixed(1)}L`;
  return `INR ${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default function MonthCloseCenter() {
  const [status, setStatus] = useState<MonthCloseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = () =>
    fetchCurrentMonthClose()
      .then((data) => {
        setStatus(data);
        setError(false);
        setActionError(null);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const toggle = async (key: string, value: boolean) => {
    if (!status || !isEditableStep(key)) return;
    setBusy(key);
    setActionError(null);
    try {
      setStatus(await updateMonthClose(status.month_year, { [key]: !value }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update month-close step.");
    } finally {
      setBusy(null);
    }
  };

  const snapshot = async () => {
    if (!status || !status.can_capture_snapshot) return;
    setBusy("snapshot");
    setActionError(null);
    try {
      setStatus(await captureMonthSnapshot(status.month_year));
      window.dispatchEvent(new Event("wealth-updated"));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not capture month snapshot.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={18} className="animate-spin" style={{ color: "#30d158" }} />
      </div>
    );
  }

  if (error || !status) {
    return <EmptyState title="Month close unavailable" detail="The backend month-close endpoint is not reachable." />;
  }

  const complete = status.status === "Closed";

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.35)" }}>
            Month Close
          </p>
          <p className="mt-1 text-[12px]" style={{ color: "rgba(255,255,255,0.36)" }}>
            {status.month_year} - quality {status.data_quality_score}/100
          </p>
        </div>
        <span
          className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold"
          style={{
            background: complete ? "rgba(48,209,88,0.13)" : status.due ? "rgba(255,69,58,0.13)" : "rgba(255,159,10,0.13)",
            border: `1px solid ${complete ? "rgba(48,209,88,0.28)" : status.due ? "rgba(255,69,58,0.28)" : "rgba(255,159,10,0.28)"}`,
            color: complete ? "#30d158" : status.due ? "#ff453a" : "#ff9f0a",
          }}
        >
          {!complete && <AlertTriangle size={12} />}
          {complete ? "Closed" : status.due ? "Due now" : "Open"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          ["Net Worth", money(status.metrics.net_worth)],
          ["Income", money(status.metrics.income)],
          ["Savings", money(status.metrics.savings)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl px-2.5 py-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-[9.5px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.28)" }}>{label}</p>
            <p className="mt-0.5 text-[12px] font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.72)" }}>{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.42)" }}>
            Month-end ingestion
          </p>
          <span className="text-[10px] font-semibold" style={{ color: status.can_capture_snapshot ? "#30d158" : "#ff9f0a" }}>
            {status.can_capture_snapshot ? "Ready to snapshot" : "Snapshot locked"}
          </span>
        </div>
        <p className="mt-1 text-[11.5px] leading-snug" style={{ color: "rgba(255,255,255,0.36)" }}>
          Complete the required inputs once a month. The snapshot becomes the source of truth for trends and forecasts.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {status.required_steps.map((step, index) => {
          const done = Boolean(step.done);
          return (
            <li key={step.key}>
              <button
                disabled={busy !== null}
                onClick={() => toggle(step.key, done)}
                className="flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left"
                style={{
                  background: done ? "rgba(48,209,88,0.08)" : "rgba(255,255,255,0.035)",
                  border: `1px solid ${done ? "rgba(48,209,88,0.18)" : "rgba(255,255,255,0.06)"}`,
                }}
              >
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: done ? "rgba(48,209,88,0.14)" : "rgba(255,255,255,0.06)", color: done ? "#30d158" : "rgba(255,255,255,0.38)" }}
                >
                  {busy === step.key ? <Loader2 size={12} className="animate-spin" /> : done ? <Check size={12} /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-[12px] font-semibold" style={{ color: done ? "rgba(255,255,255,0.76)" : "rgba(255,255,255,0.56)" }}>
                    {step.label}
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wide"
                      style={{
                        background: step.required ? "rgba(255,159,10,0.11)" : "rgba(10,132,255,0.1)",
                        color: step.required ? "#ff9f0a" : "#0a84ff",
                      }}
                    >
                      {step.required ? "Required" : "Optional"}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug" style={{ color: "rgba(255,255,255,0.34)" }}>{step.why}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {status.missing.length > 0 && (
        <div className="rounded-xl px-3 py-2" style={{ background: "rgba(255,159,10,0.07)", border: "1px solid rgba(255,159,10,0.14)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#ff9f0a" }}>Missing</p>
          <p className="mt-1 text-[11.5px] leading-snug" style={{ color: "rgba(255,255,255,0.45)" }}>{status.missing.join(" ")}</p>
        </div>
      )}

      {actionError && (
        <div className="rounded-xl px-3 py-2" style={{ background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.16)" }}>
          <p className="text-[11.5px] leading-snug" style={{ color: "#ff6961" }}>{actionError}</p>
        </div>
      )}

      <button
        onClick={snapshot}
        disabled={busy !== null || !status.can_capture_snapshot}
        className="mt-auto flex items-center justify-center gap-2 rounded-2xl py-2.5 text-[13px] font-semibold"
        style={{
          background: status.can_capture_snapshot ? "rgba(10,132,255,0.16)" : "rgba(255,255,255,0.045)",
          border: `1px solid ${status.can_capture_snapshot ? "rgba(10,132,255,0.28)" : "rgba(255,255,255,0.08)"}`,
          color: status.can_capture_snapshot ? "#0a84ff" : "rgba(255,255,255,0.36)",
        }}
      >
        {busy === "snapshot" ? <Loader2 size={14} className="animate-spin" /> : status.can_capture_snapshot ? <Camera size={14} /> : <Lock size={14} />}
        {status.can_capture_snapshot ? "Capture Month Snapshot" : "Complete Required Inputs"}
      </button>
    </div>
  );
}
