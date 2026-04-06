/**
 * page.tsx — Life Dashboard
 * ──────────────────────────────────────────────────────
 * Apple-grade layout:
 *   • Animated aurora gradient mesh background
 *   • Frosted-glass header bar
 *   • 3-column bento grid (WealthCard spans 2 rows)
 * ──────────────────────────────────────────────────────
 */

import BentoCard      from "@/components/BentoCard";
import WealthCenter   from "@/components/WealthCenter";
import Top7Priorities from "@/components/Top7Priorities";
import SmartInbox     from "@/components/SmartInbox";
import ActionCenter   from "@/components/ActionCenter";
import UpcomingBills  from "@/components/UpcomingBills";
import BalancesPanel  from "@/components/BalancesPanel";
import StocksPanel    from "@/components/StocksPanel";

export default function DashboardPage() {
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day:     "numeric",
    month:   "long",
    year:    "numeric",
  });

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: "#000000" }}>

      {/* ── Aurora mesh background ────────────────────
          Three slow-drifting radial colour blobs that
          give depth without distracting from content.    */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background: `
            radial-gradient(ellipse 65% 55% at 10% 15%,  rgba(191, 90, 242, 0.18) 0%, transparent 60%),
            radial-gradient(ellipse 55% 50% at 90% 80%,  rgba( 10,132, 255, 0.14) 0%, transparent 60%),
            radial-gradient(ellipse 45% 60% at 55% 50%,  rgba( 48,209,  88, 0.07) 0%, transparent 65%)
          `,
        }}
      />

      {/* ── Noise texture overlay for depth ── */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
          backgroundRepeat: "repeat",
          backgroundSize:   "128px 128px",
        }}
      />

      {/* ── Main content (above aurora) ── */}
      <div className="relative z-10 flex flex-col min-h-screen px-6 py-5 gap-5">

        {/* ─── Frosted-glass header bar ──────────────── */}
        <header
          className="flex items-center justify-between px-5 py-3 rounded-2xl"
          style={{
            background:      "rgba(255,255,255,0.04)",
            border:          "1px solid rgba(255,255,255,0.07)",
            backdropFilter:  "blur(40px) saturate(180%)",
            WebkitBackdropFilter: "blur(40px) saturate(180%)",
          }}
        >
          {/* Left: title */}
          <div className="flex items-center gap-3">
            {/* Coloured dot — like macOS traffic lights repurposed */}
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{
                background: "linear-gradient(135deg, #bf5af2, #0a84ff)",
                boxShadow:  "0 0 8px rgba(191,90,242,0.6)",
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

          {/* Right: live indicator + date + balances button */}
          <div className="flex items-center gap-3">
            {/* Pulsing "Live" chip */}
            <span
              className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full"
              style={{
                background: "rgba(48,209,88,0.12)",
                color:      "#30d158",
                border:     "1px solid rgba(48,209,88,0.25)",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: "#30d158" }}
              />
              Live
            </span>

            <span
              className="text-[13px]"
              style={{ color: "rgba(255,255,255,0.35)" }}
            >
              {today}
            </span>

            <StocksPanel />
            <BalancesPanel />
          </div>
        </header>

        {/* ─── Bento grid ────────────────────────────── */}
        <main
          className="flex-1"
          style={{
            display:             "grid",
            gridTemplateColumns: "1.45fr 1fr 1fr",
            gridTemplateRows:    "1fr 1fr",
            gap:                 "14px",
            minHeight:           0,
          }}
        >
          {/* Wealth — spans 2 rows, has gradient-border glow */}
          <BentoCard glow style={{ gridRow: "span 2" }}>
            <WealthCenter />
          </BentoCard>

          <BentoCard>
            <Top7Priorities />
          </BentoCard>

          <BentoCard>
            <SmartInbox />
          </BentoCard>

          <BentoCard>
            <ActionCenter />
          </BentoCard>

          <BentoCard>
            <UpcomingBills />
          </BentoCard>
        </main>

      </div>
    </div>
  );
}
