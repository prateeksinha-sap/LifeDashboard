"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { fetchBills, markBillPaid, Bill } from "@/lib/api";

interface UrgencyStyle {
  label:      string;
  color:      string;
  barColor:   string;
  barOpacity: number;
}

function getUrgency(days: number): UrgencyStyle {
  if (days <= 2) return {
    label:      days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d`,
    color:      "#ff453a",
    barColor:   "#ff453a",
    barOpacity: 0.15,
  };
  if (days <= 7) return {
    label:      `${days}d`,
    color:      "#ff9f0a",
    barColor:   "#ff9f0a",
    barOpacity: 0.12,
  };
  return {
    label:      `${days}d`,
    color:      "#30d158",
    barColor:   "#30d158",
    barOpacity: 0.10,
  };
}

function formatAmount(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

const containerVariants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.07 } },
};

const rowVariants = {
  hidden:  { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 280, damping: 24 },
  },
};

export default function UpcomingBills() {
  const [bills,   setBills]   = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBills()
      .then(setBills)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handlePay = async (id: number) => {
    try {
      const updated = await markBillPaid(id);
      // Recurring bills auto-advance and return with is_paid=false — refresh list
      setBills((prev) => {
        if (updated.is_recurring) {
          // Replace with updated (next cycle)
          return prev.map((b) => b.id === id ? updated : b);
        }
        // One-time: remove
        return prev.filter((b) => b.id !== id);
      });
    } catch { /* silently ignore */ }
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <div className="w-4 h-4 rounded-full border-2 animate-spin"
          style={{ borderColor: "rgba(255,69,58,0.3)", borderTopColor: "#ff453a" }} />
      </div>
    );
  }

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
            style={{
              background: "rgba(255,69,58,0.12)",
              color:      "#ff453a",
              border:     "1px solid rgba(255,69,58,0.2)",
            }}>
            {urgentCount} urgent
          </span>
        )}
      </div>

      <motion.ul
        className="flex flex-col gap-2"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {bills.map((bill) => {
          const u = getUrgency(bill.days_until_due);
          const barWidth = Math.max(8, Math.round((1 - bill.days_until_due / (maxDays + 1)) * 100));

          return (
            <motion.li
              key={bill.id}
              variants={rowVariants}
              className="relative overflow-hidden rounded-2xl px-3.5 py-3 cursor-pointer group"
              style={{
                background: "rgba(255,255,255,0.036)",
                border:     "1px solid rgba(255,255,255,0.055)",
              }}
              onClick={() => handlePay(bill.id)}
              title="Click to mark as paid"
            >
              <div className="absolute left-0 inset-y-0 w-0.5 rounded-l-full"
                style={{ background: u.color, opacity: 0.7 }} />

              <div className="absolute inset-0 pointer-events-none"
                style={{
                  background: `linear-gradient(90deg, ${u.barColor}${Math.round(u.barOpacity * 255).toString(16).padStart(2, "0")} 0%, transparent ${barWidth + 10}%)`,
                }} />

              <div className="relative flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate"
                    style={{ color: "rgba(255,255,255,0.78)" }}>
                    {bill.name}
                  </p>
                  <p className="text-[12px] font-semibold tabular-nums mt-0.5"
                    style={{ color: u.color }}>
                    {formatAmount(bill.amount)}
                  </p>
                </div>

                <span className="text-[11px] font-semibold px-2 py-1 rounded-xl shrink-0"
                  style={{
                    background: `${u.barColor}18`,
                    color:      u.color,
                    border:     `1px solid ${u.barColor}30`,
                  }}>
                  {u.label}
                </span>
              </div>
            </motion.li>
          );
        })}
      </motion.ul>
    </div>
  );
}
