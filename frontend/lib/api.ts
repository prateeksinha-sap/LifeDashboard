/**
 * lib/api.ts — typed API client for Life Dashboard backend
 */

const BASE = "http://localhost:8000";

// ── Wealth ─────────────────────────────────────────────────────────────

export interface WealthSlice {
  label:      string;
  value:      number;
  percentage: number;
  color:      string;
}

export interface WealthData {
  total_net_worth:   number;
  slices:            WealthSlice[];
  asset_type_slices: WealthSlice[];   // Equity / Debt / Gold / Cash
  mf_count:          number;
  stock_count:       number;
  last_updated:      string;
}

export interface XIRRData {
  xirr_pct:       number | null;
  cagr_pct:       number | null;
  total_invested: number;
  current_value:  number;
  absolute_gain:  number;
  gain_pct:       number;
  years:          number;
  method:         string;
  note:           string | null;
  error:          string | null;
}

// ── Todos / Bills / Priorities ────────────────────────────────────────

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
  id:                  number;
  rank:                number;
  text:                string;
  eisenhower_quadrant: string;   // Q1 | Q2 | Q3 | Q4
}

// ── Health ────────────────────────────────────────────────────────────

export interface HealthMetricDay {
  date:        string;
  steps:       number | null;
  sleep_hours: number | null;
  resting_hr:  number | null;
  active_mins: number | null;
  calories:    number | null;
}

export interface HealthMetricsData {
  records:     HealthMetricDay[];
  avg_steps:   number;
  avg_sleep:   number;
  avg_hr:      number;
  days_logged: number;
}

export interface MedicalData {
  id:           number;
  report_date:  string;
  source:       string | null;
  summary:      string | null;
  status_flags: Record<string, string>;   // { HbA1c: "optimal", ... }
  action_items: string[];
  overall:      string;                   // "optimal" | "warning" | "critical"
}

// ── Life Balance ──────────────────────────────────────────────────────

export interface LifeCategory {
  category:   string;
  minutes:    number;
  hours:      number;
  percentage: number;
}

export interface LifeLogData {
  days:          number;
  total_hours:   number;
  categories:    LifeCategory[];
  subcategories: { label: string; minutes: number }[];
}

// ── Personal CRM ──────────────────────────────────────────────────────

export interface CRMContact {
  id:                 number;
  contact_name:       string;
  relationship:       string | null;
  last_contact_date:  string | null;
  days_since:         number;
  check_in_interval:  number;
  overdue:            boolean;
  days_overdue:       number;
  notes:              string | null;
}


// ── Fetchers ──────────────────────────────────────────────────────────

export async function fetchWealth(): Promise<WealthData> {
  const res = await fetch(`${BASE}/api/wealth`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Wealth API error: ${res.status}`);
  return res.json();
}

export async function fetchXIRR(): Promise<XIRRData> {
  const res = await fetch(`${BASE}/api/analytics/xirr`, { cache: "no-store" });
  if (!res.ok) throw new Error(`XIRR API error: ${res.status}`);
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

export async function fetchHealthMetrics(days = 10): Promise<HealthMetricsData> {
  const res = await fetch(`${BASE}/api/health-data/metrics?days=${days}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Health metrics error: ${res.status}`);
  return res.json();
}

export async function fetchMedical(): Promise<MedicalData | null> {
  const res = await fetch(`${BASE}/api/health-data/medical`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Medical API error: ${res.status}`);
  const data = await res.json();
  return data ?? null;
}

export async function fetchLifeLog(days = 7): Promise<LifeLogData> {
  const res = await fetch(`${BASE}/api/health-data/lifelog?days=${days}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`LifeLog API error: ${res.status}`);
  return res.json();
}

export async function fetchCRM(): Promise<CRMContact[]> {
  const res = await fetch(`${BASE}/api/health-data/crm`, { cache: "no-store" });
  if (!res.ok) throw new Error(`CRM API error: ${res.status}`);
  return res.json();
}

export async function markCheckedIn(id: number): Promise<void> {
  await fetch(`${BASE}/api/health-data/crm/${id}/checked-in`, { method: "PATCH" });
}

// ── Mutations ─────────────────────────────────────────────────────────

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
