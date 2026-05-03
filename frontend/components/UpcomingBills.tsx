"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X, Check } from "lucide-react";
import { fetchBills, markBillPaid, createBill, deleteBill, Bill } from "@/lib/api";
import EmptyState from "@/components/EmptyState";

function getUrgency(days: number) {
  if (days <= 2) return { label: days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d`, color: "#ff453a", barColor: "#ff453a", barOpacity: 0.15 };
  if (days <= 7) return { label: `${days}d`, color: "#ff9f0a", barColor: "#ff9f0a", barOpacity: 0.12 };
  return          { label: `${days}d`, color: "#30d158", barColor: "#30d158", barOpacity: 0.10 };
}

function fmt(n: number) { return `₹${n.toLocaleString("en-IN")}`; }

export default function UpcomingBills() {
  const [bills,     setBills]     = useState<Bill[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [adding,    setAdding]    = useState(false);
  const [name,      setName]      = useState("");
  const [amount,    setAmount]    = useState("");
  const [dueDate,   setDueDate]   = useState("");
  const [recurring, setRecurring] = useState(true);

  const load = () =>
    fetchBills()
      .then(setBills)
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    window.addEventListener("gmail-synced", load);
    return () => window.removeEventListener("gmail-synced", load);
  }, []);

  const handlePay = async (id: number) => {
    try {
      const updated = await markBillPaid(id);
      setBills((prev) =>
        updated.is_recurring
          ? prev.map((b) => b.id === id ? updated : b)
          : prev.filter((b) => b.id !== id)
      );
    } catch { /* silent */ }
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setBills((prev) => prev.filter((b) => b.id !== id));
    try { await deleteBill(id); } catch { load(); }
  };

  const handleAdd = async () => {
    if (!name.trim() || !amount || !dueDate) return;
    try {
      const bill = await createBill({
        name: name.trim(),
        amount: parseFloat(amount),
        due_date: dueDate,
        is_recurring: recurring,
        recurrence_days: recurring ? 30 : null,
      });
      setBills((prev) => [...prev, bill].sort((a, b) => a.days_until_due - b.days_until_due));
      setName(""); setAmount(""); setDueDate(""); setRecurring(true); setAdding(false);
    } catch { /* silent */ }
  };

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <div className="w-4 h-4 rounded-full border-2 animate-spin"
        style={{ borderColor: "rgba(255,69,58,0.3)", borderTopColor: "#ff453a" }} />
    </div>
  );

  const urgentCount = bills.filter((b) => b.days_until_due <= 2).length;
  const maxDays     = Math.max(...bills.map((b) => b.days_until_due), 1);

  return (
    <div className="flex flex-col h-full gap-4">

      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em]"
          style={{ color: "rgba(255,255,255,0.35)" }}>
          Upcoming Bills
        </p>
        {urgentCount > 0 && (
          <span className="text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-full"
            style={{ background: "rgba(255,69,58,0.12)", color: "#ff453a", border: "1px solid rgba(255,69,58,0.2)" }}>
            {urgentCount} urgent
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-2 flex-1 overflow-y-auto min-h-0">
        {bills.length === 0 && (
          <li>
            <EmptyState
              title="No bills tracked"
              detail="Use Gmail Sync or add payments here so recurring obligations do not disappear into memory."
            />
          </li>
        )}
        <AnimatePresence initial={false}>
          {bills.map((bill) => {
            const u = getUrgency(bill.days_until_due);
            const barWidth = Math.max(8, Math.round((1 - bill.days_until_due / (maxDays + 1)) * 100));
            return (
              <motion.li
                key={bill.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
                className="relative overflow-hidden rounded-2xl px-3.5 py-3 cursor-pointer group"
                style={{ background: "rgba(255,255,255,0.036)", border: "1px solid rgba(255,255,255,0.055)" }}
                onClick={() => handlePay(bill.id)}
                title="Click to mark as paid"
              >
                <div className="absolute left-0 inset-y-0 w-0.5 rounded-l-full" style={{ background: u.color, opacity: 0.7 }} />
                <div className="absolute inset-0 pointer-events-none"
                  style={{ background: `linear-gradient(90deg, ${u.barColor}${Math.round(u.barOpacity * 255).toString(16).padStart(2, "0")} 0%, transparent ${barWidth + 10}%)` }} />

                <div className="relative flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate" style={{ color: "rgba(255,255,255,0.78)" }}>
                      {bill.name}
                    </p>
                    <p className="text-[12px] font-semibold tabular-nums mt-0.5" style={{ color: u.color }}>
                      {fmt(bill.amount)}
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold px-2 py-1 rounded-xl shrink-0"
                    style={{ background: `${u.barColor}18`, color: u.color, border: `1px solid ${u.barColor}30` }}>
                    {u.label}
                  </span>
                  {/* Delete button — hover only */}
                  <button
                    onClick={(e) => handleDelete(e, bill.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded-full"
                    style={{ color: "rgba(255,69,58,0.6)", background: "rgba(255,69,58,0.08)" }}
                    title="Delete bill"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      {/* ── Add bill ── */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10 }}>
        <AnimatePresence>
          {adding && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-col gap-2 mb-3 overflow-hidden"
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Bill name…"
                className="w-full bg-transparent text-[12px] outline-none px-2.5 py-1.5 rounded-lg"
                style={{ color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)" }}
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Amount ₹"
                  className="flex-1 bg-transparent text-[12px] outline-none px-2.5 py-1.5 rounded-lg"
                  style={{ color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)" }}
                />
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="flex-1 bg-transparent text-[12px] outline-none px-2.5 py-1.5 rounded-lg"
                  style={{ color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", colorScheme: "dark" }}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-[11px] cursor-pointer select-none"
                  style={{ color: "rgba(255,255,255,0.4)" }}>
                  <div
                    onClick={() => setRecurring(!recurring)}
                    className="w-7 h-4 rounded-full transition-colors relative"
                    style={{ background: recurring ? "rgba(10,132,255,0.4)" : "rgba(255,255,255,0.1)" }}>
                    <div className="absolute top-0.5 w-3 h-3 rounded-full transition-all"
                      style={{ left: recurring ? "14px" : "2px", background: recurring ? "#0a84ff" : "rgba(255,255,255,0.3)" }} />
                  </div>
                  Monthly recurring
                </label>
                <div className="flex gap-2">
                  <button onClick={() => { setAdding(false); setName(""); setAmount(""); setDueDate(""); }}
                    className="text-[11px] px-2.5 py-1 rounded-lg"
                    style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.05)" }}>
                    Cancel
                  </button>
                  <button onClick={handleAdd}
                    className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg"
                    style={{ background: "rgba(10,132,255,0.14)", color: "#0a84ff", border: "1px solid rgba(10,132,255,0.25)" }}>
                    <Check size={10} /> Add
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 text-[11px] transition-opacity opacity-40 hover:opacity-80"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            <Plus size={11} strokeWidth={2} /> Add bill
          </button>
        )}
      </div>
    </div>
  );
}
