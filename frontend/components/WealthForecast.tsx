"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ForecastData, fetchForecast } from "@/lib/api";
import EmptyState from "@/components/EmptyState";
import SafeResponsiveContainer from "@/components/SafeResponsiveContainer";

function fmtMoney(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1_00_00_000) return `${sign}INR ${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}INR ${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}INR ${(abs / 1_000).toFixed(0)}K`;
  return `${sign}INR ${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function compactMoney(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1_00_00_000) return `${sign}${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string; stroke?: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "rgba(18,18,22,0.97)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "10px 14px", minWidth: 190 }}>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, marginBottom: 4 }}>{label}</p>
      <div className="grid gap-1">
        {payload.map((item) => (
          <div key={item.name} className="flex justify-between gap-3">
            <span style={{ color: item.color ?? item.stroke ?? "rgba(255,255,255,0.65)", fontSize: 10, fontWeight: 700 }}>{item.name}</span>
            <span style={{ color: "rgba(255,255,255,0.82)", fontSize: 10, fontWeight: 700 }}>{fmtMoney(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function WealthForecast() {
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [stepUpPct, setStepUpPct] = useState(10);
  const [view, setView] = useState<"both" | "networth" | "cash">("both");

  useEffect(() => {
    fetchForecast(stepUpPct)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [stepUpPct]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "rgba(191,90,242,0.3)", borderTopColor: "#bf5af2" }} />
      </div>
    );
  }

  if (!data) return <EmptyState title="Forecast unavailable" detail="The backend forecast endpoint is not reachable." />;

  const points = data.data_points ?? [];
  const finalPoint = points.at(-1);
  const finalValue = finalPoint?.base_net_worth ?? finalPoint?.value ?? data.current_net_worth;
  const finalStepValue = finalPoint?.step_net_worth ?? finalValue;
  const finalCash = finalPoint?.base_cash ?? data.current_cash ?? 0;
  const finalStepCash = finalPoint?.step_cash ?? finalCash;
  const finalBaseGap = finalPoint?.base_unfunded_investment ?? data.base_unfunded_investment ?? 0;
  const finalStepGap = finalPoint?.step_unfunded_investment ?? data.step_unfunded_investment ?? 0;
  const hasNetWorth = data.current_net_worth > 0;
  const forecastReady = hasNetWorth || data.has_cashflow_data;
  const multiplier = hasNetWorth ? (finalStepValue / data.current_net_worth).toFixed(1) : null;
  const showNetWorth = view !== "cash";
  const showCash = view !== "networth";
  const planGap = data.monthly_investment_gap ?? 0;
  const mfInvestment = data.monthly_mutual_fund_investment ?? 0;
  const otherInvestment = data.monthly_other_investment_outflow ?? 0;
  const totalInvestmentPlan = data.monthly_investment_outflow ?? (mfInvestment + otherInvestment);
  const observedInvestmentAvg = data.observed_monthly_investment_outflow_avg ?? totalInvestmentPlan;
  const hasOneOffInvestmentNoise = totalInvestmentPlan > 0 && observedInvestmentAvg > totalInvestmentPlan * 1.25;
  const salaryGrowth = data.salary_growth_pct ?? data.assumptions?.salary_growth_pct ?? 5;
  const spendInflation = data.spend_inflation_pct ?? data.assumptions?.spend_inflation_pct ?? 6;
  const monthlyIncome = data.monthly_income_assumed ?? data.assumptions?.monthly_salary_inr ?? 0;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.35)" }}>
            Path to Wealth
          </p>
          <p className="mt-0.5 text-[10px]" style={{ color: "rgba(255,255,255,0.24)" }}>
            {data.has_cashflow_data
              ? `${data.months_of_cashflow_data} month true-spend base; salary +${salaryGrowth}%/yr`
              : "No assumed savings until cashflow is imported"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[15px] font-bold tabular-nums" style={{ color: forecastReady ? "#bf5af2" : "rgba(255,255,255,0.38)" }}>
            {multiplier ? `${multiplier}x` : data.confidence}
          </p>
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
            {forecastReady ? `MF step-up path: ${compactMoney(finalStepValue)}` : "confidence"}
          </p>
        </div>
      </div>

      {forecastReady && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex rounded-full p-0.5" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {[
              ["both", "Both"],
              ["networth", "Net worth"],
              ["cash", "Cash"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setView(key as "both" | "networth" | "cash")}
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: view === key ? "rgba(191,90,242,0.2)" : "transparent",
                  color: view === key ? "#bf5af2" : "rgba(255,255,255,0.38)",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px]" style={{ background: "rgba(48,209,88,0.06)", border: "1px solid rgba(48,209,88,0.14)", color: "rgba(255,255,255,0.68)" }}>
            MF step-up
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={stepUpPct}
              onChange={(event) => setStepUpPct(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
              className="w-10 bg-transparent text-right font-bold outline-none"
              style={{ color: "#30d158" }}
            />
            %/yr
          </label>
        </div>
      )}

      {forecastReady && planGap > 0 && (
        <div className="rounded-lg px-2.5 py-1.5 text-[10px] leading-snug" style={{ background: "rgba(255,159,10,0.07)", border: "1px solid rgba(255,159,10,0.16)", color: "#ffb340" }}>
          Current recurring investment plan needs {fmtMoney(planGap)}/mo more than salary-based surplus. MF step-up applies only to detected SIP/MF outflows.
        </div>
      )}

      {forecastReady && hasOneOffInvestmentNoise && (
        <div className="rounded-lg px-2.5 py-1.5 text-[10px] leading-snug" style={{ background: "rgba(10,132,255,0.07)", border: "1px solid rgba(10,132,255,0.16)", color: "#64d2ff" }}>
          Observed investing averaged {fmtMoney(observedInvestmentAvg)}/mo because of one-off transfers. Forecast uses recurring plan {fmtMoney(totalInvestmentPlan)}/mo.
        </div>
      )}

      {!forecastReady ? (
        <EmptyState
          title="Forecast needs real inputs"
          detail="Add net worth inputs and import bank statements. Until then, the app will not invent a future number."
        />
      ) : (
        <div className="min-h-0 flex-1" style={{ minHeight: 95 }}>
          <SafeResponsiveContainer>
            <LineChart data={points} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="networth" tickFormatter={fmtMoney} tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10 }} axisLine={false} tickLine={false} width={58} />
              <YAxis yAxisId="cash" orientation="right" tickFormatter={fmtMoney} tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10 }} axisLine={false} tickLine={false} width={58} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 9, color: "rgba(255,255,255,0.4)", paddingTop: 4 }} iconSize={7} />
              {showNetWorth && (
                <Line yAxisId="networth" type="monotone" dataKey="base_net_worth" name="NW no step-up" stroke="#bf5af2" strokeWidth={2} dot={{ r: 2.5, fill: "#bf5af2", stroke: "none" }} isAnimationActive={false} />
              )}
              {showNetWorth && (
                <Line yAxisId="networth" type="monotone" dataKey="step_net_worth" name="NW MF step-up" stroke="#30d158" strokeWidth={2} dot={{ r: 2.5, fill: "#30d158", stroke: "none" }} isAnimationActive={false} />
              )}
              {showCash && (
                <Line yAxisId="cash" type="monotone" dataKey="base_cash" name="Cash no step-up" stroke="#0a84ff" strokeWidth={1.8} strokeDasharray="5 4" dot={{ r: 2.5, fill: "#0a84ff", stroke: "none" }} isAnimationActive={false} />
              )}
              {showCash && (
                <Line yAxisId="cash" type="monotone" dataKey="step_cash" name="Cash MF step-up" stroke="#ff9f0a" strokeWidth={1.8} strokeDasharray="5 4" dot={{ r: 2.5, fill: "#ff9f0a", stroke: "none" }} isAnimationActive={false} />
              )}
            </LineChart>
          </SafeResponsiveContainer>
        </div>
      )}

      {forecastReady && (
        <div className="grid grid-cols-2 gap-1.5">
          <div className="rounded-lg px-2.5 py-1.5" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.055)" }}>
            <p className="text-[9px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.3)" }}>No step-up</p>
            <p className="text-[11px] font-bold tabular-nums" style={{ color: "#bf5af2" }}>NW {compactMoney(finalValue)}</p>
            <p className="text-[9.5px] font-semibold tabular-nums" style={{ color: "#ffb340" }}>
              Cash {compactMoney(finalCash)} / gap {compactMoney(finalBaseGap)}
            </p>
          </div>
          <div className="rounded-lg px-2.5 py-1.5" style={{ background: "rgba(48,209,88,0.055)", border: "1px solid rgba(48,209,88,0.12)" }}>
            <p className="text-[9px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.3)" }}>MF step-up</p>
            <p className="text-[11px] font-bold tabular-nums" style={{ color: "#30d158" }}>NW {compactMoney(finalStepValue)}</p>
            <p className="text-[9.5px] font-semibold tabular-nums" style={{ color: "#ffb340" }}>
              Cash {compactMoney(finalStepCash)} / gap {compactMoney(finalStepGap)}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {[
          { label: "Return", value: `${data.annual_return_pct}% p.a.`, color: "#30d158" },
          { label: "Salary base", value: data.has_cashflow_data ? `${fmtMoney(monthlyIncome)}/mo` : "unknown", color: "#0a84ff" },
          { label: "Spend inflation", value: `${spendInflation}%/yr`, color: "#ff9f0a" },
          { label: "Investable surplus", value: data.has_cashflow_data ? `${fmtMoney(data.monthly_savings_assumed)}/mo` : "unknown", color: "#64d2ff" },
          { label: "MF plan", value: data.has_cashflow_data ? `${fmtMoney(mfInvestment)}/mo` : "unknown", color: "#bf5af2" },
          { label: "Other recurring", value: data.has_cashflow_data ? `${fmtMoney(otherInvestment)}/mo` : "unknown", color: "#64d2ff" },
          { label: "Planned invest", value: data.has_cashflow_data ? `${fmtMoney(totalInvestmentPlan)}/mo` : "unknown", color: "#30d158" },
          { label: "Plan gap", value: data.has_cashflow_data ? `${fmtMoney(planGap)}/mo` : "unknown", color: planGap > 0 ? "#ff9f0a" : "#30d158" },
          { label: "Cashflow", value: `${data.months_of_cashflow_data} mo`, color: data.months_of_cashflow_data >= 3 ? "#30d158" : "#ff9f0a" },
          { label: "Confidence", value: data.confidence, color: data.confidence === "high" ? "#30d158" : "#ff9f0a" },
        ].map(({ label, value, color }) => (
          <span key={label} className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: `${color}12`, color, border: `1px solid ${color}22` }}>
            {label}: <strong>{value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
