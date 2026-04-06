/**
 * lib/api.ts — typed API client for Life Dashboard backend
 */

const BASE = "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────

export interface WealthSlice {
  label:      string;
  value:      number;
  percentage: number;
  color:      string;
}

export interface WealthData {
  total_net_worth: number;
  slices:          WealthSlice[];
  mf_count:        number;
  stock_count:     number;
  last_updated:    string;
}

export interface Todo {
  id:         number;
  text:       string;
  done:       boolean;
  created_at: string;
}

export interface Bill {
  id:              number;
  name:            string;
  amount:          number;
  due_date:        string;
  days_until_due:  number;
  is_paid:         boolean;
  is_recurring:    boolean;
  recurrence_days: number | null;
}

export interface Priority {
  id:   number;
  rank: number;
  text: string;
}

// ── Fetchers ───────────────────────────────────────────────────────────

export async function fetchWealth(): Promise<WealthData> {
  const res = await fetch(`${BASE}/api/wealth`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Wealth API error: ${res.status}`);
  return res.json();
}

export async function fetchTodos(): Promise<Todo[]> {
  const res = await fetch(`${BASE}/api/todos`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Todos API error: ${res.status}`);
  return res.json();
}

export async function fetchBills(): Promise<Bill[]> {
  const res = await fetch(`${BASE}/api/bills`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Bills API error: ${res.status}`);
  return res.json();
}

export async function fetchPriorities(): Promise<Priority[]> {
  const res = await fetch(`${BASE}/api/priorities`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Priorities API error: ${res.status}`);
  return res.json();
}

export async function createTodo(text: string): Promise<Todo> {
  const res = await fetch(`${BASE}/api/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Create todo error: ${res.status}`);
  return res.json();
}

export async function patchTodo(id: number, patch: { text?: string; done?: boolean }): Promise<Todo> {
  const res = await fetch(`${BASE}/api/todos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Patch todo error: ${res.status}`);
  return res.json();
}

export async function deleteTodo(id: number): Promise<void> {
  await fetch(`${BASE}/api/todos/${id}`, { method: "DELETE" });
}

export async function markBillPaid(id: number): Promise<Bill> {
  const res = await fetch(`${BASE}/api/bills/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_paid: true }),
  });
  if (!res.ok) throw new Error(`Mark paid error: ${res.status}`);
  return res.json();
}
