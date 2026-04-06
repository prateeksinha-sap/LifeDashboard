"use client";

import { useEffect, useRef, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Upload, CheckCircle, AlertCircle, Loader } from "lucide-react";

const BASE = "http://localhost:8000";

interface MonthData {
  month:     string;
  income:    number;
  expenses:  number;
  net_worth: number | null;
  has_data:  boolean;
}

interface TrendsResponse {
  months:           MonthData[];
  has_transactions: boolean;
}

// Format ₹ axis labels compactly
function fmtAxis(v: number): string {
  if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(1)}Cr`;
  if (v >= 1_00_000)    return `₹${(v / 1_00_000).toFixed(0)}L`;
  if (v >= 1_000)       return `₹${(v / 1_000).toFixed(0)}K`;
  return `₹${v}`;
}

function fmtMonth(my: string): string {
  const [y, m] = my.split("-");
  const month  = new Date(+y, +m - 1).toLocaleString("en-IN", { month: "short" });
  return `${month} '${y.slice(2)}`;
}

// Custom dark-theme tooltip
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
      background:    "rgba(18,18,22,0.97)",
      border:        "1px solid rgba(255,255,255,0.1)",
      borderRadius:  12,
      padding:       "10px 14px",
      backdropFilter:"blur(20px)",
      minWidth:      140,
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

type UploadState = "idle" | "uploading" | "success" | "error";

interface UploadResult { imported: number; skipped: number; errors: number; }

export default function WealthTrendsChart() {
  const [data,         setData]         = useState<TrendsResponse | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [uploadState,  setUploadState]  = useState<UploadState>("idle");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadTrends = () =>
    fetch(`${BASE}/api/wealth/trends`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => { loadTrends(); }, []);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";          // reset so same file can be re-selected

    setUploadState("uploading");
    setUploadResult(null);

    const form = new FormData();
    form.append("file",    file);
    form.append("account", "Bank Account");
    form.append("no_llm",  "false");

    try {
      const res  = await fetch(`${BASE}/api/wealth/import-statement`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? "Upload failed");
      setUploadResult({ imported: json.imported, skipped: json.skipped, errors: json.errors });
      setUploadState("success");
      // Refresh chart data
      setTimeout(() => loadTrends(), 400);
      setTimeout(() => setUploadState("idle"), 5000);
    } catch {
      setUploadState("error");
      setTimeout(() => setUploadState("idle"), 4000);
    }
  };

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <div className="w-4 h-4 rounded-full border-2 animate-spin"
        style={{ borderColor: "rgba(10,132,255,0.3)", borderTopColor: "#0a84ff" }} />
    </div>
  );

  const noData = !data || !data.has_transactions;

  return (
    <div className="flex flex-col h-full gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em]"
            style={{ color: "rgba(255,255,255,0.35)" }}>
            Wealth Trends
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>
            12-month income, expenses & net worth
          </p>
        </div>
        {/* Upload button — always visible, state-aware */}
        <div className="flex items-center gap-2">
          {uploadState === "success" && uploadResult && (
            <span className="flex items-center gap-1 text-[10px] font-medium"
              style={{ color: "#30d158" }}>
              <CheckCircle size={11} />
              {uploadResult.imported} imported
              {uploadResult.skipped > 0 && `, ${uploadResult.skipped} skipped`}
            </span>
          )}
          {uploadState === "error" && (
            <span className="flex items-center gap-1 text-[10px] font-medium"
              style={{ color: "#ff453a" }}>
              <AlertCircle size={11} /> Upload failed
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={onFileChange}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadState === "uploading"}
            className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all"
            style={{
              background: uploadState === "uploading"
                ? "rgba(255,255,255,0.06)"
                : "rgba(10,132,255,0.12)",
              color:      uploadState === "uploading"
                ? "rgba(255,255,255,0.3)"
                : "#0a84ff",
              border: `1px solid ${uploadState === "uploading"
                ? "rgba(255,255,255,0.08)"
                : "rgba(10,132,255,0.25)"}`,
              cursor: uploadState === "uploading" ? "not-allowed" : "pointer",
            }}
          >
            {uploadState === "uploading"
              ? <><Loader size={10} className="animate-spin" /> Importing…</>
              : <><Upload size={10} /> Import CSV</>
            }
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0" style={{ minHeight: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data?.months ?? []}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.05)"
              vertical={false}
            />
            <XAxis
              dataKey="month"
              tickFormatter={fmtMonth}
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="bars"
              tickFormatter={fmtAxis}
              tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <YAxis
              yAxisId="line"
              orientation="right"
              tickFormatter={fmtAxis}
              tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.4)", paddingTop: 8 }}
              iconType="circle"
              iconSize={7}
            />

            {/* Income bars */}
            <Bar
              yAxisId="bars"
              dataKey="income"
              name="Income"
              fill="#30d158"
              fillOpacity={0.7}
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
            />

            {/* Expenses bars */}
            <Bar
              yAxisId="bars"
              dataKey="expenses"
              name="Expenses"
              fill="#ff453a"
              fillOpacity={0.65}
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
            />

            {/* Net Worth line */}
            <Line
              yAxisId="line"
              type="monotone"
              dataKey="net_worth"
              name="Net Worth"
              stroke="#bf5af2"
              strokeWidth={2}
              dot={{ r: 3, fill: "#bf5af2", stroke: "none" }}
              activeDot={{ r: 4, fill: "#bf5af2", stroke: "rgba(191,90,242,0.3)", strokeWidth: 4 }}
              connectNulls={true}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* No-data placeholder */}
      {noData && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-2"
          style={{ paddingTop: 60 }}>
          <Upload size={18} style={{ color: "rgba(255,255,255,0.1)" }} />
          <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>
            Upload a bank statement CSV to see trends
          </p>
        </div>
      )}
    </div>
  );
}
