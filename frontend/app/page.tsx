import BentoCard from "@/components/BentoCard";
import WealthCenter from "@/components/WealthCenter";
import BalancesPanel from "@/components/BalancesPanel";
import DataIngestionCenter from "@/components/DataIngestionCenter";
import StocksPanel from "@/components/StocksPanel";
import WealthTrendsChart from "@/components/WealthTrendsChart";
import WealthForecast from "@/components/WealthForecast";
import NewsImpact from "@/components/NewsImpact";
import CashflowSummary from "@/components/CashflowSummary";
import WealthCoach from "@/components/WealthCoach";
import AssistantChat from "@/components/AssistantChat";
import MonthReviewPanel from "@/components/MonthReviewPanel";
import DataFreshness from "@/components/DataFreshness";
import SpendBreakdown from "@/components/SpendBreakdown";
import ActionHub from "@/components/ActionHub";
import CFOPlanPanel from "@/components/CFOPlanPanel";
import PortfolioAgentBrief from "@/components/PortfolioAgentBrief";

export default function DashboardPage() {
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: "#000000" }}>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background: `
            radial-gradient(ellipse 52% 44% at 10% 10%, rgba(191,90,242,0.16) 0%, transparent 58%),
            radial-gradient(ellipse 48% 42% at 90% 88%, rgba(10,132,255,0.12) 0%, transparent 60%),
            radial-gradient(ellipse 40% 48% at 55% 50%, rgba(48,209,88,0.06) 0%, transparent 64%)
          `,
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1680px] flex-col gap-4 px-4 py-4 lg:px-5">
        <header
          className="flex flex-col gap-3 rounded-lg px-4 py-3 md:flex-row md:items-center md:justify-between"
          style={{
            background: "rgba(255,255,255,0.045)",
            border: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(34px) saturate(160%)",
            WebkitBackdropFilter: "blur(34px) saturate(160%)",
          }}
        >
          <div className="flex w-full items-center gap-3 md:w-auto">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{
                background: "linear-gradient(135deg, #bf5af2, #0a84ff)",
                boxShadow: "0 0 8px rgba(191,90,242,0.6)",
              }}
            />
            <h1
              className="text-lg font-semibold tracking-tight"
              style={{
                fontFamily: "var(--font-syne-var), 'SF Pro Display', sans-serif",
                color: "rgba(255,255,255,0.92)",
              }}
            >
              Life Dashboard
            </h1>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
            <span
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{
                background: "rgba(48,209,88,0.12)",
                color: "#30d158",
                border: "1px solid rgba(48,209,88,0.25)",
              }}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "#30d158" }} />
              Live
            </span>
            <span className="text-[13px]" style={{ color: "rgba(255,255,255,0.38)" }}>
              {today}
            </span>
            <StocksPanel />
            <BalancesPanel />
            <MonthReviewPanel />
            <DataIngestionCenter />
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-4">
          <section className="grid items-start gap-4 xl:grid-cols-[1.35fr_1fr_1fr_1.05fr]">
            <BentoCard className="h-[320px]">
              <WealthCoach />
            </BentoCard>
            <BentoCard className="h-[320px]">
              <PortfolioAgentBrief />
            </BentoCard>
            <BentoCard className="h-[320px]">
              <CashflowSummary />
            </BentoCard>
            <BentoCard className="h-[320px]">
              <DataFreshness />
            </BentoCard>
          </section>

          <section className="grid items-start gap-4 xl:grid-cols-[1.35fr_1fr_1fr_1.6fr]">
            <BentoCard glow className="h-[730px] xl:row-span-2">
              <WealthCenter />
            </BentoCard>
            <BentoCard className="h-[360px] xl:col-span-2">
              <WealthTrendsChart />
            </BentoCard>
            <BentoCard className="h-[330px]">
              <WealthForecast />
            </BentoCard>
            <BentoCard className="h-[330px] xl:col-span-3">
              <ActionHub />
            </BentoCard>
          </section>

          <section className="grid items-start gap-4 xl:grid-cols-[1fr_1fr_1fr]">
            <BentoCard className="h-[360px]">
              <CFOPlanPanel />
            </BentoCard>
            <BentoCard className="h-[360px]">
              <SpendBreakdown />
            </BentoCard>
            <BentoCard className="h-[360px]">
              <NewsImpact />
            </BentoCard>
          </section>
        </main>
      </div>
      <AssistantChat />
    </div>
  );
}
