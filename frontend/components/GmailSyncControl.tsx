"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader, MailCheck, Upload } from "lucide-react";
import {
  fetchGmailStatus,
  GmailStatus,
  runGmailSync,
  uploadGmailCredentials,
} from "@/lib/api";

function fmtSyncTime(value?: string | null) {
  if (!value) return "Never synced";
  const date = new Date(value);
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function GmailSyncControl() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadStatus = () =>
    fetchGmailStatus()
      .then(setStatus)
      .catch((err) => setMessage(err instanceof Error ? err.message : "Could not check Gmail sync."));

  useEffect(() => { loadStatus(); }, []);

  const onCredentials = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      setStatus(await uploadGmailCredentials(file));
      setMessage("Credentials saved. Connect & Sync when ready.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save credentials.");
    } finally {
      setBusy(false);
    }
  };

  const onSync = async () => {
    setBusy(true);
    setMessage("");
    try {
      const mode = status?.initial_backfill_done ? "delta" : "full_month";
      const result = await runGmailSync(168, mode, mode === "full_month" ? 300 : 160);
      const scanned = result.candidates ?? result.processed;
      setMessage(`${mode === "full_month" ? "Initial current plus previous month sync" : "Delta sync"} scanned ${scanned} important emails, skipped ${result.skipped_unimportant ?? 0}, created ${result.actionables_created} actions and ${result.bills_created ?? 0} bills.`);
      await loadStatus();
      window.dispatchEvent(new Event("gmail-synced"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Gmail sync failed.");
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const ready = Boolean(status?.configured && status?.deps_ready);
  const synced = Boolean(status?.last_sync && !status?.last_error);
  const reconnectRequired = Boolean(
    status?.reconnect_required ||
    status?.last_error?.toLowerCase().includes("invalid_grant") ||
    status?.last_error?.toLowerCase().includes("expired or revoked"),
  );
  const panelColor = reconnectRequired ? "#ff453a" : synced ? "#30d158" : "#0a84ff";
  const buttonLabel = reconnectRequired
    ? "Reconnect Gmail"
    : status?.authorized
      ? (status.initial_backfill_done ? "Sync Gmail" : "Initial Sync")
      : "Connect Gmail";

  return (
    <div className="rounded-lg p-3" style={{ background: `${panelColor}0f`, border: `1px solid ${panelColor}24` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {synced && !reconnectRequired ? <CheckCircle2 size={13} style={{ color: "#30d158" }} /> : <MailCheck size={13} style={{ color: panelColor }} />}
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.48)" }}>
              Gmail Sync
            </p>
          </div>
          <p className="mt-1 text-[12px] font-semibold leading-snug" style={{ color: reconnectRequired ? "#ff9f9a" : "rgba(255,255,255,0.72)" }}>
            {reconnectRequired ? "Your saved Google authorization was revoked. Reconnect Gmail once." : status?.next_step ?? "Checking Gmail connection..."}
          </p>
          <p className="mt-1 text-[11px] leading-snug" style={{ color: "rgba(255,255,255,0.42)" }}>
            {reconnectRequired
              ? "Click Reconnect Gmail. A Google sign-in window should open; approve read-only Gmail access, then return here."
              : "This reads Gmail through Google OAuth and extracts bills/action items into the dashboard."}
          </p>
          {status?.last_sync && (
            <p className="mt-1 text-[10px]" style={{ color: "rgba(255,255,255,0.28)" }}>
              Last: {fmtSyncTime(status.last_sync)}
              {status.last_mode ? ` | ${status.last_mode.replace("_", " ")}` : ""}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onCredentials} />
          {!status?.configured && (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold"
              style={{ background: "rgba(255,255,255,0.06)", color: "#0a84ff", border: "1px solid rgba(10,132,255,0.25)" }}
            >
            <Upload size={10} /> OAuth JSON
            </button>
          )}
          <button
            onClick={onSync}
            disabled={busy || !ready}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold"
            style={{
              background: ready ? "rgba(10,132,255,0.16)" : "rgba(255,255,255,0.04)",
              color: ready ? "#0a84ff" : "rgba(255,255,255,0.28)",
              border: `1px solid ${ready ? "rgba(10,132,255,0.28)" : "rgba(255,255,255,0.08)"}`,
            }}
          >
            {busy ? <Loader size={10} className="animate-spin" /> : <MailCheck size={10} />}
            {buttonLabel}
          </button>
        </div>
      </div>

      {message && (
        <div className="mt-2 flex gap-1.5 rounded-md px-2 py-1.5 text-[10.5px]" style={{ background: "rgba(255,255,255,0.045)", color: status?.last_error ? "#ff6961" : "rgba(255,255,255,0.55)" }}>
          {status?.last_error && <AlertCircle size={11} className="shrink-0" />}
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}
