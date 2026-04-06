/**
 * mockData.ts
 * ──────────────────────────────────────────────────────
 * Single source of truth for ALL mock data used in the
 * Life Dashboard. Edit this file to update widget content
 * without touching any component code.
 * ──────────────────────────────────────────────────────
 */

// ── Wealth Center ────────────────────────────────────

export const TOTAL_NET_WORTH = 8742500; // ₹87,42,500

/** Donut chart slices */
export interface WealthSlice {
  label: string;
  percentage: number; // 0–100
  color: string;
}

export const WEALTH_SLICES: WealthSlice[] = [
  { label: "Mutual Funds", percentage: 40, color: "#bf5af2" }, // apple-purple
  { label: "Stocks",       percentage: 25, color: "#0a84ff" }, // apple-blue
  { label: "Cash",         percentage: 15, color: "#30d158" }, // apple-green
  { label: "Gold",         percentage: 12, color: "#ff9f0a" }, // apple-orange
  { label: "EPF",          percentage: 8,  color: "#5ac8fa" }, // apple-teal
];

// ── Top 7 Priorities ─────────────────────────────────

export interface Priority {
  id: number;
  text: string;
}

export const TOP_PRIORITIES: Priority[] = [
  { id: 1, text: "Review Q2 financial plan" },
  { id: 2, text: "Pay Vibgyor school fees" },
  { id: 3, text: "Rebalance MF portfolio" },
  { id: 4, text: "Book annual health checkup" },
  { id: 5, text: "Submit LIC premium docs" },
  { id: 6, text: "Call accountant re: ITR" },
  { id: 7, text: "Family outing plan" },
];

// ── Smart Inbox ──────────────────────────────────────

export type InboxBadge = "Vibgyor" | "Bill" | "Alert";

export interface InboxItem {
  id: number;
  badge: InboxBadge;
  sender: string;
  subject: string;
}

export const INBOX_ITEMS: InboxItem[] = [
  {
    id: 1,
    badge: "Vibgyor",
    sender: "School School",
    subject: "PTM scheduled — Child's class on 12th April, 10 AM",
  },
  {
    id: 2,
    badge: "Bill",
    sender: "Tata Power",
    subject: "Electricity bill ₹2,140 due in 2 days",
  },
  {
    id: 3,
    badge: "Alert",
    sender: "HDFC Bank",
    subject: "Credit card statement generated — ₹38,450",
  },
  {
    id: 4,
    badge: "Vibgyor",
    sender: "Vibgyor Admin",
    subject: "Annual day registration closes 15th April",
  },
];

// ── Action Center / To-Dos ────────────────────────────

export interface TodoItem {
  id: number;
  text: string;
}

export const INITIAL_TODOS: TodoItem[] = [
  { id: 1, text: "Call insurance agent" },
  { id: 2, text: "Check SIP status" },
  { id: 3, text: "Review kids' expenses" },
  { id: 4, text: "Book dentist appointment" },
];

// ── Upcoming Bills ────────────────────────────────────

export interface Bill {
  id: number;
  name: string;
  amount: string;
  daysUntilDue: number; // positive = future, 0 = today, negative = overdue
}

export const UPCOMING_BILLS: Bill[] = [
  { id: 1, name: "Tata Power",       amount: "₹2,140",  daysUntilDue: 1  },
  { id: 2, name: "HDFC Credit Card", amount: "₹38,450", daysUntilDue: 2  },
  { id: 3, name: "SIP — Axis MF",    amount: "₹10,000", daysUntilDue: 5  },
  { id: 4, name: "LIC Premium",      amount: "₹15,200", daysUntilDue: 12 },
  { id: 5, name: "Broadband",        amount: "₹999",    daysUntilDue: 18 },
];
