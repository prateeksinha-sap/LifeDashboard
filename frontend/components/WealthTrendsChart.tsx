"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Cell,
  Tooltip, Legend,
} from "recharts";
import {
  Upload, CheckCircle, AlertCircle, Loader, X, ArrowDownLeft, ArrowUpRight,
  Search, Trash2, ArrowUpDown,
} from "lucide-react";
import { API_BASE } from "@/lib/config";
import EmptyState from "@/components/EmptyState";
import SafeResponsiveContainer from "@/components/SafeResponsiveContainer";

interface MonthData {
  month: string;
  income: number;
  expenses: number;
  expenses_excluding_investments?: number;
  investment_outflow?: number;
  net_worth: number | null;
  has_data: boolean;
  is_current_month?: boolean;
  is_provisional?: boolean;
  visible_in_trend?: boolean;
}

interface TrendsResponse {
  months: MonthData[];
  has_transactions: boolean;
  range_mode?: string;
  range_label?: string;
  total_transaction_count?: number;
  earliest_transaction_date?: string | null;
  latest_transaction_date?: string | null;
  total_snapshot_count?: number;
  earliest_snapshot_month?: string | null;
  latest_snapshot_month?: string | null;
  is_showing_imported_period?: boolean;
  provisional_months?: string[];
  provisional_month_note?: string | null;
}

type UploadState = "idle" | "uploading" | "success" | "error";
type TrendRange = "auto" | "last12" | "all";
type ExpenseMode = "all" | "spend_only";

interface UploadResult {
  imported: number;
  skipped: number;
  errors: number;
  parsed_rows: number;
  earliest_date: string | null;
  latest_date: string | null;
  date_span_days: number;
  unique_months: string[];
}

type BreakdownDirection = "Credit" | "Debit";
type TransactionGroupBy = "category" | "merchant" | "account";
type TransactionSortKey = "date" | "amount" | "merchant" | "category";

interface CategoryBreakdown {
  category: string;
  total: number;
  count: number;
  percentage: number;
  top_merchants: { merchant: string; total: number }[];
}

interface TransactionBreakdown {
  id: number;
  date: string;
  description: string;
  merchant: string;
  amount: number;
  category: string;
  account_source: string | null;
  confidence: number;
}

interface MonthBreakdown {
  month: string;
  direction: BreakdownDirection;
  label: string;
  total: number;
  transaction_count: number;
  raw_transaction_count?: number;
  excluded_category_total?: number;
  excluded_category_count?: number;
  cash_withdrawals_hidden?: boolean;
  hidden_categories?: string[];
  exclude_investments?: boolean;
  derived_category_count: number;
  categories: CategoryBreakdown[];
  transactions: TransactionBreakdown[];
}

function fmtAxis(v: number): string {
  if (v >= 1_00_00_000) return `INR ${(v / 1_00_00_000).toFixed(1)}Cr`;
  if (v >= 1_00_000) return `INR ${(v / 1_00_000).toFixed(0)}L`;
  if (v >= 1_000) return `INR ${(v / 1_000).toFixed(0)}K`;
  return `INR ${v}`;
}

function fmtMoney(v: number): string {
  return `INR ${Math.round(v).toLocaleString("en-IN")}`;
}

function fmtMonth(my: string): string {
  const [y, m] = my.split("-");
  const month = new Date(+y, +m - 1).toLocaleString("en-IN", { month: "short" });
  return `${month} '${y.slice(2)}`;
}

function fmtDate(value?: string | null): string {
  if (!value) return "";
  const d = new Date(`${value}T00:00:00`);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const CustomTooltip = ({
  active, payload, label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "rgba(18,18,22,0.97)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 12,
      padding: "10px 14px",
      backdropFilter: "blur(20px)",
      minWidth: 160,
    }}>
      <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginBottom: 6 }}>
        {label ? fmtMonth(label) : ""}
      </p>
      {payload.map((p) => (
        <div key={p.name} style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 3 }}>
          <span style={{ color: p.color, fontSize: 11, fontWeight: 600 }}>{p.name}</span>
          <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: 700 }}>
            {fmtAxis(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

const EXPENSE_CATEGORIES = [
  "Investments & Savings",
  "Transfers Out",
  "Rent & Housing",
  "Household Help",
  "Education & Child",
  "Food & Delivery",
  "Groceries",
  "Utilities & Bills",
  "Shopping",
  "Travel & Transport",
  "Fuel & Vehicle",
  "Healthcare",
  "Insurance",
  "Subscriptions",
  "Entertainment",
  "Cash Withdrawal",
  "Taxes",
  "Bank Charges",
  "Miscellaneous",
];

const INCOME_CATEGORIES = ["Salary", "Investment Income", "Refunds & Reversals", "Transfers In", "Other Income"];

function monthFromChartPayload(entry: unknown): string | null {
  const payload = entry as { month?: string; payload?: { month?: string } } | null;
  return payload?.payload?.month ?? payload?.month ?? null;
}

export default function WealthTrendsChart() {
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [range, setRange] = useState<TrendRange>("auto");
  const [expenseMode, setExpenseMode] = useState<ExpenseMode>("all");
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedBreakdown, setSelectedBreakdown] = useState<{ month: string; direction: BreakdownDirection; excludeInvestments: boolean } | null>(null);
  const [breakdown, setBreakdown] = useState<MonthBreakdown | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState("");
  const [reloadBreakdownKey, setReloadBreakdownKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadTrends = useCallback((nextRange = range) =>
    fetch(`${API_BASE}/api/wealth/trends?range=${nextRange === "last12" ? "rolling" : nextRange}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`Trends API error: ${r.status}`);
        return r.json();
      })
      .then((json) => {
        setData(json);
        setErrorMessage("");
      })
      .catch((err) => setErrorMessage(err instanceof Error ? err.message : "Could not load trends."))
      .finally(() => setLoading(false)), [range]);

  useEffect(() => { loadTrends(range); }, [loadTrends, range]);

  useEffect(() => {
    if (!selectedBreakdown) {
      setBreakdown(null);
      setBreakdownError("");
      return;
    }

    setBreakdownLoading(true);
    setBreakdown(null);
    setBreakdownError("");
    const params = new URLSearchParams({ direction: selectedBreakdown.direction });
    if (selectedBreakdown.excludeInvestments) params.set("exclude_investments", "true");
    fetch(`${API_BASE}/api/wealth/transactions/month-breakdown/${selectedBreakdown.month}?${params.toString()}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`Breakdown API error: ${res.status}`);
        return res.json();
      })
      .then((json) => setBreakdown(json))
      .catch((err) => setBreakdownError(err instanceof Error ? err.message : "Could not load monthly breakdown."))
      .finally(() => setBreakdownLoading(false));
  }, [selectedBreakdown, reloadBreakdownKey]);

  const openBreakdown = (entry: unknown, direction: BreakdownDirection) => {
    const month = monthFromChartPayload(entry);
    if (!month) return;
    setSelectedBreakdown({
      month,
      direction,
      excludeInvestments: direction === "Debit" && expenseMode === "spend_only",
    });
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setUploadState("uploading");
    setUploadResult(null);
    setErrorMessage("");

    const form = new FormData();
    form.append("file", file);
    form.append("account", "Bank Account");
    form.append("no_llm", "true");

    try {
      const res = await fetch(`${API_BASE}/api/wealth/import-statement`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? "Upload failed");
      setUploadResult({
        imported: json.imported,
        skipped: json.skipped,
        errors: json.errors,
        parsed_rows: json.parsed_rows ?? 0,
        earliest_date: json.earliest_date ?? null,
        latest_date: json.latest_date ?? null,
        date_span_days: json.date_span_days ?? 0,
        unique_months: json.unique_months ?? [],
      });
      setUploadState("success");
      setTimeout(() => loadTrends(), 400);
      setTimeout(() => setUploadState("idle"), 5000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Upload failed.");
      setUploadState("error");
      setTimeout(() => setUploadState("idle"), 4000);
    }
  };

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <div className="h-4 w-4 animate-spin rounded-full border-2"
        style={{ borderColor: "rgba(10,132,255,0.3)", borderTopColor: "#0a84ff" }} />
    </div>
  );

  const noData = !data || (data.total_transaction_count ?? 0) === 0;
  const trendMonths = data?.months ?? [];
  const provisionalMonths = trendMonths.filter((month) => month.has_data && month.is_provisional);
  const visibleMonths = trendMonths.filter((m) => m.has_data).length;
  const uploadCoversTooLittle = Boolean(uploadResult && uploadResult.date_span_days > 0 && uploadResult.date_span_days < 60);
  const importedPeriod = data?.earliest_transaction_date && data.latest_transaction_date
    ? `${fmtDate(data.earliest_transaction_date)} to ${fmtDate(data.latest_transaction_date)}`
    : "";
  const expenseDataKey = expenseMode === "spend_only" ? "displayed_expenses" : "expenses";
  const expenseLabel = expenseMode === "spend_only" ? "Spend" : "Expenses";
  const chartMonths = trendMonths.map((month) => ({
    ...month,
    displayed_expenses: month.expenses_excluding_investments ?? month.expenses,
  }));
  const excludedInvestmentTotal = trendMonths.reduce((sum, month) => sum + (month.investment_outflow ?? 0), 0);
  const hasProvisionalNotice = provisionalMonths.length > 0 && Boolean(data?.provisional_month_note);
  const provisionalNotice = provisionalMonths.length === 1
    ? `${fmtMonth(provisionalMonths[0].month)} is provisional until salary/month-end; use it for progress only.`
    : `${provisionalMonths.length} months are provisional until salary/month-end; use them for progress only.`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.35)" }}>
            Wealth Trends
          </p>
          <p className="mt-0.5 text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
            {data?.range_label ?? "Automatic range"} - income, expenses, savings and net worth
          </p>
          {data && (data.total_transaction_count ?? 0) > 0 && (
            <p className="mt-1 text-[10px] leading-snug" style={{ color: data.is_showing_imported_period ? "#ff9f0a" : "rgba(255,255,255,0.3)" }}>
              {visibleMonths} month{visibleMonths === 1 ? "" : "s"} visible from {data.total_transaction_count} imported transactions
              {importedPeriod ? ` (${importedPeriod})` : ""}
            </p>
          )}
          {data && (data.total_transaction_count ?? 0) > 0 && (
            <p className="mt-1 text-[10px] leading-snug" style={{ color: expenseMode === "spend_only" ? "#ff9f0a" : "rgba(255,255,255,0.24)" }}>
              {expenseMode === "spend_only"
                ? `Red bars exclude investment transfers and cash withdrawals${excludedInvestmentTotal > 0 ? ` (${fmtAxis(excludedInvestmentTotal)} investments hidden across visible months)` : ""}.`
                : "Red bars include visible bank debits, including investments and savings transfers. Cash withdrawals are hidden."}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <div
            className="flex rounded-full p-0.5"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
            title="Switch whether investment transfers are counted inside the red expense bars"
          >
            {[
              ["all", "All debits"],
              ["spend_only", "True spend"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setExpenseMode(key as ExpenseMode)}
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: expenseMode === key ? "rgba(255,69,58,0.18)" : "transparent",
                  color: expenseMode === key ? "#ff6961" : "rgba(255,255,255,0.38)",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex rounded-full p-0.5" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {[
              ["auto", "Auto"],
              ["last12", "12M"],
              ["all", "All"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setRange(key as TrendRange)}
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: range === key ? "rgba(10,132,255,0.22)" : "transparent",
                  color: range === key ? "#0a84ff" : "rgba(255,255,255,0.38)",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {uploadState === "success" && uploadResult && (
            <span className="flex items-center gap-1 text-[10px] font-medium" style={{ color: "#30d158" }}>
              <CheckCircle size={11} />
              {uploadResult.imported} imported
              {uploadResult.skipped > 0 && `, ${uploadResult.skipped} skipped`}
              {uploadResult.earliest_date && uploadResult.latest_date && ` (${fmtDate(uploadResult.earliest_date)}-${fmtDate(uploadResult.latest_date)})`}
            </span>
          )}
          {uploadState === "error" && (
            <span className="flex items-center gap-1 text-[10px] font-medium" style={{ color: "#ff453a" }}>
              <AlertCircle size={11} /> Upload failed
            </span>
          )}
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadState === "uploading"}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all"
            style={{
              background: uploadState === "uploading" ? "rgba(255,255,255,0.06)" : "rgba(10,132,255,0.12)",
              color: uploadState === "uploading" ? "rgba(255,255,255,0.3)" : "#0a84ff",
              border: `1px solid ${uploadState === "uploading" ? "rgba(255,255,255,0.08)" : "rgba(10,132,255,0.25)"}`,
              cursor: uploadState === "uploading" ? "not-allowed" : "pointer",
            }}
          >
            {uploadState === "uploading"
              ? <><Loader size={10} className="animate-spin" /> Importing...</>
              : <><Upload size={10} /> Import CSV</>
            }
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-xl px-3 py-2 text-[11px]" style={{ background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.16)", color: "#ff6961" }}>
          {errorMessage}
        </div>
      )}

      {uploadCoversTooLittle && uploadResult?.earliest_date && uploadResult.latest_date && (
        <div className="rounded-xl px-3 py-2 text-[11px] leading-snug" style={{ background: "rgba(255,159,10,0.08)", border: "1px solid rgba(255,159,10,0.18)", color: "#ff9f0a" }}>
          This upload covers only {uploadResult.date_span_days} days ({fmtDate(uploadResult.earliest_date)} to {fmtDate(uploadResult.latest_date)}). For a 12-month trend, export a statement covering roughly one full year.
        </div>
      )}

      {hasProvisionalNotice && (
        <div className="shrink-0 rounded-xl px-3 py-1.5 text-[10.5px] leading-snug" style={{ background: "rgba(10,132,255,0.08)", border: "1px solid rgba(10,132,255,0.18)", color: "#64d2ff" }}>
          {provisionalNotice}
        </div>
      )}

      {noData ? (
        <EmptyState
          title="No bank statement imported yet"
          detail="Click Import CSV and upload a bank statement. A 12-month export is best for first setup; monthly exports are best after that."
        />
      ) : (
        <div className="min-h-0 flex-1">
          <SafeResponsiveContainer>
            <ComposedChart data={chartMonths} margin={{ top: 2, right: 4, bottom: 6, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={fmtMonth}
                tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                height={22}
              />
              <YAxis
                yAxisId="bars"
                tickFormatter={fmtAxis}
                tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={72}
              />
              <YAxis
                yAxisId="line"
                orientation="right"
                tickFormatter={fmtAxis}
                tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={72}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend height={18} wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.4)", paddingTop: 2 }} iconType="circle" iconSize={7} />
              <Bar
                yAxisId="bars"
                dataKey="income"
                name="Income"
                fill="#30d158"
                fillOpacity={0.7}
                radius={[3, 3, 0, 0]}
                maxBarSize={28}
                isAnimationActive={false}
                cursor="pointer"
                onClick={(entry) => openBreakdown(entry, "Credit")}
              >
                {chartMonths.map((month) => (
                  <Cell key={`income-${month.month}`} fill="#30d158" fillOpacity={month.is_provisional ? 0.34 : 0.7} />
                ))}
              </Bar>
              <Bar
                yAxisId="bars"
                dataKey={expenseDataKey}
                name={expenseLabel}
                fill="#ff453a"
                fillOpacity={0.65}
                radius={[3, 3, 0, 0]}
                maxBarSize={28}
                isAnimationActive={false}
                cursor="pointer"
                onClick={(entry) => openBreakdown(entry, "Debit")}
              >
                {chartMonths.map((month) => (
                  <Cell key={`expense-${month.month}`} fill="#ff453a" fillOpacity={month.is_provisional ? 0.32 : 0.65} />
                ))}
              </Bar>
              <Line
                yAxisId="line"
                type="monotone"
                dataKey="net_worth"
                name="Net Worth"
                stroke="#bf5af2"
                strokeWidth={2}
                dot={{ r: 3, fill: "#bf5af2", stroke: "none" }}
                activeDot={{ r: 4, fill: "#bf5af2", stroke: "rgba(191,90,242,0.3)", strokeWidth: 4 }}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </SafeResponsiveContainer>
        </div>
      )}

      {selectedBreakdown && (
        <MonthlyBreakdownModal
          month={selectedBreakdown.month}
          direction={selectedBreakdown.direction}
          excludeInvestments={selectedBreakdown.excludeInvestments}
          data={breakdown}
          loading={breakdownLoading}
          error={breakdownError}
          onChanged={() => setReloadBreakdownKey((value) => value + 1)}
          onClose={() => setSelectedBreakdown(null)}
        />
      )}
    </div>
  );
}

function MonthlyBreakdownModal({
  month,
  direction,
  excludeInvestments,
  data,
  loading,
  error,
  onChanged,
  onClose,
}: {
  month: string;
  direction: BreakdownDirection;
  excludeInvestments: boolean;
  data: MonthBreakdown | null;
  loading: boolean;
  error: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const accent = direction === "Credit" ? "#30d158" : "#ff453a";
  const Icon = direction === "Credit" ? ArrowDownLeft : ArrowUpRight;
  const largest = useMemo(() => Math.max(...(data?.categories ?? []).map((cat) => cat.total), 1), [data]);
  const [savingRule, setSavingRule] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filterText, setFilterText] = useState("");
  const [groupBy, setGroupBy] = useState<TransactionGroupBy>("category");
  const [sortKey, setSortKey] = useState<TransactionSortKey>("amount");
  const [sortAsc, setSortAsc] = useState(false);
  const categoryOptions = direction === "Credit" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const saveCorrection = async (transactionId: number, category: string) => {
    setSavingRule(transactionId);
    try {
      const res = await fetch(`${API_BASE}/api/wealth/transactions/category-correction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: transactionId, category, scope: "merchant" }),
      });
      if (!res.ok) throw new Error("Could not save category");
      onChanged();
      window.dispatchEvent(new Event("wealth-updated"));
    } finally {
      setSavingRule(null);
    }
  };

  const deleteTransaction = async (transactionId: number) => {
    const ok = window.confirm("Delete this transaction from the ledger? This cannot be undone.");
    if (!ok) return;
    setDeletingId(transactionId);
    try {
      const res = await fetch(`${API_BASE}/api/wealth/transactions/${transactionId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not delete transaction");
      onChanged();
      window.dispatchEvent(new Event("wealth-updated"));
    } finally {
      setDeletingId(null);
    }
  };

  const filteredTransactions = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    const rows = data?.transactions ?? [];
    const filtered = needle
      ? rows.filter((txn) =>
          [txn.date, txn.merchant, txn.description, txn.category, txn.account_source ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : rows;
    const sign = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "amount") return (a.amount - b.amount) * sign;
      const av = String(a[sortKey] ?? "").toLowerCase();
      const bv = String(b[sortKey] ?? "").toLowerCase();
      return av.localeCompare(bv) * sign;
    });
  }, [data?.transactions, filterText, sortAsc, sortKey]);

  const groupedRows = useMemo(() => {
    const buckets = new Map<string, { label: string; total: number; count: number }>();
    filteredTransactions.forEach((txn) => {
      const label = groupBy === "category"
        ? txn.category
        : groupBy === "merchant"
          ? txn.merchant
          : txn.account_source || "Unknown account";
      const current = buckets.get(label) ?? { label, total: 0, count: 0 };
      current.total += txn.amount;
      current.count += 1;
      buckets.set(label, current);
    });
    return [...buckets.values()].sort((a, b) => b.total - a.total);
  }, [filteredTransactions, groupBy]);

  const filteredTotal = filteredTransactions.reduce((sum, txn) => sum + txn.amount, 0);

  const toggleSort = (key: TransactionSortKey) => {
    if (sortKey === key) {
      setSortAsc((value) => !value);
    } else {
      setSortKey(key);
      setSortAsc(key !== "amount");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.72)" }}>
      <div
        className="flex max-h-[86vh] w-full max-w-[980px] flex-col overflow-hidden rounded-xl"
        style={{
          background: "rgba(14,14,18,0.98)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 24px 90px rgba(0,0,0,0.62)",
          backdropFilter: "blur(28px) saturate(150%)",
        }}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}35` }}>
                <Icon size={14} />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.45)" }}>
                  {direction === "Credit" ? "Income Breakdown" : (excludeInvestments ? "True Spend Breakdown" : "Expense Breakdown")}
                </p>
                <h2 className="truncate text-lg font-semibold" style={{ color: "rgba(255,255,255,0.92)" }}>
                  {fmtMonth(month)}
                </h2>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.1)" }}
            aria-label="Close breakdown"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 overflow-auto px-5 py-4">
          {loading && (
            <div className="flex h-72 items-center justify-center">
              <Loader className="animate-spin" size={22} style={{ color: accent }} />
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg px-4 py-3 text-sm" style={{ background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.18)", color: "#ff6961" }}>
              {error}
            </div>
          )}

          {!loading && !error && data && (
            <div className="grid gap-4 lg:grid-cols-[0.95fr_1.25fr]">
              <section className="min-w-0">
                {excludeInvestments && direction === "Debit" && (
                  <div className="mb-3 rounded-lg px-3 py-2 text-[11px] leading-snug" style={{ background: "rgba(255,159,10,0.08)", border: "1px solid rgba(255,159,10,0.18)", color: "#ffb340" }}>
                    Showing spending after excluding Investments &amp; Savings
                    {data.excluded_category_total ? ` (${fmtMoney(data.excluded_category_total)} across ${data.excluded_category_count ?? 0} transactions).` : "."}
                  </div>
                )}
                {direction === "Debit" && data.cash_withdrawals_hidden && (
                  <div className="mb-3 rounded-lg px-3 py-2 text-[11px] leading-snug" style={{ background: "rgba(10,132,255,0.08)", border: "1px solid rgba(10,132,255,0.18)", color: "#64d2ff" }}>
                    Cash withdrawals are hidden from this view.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.36)" }}>
                      {excludeInvestments && direction === "Debit" ? "Spend" : "Total"}
                    </p>
                    <p className="mt-1 text-xl font-bold tabular-nums" style={{ color: accent }}>{fmtMoney(data.total)}</p>
                  </div>
                  <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.36)" }}>Rows</p>
                    <p className="mt-1 text-xl font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.9)" }}>{data.transaction_count}</p>
                  </div>
                </div>

                <div className="mt-4 rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="flex items-end justify-between gap-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>Categories</p>
                    <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {data.derived_category_count} rule-derived
                    </p>
                  </div>

                  <div className="mt-3 grid gap-2">
                    {data.categories.map((cat) => (
                      <div key={cat.category} className="rounded-md px-3 py-2" style={{ background: "rgba(255,255,255,0.028)" }}>
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="min-w-0 truncate text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.78)" }}>
                            {cat.category}
                          </p>
                          <div className="shrink-0 text-right">
                            <p className="text-[12px] font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.84)" }}>{fmtMoney(cat.total)}</p>
                            <p className="text-[10px] tabular-nums" style={{ color: accent }}>{cat.percentage.toFixed(0)}% · {cat.count}</p>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.07)" }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.max((cat.total / largest) * 100, 2)}%`, background: accent }} />
                        </div>
                        {cat.top_merchants.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {cat.top_merchants.slice(0, 3).map((merchant) => (
                              <span key={merchant.merchant} className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "rgba(255,255,255,0.045)", color: "rgba(255,255,255,0.46)" }}>
                                {merchant.merchant}: {fmtMoney(merchant.total)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="min-w-0 rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>Transaction Workbench</p>
                    <p className="mt-0.5 text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {filteredTransactions.length} rows | {fmtMoney(filteredTotal)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 rounded-full px-2 py-1" style={{ background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <Search size={12} style={{ color: "rgba(255,255,255,0.42)" }} />
                      <input
                        value={filterText}
                        onChange={(event) => setFilterText(event.target.value)}
                        placeholder="Filter"
                        className="w-28 bg-transparent text-[11px] outline-none"
                        style={{ color: "rgba(255,255,255,0.82)" }}
                      />
                    </label>
                    <select
                      value={groupBy}
                      onChange={(event) => setGroupBy(event.target.value as TransactionGroupBy)}
                      className="rounded-full px-2 py-1 text-[11px] outline-none"
                      style={{ background: "rgba(255,255,255,0.055)", color: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.08)" }}
                      title="Group rows"
                    >
                      <option value="category" style={{ background: "#15151a", color: "white" }}>Group category</option>
                      <option value="merchant" style={{ background: "#15151a", color: "white" }}>Group merchant</option>
                      <option value="account" style={{ background: "#15151a", color: "white" }}>Group account</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3 rounded-lg p-2" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="max-h-24 overflow-auto">
                    <table className="w-full border-collapse text-left text-[11px]">
                      <thead>
                        <tr style={{ color: "rgba(255,255,255,0.36)" }}>
                          <th className="pb-1 font-semibold">Group</th>
                          <th className="pb-1 text-right font-semibold">Rows</th>
                          <th className="pb-1 text-right font-semibold">Sum</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupedRows.map((row) => (
                          <tr key={row.label} style={{ borderTop: "1px solid rgba(255,255,255,0.045)" }}>
                            <td className="max-w-[220px] truncate py-1.5" style={{ color: "rgba(255,255,255,0.72)" }}>{row.label}</td>
                            <td className="py-1.5 text-right tabular-nums" style={{ color: "rgba(255,255,255,0.5)" }}>{row.count}</td>
                            <td className="py-1.5 text-right font-semibold tabular-nums" style={{ color: accent }}>{fmtMoney(row.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mt-3 max-h-[42vh] overflow-auto rounded-lg" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                  {data.transactions.length === 0 ? (
                    <div className="flex h-52 items-center justify-center text-sm" style={{ color: "rgba(255,255,255,0.42)" }}>
                      No transactions for this month.
                    </div>
                  ) : (
                    <table className="w-full min-w-[720px] border-collapse text-left text-[11px]">
                      <thead className="sticky top-0 z-10" style={{ background: "rgba(18,18,22,0.98)", color: "rgba(255,255,255,0.42)" }}>
                        <tr>
                          {[
                            ["date", "Date"],
                            ["merchant", "Payee"],
                            ["category", "Category"],
                            ["amount", "Amount"],
                          ].map(([key, label]) => (
                            <th key={key} className="px-2 py-2 font-semibold">
                              <button type="button" onClick={() => toggleSort(key as TransactionSortKey)} className="inline-flex items-center gap-1">
                                {label}
                                <ArrowUpDown size={10} />
                              </button>
                            </th>
                          ))}
                          <th className="px-2 py-2 font-semibold">Description</th>
                          <th className="px-2 py-2 text-right font-semibold">Delete</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTransactions.map((txn) => (
                          <tr key={txn.id} style={{ borderTop: "1px solid rgba(255,255,255,0.055)" }}>
                            <td className="whitespace-nowrap px-2 py-2 tabular-nums" style={{ color: "rgba(255,255,255,0.52)" }}>{fmtDate(txn.date)}</td>
                            <td className="max-w-[160px] truncate px-2 py-2 font-semibold" style={{ color: "rgba(255,255,255,0.78)" }}>{txn.merchant}</td>
                            <td className="px-2 py-2">
                              <select
                                value={txn.category}
                                disabled={savingRule === txn.id}
                                onChange={(event) => void saveCorrection(txn.id, event.target.value)}
                                className="w-36 rounded-full px-2 py-1 text-[10px] outline-none"
                                style={{ background: `${accent}12`, color: "rgba(255,255,255,0.8)", border: `1px solid ${accent}22` }}
                                title="Correct category and remember this merchant"
                              >
                                {Array.from(new Set([txn.category, ...categoryOptions])).map((option) => (
                                  <option key={option} value={option} style={{ background: "#15151a", color: "white" }}>{option}</option>
                                ))}
                              </select>
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-right font-bold tabular-nums" style={{ color: accent }}>{fmtMoney(txn.amount)}</td>
                            <td className="max-w-[260px] truncate px-2 py-2" title={txn.description} style={{ color: "rgba(255,255,255,0.34)" }}>{txn.description}</td>
                            <td className="px-2 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => void deleteTransaction(txn.id)}
                                disabled={deletingId === txn.id}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-white/10 disabled:opacity-40"
                                style={{ color: "#ff6961", border: "1px solid rgba(255,105,97,0.22)", background: "rgba(255,69,58,0.08)" }}
                                aria-label={`Delete ${txn.merchant} transaction`}
                              >
                                {deletingId === txn.id ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
