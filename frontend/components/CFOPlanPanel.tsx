"use client";

import { FormEvent, useEffect, useState } from "react";
import { Calculator, Flag, Landmark, Loader2, Plus, Target } from "lucide-react";
import {
  createGoal,
  createLiability,
  DailyBriefing,
  fetchDailyBriefing,
  fetchPlanningOverview,
  fetchScenario,
  PlanningOverview,
  ScenarioResponse,
} from "@/lib/api";
import EmptyState from "@/components/EmptyState";

function money(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value || 0);
  if (abs >= 1_00_00_000) return `${sign}INR ${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}INR ${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}INR ${(abs / 1_000).toFixed(0)}K`;
  return `${sign}INR ${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default function CFOPlanPanel() {
  const [overview, setOverview] = useState<PlanningOverview | null>(null);
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [scenario, setScenario] = useState<ScenarioResponse | null>(null);
  const [extraSip, setExtraSip] = useState(20000);
  const [spendCut, setSpendCut] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [liabilityAmount, setLiabilityAmount] = useState("");
  const [goalAmount, setGoalAmount] = useState("");

  const load = () => Promise.all([fetchPlanningOverview(), fetchDailyBriefing(), fetchScenario({ monthly_extra_investment: extraSip, spend_cut_pct: spendCut })])
    .then(([plan, daily, scenarioData]) => {
      setOverview(plan);
      setBriefing(daily);
      setScenario(scenarioData);
      setError(false);
    })
    .catch(() => setError(true));

  useEffect(() => {
    load();
    window.addEventListener("wealth-updated", load);
    return () => window.removeEventListener("wealth-updated", load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchScenario({ monthly_extra_investment: extraSip, spend_cut_pct: spendCut })
      .then(setScenario)
      .catch(() => {});
  }, [extraSip, spendCut]);

  const addLiability = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(liabilityAmount);
    if (!amount || amount < 0) return;
    setBusy(true);
    try {
      await createLiability({
        name: "Loan / card due",
        liability_type: "Loan",
        outstanding_amount: amount,
        interest_rate_pct: null,
        emi_amount: 0,
        due_day: null,
        notes: null,
      });
      setLiabilityAmount("");
      await load();
      window.dispatchEvent(new Event("wealth-updated"));
    } finally {
      setBusy(false);
    }
  };

  const addGoal = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(goalAmount);
    if (!amount || amount <= 0) return;
    setBusy(true);
    try {
      await createGoal({
        name: "Financial target",
        target_amount: amount,
        target_date: null,
        current_amount: 0,
        priority: "Medium",
        notes: null,
      });
      setGoalAmount("");
      await load();
      window.dispatchEvent(new Event("wealth-updated"));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <EmptyState title="CFO plan unavailable" detail="The planning endpoint is not reachable." />;
  if (!overview || !briefing) return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin" size={18} style={{ color: "#30d158" }} /></div>;

  const liabilityTotal = overview.liabilities.total;
  const goal = overview.goals[0];
  const incremental = scenario?.incremental_wealth ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>
            <Calculator size={12} /> CFO Plan
          </p>
          <p className="mt-1 text-[11px]" style={{ color: "rgba(255,255,255,0.32)" }}>
            {briefing.headline}
          </p>
        </div>
        <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ color: "#30d158", background: "rgba(48,209,88,0.12)", border: "1px solid rgba(48,209,88,0.22)" }}>
          {briefing.metrics.confidence}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg px-2.5 py-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-[9px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.3)" }}>Net worth</p>
          <p className="mt-0.5 text-[13px] font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.86)" }}>{money(briefing.metrics.net_worth)}</p>
        </div>
        <div className="rounded-lg px-2.5 py-2" style={{ background: "rgba(255,69,58,0.06)", border: "1px solid rgba(255,69,58,0.12)" }}>
          <p className="text-[9px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.3)" }}>Debt</p>
          <p className="mt-0.5 text-[13px] font-bold tabular-nums" style={{ color: liabilityTotal > 0 ? "#ff6961" : "rgba(255,255,255,0.5)" }}>{money(liabilityTotal)}</p>
        </div>
        <div className="rounded-lg px-2.5 py-2" style={{ background: "rgba(10,132,255,0.06)", border: "1px solid rgba(10,132,255,0.12)" }}>
          <p className="text-[9px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.3)" }}>Surplus</p>
          <p className="mt-0.5 text-[13px] font-bold tabular-nums" style={{ color: "#64d2ff" }}>{money(briefing.metrics.monthly_surplus)}</p>
        </div>
      </div>

      <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "rgba(255,255,255,0.72)" }}>
            <Target size={12} /> Scenario
          </p>
          <p className="text-[12px] font-bold tabular-nums" style={{ color: incremental >= 0 ? "#30d158" : "#ff453a" }}>{money(incremental)}</p>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-[10px]" style={{ color: "rgba(255,255,255,0.36)" }}>
            Extra SIP
            <input value={extraSip} onChange={(event) => setExtraSip(Number(event.target.value) || 0)} type="number" className="mt-1 w-full rounded-md px-2 py-1.5 text-[12px] outline-none" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.86)", border: "1px solid rgba(255,255,255,0.08)" }} />
          </label>
          <label className="text-[10px]" style={{ color: "rgba(255,255,255,0.36)" }}>
            Spend cut %
            <input value={spendCut} onChange={(event) => setSpendCut(Number(event.target.value) || 0)} type="number" className="mt-1 w-full rounded-md px-2 py-1.5 text-[12px] outline-none" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.86)", border: "1px solid rgba(255,255,255,0.08)" }} />
          </label>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
        <div className="min-h-0 rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.055)" }}>
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.36)" }}><Landmark size={11} /> Liabilities</p>
          {overview.liabilities.items.length ? (
            <div className="mt-2 grid gap-1.5">
              {overview.liabilities.items.slice(0, 3).map((item) => (
                <div key={item.id} className="flex justify-between gap-2 text-[11px]">
                  <span className="truncate" style={{ color: "rgba(255,255,255,0.66)" }}>{item.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums" style={{ color: "#ff6961" }}>{money(item.outstanding_amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <form onSubmit={addLiability} className="mt-2 flex gap-1.5">
              <input value={liabilityAmount} onChange={(event) => setLiabilityAmount(event.target.value)} placeholder="Outstanding" type="number" className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-[11px] outline-none" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.86)", border: "1px solid rgba(255,255,255,0.08)" }} />
              <button disabled={busy} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ color: "#ff6961", background: "rgba(255,69,58,0.1)", border: "1px solid rgba(255,69,58,0.18)" }}><Plus size={13} /></button>
            </form>
          )}
        </div>

        <div className="min-h-0 rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.055)" }}>
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.36)" }}><Flag size={11} /> Goals</p>
          {goal ? (
            <div className="mt-2">
              <div className="flex justify-between gap-2 text-[11px]">
                <span className="truncate" style={{ color: "rgba(255,255,255,0.66)" }}>{goal.name}</span>
                <span className="shrink-0 font-semibold tabular-nums" style={{ color: goal.on_track === false ? "#ff9f0a" : "#30d158" }}>{money(goal.required_monthly)}/mo</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, goal.progress_pct)}%`, background: "#30d158" }} />
              </div>
            </div>
          ) : (
            <form onSubmit={addGoal} className="mt-2 flex gap-1.5">
              <input value={goalAmount} onChange={(event) => setGoalAmount(event.target.value)} placeholder="Target amount" type="number" className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-[11px] outline-none" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.86)", border: "1px solid rgba(255,255,255,0.08)" }} />
              <button disabled={busy} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ color: "#30d158", background: "rgba(48,209,88,0.1)", border: "1px solid rgba(48,209,88,0.18)" }}><Plus size={13} /></button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
