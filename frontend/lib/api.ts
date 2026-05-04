/**
 * lib/api.ts — typed API client for Life Dashboard backend
 */

import { API_BASE } from "@/lib/config";

// ── Wealth ─────────────────────────────────────────────────────────────

export interface WealthSlice {
  label:      string;
  value:      number;
  percentage: number;
  color:      string;
}

export interface WealthData {
  total_net_worth:   number;
  gross_assets?:      number;
  liabilities?:       number;
  slices:            WealthSlice[];
  asset_type_slices: WealthSlice[];   // Equity / Debt / Gold / Cash
  mf_count:          number;
  stock_count:       number;
  last_updated:      string;
}

export interface EquityExposureRow {
  type:           "Mutual Fund" | "Direct Stock" | "ETF Look-through";
  source:         string;
  stock_name:     string;
  symbol?:        string | null;
  isin?:          string | null;
  category:       "Large Cap" | "Mid Cap" | "Small Cap" | null;
  sector:         string;
  weight_pct:     number;
  parent_weight_pct?: number;
  value:          number;
  fund_value?:    number;
  quantity?:      number;
  avg_price?:     number;
  current_price?: number;
  updated_at?:    string | null;
  lookthrough_source?: string | null;
  weight_method?: string | null;
  reason?:        string;
}

export interface EquityBucket {
  label:      string;
  value:      number;
  percentage: number;
  color:      string;
  count:      number;
  rows:       EquityExposureRow[];
}

export interface EquitySectorBucket {
  label:      string;
  value:      number;
  percentage: number;
  color:      string;
  count:      number;
}

export interface EquityAllocationData {
  total_equity:          number;
  mapped_value:          number;
  unmapped_value:        number;
  coverage_pct:          number;
  bucket_count:          number;
  sector_count:          number;
  sector_mapped_value:   number;
  sector_unmapped_value: number;
  sector_coverage_pct:   number;
  row_count:             number;
  holding_count:         number;
  security_master_count: number;
  fund_portfolio_row_count: number;
  classification_method: string;
  buckets:               EquityBucket[];
  sector_allocation:     EquitySectorBucket[];
  rows:                  EquityExposureRow[];
  unmapped: {
    value:                    number;
    missing_fund_composition: Array<{ type: string; source: string; value: number; reason: string }>;
    unclassified_rows:        EquityExposureRow[];
  };
  last_updated:          string;
}

export interface SectorGuidanceSource {
  title: string;
  url: string;
  source: string;
  published_iso: string | null;
  sectors: string[];
}

export interface SectorGuidanceSuggestion {
  sector: string;
  stance: "add" | "hold" | "reduce" | "research";
  why: string;
  action: string;
  confidence: "low" | "medium" | "high";
  dashboard_evidence: string[];
  source_evidence: string[];
}

export interface SectorGuidanceData {
  status: string;
  generated_at: string;
  provider: string;
  model: string | null;
  fallback: boolean;
  cached?: boolean;
  source_count: number;
  headline: string;
  suggestions: SectorGuidanceSuggestion[];
  limitations: string[];
  sources: SectorGuidanceSource[];
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
  const res = await fetch(`${API_BASE}/api/wealth`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Wealth API error: ${res.status}`);
  return res.json();
}

export async function fetchEquityAllocation(): Promise<EquityAllocationData> {
  const res = await fetch(`${API_BASE}/api/wealth/equity-allocation`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Equity allocation API error: ${res.status}`);
  return res.json();
}

export async function uploadEquitySecurityMaster(file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/wealth/equity-allocation/import-security-master`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Security master import failed: ${res.status}`);
  }
  return res.json();
}

export async function uploadFundPortfolio(file: File, schemeName = "", asOfDate = "") {
  const form = new FormData();
  form.append("file", file);
  if (schemeName) form.append("scheme_name", schemeName);
  if (asOfDate) form.append("as_of_date", asOfDate);
  const res = await fetch(`${API_BASE}/api/wealth/equity-allocation/import-fund-portfolio`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Fund portfolio import failed: ${res.status}`);
  }
  return res.json();
}

export async function refreshEquitySecurityMaster() {
  const res = await fetch(`${API_BASE}/api/wealth/equity-allocation/refresh-security-master`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `AMFI refresh failed: ${res.status}`);
  }
  return res.json();
}

export async function syncEquityLookthrough() {
  const res = await fetch(`${API_BASE}/api/wealth/equity-allocation/sync`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Equity look-through sync failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchSectorGuidance(days = 45, force = false): Promise<SectorGuidanceData> {
  const params = new URLSearchParams({ days: String(days), use_ai: "true", force: String(force) });
  const res = await fetch(`${API_BASE}/api/wealth/equity-allocation/sector-guidance?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sector guidance error: ${res.status}`);
  return res.json();
}

export async function fetchXIRR(): Promise<XIRRData> {
  const res = await fetch(`${API_BASE}/api/analytics/xirr`, { cache: "no-store" });
  if (!res.ok) throw new Error(`XIRR API error: ${res.status}`);
  return res.json();
}

export async function fetchTodos(): Promise<Todo[]> {
  const res = await fetch(`${API_BASE}/api/todos`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Todos API error: ${res.status}`);
  return res.json();
}

export async function fetchBills(): Promise<Bill[]> {
  const res = await fetch(`${API_BASE}/api/bills`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Bills API error: ${res.status}`);
  return res.json();
}

export async function fetchPriorities(): Promise<Priority[]> {
  const res = await fetch(`${API_BASE}/api/priorities`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Priorities API error: ${res.status}`);
  return res.json();
}

export async function fetchHealthMetrics(days = 10): Promise<HealthMetricsData> {
  const res = await fetch(`${API_BASE}/api/health-data/metrics?days=${days}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Health metrics error: ${res.status}`);
  return res.json();
}

export async function fetchMedical(): Promise<MedicalData | null> {
  const res = await fetch(`${API_BASE}/api/health-data/medical`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Medical API error: ${res.status}`);
  const data = await res.json();
  return data ?? null;
}

export async function fetchLifeLog(days = 7): Promise<LifeLogData> {
  const res = await fetch(`${API_BASE}/api/health-data/lifelog?days=${days}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`LifeLog API error: ${res.status}`);
  return res.json();
}

export async function fetchCRM(): Promise<CRMContact[]> {
  const res = await fetch(`${API_BASE}/api/health-data/crm`, { cache: "no-store" });
  if (!res.ok) throw new Error(`CRM API error: ${res.status}`);
  return res.json();
}

export async function markCheckedIn(id: number): Promise<void> {
  await fetch(`${API_BASE}/api/health-data/crm/${id}/checked-in`, { method: "PATCH" });
}

// ── Actionables ───────────────────────────────────────────────────────

export interface Actionable {
  id:                number;
  source:            string;          // "Gmail" | "Manual"
  task_description:  string;
  due_date:          string | null;   // ISO date "2026-04-10" or null
  priority:          string;          // "High" | "Medium" | "Low"
  status:            string;          // "Pending" | "Completed"
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
  const res = await fetch(`${API_BASE}/api/actionables${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Actionables API error: ${res.status}`);
  return res.json();
}

export async function markActionableDone(id: number): Promise<Actionable> {
  const res = await fetch(`${API_BASE}/api/actionables/${id}`, {
    method:  "PUT",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ status: "Completed" }),
  });
  if (!res.ok) throw new Error(`Mark done error: ${res.status}`);
  return res.json();
}

export async function deleteActionable(id: number): Promise<void> {
  await fetch(`${API_BASE}/api/actionables/${id}`, { method: "DELETE" });
}

export interface GmailStatus {
  configured: boolean;
  authorized: boolean;
  reconnect_required?: boolean;
  deps_ready: boolean;
  ai_online: boolean;
  ai_model: string | null;
  last_successful_sync?: string | null;
  initial_backfill_done?: boolean;
  last_mode?: string | null;
  last_query?: string | null;
  last_sync: string | null;
  last_result: {
    processed?: number;
    candidates?: number;
    skipped_unimportant?: number;
    actionables_created?: number;
    bills_created?: number;
    errors?: number;
    mode?: string;
  } | null;
  last_error: string | null;
  next_step: string;
}

export interface GmailSyncResult {
  status: string;
  processed: number;
  candidates?: number;
  skipped_unimportant?: number;
  actionables_created: number;
  bills_created?: number;
  errors: number;
  mode?: string;
}

export async function fetchGmailStatus(): Promise<GmailStatus> {
  const res = await fetch(`${API_BASE}/api/gmail/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Gmail status error: ${res.status}`);
  return res.json();
}

export async function uploadGmailCredentials(file: File): Promise<GmailStatus> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/gmail/credentials`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Credential upload error: ${res.status}`);
  }
  return fetchGmailStatus();
}

export async function runGmailSync(hours = 72, mode = "auto", maxMessages = 300): Promise<GmailSyncResult> {
  const params = new URLSearchParams({
    hours: String(hours),
    mode,
    max_messages: String(maxMessages),
  });
  const res = await fetch(`${API_BASE}/api/gmail/sync?${params}`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Gmail sync error: ${res.status}`);
  }
  return res.json();
}

export interface IngestionSourceStatus {
  key: string;
  label: string;
  status: "ready" | "missing";
  count: number;
  detail: string;
  required_for_month_close: boolean;
  current_month_ready?: boolean;
  last_updated?: string | null;
  age_days?: number | null;
  quality_score: number;
  issues: string[];
  next_action: string;
}

export interface IngestionStatus {
  ready: number;
  total: number;
  completion_pct: number;
  quality_score: number;
  required_ready: number;
  required_total: number;
  top_issues: string[];
  sources: IngestionSourceStatus[];
}

export interface AutomationStatus {
  enabled: boolean;
  gmail: {
    configured: boolean;
    authorized: boolean;
    reconnect_required?: boolean;
    interval_minutes: number;
    last_sync?: string | null;
    last_result?: GmailSyncResult | null;
    last_error?: string | null;
  };
  ingestion?: {
    enabled: boolean;
    auto_import: boolean;
    interval_minutes: number;
    drop_folder: string;
    last_scan?: string | null;
    last_result?: unknown;
    last_error?: string | null;
  };
  investments: {
    interval_hours: number;
    last_refresh?: string | null;
    last_result?: {
      stocks_updated?: number;
      stocks_total?: number;
      mutual_funds_updated?: number;
      mutual_funds_total?: number;
    } | null;
    last_error?: string | null;
  };
  equity_lookthrough?: {
    enabled: boolean;
    interval_hours: number;
    last_refresh?: string | null;
    last_result?: unknown;
    last_error?: string | null;
  };
  snapshot: {
    auto_capture_enabled: boolean;
    last_snapshot_month?: string | null;
    last_snapshot_at?: string | null;
    last_result?: Record<string, unknown> | null;
    last_error?: string | null;
  };
  last_run?: string | null;
}

export async function fetchIngestionStatus(): Promise<IngestionStatus> {
  const res = await fetch(`${API_BASE}/api/ingestion/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Ingestion status error: ${res.status}`);
  return res.json();
}

export async function fetchAutomationStatus(): Promise<AutomationStatus> {
  const res = await fetch(`${API_BASE}/api/automation/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Automation status error: ${res.status}`);
  return res.json();
}

export async function runAutomationNow(): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/automation/run?force=true`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Automation error: ${res.status}`);
  }
  return res.json();
}

// Portfolio Agent

export interface PortfolioAgentDecision {
  id: number;
  fingerprint: string;
  status: "Review" | "Accepted" | "Stalling" | "Dismissed" | "Executed";
  notes: string | null;
  review_date: string | null;
  dismissed_until: string | null;
  actionable_id: number | null;
  last_recommendation_id: number | null;
  last_run_id: string | null;
  decided_at: string | null;
  updated_at: string | null;
}

export interface PortfolioAgentRun {
  id: number;
  run_id: string;
  report_date: string | null;
  generated_at: string | null;
  imported_at: string | null;
  source_path: string | null;
  run_mode: string | null;
  data_mode: string | null;
  delivery_mode: string | null;
  delivery_status: { email: string | null; slack: string | null };
  model: string | null;
  estimated_cost_usd: number | null;
  summary: {
    total_invested: number | null;
    total_current_value: number | null;
    total_pnl: number | null;
    total_pnl_pct: number | null;
    required_annual_return_pct: number | null;
    estimated_portfolio_cagr: number | null;
    target_portfolio_value: number | null;
    on_track_to_double: boolean | null;
  };
  capital_growth_verdict: string | null;
  overall_sentiment: string | null;
  top_action: string | null;
  report?: Record<string, unknown>;
  cost?: Record<string, unknown> | null;
}

export interface PortfolioAgentRecommendation {
  id: number;
  run_id: string;
  source_type: "action_plan" | "validated" | "rejected" | "futures";
  fingerprint: string;
  priority: number | null;
  ticker: string | null;
  name: string | null;
  action: string;
  timing: string | null;
  source_agent: string | null;
  conviction: string | null;
  estimated_amount_inr: number | null;
  suggested_allocation_pct: number | null;
  target_price: number | null;
  rationale: string | null;
  raw: Record<string, unknown> | null;
  decision: PortfolioAgentDecision | null;
}

export interface PortfolioAgentBrief {
  status: "ok" | "empty" | "missing";
  report_dir: string;
  report_dir_exists: boolean;
  is_live?: boolean;
  latest_run: PortfolioAgentRun | null;
  latest_imported_run?: PortfolioAgentRun | null;
  newer_non_live_count?: number;
  action_plan: PortfolioAgentRecommendation[];
  validated_recommendations: PortfolioAgentRecommendation[];
  rejected_recommendations: PortfolioAgentRecommendation[];
  unresolved_count: number;
  recent_decisions: PortfolioAgentDecision[];
  history: PortfolioAgentRun[];
}

export interface PortfolioAgentSyncResult {
  status: string;
  report_dir: string;
  report_dir_exists: boolean;
  imported_runs: number;
  imported_recommendations: number;
  updated_runs: number;
  skipped_runs: number;
  errors: Array<{ path: string; error: string }>;
}

export async function syncPortfolioAgentReports(): Promise<PortfolioAgentSyncResult> {
  const res = await fetch(`${API_BASE}/api/portfolio-agent/sync`, { method: "POST" });
  if (!res.ok) throw new Error(`Portfolio sync error: ${res.status}`);
  return res.json();
}

export async function fetchPortfolioAgentBrief(): Promise<PortfolioAgentBrief> {
  const res = await fetch(`${API_BASE}/api/portfolio-agent/brief`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Portfolio brief error: ${res.status}`);
  return res.json();
}

export async function fetchPortfolioAgentRuns(): Promise<PortfolioAgentRun[]> {
  const res = await fetch(`${API_BASE}/api/portfolio-agent/runs`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Portfolio runs error: ${res.status}`);
  return res.json();
}

export async function updatePortfolioAgentDecision(
  recommendationId: number,
  payload: { status: PortfolioAgentDecision["status"]; notes?: string; review_date?: string | null },
): Promise<{ decision: PortfolioAgentDecision; recommendation: PortfolioAgentRecommendation }> {
  const res = await fetch(`${API_BASE}/api/portfolio-agent/recommendations/${recommendationId}/decision`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Portfolio decision error: ${res.status}`);
  }
  return res.json();
}

// Assistant

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantStatus {
  provider: string;
  model: string | null;
  mode?: string;
  local_preferred_model?: string;
  available_local_models?: string[];
  openai?: {
    configured: boolean;
    working: boolean;
    model: string;
    status: string;
    message?: string;
    next_step?: string | null;
  };
  anthropic?: {
    configured: boolean;
    working: boolean | null;
    model: string;
    status: string;
  };
  ollama?: {
    online: boolean;
    url?: string;
    active_model?: string;
    available?: string[];
    model_present?: boolean;
    error?: string;
  };
  enabled?: boolean;
  online: boolean;
  model_present: boolean;
  fallback_available: boolean;
}

export interface AssistantResponse {
  answer: string;
  provider: string;
  model: string | null;
  grounded: boolean;
  data_used: string[];
  suggested_questions: string[];
  fallback: boolean;
}

export async function fetchAssistantStatus(): Promise<AssistantStatus> {
  const res = await fetch(`${API_BASE}/api/assistant/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Assistant status error: ${res.status}`);
  return res.json();
}

export async function askAssistant(
  message: string,
  history: AssistantMessage[] = [],
): Promise<AssistantResponse> {
  const res = await fetch(`${API_BASE}/api/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Assistant error: ${res.status}`);
  }
  return res.json();
}

// ── Wealth analytics ──────────────────────────────────────────────────

// Financial Coach

export interface CoachOpportunity {
  id: string;
  category: string;
  title: string;
  why: string;
  action: string;
  impact_monthly: number;
  impact_annual: number;
  confidence: string;
  difficulty: string;
  evidence: string[];
  priority: number;
  status: string;
}

export interface CoachAllocation {
  label: string;
  value: number;
  percentage: number;
}

export interface CoachTarget {
  label: string;
  target_value: number;
  months: number;
  required_monthly_contribution: number;
  current_gap_per_month: number;
}

export interface PlanningLiability {
  id: number;
  name: string;
  liability_type: string;
  outstanding_amount: number;
  interest_rate_pct: number | null;
  emi_amount: number | null;
  due_day: number | null;
  notes: string | null;
  updated_at: string | null;
}

export interface PlanningLiabilitySummary {
  total: number;
  monthly_emi: number;
  count: number;
  items: PlanningLiability[];
}

export interface PlanningGoal {
  id: number;
  name: string;
  target_amount: number;
  target_date: string | null;
  current_amount: number;
  priority: string;
  notes: string | null;
  updated_at?: string | null;
}

export interface PlanningGoalStatus extends PlanningGoal {
  gap: number;
  months_left: number | null;
  required_monthly: number;
  on_track: boolean | null;
  progress_pct: number;
}

export interface DailyBriefing {
  as_of: string;
  headline: string;
  metrics: {
    net_worth: number;
    gross_assets: number;
    liabilities: number;
    cash: number;
    monthly_surplus: number;
    true_spend: number;
    mf_plan: number;
    confidence: string;
  };
  actions: { priority: number; title: string; detail: string; impact: string }[];
  data_quality: {
    months_of_cashflow_data: number;
    analyzed_months: string[];
    missing_liabilities: boolean;
    missing_goals: boolean;
  };
}

export interface PlanningOverview {
  as_of: string;
  liabilities: PlanningLiabilitySummary;
  goals: PlanningGoalStatus[];
  forecast: ForecastData;
  data_quality: {
    has_liabilities: boolean;
    has_goals: boolean;
    months_of_cashflow_data: number;
  };
}

export interface ScenarioResponse {
  base_final_net_worth: number;
  scenario_final_net_worth: number;
  incremental_wealth: number;
  points: { year: number; net_worth: number; cash: number; invested: number }[];
  inputs: Record<string, number>;
  assumptions: Record<string, unknown>;
}

export interface CoachOverview {
  as_of: string;
  month: string;
  health_score: number;
  health_band: string;
  scores: Record<string, number>;
  metrics: {
    net_worth: number;
    gross_assets?: number;
    liabilities?: number;
    monthly_emi?: number;
    cash: number;
    income: number;
    total_debits: number;
    true_expenses: number;
    investment_outflow: number;
    unclear_transfers: number;
    bank_surplus: number;
    lifestyle_surplus: number;
    wealth_creation: number;
    bank_savings_rate_pct: number;
    wealth_creation_rate_pct: number;
    cash_runway_months: number | null;
    avg_income_6m: number;
    avg_true_expenses_6m: number;
    avg_wealth_creation_6m: number;
  };
  targets: CoachTarget[];
  forecast: {
    projected_2y: number;
    projected_5y: number;
    assumed_return_pct: number;
    monthly_contribution_used: number;
    salary_growth_pct?: number;
    spend_inflation_pct?: number;
    mf_step_up_pct?: number;
    step_up_projected_5y?: number;
    cash_projected_5y?: number;
    step_up_cash_projected_5y?: number;
  };
  allocation: CoachAllocation[];
  cashflow: {
    month: string;
    income: number;
    debits_total: number;
    true_expenses: number;
    investment_outflow: number;
    unclear_transfers: number;
    bank_surplus: number;
    wealth_creation_rate_pct: number;
    transaction_count?: number;
    categories: {
      category: string;
      total: number;
      count: number;
      percentage_of_debits: number;
      top_merchants: { merchant: string; total: number }[];
    }[];
  };
  opportunities: CoachOpportunity[];
  mirror: string[];
  data_gaps: string[];
  quality: Record<string, string | number | null>;
  attention: {
    bills_due_14d: number;
    urgent_actions: number;
    pending_actions: number;
  };
  goals?: PlanningGoalStatus[];
  liabilities?: PlanningLiabilitySummary;
}

export interface CoachReport {
  report: string;
  provider: string;
  model: string | null;
  fallback: boolean;
  data_used: string[];
}

export async function fetchCoachOverview(): Promise<CoachOverview> {
  const res = await fetch(`${API_BASE}/api/coach/overview`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Coach overview error: ${res.status}`);
  return res.json();
}

export async function fetchPlanningOverview(): Promise<PlanningOverview> {
  const res = await fetch(`${API_BASE}/api/planning/overview`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Planning overview error: ${res.status}`);
  return res.json();
}

export async function fetchDailyBriefing(): Promise<DailyBriefing> {
  const res = await fetch(`${API_BASE}/api/planning/briefing`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Daily briefing error: ${res.status}`);
  return res.json();
}

export async function createLiability(payload: Omit<PlanningLiability, "id" | "updated_at">): Promise<PlanningLiability> {
  const res = await fetch(`${API_BASE}/api/planning/liabilities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Create liability error: ${res.status}`);
  return res.json();
}

export async function createGoal(payload: Omit<PlanningGoal, "id" | "updated_at">): Promise<PlanningGoal> {
  const res = await fetch(`${API_BASE}/api/planning/goals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Create goal error: ${res.status}`);
  return res.json();
}

export async function fetchScenario(params: {
  monthly_extra_investment?: number;
  spend_cut_pct?: number;
  salary_growth_pct?: number;
  mf_step_up_pct?: number;
}): Promise<ScenarioResponse> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) qs.set(key, String(value));
  });
  const res = await fetch(`${API_BASE}/api/planning/scenario?${qs.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Scenario error: ${res.status}`);
  return res.json();
}

export async function generateCoachReport(): Promise<CoachReport> {
  const res = await fetch(`${API_BASE}/api/coach/report`, { method: "POST" });
  if (!res.ok) throw new Error(`Coach report error: ${res.status}`);
  return res.json();
}

export interface MonthData {
  month:     string;
  income:    number;
  expenses:  number;
  expenses_excluding_investments?: number;
  investment_outflow?: number;
  net_worth: number | null;
  has_data:  boolean;
  is_current_month?: boolean;
  is_provisional?: boolean;
  visible_in_trend?: boolean;
}

export interface TrendsResponse {
  months:           MonthData[];
  has_transactions: boolean;
  total_transaction_count?: number;
  earliest_transaction_date?: string | null;
  latest_transaction_date?: string | null;
  range_mode?: string;
  range_label?: string;
  total_snapshot_count?: number;
  earliest_snapshot_month?: string | null;
  latest_snapshot_month?: string | null;
  is_showing_imported_period?: boolean;
  provisional_months?: string[];
  provisional_month_note?: string | null;
}

export interface SavingsRateData {
  current_month:                  string;
  income_this_month:              number;
  expenses_this_month:            number;
  savings_this_month:             number;
  savings_rate_pct:               number;
  trailing_6m_avg_income:         number;
  trailing_6m_avg_expenses:       number;
  trailing_6m_avg_savings:        number;
  trailing_6m_savings_rate_pct:   number;
  has_data:                       boolean;
}

export interface ForecastDataPoint {
  year:  number;
  label: string;
  value: number;
  base_net_worth?: number;
  base_cash?: number;
  step_net_worth?: number;
  step_cash?: number;
  base_monthly_investment?: number;
  step_monthly_investment?: number;
  base_monthly_mf_investment?: number;
  step_monthly_mf_investment?: number;
  monthly_other_investment_outflow?: number;
  base_actual_monthly_investment?: number;
  step_actual_monthly_investment?: number;
  base_unfunded_investment?: number;
  step_unfunded_investment?: number;
  base_cash_shortfall?: number;
  step_cash_shortfall?: number;
  monthly_income?: number;
  monthly_true_expenses?: number;
  base_invested?: number;
  step_invested?: number;
}

export interface ForecastData {
  current_net_worth:       number;
  current_cash?:           number;
  current_invested_assets?: number;
  monthly_savings_assumed: number;
  gross_assets?:           number;
  liabilities?:            number;
  monthly_emi?:            number;
  monthly_income_assumed?: number;
  monthly_true_expenses?:  number;
  monthly_investment_outflow?: number;
  monthly_mutual_fund_investment?: number;
  monthly_other_investment_outflow?: number;
  observed_monthly_investment_outflow_avg?: number;
  monthly_investment_gap?: number;
  monthly_raw_cash_change?: number;
  savings_basis?:          string;
  investment_step_up_pct?: number;
  step_up_applies_to?:     string;
  base_unfunded_investment?: number;
  step_unfunded_investment?: number;
  base_cash_shortfall?: number;
  step_cash_shortfall?: number;
  base_cash_runs_out_month?: number | null;
  step_cash_runs_out_month?: number | null;
  annual_return_pct:       number;
  cash_return_pct?:        number;
  salary_growth_pct?:      number;
  spend_inflation_pct?:    number;
  projection_years:        number;
  data_points:             ForecastDataPoint[];
  months_of_cashflow_data: number;
  has_cashflow_data:       boolean;
  confidence:              "low" | "medium" | "high";
  notes:                   string[];
  assumptions?: {
    monthly_salary_inr?: number;
    salary_growth_pct?: number;
    spend_inflation_pct?: number;
    default_mf_step_up_pct?: number;
    projection_years?: number;
    return_rates_pct?: Record<string, number>;
    gold_price_inr_per_gram?: number;
  };
  analyzed_months?: string[];
  asset_return_components?: {
    label: string;
    value: number;
    annual_return_pct: number;
  }[];
}

export interface DashboardSummary {
  as_of: string;
  net_worth: number;
  cash: number;
  income_this_month: number;
  expenses_this_month: number;
  savings_this_month: number;
  savings_rate_pct: number | null;
  pending_actions: number;
  urgent_actions: number;
  bills_due_7d: number;
  overdue_contacts: number;
  data_counts: Record<string, number>;
  missing_inputs: string[];
  transparency_score: number;
}

export interface MonthCloseStatus {
  month_year: string;
  period_start: string;
  period_end: string;
  status: string;
  due: boolean;
  data_quality_score: number;
  checklist: Record<string, boolean>;
  missing: string[];
  can_capture_snapshot: boolean;
  required_steps: {
    key: string;
    label: string;
    why: string;
    required: boolean;
    done: boolean;
  }[];
  metrics: {
    income: number;
    expenses: number;
    savings: number;
    transaction_count: number;
    net_worth: number;
    liquid: number;
    invested: number;
    pending_actions: number;
  };
  notes: string | null;
  closed_at: string | null;
}

export async function fetchTrends(): Promise<TrendsResponse> {
  const res = await fetch(`${API_BASE}/api/wealth/trends`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Trends API error: ${res.status}`);
  return res.json();
}

export async function fetchSavingsRate(): Promise<SavingsRateData> {
  const res = await fetch(`${API_BASE}/api/wealth/savings-rate`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Savings rate API error: ${res.status}`);
  return res.json();
}

export async function fetchForecast(stepUpPct = 10): Promise<ForecastData> {
  const params = new URLSearchParams({ step_up_pct: String(stepUpPct) });
  const res = await fetch(`${API_BASE}/api/wealth/forecast?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Forecast API error: ${res.status}`);
  return res.json();
}

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const res = await fetch(`${API_BASE}/api/dashboard/summary`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Dashboard summary error: ${res.status}`);
  return res.json();
}

export async function fetchCurrentMonthClose(): Promise<MonthCloseStatus> {
  const res = await fetch(`${API_BASE}/api/month-close/current`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Month close error: ${res.status}`);
  return res.json();
}

export async function captureMonthSnapshot(monthYear: string): Promise<MonthCloseStatus> {
  const res = await fetch(`${API_BASE}/api/month-close/${monthYear}/snapshot`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    throw new Error(detail?.message || `Capture snapshot error: ${res.status}`);
  }
  return res.json();
}

export async function updateMonthClose(
  monthYear: string,
  patch: Partial<Record<"bank_statement_imported" | "balances_updated" | "investments_refreshed" | "actionables_reviewed", boolean>>,
): Promise<MonthCloseStatus> {
  const res = await fetch(`${API_BASE}/api/month-close/${monthYear}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Update month close error: ${res.status}`);
  return res.json();
}

// ── Mutations ─────────────────────────────────────────────────────────

export async function createTodo(text: string): Promise<Todo> {
  const res = await fetch(`${API_BASE}/api/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Create todo error: ${res.status}`);
  return res.json();
}

export async function patchTodo(id: number, patch: { text?: string; done?: boolean }): Promise<Todo> {
  const res = await fetch(`${API_BASE}/api/todos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Patch todo error: ${res.status}`);
  return res.json();
}

export async function deleteTodo(id: number): Promise<void> {
  await fetch(`${API_BASE}/api/todos/${id}`, { method: "DELETE" });
}

export async function updatePriorities(
  items: { rank: number; text: string; eisenhower_quadrant: string }[]
): Promise<Priority[]> {
  const res = await fetch(`${API_BASE}/api/priorities`, {
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
  const res = await fetch(`${API_BASE}/api/bills`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(bill),
  });
  if (!res.ok) throw new Error(`Create bill error: ${res.status}`);
  return res.json();
}

export async function deleteBill(id: number): Promise<void> {
  await fetch(`${API_BASE}/api/bills/${id}`, { method: "DELETE" });
}

export async function markBillPaid(id: number): Promise<Bill> {
  const res = await fetch(`${API_BASE}/api/bills/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_paid: true }),
  });
  if (!res.ok) throw new Error(`Mark paid error: ${res.status}`);
  return res.json();
}
