"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, CheckCircle2, Loader2, X } from "lucide-react";
import { API_BASE } from "@/lib/config";

type Category = {
  category: string;
  total: number;
  count: number;
  percentage: number;
  top_merchants: { merchant: string; total: number }[];
};

type MonthReview = {
  month_year: string;
  status: {
    data_quality_score: number;
    missing: string[];
    metrics: {
      income: number;
      expenses: number;
      savings: number;
      transaction_count: number;
      net_worth: number;
    };
  };
  previous: { month_year: string; income: number; expenses: number; transaction_count: number };
  expense_breakdown: { total: number; count: number; categories: Category[] };
  income_breakdown: { total: number; count: number; categories: Category[] };
  insights: { severity: string; title: string; detail: string }[];
  bills: { id: number; name: string; amount: number; due_date: string }[];
  actionables: { id: number; task: string; priority: string; due_date: string | null; source: string }[];
  categorisation: { saved_rules: number; ambiguous_buckets: Category[] };
};

function money(value: number): string {
  const abs = Math.abs(value || 0);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_00_00_000) return `${sign}INR ${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}INR ${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}INR ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}INR ${Math.round(abs).toLocaleString("en-IN")}`;
}

function monthLabel(monthYear: string): string {
  const [year, month] = monthYear.split("-");
  return new Date(Number(year), Number(month) - 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

const HIDDEN_CATEGORIES = new Set(["Cash Withdrawal"]);

export default function MonthReviewPanel() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [review, setReview] = useState<MonthReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const current = await fetch(`${API_BASE}/api/month-close/current`, { cache: "no-store" }).then((res) => res.json());
      const data = await fetch(`${API_BASE}/api/month-close/${current.month_year}/review`, { cache: "no-store" }).then((res) => {
        if (!res.ok) throw new Error(`Month review error: ${res.status}`);
        return res.json();
      });
      setReview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load month review.");
    } finally {
      setLoading(false);
    }
  };

  const openPanel = () => {
    setOpen(true);
    void load();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-all"
        style={{ background: "rgba(191,90,242,0.12)", color: "#bf5af2", border: "1px solid rgba(191,90,242,0.22)" }}
      >
        <BarChart3 size={13} />
        Month Review
      </button>

      {mounted && createPortal(
        <AnimatePresence>
          {open && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0" style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)", zIndex: 9998 }} />
              <motion.section
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 14, scale: 0.98 }}
                className="fixed inset-x-4 top-8 mx-auto max-h-[88vh] max-w-[1100px] overflow-y-auto rounded-lg p-5"
                style={{ zIndex: 9999, background: "rgba(15,15,19,0.97)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 32px 90px rgba(0,0,0,0.7)" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold" style={{ color: "rgba(255,255,255,0.92)" }}>
                      {review ? monthLabel(review.month_year) : "Month Review"}
                    </p>
                    <p className="mt-1 text-[13px]" style={{ color: "rgba(255,255,255,0.42)" }}>
                      One page for cashflow, spending, actionables, data quality, and snapshot readiness.
                    </p>
                  </div>
                  <button type="button" aria-label="Close month review" onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.55)" }}>
                    <X size={15} />
                  </button>
                </div>

                {loading && (
                  <div className="flex h-72 items-center justify-center"><Loader2 className="animate-spin" style={{ color: "#bf5af2" }} /></div>
                )}

                {!loading && error && (
                  <div className="mt-4 rounded-lg p-3 text-sm" style={{ background: "rgba(255,69,58,0.08)", color: "#ff6961", border: "1px solid rgba(255,69,58,0.18)" }}>{error}</div>
                )}

                {!loading && review && (
                  <div className="mt-5 grid gap-4">
                    <div className="grid gap-3 md:grid-cols-5">
                      {[
                        ["Quality", `${review.status.data_quality_score}/100`, "#30d158"],
                        ["Income", money(review.status.metrics.income), "#30d158"],
                        ["Expenses", money(review.status.metrics.expenses), "#ff453a"],
                        ["Savings", money(review.status.metrics.savings), review.status.metrics.savings >= 0 ? "#30d158" : "#ff453a"],
                        ["Net worth", money(review.status.metrics.net_worth), "#bf5af2"],
                      ].map(([label, value, color]) => (
                        <div key={label} className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.36)" }}>{label}</p>
                          <p className="mt-1 text-lg font-bold tabular-nums" style={{ color }}>{value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                      <section className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <p className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>Insights</p>
                        <div className="mt-3 grid gap-2">
                          {review.insights.map((item) => (
                            <div key={`${item.title}-${item.detail}`} className="rounded-md p-3" style={{ background: item.severity === "critical" ? "rgba(255,69,58,0.08)" : item.severity === "warning" ? "rgba(255,159,10,0.08)" : "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
                              <p className="text-[13px] font-semibold" style={{ color: "rgba(255,255,255,0.82)" }}>{item.title}</p>
                              <p className="mt-1 text-[12px]" style={{ color: "rgba(255,255,255,0.5)" }}>{item.detail}</p>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <p className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>Month Close</p>
                        <div className="mt-3 grid gap-2">
                          {review.status.missing.length ? review.status.missing.map((item) => (
                            <p key={item} className="rounded-md p-2 text-[12px]" style={{ background: "rgba(255,159,10,0.08)", color: "#ff9f0a" }}>{item}</p>
                          )) : (
                            <p className="flex items-center gap-2 rounded-md p-2 text-[12px]" style={{ background: "rgba(48,209,88,0.08)", color: "#30d158" }}><CheckCircle2 size={13} /> Required inputs complete.</p>
                          )}
                        </div>
                      </section>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <section className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <p className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>Expense Buckets</p>
                        <div className="mt-3 grid gap-2">
                          {review.expense_breakdown.categories.filter((cat) => !HIDDEN_CATEGORIES.has(cat.category)).slice(0, 8).map((cat) => (
                            <div key={cat.category} className="rounded-md p-2" style={{ background: "rgba(255,255,255,0.03)" }}>
                              <div className="flex justify-between gap-3">
                                <p className="text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.76)" }}>{cat.category}</p>
                                <p className="text-[12px] font-bold tabular-nums" style={{ color: "#ff453a" }}>{money(cat.total)} | {cat.percentage}%</p>
                              </div>
                              <p className="mt-1 text-[10.5px]" style={{ color: "rgba(255,255,255,0.36)" }}>
                                {cat.top_merchants.slice(0, 3).map((m) => `${m.merchant} ${money(m.total)}`).join(" | ")}
                              </p>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <p className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>Actionables & Bills</p>
                        <div className="mt-3 grid gap-2">
                          {[...review.bills.map((bill) => ({ key: `bill-${bill.id}`, label: bill.name, detail: `${money(bill.amount)} due ${bill.due_date}` })), ...review.actionables.map((item) => ({ key: `action-${item.id}`, label: item.task, detail: `${item.priority} | ${item.source}${item.due_date ? ` | ${item.due_date}` : ""}` }))].slice(0, 8).map((item) => (
                            <div key={item.key} className="rounded-md p-2" style={{ background: "rgba(255,255,255,0.03)" }}>
                              <p className="text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.76)" }}>{item.label}</p>
                              <p className="mt-1 text-[10.5px]" style={{ color: "rgba(255,255,255,0.38)" }}>{item.detail}</p>
                            </div>
                          ))}
                          {review.bills.length === 0 && review.actionables.length === 0 && (
                            <p className="rounded-md p-3 text-[12px]" style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.4)" }}>No open bills or actionables found for this review.</p>
                          )}
                        </div>
                      </section>
                    </div>
                  </div>
                )}
              </motion.section>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
