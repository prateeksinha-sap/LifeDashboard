"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, MailCheck, Plus, Target, Trash2 } from "lucide-react";
import {
  Actionable,
  Bill,
  fetchActionables,
  fetchBills,
  fetchGmailStatus,
  fetchPriorities,
  GmailStatus,
  Priority,
  updatePriorities,
} from "@/lib/api";

function money(value: number): string {
  if (value >= 1_00_000) return `INR ${(value / 1_00_000).toFixed(1)}L`;
  return `INR ${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function dueLabel(value?: string | null) {
  if (!value) return "No date";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function ActionHub() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [actions, setActions] = useState<Actionable[]>([]);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [newPriority, setNewPriority] = useState("");
  const [savingPriority, setSavingPriority] = useState(false);

  const load = () => Promise.all([
    fetchBills().catch(() => []),
    fetchActionables("Pending").catch(() => []),
    fetchPriorities().catch(() => []),
    fetchGmailStatus().catch(() => null),
  ]).then(([billRows, actionRows, priorityRows, gmailStatus]) => {
    setBills(billRows);
    setActions(actionRows);
    setPriorities(priorityRows);
    setGmail(gmailStatus);
  }).finally(() => setLoading(false));

  useEffect(() => {
    load();
    window.addEventListener("gmail-synced", load);
    window.addEventListener("actionables-updated", load);
    return () => {
      window.removeEventListener("gmail-synced", load);
      window.removeEventListener("actionables-updated", load);
    };
  }, []);

  const dueBills = useMemo(() => bills.filter((bill) => !bill.is_paid).sort((a, b) => a.days_until_due - b.days_until_due).slice(0, 3), [bills]);
  const urgentActions = useMemo(() => [...actions].sort((a, b) => {
    const score = (v: Actionable) => v.priority === "High" ? 0 : v.priority === "Medium" ? 1 : 2;
    return score(a) - score(b);
  }).slice(0, 4), [actions]);
  const topPriorities = useMemo(() => [...priorities].sort((a, b) => a.rank - b.rank).slice(0, 4), [priorities]);

  const persistPriorities = async (items: { text: string; eisenhower_quadrant: string }[]) => {
    setSavingPriority(true);
    try {
      const saved = await updatePriorities(items.map((item, index) => ({
        rank: index + 1,
        text: item.text,
        eisenhower_quadrant: item.eisenhower_quadrant || "Q2",
      })));
      setPriorities(saved);
      setNewPriority("");
    } finally {
      setSavingPriority(false);
    }
  };

  const addPriority = async () => {
    const text = newPriority.trim();
    if (!text || savingPriority) return;
    await persistPriorities([
      ...topPriorities.map((item) => ({ text: item.text, eisenhower_quadrant: item.eisenhower_quadrant })),
      { text, eisenhower_quadrant: "Q2" },
    ]);
  };

  const removePriority = async (id: number) => {
    if (savingPriority) return;
    await persistPriorities(
      [...priorities]
        .sort((a, b) => a.rank - b.rank)
        .filter((item) => item.id !== id)
        .map((item) => ({ text: item.text, eisenhower_quadrant: item.eisenhower_quadrant })),
    );
  };

  if (loading) return <div className="flex h-full items-center justify-center"><div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "rgba(10,132,255,0.25)", borderTopColor: "#0a84ff" }} /></div>;

  const activeCount = dueBills.length + urgentActions.length + topPriorities.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>
            <AlertTriangle size={12} /> Action Hub
          </p>
          <p className="mt-1 text-[11px]" style={{ color: "rgba(255,255,255,0.32)" }}>
            Priorities first, interruptions second
          </p>
        </div>
        <span className="rounded-full px-2 py-1 text-[11px] font-semibold" style={{ background: "rgba(48,209,88,0.12)", color: "#30d158", border: "1px solid rgba(48,209,88,0.22)" }}>
          {activeCount} active
        </span>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[1.15fr_1fr]">
        <section className="flex min-h-0 flex-col rounded-lg px-3 py-3" style={{ background: "rgba(191,90,242,0.075)", border: "1px solid rgba(191,90,242,0.2)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#d7a7ff" }}>
                <Target size={12} /> This Week&apos;s Priorities
              </p>
              <p className="mt-1 text-[10px]" style={{ color: "rgba(255,255,255,0.38)" }}>
                The 1-4 commitments that should survive the noise
              </p>
            </div>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: "#bf5af2", background: "rgba(191,90,242,0.14)" }}>
              {topPriorities.length}
            </span>
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
            <div className="grid gap-2">
              {topPriorities.length === 0 ? (
                <div className="rounded-lg px-3 py-4" style={{ color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(191,90,242,0.24)" }}>
                  <p className="text-[13px] font-semibold" style={{ color: "rgba(255,255,255,0.78)" }}>No priorities set</p>
                  <p className="mt-1 text-[11px]">Add the few things that make this week successful.</p>
                </div>
              ) : (
                topPriorities.map((item) => (
                  <div key={`priority-${item.id}`} className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold" style={{ color: "#050506", background: "#bf5af2" }}>
                      {item.rank}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-[13px] font-semibold" style={{ color: "rgba(255,255,255,0.9)" }}>
                      {item.text}
                    </p>
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={{ color: "#d7a7ff", background: "rgba(191,90,242,0.13)" }}>
                      {item.eisenhower_quadrant}
                    </span>
                    <button
                      type="button"
                      onClick={() => void removePriority(item.id)}
                      disabled={savingPriority}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10 disabled:opacity-40"
                      style={{ color: "rgba(255,255,255,0.48)" }}
                      aria-label={`Remove priority ${item.text}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <form
            className="mt-3 flex shrink-0 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void addPriority();
            }}
          >
            <input
              value={newPriority}
              onChange={(event) => setNewPriority(event.target.value)}
              placeholder="Add weekly priority"
              className="min-w-0 flex-1 rounded-md px-2.5 py-2 text-[12px] outline-none"
              style={{
                color: "rgba(255,255,255,0.9)",
                background: "rgba(0,0,0,0.24)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            />
            <button
              type="submit"
              disabled={!newPriority.trim() || savingPriority}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition disabled:opacity-40"
              style={{
                color: "#050506",
                background: "#bf5af2",
                border: "1px solid rgba(255,255,255,0.16)",
              }}
              aria-label="Add priority"
            >
              <Plus size={16} />
            </button>
          </form>
        </section>

        <section className="grid min-h-0 gap-3 md:grid-cols-2 xl:grid-cols-2">
          <div className="flex min-h-0 flex-col rounded-lg px-3 py-3" style={{ background: "rgba(255,159,10,0.055)", border: "1px solid rgba(255,159,10,0.14)" }}>
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#ffbf69" }}>
                <CalendarClock size={11} /> Bills
              </p>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: dueBills.length ? "#ff9f0a" : "#30d158", background: "rgba(255,255,255,0.06)" }}>
                {dueBills.length}
              </span>
            </div>
            <div className="mt-2 min-h-0 flex-1 overflow-auto pr-1">
              {dueBills.length === 0 ? (
                <p className="rounded-md px-2 py-3 text-[11px]" style={{ color: "rgba(255,255,255,0.42)", background: "rgba(255,255,255,0.035)" }}>No unpaid bills surfaced.</p>
              ) : (
                <div className="grid gap-2">
                  {dueBills.map((bill) => (
                    <div key={`bill-${bill.id}`} className="rounded-md px-2.5 py-2" style={{ background: "rgba(255,255,255,0.045)" }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.82)" }}>{bill.name}</p>
                          <p className="mt-0.5 text-[10px]" style={{ color: "rgba(255,255,255,0.36)" }}>Due {dueLabel(bill.due_date)} | {bill.days_until_due}d</p>
                        </div>
                        <p className="shrink-0 text-[11px] font-bold" style={{ color: "#ff9f0a" }}>{money(bill.amount)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded-lg px-3 py-3" style={{ background: "rgba(10,132,255,0.052)", border: "1px solid rgba(10,132,255,0.14)" }}>
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#64d2ff" }}>
                <MailCheck size={11} /> Inbox
              </p>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: urgentActions.length ? "#0a84ff" : "#30d158", background: "rgba(255,255,255,0.06)" }}>
                {urgentActions.length}
              </span>
            </div>
            <div className="mt-2 min-h-0 flex-1 overflow-auto pr-1">
              {urgentActions.length === 0 ? (
                <p className="rounded-md px-2 py-3 text-[11px]" style={{ color: "rgba(255,255,255,0.42)", background: "rgba(255,255,255,0.035)" }}>
                  {gmail?.authorized ? "No pending Gmail actions surfaced." : "Connect Gmail to surface actionables."}
                </p>
              ) : (
                <div className="grid gap-2">
                  {urgentActions.map((item) => (
                    <div key={`action-${item.id}`} className="rounded-md px-2.5 py-2" style={{ background: "rgba(255,255,255,0.045)" }}>
                      <div className="flex items-start gap-2">
                        <MailCheck size={12} className="mt-0.5 shrink-0" style={{ color: "#0a84ff" }} />
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.78)" }}>{item.task_description}</p>
                          <p className="mt-0.5 truncate text-[10px]" style={{ color: "rgba(255,255,255,0.34)" }}>{item.sender || item.source} {item.due_date ? `| Due ${dueLabel(item.due_date)}` : ""}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
