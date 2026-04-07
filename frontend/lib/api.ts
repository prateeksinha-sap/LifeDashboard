/**
 * lib/api.ts — typed API client for Life Dashboard backend
 */

const BASE = "http://localhost:8001";

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

// ── Actionables ───────────────────────────────────────────────────────

export interface Actionable {
  id:                number;
  source:            string;          // "Gmail" | "Manual"
  task_description:  string;
  due_date:          string | null;   // ISO date "2026-04-10" or null
  priority:          string;          // "High" | "Medium" | "Low"
  status:            string;          // "Pending" | "Done"
  original_email_id: string | null;
  sender:            string | null;
  subject:           string | null;
  created_at:        string;
}

export async function fetchActionables(
  status?: string,
  source?: string,
): Promise<Actionable[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (source) params.set("source", source);
  const qs  = params.toString() ? `?${params}` : "";
  const res = await fetch(`${BASE}/api/actionables${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Actionables API error: ${res.status}`);
  return res.json();
}

export async function markActionableDone(id: number): Promise<Actionable> {
  const res = await fetch(`${BASE}/api/actionables/${id}`, {
    method:  "PUT",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ status: "Done" }),
  });
  if (!res.ok) throw new Error(`Mark done error: ${res.status}`);
  return res.json();
}

export async function deleteActionable(id: number): Promise<void> {
  await fetch(`${BASE}/api/actionables/${id}`, { method: "DELETE" });
}

// ── Wealth analytics ──────────────────────────────────────────────────

export interface MonthData {
  month:     string;
  income:    number;
  expenses:  number;
  net_worth: number | null;
  has_data:  boolean;
}

export interface TrendsResponse {
  months:           MonthData[];
  has_transactions: boolean;
}

export interface SavingsRateData {
  current_month:      string;
  current_income:     number;
  current_expenses:   number;
  current_savings:    number;
  savings_rate_pct:   number;
  trailing_6m_avg:    number;
  has_data:           boolean;
}

export interface ForecastDataPoint {
  year:  number;
  label: string;
  value: number;
}

export interface ForecastData {
  current_net_worth:       number;
  monthly_savings_assumed: number;
  annual_return_pct:       number;
  projection_years:        number;
  data_points:             ForecastDataPoint[];
}

export async function fetchTrends(): Promise<TrendsResponse> {
  const res = await fetch(`${BASE}/api/wealth/trends`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Trends API error: ${res.status}`);
  return res.json();
}

export async function fetchSavingsRate(): Promise<SavingsRateData> {
  const res = await fetch(`${BASE}/api/wealth/savings-rate`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Savings rate API error: ${res.status}`);
  return res.json();
}

export async function fetchForecast(): Promise<ForecastData> {
  const res = await fetch(`${BASE}/api/wealth/forecast`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Forecast API error: ${res.status}`);
  return res.json();
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

export async function updatePriorities(
  items: { rank: number; text: string; eisenhower_quadrant: string }[]
): Promise<Priority[]> {
  const res = await fetch(`${BASE}/api/priorities`, {
    method:  "PUT",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(items),
  });
  if (!res.ok) throw new Error(`Update priorities error: ${res.status}`);
  return res.json();
}

export async function createBill(bill: {
  name: string; amount: number; due_date: string;
  is_recurring: boolean; recurrence_days: number | null;
}): Promise<Bill> {
  const res = await fetch(`${BASE}/api/bills`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(bill),
  });
  if (!res.ok) throw new Error(`Create bill error: ${res.status}`);
  return res.json();
}

export async function deleteBill(id: number): Promise<void> {
  await fetch(`${BASE}/api/bills/${id}`, { method: "DELETE" });
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
