"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Database, FileUp, FolderOpen, Loader2, Play, RefreshCw, Save, X } from "lucide-react";
import { API_BASE } from "@/lib/config";
import GmailSyncControl from "@/components/GmailSyncControl";

type SourceStatus = {
  key: string;
  label: string;
  status: "ready" | "missing";
  count: number;
  detail: string;
  required_for_month_close: boolean;
  current_month_ready?: boolean;
  quality_score?: number;
  last_updated?: string | null;
  age_days?: number | null;
  issues?: string[];
  next_action?: string;
};

type IngestionStatus = {
  ready: number;
  total: number;
  completion_pct: number;
  quality_score?: number;
  required_ready?: number;
  required_total?: number;
  top_issues?: string[];
  sources: SourceStatus[];
};

type MonthCloseStatus = {
  month_year: string;
  status: string;
  data_quality_score: number;
  checklist: Record<string, boolean>;
  missing: string[];
  can_capture_snapshot: boolean;
};

type IngestionAutomationFile = {
  id: number;
  source: string;
  filename: string;
  detected_type: string;
  confidence: number;
  status: string;
  reason?: string | null;
  error?: string | null;
  created_at?: string | null;
};

type IngestionAutomationStatus = {
  enabled: boolean;
  auto_import: boolean;
  interval_minutes: number;
  drop_folder: string;
  gmail_authorized: boolean;
  cas_password_ready: boolean;
  last_scan?: string | null;
  counts: Record<string, number>;
  needs_review: IngestionAutomationFile[];
  automated_inputs: { key: string; label: string; method: string; frequency: string; status: string }[];
  manual_inputs: { key: string; label: string; current: string; automation_path: string }[];
};

const MANUAL_FIELDS = [
  ["BANK", "Bank cash", "All savings/current account cash"],
  ["FD", "Fixed deposits", "Principal plus accrued interest"],
  ["REAL_ESTATE", "Real estate", "Conservative current market value"],
  ["EPF", "PF / EPF", "EPFO passbook balance"],
  ["PPF", "PPF", "PPF account balance"],
  ["NPS", "NPS", "NPS statement balance"],
  ["GOLD_GRAMS", "Gold grams", "Physical gold in grams"],
] as const;

function fmtStatus(source: SourceStatus) {
  if (source.key === "bank" && source.status === "ready" && !source.current_month_ready) {
    return "Imported, but not current month";
  }
  return source.status === "ready" ? "Ready" : "Missing";
}

export default function DataIngestionCenter() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<IngestionStatus | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [monthClose, setMonthClose] = useState<MonthCloseStatus | null>(null);
  const [automation, setAutomation] = useState<IngestionAutomationStatus | null>(null);
  const [casPassword, setCasPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const bankRef = useRef<HTMLInputElement>(null);
  const stocksRef = useRef<HTMLInputElement>(null);
  const healthRef = useRef<HTMLInputElement>(null);
  const mfRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const load = async () => {
    const [statusRes, manualRes, monthCloseRes, automationRes] = await Promise.all([
      fetch(`${API_BASE}/api/ingestion/status`, { cache: "no-store" }),
      fetch(`${API_BASE}/api/wealth/manual`, { cache: "no-store" }),
      fetch(`${API_BASE}/api/month-close/current`, { cache: "no-store" }),
      fetch(`${API_BASE}/api/ingestion/automation/status`, { cache: "no-store" }),
    ]);
    if (statusRes.ok) setStatus(await statusRes.json());
    if (monthCloseRes.ok) setMonthClose(await monthCloseRes.json());
    if (automationRes.ok) setAutomation(await automationRes.json());
    if (manualRes.ok) {
      const data = await manualRes.json();
      const next: Record<string, string> = {};
      MANUAL_FIELDS.forEach(([key]) => {
        next[key] = data[key] ? String(data[key]) : "";
      });
      setManual(next);
    }
  };

  useEffect(() => { if (open) load().catch(() => setMessage("Could not load setup status.")); }, [open]);

  const upload = async (kind: "bank" | "stocks" | "health" | "mutual_funds", file?: File) => {
    if (!file) return;
    setBusy(kind);
    setMessage("");
    const form = new FormData();
    form.append("file", file);
    if (kind === "bank") {
      form.append("account", "Bank Account");
      form.append("no_llm", "true");
    }
    if (kind === "mutual_funds") {
      form.append("password", casPassword);
    }
    const url = kind === "bank"
      ? `${API_BASE}/api/wealth/import-statement`
      : kind === "stocks"
        ? `${API_BASE}/api/wealth/stocks/import`
        : kind === "health"
          ? `${API_BASE}/api/health-data/metrics/import-csv`
          : `${API_BASE}/api/wealth/mutual-funds/import-cas`;
    try {
      const res = await fetch(url, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "Upload failed");
      setMessage(
        kind === "bank" && json.earliest_date && json.latest_date
          ? `Bank import read ${json.parsed_rows} rows from ${json.earliest_date} to ${json.latest_date}.`
          : kind === "mutual_funds"
            ? `Imported ${json.imported ?? 0} mutual fund holding(s).`
          : `Imported ${json.imported ?? 0} row(s).`
      );
      await load();
      window.dispatchEvent(new Event("wealth-updated"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy("");
      if (bankRef.current) bankRef.current.value = "";
      if (stocksRef.current) stocksRef.current.value = "";
      if (healthRef.current) healthRef.current.value = "";
      if (mfRef.current) mfRef.current.value = "";
    }
  };

  const saveManual = async () => {
    setBusy("manual");
    setMessage("");
    try {
      await Promise.all(MANUAL_FIELDS.map(([key]) => fetch(`${API_BASE}/api/wealth/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_type: key, value: parseFloat(manual[key] || "0") || 0 }),
      })));
      setMessage("Manual balances saved.");
      await load();
      window.dispatchEvent(new Event("wealth-updated"));
    } catch {
      setMessage("Could not save manual balances.");
    } finally {
      setBusy("");
    }
  };

  const captureSnapshot = async () => {
    if (!monthClose) return;
    setBusy("snapshot");
    setMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/month-close/${monthClose.month_year}/snapshot`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        const detail = typeof json.detail === "object" ? json.detail.message : json.detail;
        throw new Error(detail || "Snapshot capture failed");
      }
      setMessage(`Captured ${monthClose.month_year} net-worth snapshot.`);
      await load();
      window.dispatchEvent(new Event("wealth-updated"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Snapshot capture failed.");
    } finally {
      setBusy("");
    }
  };

  const runIngestionAutomation = async () => {
    setBusy("automation");
    setMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/ingestion/automation/run?source=all&auto_import=true`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "Automated ingestion failed");
      const drop = json.results?.drop_folder;
      const gmail = json.results?.gmail_attachments;
      const imported = (drop?.imported ?? 0) + (gmail?.imported ?? 0);
      const staged = (drop?.staged ?? 0) + (gmail?.staged ?? 0);
      const duplicates = (drop?.duplicates ?? 0) + (gmail?.duplicates ?? 0);
      setMessage(`Ingestion scan complete. Imported ${imported}, staged ${staged}, duplicates ${duplicates}.`);
      await load();
      window.dispatchEvent(new Event("wealth-updated"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Automated ingestion failed.");
    } finally {
      setBusy("");
    }
  };

  const importStagedFile = async (fileId: number) => {
    setBusy(`import-${fileId}`);
    setMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/ingestion/automation/files/${fileId}/import`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "Import failed");
      setMessage(`Imported ${json.filename}.`);
      await load();
      window.dispatchEvent(new Event("wealth-updated"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy("");
    }
  };

  const ignoreStagedFile = async (fileId: number) => {
    setBusy(`ignore-${fileId}`);
    setMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/ingestion/automation/files/${fileId}/status?status=skipped`, { method: "PATCH" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "Could not ignore file");
      setMessage(`Ignored ${json.filename}.`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not ignore file.");
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-all"
        style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.65)", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        <Database size={13} />
        Data Setup
      </button>

      {mounted && createPortal(
        <AnimatePresence>
          {open && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0"
                style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)", zIndex: 9998 }}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -12 }}
                className="fixed left-1/2 top-8 flex max-h-[88vh] w-[min(980px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-4 overflow-y-auto rounded-3xl p-6"
                style={{ zIndex: 9999, background: "rgba(20,20,24,0.96)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 32px 90px rgba(0,0,0,0.7)" }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[18px] font-semibold" style={{ color: "rgba(255,255,255,0.92)" }}>Data Setup</p>
                    <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed" style={{ color: "rgba(255,255,255,0.46)" }}>
                      This is the single place to feed the dashboard. Use broad CSV/PDF exports where possible; exact column names are flexible for bank, stock, and health CSVs.
                    </p>
                  </div>
                  <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}>
                    <X size={15} />
                  </button>
                </div>

                <section className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="mb-3">
                    <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.42)" }}>Gmail actions and bills</p>
                    <p className="mt-1 text-[11px] leading-snug" style={{ color: "rgba(255,255,255,0.36)" }}>
                      Use this when Data Freshness says Gmail needs reconnect. It is separate from bank/CAS uploads.
                    </p>
                  </div>
                  <GmailSyncControl />
                </section>

                <section className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.42)" }}>Automated ingestion</p>
                      <p className="mt-1 max-w-[720px] text-[11px] leading-snug" style={{ color: "rgba(255,255,255,0.36)" }}>
                        Bank CSVs, Zerodha holdings, CAS PDFs, and health CSVs can be picked up from Gmail attachments or the local inbox folder. Ambiguous loan/card/balance statements stay in review.
                      </p>
                    </div>
                    <button
                      onClick={runIngestionAutomation}
                      className="flex shrink-0 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
                      style={{ background: "rgba(10,132,255,0.14)", color: "#0a84ff", border: "1px solid rgba(10,132,255,0.24)" }}
                    >
                      {busy === "automation" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                      Run scan
                    </button>
                  </div>

                  <div className="grid gap-2 md:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.44)" }}>
                        <FolderOpen size={12} /> Inbox folder
                      </p>
                      <p className="mt-1 break-all text-[11px]" style={{ color: "rgba(255,255,255,0.72)" }}>{automation?.drop_folder ?? "Loading..."}</p>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {[
                          ["Imported", automation?.counts?.imported ?? 0, "#30d158"],
                          ["Review", (automation?.counts?.staged ?? 0) + (automation?.counts?.error ?? 0), "#ff9f0a"],
                          ["Ignored", automation?.counts?.skipped ?? 0, "rgba(255,255,255,0.58)"],
                        ].map(([label, value, color]) => (
                          <div key={label as string} className="rounded-lg px-2 py-1.5" style={{ background: "rgba(0,0,0,0.16)", border: "1px solid rgba(255,255,255,0.05)" }}>
                            <p className="text-[9px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.36)" }}>{label as string}</p>
                            <p className="text-[14px] font-semibold" style={{ color: color as string }}>{value as number}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.44)" }}>Setup state</p>
                      <div className="mt-2 grid gap-1.5">
                        {[
                          ["Gmail", automation?.gmail_authorized ? "Connected" : "Needs OAuth", automation?.gmail_authorized],
                          ["CAS password", automation?.cas_password_ready ? "Ready" : "Set in backend .env", automation?.cas_password_ready],
                          ["Auto import", automation?.auto_import ? "On" : "Off", automation?.auto_import],
                        ].map(([label, value, ok]) => (
                          <div key={label as string} className="flex items-center justify-between gap-2 text-[11px]">
                            <span style={{ color: "rgba(255,255,255,0.54)" }}>{label as string}</span>
                            <span style={{ color: ok ? "#30d158" : "#ff9f0a" }}>{value as string}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    {automation?.automated_inputs.map((item) => (
                      <div key={item.key} className="rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.055)" }}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.74)" }}>{item.label}</p>
                          <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase" style={{ color: item.status === "automated" ? "#30d158" : "#ff9f0a", background: item.status === "automated" ? "rgba(48,209,88,0.1)" : "rgba(255,159,10,0.1)" }}>{item.status.replaceAll("_", " ")}</span>
                        </div>
                        <p className="mt-1 text-[10.5px] leading-snug" style={{ color: "rgba(255,255,255,0.36)" }}>{item.method}</p>
                        <p className="mt-1 text-[10px]" style={{ color: "rgba(100,210,255,0.62)" }}>{item.frequency}</p>
                      </div>
                    ))}
                  </div>

                  {automation?.needs_review?.length ? (
                    <div className="mt-3 rounded-xl p-3" style={{ background: "rgba(255,159,10,0.06)", border: "1px solid rgba(255,159,10,0.14)" }}>
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "#ff9f0a" }}><AlertTriangle size={12} /> Needs review</p>
                      <div className="mt-2 grid gap-2">
                        {automation.needs_review.slice(0, 6).map((file) => {
                          const importable = ["bank_statement", "stock_holdings", "mutual_fund_cas", "health_csv"].includes(file.detected_type);
                          return (
                            <div key={file.id} className="flex flex-col gap-2 rounded-lg px-2.5 py-2 md:flex-row md:items-center md:justify-between" style={{ background: "rgba(0,0,0,0.16)", border: "1px solid rgba(255,255,255,0.06)" }}>
                              <div className="min-w-0">
                                <p className="truncate text-[11.5px] font-semibold" style={{ color: "rgba(255,255,255,0.76)" }}>{file.filename}</p>
                                <p className="mt-0.5 text-[10.5px] leading-snug" style={{ color: file.error ? "#ff453a" : "rgba(255,255,255,0.38)" }}>
                                  {file.detected_type.replaceAll("_", " ")} | {Math.round((file.confidence ?? 0) * 100)}% | {file.error || file.reason}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                {importable && (
                                  <button onClick={() => importStagedFile(file.id)} className="rounded-full px-2.5 py-1 text-[10.5px] font-semibold" style={{ color: "#30d158", background: "rgba(48,209,88,0.12)", border: "1px solid rgba(48,209,88,0.2)" }}>
                                    {busy === `import-${file.id}` ? "Importing" : "Import"}
                                  </button>
                                )}
                                <button onClick={() => ignoreStagedFile(file.id)} className="rounded-full px-2.5 py-1 text-[10.5px] font-semibold" style={{ color: "rgba(255,255,255,0.58)", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                                  {busy === `ignore-${file.id}` ? "Ignoring" : "Ignore"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </section>

                <div className="grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
                  <section className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.42)" }}>Current Coverage</p>
                        {status && (
                          <p className="mt-1 text-[11px]" style={{ color: "rgba(255,255,255,0.36)" }}>
                            Trust score {status.quality_score ?? status.completion_pct}/100 | required {status.required_ready ?? 0}/{status.required_total ?? 0}
                          </p>
                        )}
                      </div>
                      <button onClick={() => load()} className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px]" style={{ color: "#0a84ff", background: "rgba(10,132,255,0.1)" }}>
                        <RefreshCw size={11} /> Refresh
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {status?.sources.map((source) => (
                        <div key={source.key} className="rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.76)" }}>{source.label}</p>
                            <span className="text-[10px] font-semibold" style={{ color: source.status === "ready" && source.current_month_ready !== false ? "#30d158" : "#ff9f0a" }}>{source.quality_score ?? 0}/100</span>
                          </div>
                          <p className="mt-1 text-[10.5px] leading-snug" style={{ color: "rgba(255,255,255,0.36)" }}>
                            {fmtStatus(source)}{source.age_days != null ? ` · updated ${source.age_days}d ago` : ""}. {source.detail}
                          </p>
                          {source.issues?.length ? (
                            <p className="mt-1 text-[10.5px] leading-snug" style={{ color: "#ff9f0a" }}>{source.issues.join(" ")}</p>
                          ) : null}
                          {source.next_action && (
                            <p className="mt-1 text-[10.5px] leading-snug" style={{ color: "rgba(100,210,255,0.78)" }}>{source.next_action}</p>
                          )}
                        </div>
                      )) ?? <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.45)" }}>Loading...</p>}
                    </div>
                  </section>

                  <section className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.42)" }}>Upload Files</p>
                    {[
                      ["bank", "Bank statement CSV", "Best first setup: export 12 months. Ongoing: export one month at month-end.", bankRef],
                      ["stocks", "Stocks holdings file", "Zerodha Console > Portfolio > Holdings > download XLSX or CSV.", stocksRef],
                      ["mutual_funds", "Mutual fund CAS PDF", "Download CAMS/KFintech CAS PDF. Enter password below, then upload here.", mfRef],
                      ["health", "Health CSV", "Flexible columns: date, steps, sleep, resting_hr, active_mins, calories.", healthRef],
                    ].map(([kind, label, detail, ref]) => (
                      <div key={kind as string} className="mb-2 rounded-xl p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[13px] font-semibold" style={{ color: "rgba(255,255,255,0.78)" }}>{label as string}</p>
                            <p className="mt-1 text-[11px] leading-snug" style={{ color: "rgba(255,255,255,0.38)" }}>{detail as string}</p>
                          </div>
                          <button onClick={() => (ref as RefObject<HTMLInputElement>).current?.click()} className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold" style={{ background: "rgba(10,132,255,0.14)", color: "#0a84ff", border: "1px solid rgba(10,132,255,0.24)" }}>
                            {busy === kind ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
                            Upload
                          </button>
                          <input
                            ref={ref as RefObject<HTMLInputElement>}
                            type="file"
                            accept={kind === "mutual_funds" ? ".pdf" : kind === "stocks" ? ".xlsx,.xlsm,.csv,.txt" : ".csv,.txt"}
                            className="hidden"
                            onChange={(e) => upload(kind as "bank" | "stocks" | "health" | "mutual_funds", e.target.files?.[0])}
                          />
                        </div>
                        {kind === "mutual_funds" && (
                          <input
                            type="password"
                            value={casPassword}
                            onChange={(e) => setCasPassword(e.target.value)}
                            placeholder="CAS password (PAN+DOB, if not set in backend .env)"
                            className="mt-2 w-full rounded-lg bg-transparent px-2.5 py-1.5 text-[12px] outline-none"
                            style={{ color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)" }}
                          />
                        )}
                      </div>
                    ))}
                  </section>
                </div>

                <section className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.42)" }}>Manual Balances</p>
                      <p className="mt-1 text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>Use current values. These feed net worth immediately and monthly snapshots when you close the month.</p>
                    </div>
                    <button onClick={saveManual} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold" style={{ background: "rgba(48,209,88,0.14)", color: "#30d158", border: "1px solid rgba(48,209,88,0.22)" }}>
                      {busy === "manual" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      Save
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {MANUAL_FIELDS.map(([key, label, hint]) => (
                      <label key={key} className="rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <span className="text-[11px] font-semibold" style={{ color: "rgba(255,255,255,0.66)" }}>{label}</span>
                        <input
                          value={manual[key] ?? ""}
                          onChange={(e) => setManual((prev) => ({ ...prev, [key]: e.target.value.replace(/[^\d.]/g, "") }))}
                          placeholder="0"
                          inputMode="decimal"
                          className="mt-1 w-full bg-transparent text-[14px] font-semibold outline-none"
                          style={{ color: "rgba(255,255,255,0.9)" }}
                        />
                        <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.28)" }}>{hint}</span>
                      </label>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.42)" }}>Month-End Snapshot</p>
                      <p className="mt-1 text-[11px] leading-snug" style={{ color: "rgba(255,255,255,0.35)" }}>
                        {monthClose
                          ? monthClose.checklist.snapshot_captured
                            ? `${monthClose.month_year} snapshot is already captured. Re-capturing updates it with the latest values.`
                            : monthClose.can_capture_snapshot
                              ? `${monthClose.month_year} is ready. Capture now to lock the month for trends.`
                              : `Complete required inputs first: ${monthClose.missing.join(" ")}`
                          : "Loading month-close status..."}
                      </p>
                    </div>
                    <button
                      onClick={captureSnapshot}
                      disabled={!monthClose?.can_capture_snapshot || busy === "snapshot"}
                      className="flex shrink-0 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
                      style={{
                        background: monthClose?.can_capture_snapshot ? "rgba(48,209,88,0.14)" : "rgba(255,255,255,0.06)",
                        color: monthClose?.can_capture_snapshot ? "#30d158" : "rgba(255,255,255,0.34)",
                        border: `1px solid ${monthClose?.can_capture_snapshot ? "rgba(48,209,88,0.24)" : "rgba(255,255,255,0.08)"}`,
                        cursor: !monthClose?.can_capture_snapshot || busy === "snapshot" ? "not-allowed" : "pointer",
                      }}
                    >
                      {busy === "snapshot" ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                      {monthClose?.checklist.snapshot_captured ? "Update Snapshot" : "Capture Snapshot"}
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.42)" }}>How the dashboard uses this</p>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    {[
                      ["Net worth", "Manual balances + MF CAS + stock holdings + gold price fallback."],
                      ["Trends", "Bank transactions trend immediately; asset trends are built from monthly snapshots."],
                      ["News", "Google News RSS is filtered by personal-finance impact rules. Configure NEWS_TOPICS in backend .env."],
                    ].map(([title, detail]) => (
                      <div key={title} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <p className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.72)" }}><CheckCircle2 size={12} />{title}</p>
                        <p className="mt-1 text-[11px] leading-snug" style={{ color: "rgba(255,255,255,0.36)" }}>{detail}</p>
                      </div>
                    ))}
                  </div>
                </section>

                {message && (
                  <div className="rounded-xl px-3 py-2 text-[12px]" style={{ background: "rgba(10,132,255,0.1)", color: "#64d2ff", border: "1px solid rgba(10,132,255,0.18)" }}>
                    {message}
                  </div>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
