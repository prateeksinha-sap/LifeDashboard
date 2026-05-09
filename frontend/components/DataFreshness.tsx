"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { DatabaseZap, Folder, Loader2, Mail, RefreshCw } from "lucide-react";
import {
  AutomationStatus,
  fetchAutomationStatus,
  fetchIngestionStatus,
  IngestionStatus,
  runAutomationNow,
} from "@/lib/api";
import EmptyState from "@/components/EmptyState";

function fmtTime(value?: string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function tone(score: number): string {
  if (score >= 80) return "#30d158";
  if (score >= 60) return "#ff9f0a";
  return "#ff453a";
}

function shortGmailError(value?: string | null): string {
  if (!value) return "";
  const lower = value.toLowerCase();
  if (lower.includes("invalid_grant") || lower.includes("expired or revoked")) return "Reconnect Gmail";
  if (lower.includes("oauth2.googleapis.com")) return "Google OAuth unreachable";
  if (lower.includes("timeout")) return "Sync timed out";
  if (lower.includes("credentials") || lower.includes("token")) return "Reconnect Gmail";
  return "Sync failed";
}

function SourcePill({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  const color = ok ? "#30d158" : "#ff9f0a";
  return (
    <div className="min-w-0 rounded-lg px-2.5 py-1.5" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-semibold" style={{ color: "rgba(255,255,255,0.72)" }}>{label}</p>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}66` }} />
      </div>
      <p className="mt-0.5 truncate text-[10px]" style={{ color: "rgba(255,255,255,0.32)" }}>{detail}</p>
    </div>
  );
}

function ActivityPill({
  icon,
  label,
  time,
  status,
  color,
  title,
}: {
  icon: ReactNode;
  label: string;
  time: string;
  status: string;
  color: string;
  title?: string;
}) {
  return (
    <div
      className="min-w-0 rounded-lg px-2.5 py-2"
      title={title || status}
      style={{
        background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.025))",
        border: "1px solid rgba(255,255,255,0.075)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 truncate text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
          <span className="shrink-0">{icon}</span>
          <span className="truncate">{label}</span>
        </p>
        <p className="shrink-0 text-[9.5px] tabular-nums" style={{ color: "rgba(255,255,255,0.34)" }}>
          {time}
        </p>
      </div>
      <p className="mt-1 truncate text-[10.5px] leading-snug" style={{ color: "rgba(255,255,255,0.6)" }}>
        {status}
      </p>
    </div>
  );
}

export default function DataFreshness() {
  const [ingestion, setIngestion] = useState<IngestionStatus | null>(null);
  const [automation, setAutomation] = useState<AutomationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const load = () => Promise.all([fetchIngestionStatus(), fetchAutomationStatus()])
    .then(([ingestionStatus, automationStatus]) => {
      setIngestion(ingestionStatus);
      setAutomation(automationStatus);
      setError("");
    })
    .catch((err) => setError(err instanceof Error ? err.message : "Could not load data freshness."))
    .finally(() => setLoading(false));

  useEffect(() => {
    load();
    window.addEventListener("wealth-updated", load);
    window.addEventListener("gmail-synced", load);
    return () => {
      window.removeEventListener("wealth-updated", load);
      window.removeEventListener("gmail-synced", load);
    };
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      await runAutomationNow();
      await load();
      window.dispatchEvent(new Event("gmail-synced"));
      window.dispatchEvent(new Event("wealth-updated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Automation failed.");
    } finally {
      setRunning(false);
    }
  };

  const coreSources = useMemo(() => {
    const byKey = new Map((ingestion?.sources ?? []).map((source) => [source.key, source]));
    return [
      byKey.get("bank"),
      byKey.get("stocks"),
      byKey.get("mutual_funds"),
      byKey.get("snapshots"),
    ].filter(Boolean);
  }, [ingestion]);

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "rgba(48,209,88,0.25)", borderTopColor: "#30d158" }} />
    </div>
  );
  if (error && !ingestion) return <EmptyState title="Data status unavailable" detail={error} />;

  const score = ingestion?.quality_score ?? 0;
  const color = tone(score);
  const gmailReconnectRequired = Boolean(automation?.gmail.reconnect_required);
  const gmailReady = Boolean(automation?.gmail.configured && automation.gmail.authorized && !gmailReconnectRequired);
  const autoOn = Boolean(automation?.enabled);
  const gmailResult = automation?.gmail.last_result;
  const gmailError = automation?.gmail.last_error;
  const gmailIssueCount = gmailResult?.errors ?? 0;
  const gmailStatusText = gmailError
    ? shortGmailError(gmailError)
    : gmailIssueCount > 0
      ? `${gmailIssueCount} extraction errors`
      : gmailResult
        ? `${gmailResult.candidates ?? 0} candidates · ${gmailResult.actionables_created ?? 0} actions · ${gmailResult.bills_created ?? 0} bills`
        : "Ready";
  const gmailTone = gmailError || gmailIssueCount > 0 ? "#ff453a" : "#64d2ff";
  const gmailDetail = gmailError
    ? gmailError
    : gmailResult
      ? `${gmailResult.processed ?? 0} processed, ${gmailResult.skipped_unimportant ?? 0} skipped`
      : "Ready for current plus previous month sync, then deltas.";
  const fileIngestion = automation?.ingestion;
  const fileIngestionError = fileIngestion?.last_error;
  const fileIngestionTone = fileIngestionError ? "#ff453a" : "#30d158";
  const fileIngestionStatus = fileIngestionError || (fileIngestion?.auto_import ? "Auto-importing safe files" : "Staging files for review");

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>
            <DatabaseZap size={12} /> Data Freshness
          </p>
          <p className="mt-0.5 truncate text-[11px]" style={{ color: "rgba(255,255,255,0.34)" }}>
            Auto {autoOn ? "on" : "off"} | Gmail {gmailReconnectRequired ? "reconnect" : gmailReady ? "authorized" : "not connected"} | Files {fileIngestion?.enabled ? "auto" : "manual"} | Stocks/MF {automation?.investments.interval_hours ?? 24}h
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runNow()}
          disabled={running}
          className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: "rgba(10,132,255,0.14)", color: "#0a84ff", border: "1px solid rgba(10,132,255,0.24)" }}
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Run
        </button>
      </div>

      <div className="rounded-lg p-2" style={{ background: `${color}0f`, border: `1px solid ${color}24` }}>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.36)" }}>Trust score</p>
            <p className="text-2xl font-bold tabular-nums leading-tight" style={{ color }}>{score}/100</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold" style={{ color: "rgba(255,255,255,0.72)" }}>
              {ingestion?.required_ready ?? 0}/{ingestion?.required_total ?? 0} required ready
            </p>
            <p className="mt-1 text-[10px]" style={{ color: "rgba(255,255,255,0.34)" }}>
              Last automation: {fmtTime(automation?.last_run)}
            </p>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div className="h-full rounded-full" style={{ width: `${Math.max(4, score)}%`, background: color }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {coreSources.map((source) => (
          <SourcePill
            key={source!.key}
            label={source!.label}
            ok={source!.status === "ready" && source!.current_month_ready !== false}
            detail={source!.age_days != null ? `${source!.age_days}d old` : source!.status}
          />
        ))}
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2">
        <ActivityPill
          icon={<Mail size={12} />}
          label="Gmail"
          time={fmtTime(automation?.gmail.last_sync)}
          status={gmailStatusText}
          color={gmailTone}
          title={gmailDetail}
        />
        <ActivityPill
          icon={<Folder size={12} />}
          label="Files"
          time={fmtTime(fileIngestion?.last_scan)}
          status={fileIngestionStatus}
          color={fileIngestionTone}
          title={fileIngestion?.drop_folder || fileIngestionStatus}
        />
      </div>

    </div>
  );
}
