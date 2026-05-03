"use client";

import Link from "next/link";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, DatabaseZap, Layers3, RefreshCw, Upload } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import {
  EquityAllocationData,
  EquityBucket,
  EquityExposureRow,
  EquitySectorBucket,
  SectorGuidanceData,
  SectorGuidanceSuggestion,
  fetchSectorGuidance,
  fetchEquityAllocation,
  refreshEquitySecurityMaster,
  syncEquityLookthrough,
  uploadEquitySecurityMaster,
  uploadFundPortfolio,
} from "@/lib/api";

function shortMoney(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_00_00_000) return `${sign}INR ${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}INR ${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}INR ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}INR ${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function pct(value: number): string {
  if (value > 0 && value < 1) return "<1%";
  return `${value.toFixed(0)}%`;
}

function BucketCard({ bucket }: { bucket: EquityBucket }) {
  return (
    <div className="rounded-lg p-4" style={{ background: `${bucket.color}12`, border: `1px solid ${bucket.color}28` }}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-sm font-bold">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: bucket.color }} />
          <span className="truncate">{bucket.label}</span>
        </p>
        <span className="text-sm font-bold tabular-nums" style={{ color: bucket.color }}>{pct(bucket.percentage)}</span>
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums">{shortMoney(bucket.value)}</p>
      <p className="mt-1 text-[12px]" style={{ color: "rgba(255,255,255,0.44)" }}>
        {bucket.count} stock-level rows
      </p>
    </div>
  );
}

function SectorTile({ sectors, coveragePct, unmappedValue }: { sectors: EquitySectorBucket[]; coveragePct: number; unmappedValue: number }) {
  const topSectors = sectors.slice(0, 10);
  const remaining = Math.max(sectors.length - topSectors.length, 0);

  return (
    <section className="rounded-lg p-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.42)" }}>
            Sector exposure
          </p>
          <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.46)" }}>
            Look-through sector split from mutual fund underlying stocks plus direct equity.
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-[12px] font-semibold tabular-nums" style={{ color: "rgba(255,255,255,0.56)" }}>
            {sectors.length} sectors | {coveragePct.toFixed(0)}% classified
          </p>
          {unmappedValue > 0 && (
            <p className="text-[11px] tabular-nums" style={{ color: "rgba(255,255,255,0.38)" }}>
              {shortMoney(unmappedValue)} still unmapped/non-sector
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex h-3 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
        {topSectors.map((sector) => (
          <div
            key={sector.label}
            title={`${sector.label}: ${shortMoney(sector.value)} (${sector.percentage.toFixed(1)}%)`}
            style={{ width: `${Math.max(sector.percentage, sector.value > 0 ? 1 : 0)}%`, background: sector.color }}
          />
        ))}
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {topSectors.map((sector) => (
          <div
            key={sector.label}
            className="min-w-0 rounded-lg px-3 py-2"
            style={{ background: `${sector.color}0f`, border: `1px solid ${sector.color}22` }}
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="flex min-w-0 items-center gap-2 text-[12px] font-bold">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: sector.color }} />
                <span className="truncate">{sector.label}</span>
              </p>
              <span className="shrink-0 text-[12px] font-bold tabular-nums" style={{ color: sector.color }}>{pct(sector.percentage)}</span>
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <p className="text-lg font-bold tabular-nums">{shortMoney(sector.value)}</p>
              <p className="text-[10.5px] tabular-nums" style={{ color: "rgba(255,255,255,0.38)" }}>
                {sector.count} rows
              </p>
            </div>
          </div>
        ))}
      </div>

      {remaining > 0 && (
        <p className="mt-3 text-[11px]" style={{ color: "rgba(255,255,255,0.42)" }}>
          +{remaining} smaller sectors are included in the stock-level table below.
        </p>
      )}
    </section>
  );
}

function stanceColor(stance: SectorGuidanceSuggestion["stance"]): string {
  if (stance === "add") return "#30d158";
  if (stance === "reduce") return "#ff9f0a";
  if (stance === "research") return "#64d2ff";
  return "rgba(255,255,255,0.62)";
}

function SectorGuidanceTile({
  guidance,
  loading,
  error,
  onRefresh,
}: {
  guidance: SectorGuidanceData | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  return (
    <section className="rounded-lg p-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.42)" }}>
            AI sector guidance
          </p>
          <p className="mt-1 text-sm font-semibold">{guidance?.headline || "Grounded suggestions from your allocation and recent reliable-source coverage."}</p>
          <p className="mt-1 text-[12px]" style={{ color: "rgba(255,255,255,0.44)" }}>
            {guidance ? `${guidance.source_count} source items | ${guidance.provider}${guidance.model ? ` / ${guidance.model}` : ""}${guidance.fallback ? " | fallback logic" : ""}${guidance.cached ? " | cached" : ""}` : "Generates without changing your holdings."}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold"
          style={{ background: "rgba(48,209,88,0.10)", color: "#30d158", border: "1px solid rgba(48,209,88,0.22)" }}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> {loading ? "Thinking..." : "Refresh guidance"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg px-3 py-2 text-[12px]" style={{ background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.18)", color: "#ff8a80" }}>
          {error}
        </div>
      )}

      {!guidance && !error && (
        <div className="mt-4 rounded-lg px-3 py-4 text-[12px]" style={{ background: "rgba(255,255,255,0.035)", color: "rgba(255,255,255,0.46)" }}>
          {loading ? "Reading your sector allocation and recent market-source headlines..." : "No guidance generated yet."}
        </div>
      )}

      {guidance && (
        <>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {guidance.suggestions.slice(0, 6).map((item) => (
              <div key={`${item.sector}-${item.stance}`} className="rounded-lg p-3" style={{ background: "rgba(0,0,0,0.18)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{item.sector}</p>
                    <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "rgba(255,255,255,0.58)" }}>{item.why}</p>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase"
                    style={{ background: `${stanceColor(item.stance)}18`, color: stanceColor(item.stance), border: `1px solid ${stanceColor(item.stance)}30` }}
                  >
                    {item.stance}
                  </span>
                </div>
                <p className="mt-3 text-[12px] font-semibold" style={{ color: "#30d158" }}>{item.action}</p>
                {item.source_evidence.length > 0 && (
                  <p className="mt-2 line-clamp-2 text-[11px]" style={{ color: "rgba(255,255,255,0.38)" }}>
                    Source basis: {item.source_evidence.slice(0, 2).join(" | ")}
                  </p>
                )}
              </div>
            ))}
          </div>

          {guidance.sources.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.34)" }}>
                Sources considered
              </p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {guidance.sources.slice(0, 6).map((source) => (
                  <a
                    key={`${source.source}-${source.title}`}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 rounded-md px-3 py-2 text-[12px]"
                    style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <p className="truncate font-semibold">{source.title}</p>
                    <p className="mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.38)" }}>{source.source}</p>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ExposureRow({ row }: { row: EquityExposureRow }) {
  return (
    <tr style={{ borderTop: "1px solid rgba(255,255,255,0.055)" }}>
      <td className="px-3 py-2 text-[12px] font-semibold">{row.type}</td>
      <td className="max-w-[260px] px-3 py-2 text-[12px]">
        <p className="truncate font-semibold">{row.source}</p>
      </td>
      <td className="max-w-[220px] px-3 py-2 text-[12px]">
        <p className="truncate font-semibold">{row.stock_name}</p>
        {row.symbol && <p className="text-[10.5px]" style={{ color: "rgba(255,255,255,0.36)" }}>{row.symbol}</p>}
      </td>
      <td className="px-3 py-2 text-[12px]">{row.category ?? "Unmapped"}</td>
      <td className="max-w-[180px] px-3 py-2 text-[12px]">
        <p className="truncate">{row.sector || "Unknown"}</p>
      </td>
      <td className="px-3 py-2 text-right text-[12px] tabular-nums">{row.weight_pct.toFixed(row.type === "Direct Stock" ? 0 : 2)}%</td>
      <td className="px-3 py-2 text-right text-[12px] font-bold tabular-nums">{shortMoney(row.value)}</td>
    </tr>
  );
}

export default function EquityAllocationPage() {
  const [data, setData] = useState<EquityAllocationData | null>(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState("");
  const [syncing, setSyncing] = useState("");
  const [notice, setNotice] = useState("");
  const [guidance, setGuidance] = useState<SectorGuidanceData | null>(null);
  const [guidanceLoading, setGuidanceLoading] = useState(false);
  const [guidanceError, setGuidanceError] = useState("");
  const [portfolioScheme, setPortfolioScheme] = useState("");
  const securityInput = useRef<HTMLInputElement | null>(null);
  const portfolioInput = useRef<HTMLInputElement | null>(null);

  const load = () => {
    fetchEquityAllocation()
      .then((result) => {
        setData(result);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load equity allocation."));
  };

  useEffect(() => {
    load();
  }, []);

  const loadGuidance = useCallback((force = false) => {
    setGuidanceLoading(true);
    setGuidanceError("");
    fetchSectorGuidance(45, force)
      .then((result) => setGuidance(result))
      .catch((err) => setGuidanceError(err instanceof Error ? err.message : "Could not generate sector guidance."))
      .finally(() => setGuidanceLoading(false));
  }, []);

  useEffect(() => {
    if (data?.total_equity && data.total_equity > 0 && !guidance && !guidanceLoading) {
      loadGuidance();
    }
  }, [data?.total_equity, guidance, guidanceLoading, loadGuidance]);

  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const topRows = useMemo(() => allRows.slice(0, 80), [allRows]);

  async function importFile(event: ChangeEvent<HTMLInputElement>, type: "security" | "portfolio") {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(type);
    setNotice("");
    try {
      const result = type === "security"
        ? await uploadEquitySecurityMaster(file)
        : await uploadFundPortfolio(file, portfolioScheme);
      setNotice(`${file.name}: ${result.imported ?? 0} imported, ${result.updated ?? 0} updated, ${result.skipped ?? 0} skipped.`);
      load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting("");
      event.target.value = "";
    }
  }

  async function runAutomaticSync(mode: "all" | "amfi") {
    setSyncing(mode);
    setNotice("");
    try {
      const result = mode === "all"
        ? await syncEquityLookthrough()
        : await refreshEquitySecurityMaster();
      const security = result.security_master ?? result;
      const portfolios = result.fund_portfolios;
      const message = portfolios
        ? `Synced AMFI (${security.total ?? security.imported ?? 0} classifications) and ${portfolios.funds_synced ?? 0} fund portfolios with ${portfolios.portfolio_rows_imported ?? 0} stock rows.`
        : `Refreshed AMFI classifications: ${security.imported ?? 0} imported, ${security.updated ?? 0} updated.`;
      setNotice(message);
      load();
      setGuidance(null);
      loadGuidance();
      window.dispatchEvent(new Event("wealth-updated"));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing("");
    }
  }

  if (error) {
    return (
      <main className="min-h-screen p-5" style={{ background: "#000", color: "rgba(255,255,255,0.9)" }}>
        <EmptyState title="Equity allocation unavailable" detail={error} />
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center" style={{ background: "#000" }}>
        <div className="h-5 w-5 animate-spin rounded-full border-2" style={{ borderColor: "rgba(10,132,255,0.28)", borderTopColor: "#0a84ff" }} />
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: "#000", color: "rgba(255,255,255,0.92)" }}>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          background: `
            radial-gradient(ellipse 46% 40% at 12% 12%, rgba(10,132,255,0.16) 0%, transparent 60%),
            radial-gradient(ellipse 42% 44% at 88% 78%, rgba(191,90,242,0.12) 0%, transparent 64%)
          `,
        }}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[1380px] flex-col gap-4 px-4 py-5 lg:px-6">
        <header
          className="flex flex-col gap-3 rounded-lg px-4 py-3 md:flex-row md:items-center md:justify-between"
          style={{ background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
              aria-label="Back to dashboard"
            >
              <ArrowLeft size={17} />
            </Link>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.42)" }}>
                Equity X-ray
              </p>
              <h1 className="text-xl font-semibold">Large, mid and small-cap look-through</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void runAutomaticSync("all")}
              disabled={Boolean(syncing)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold"
              style={{ background: "rgba(48,209,88,0.12)", color: "#30d158", border: "1px solid rgba(48,209,88,0.24)" }}
            >
              <RefreshCw size={13} className={syncing === "all" ? "animate-spin" : ""} /> {syncing === "all" ? "Syncing..." : "Auto sync"}
            </button>
            <button
              type="button"
              onClick={() => void runAutomaticSync("amfi")}
              disabled={Boolean(syncing)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold"
              style={{ background: "rgba(10,132,255,0.10)", color: "#64d2ff", border: "1px solid rgba(10,132,255,0.22)" }}
            >
              <DatabaseZap size={13} /> {syncing === "amfi" ? "Refreshing..." : "Refresh AMFI"}
            </button>
            <input
              value={portfolioScheme}
              onChange={(event) => setPortfolioScheme(event.target.value)}
              placeholder="Fund name if file has no scheme column"
              className="h-8 min-w-[260px] rounded-full px-3 text-[12px] outline-none"
              style={{ background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.86)" }}
            />
            <button
              type="button"
              onClick={() => securityInput.current?.click()}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold"
              style={{ background: "rgba(10,132,255,0.12)", color: "#64d2ff", border: "1px solid rgba(10,132,255,0.24)" }}
            >
              <Upload size={13} /> {importing === "security" ? "Importing..." : "Import AMFI list"}
            </button>
            <button
              type="button"
              onClick={() => portfolioInput.current?.click()}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold"
              style={{ background: "rgba(191,90,242,0.12)", color: "#bf5af2", border: "1px solid rgba(191,90,242,0.24)" }}
            >
              <Upload size={13} /> {importing === "portfolio" ? "Importing..." : "Import fund portfolio"}
            </button>
            <input ref={securityInput} type="file" className="hidden" accept=".csv,.xlsx,.xlsm" onChange={(event) => void importFile(event, "security")} />
            <input ref={portfolioInput} type="file" className="hidden" accept=".csv,.xlsx,.xlsm" onChange={(event) => void importFile(event, "portfolio")} />
          </div>
        </header>

        {notice && (
          <div className="rounded-lg px-4 py-2 text-[12px]" style={{ background: "rgba(255,159,10,0.08)", border: "1px solid rgba(255,159,10,0.18)", color: "#ffcc66" }}>
            {notice}
          </div>
        )}

        {data.total_equity <= 0 ? (
          <section className="rounded-lg p-6" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <EmptyState title="No equity holdings yet" detail="Import CAS and Zerodha holdings to see large, mid and small-cap exposure." />
          </section>
        ) : (
          <>
            <section className="grid gap-4 lg:grid-cols-[0.9fr_1.5fr_1.1fr]">
              <div className="rounded-lg p-5" style={{ background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.42)" }}>
                      Total equity
                    </p>
                    <p className="mt-2 text-4xl font-bold tabular-nums">{shortMoney(data.total_equity)}</p>
                  </div>
                  <Layers3 size={24} style={{ color: "#0a84ff" }} />
                </div>
                <p className="mt-4 text-[12px] leading-relaxed" style={{ color: "rgba(255,255,255,0.48)" }}>
                  {data.classification_method}
                </p>
              </div>

              <div className="rounded-lg p-5" style={{ background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.42)" }}>
                  Summary allocation
                </p>
                <div className="mt-4 flex h-3 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                  {data.buckets.map((bucket) => (
                    <div
                      key={bucket.label}
                      title={`${bucket.label}: ${shortMoney(bucket.value)} (${bucket.percentage.toFixed(1)}%)`}
                      style={{ width: `${Math.max(bucket.percentage, bucket.value > 0 ? 1 : 0)}%`, background: bucket.color }}
                    />
                  ))}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {data.buckets.map((bucket) => <BucketCard key={bucket.label} bucket={bucket} />)}
                </div>
              </div>

              <div className="rounded-lg p-5" style={{ background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.42)" }}>
                      Data coverage
                    </p>
                    <p className="mt-2 text-3xl font-bold tabular-nums" style={{ color: data.coverage_pct >= 85 ? "#30d158" : "#ff9f0a" }}>
                      {data.coverage_pct.toFixed(0)}%
                    </p>
                  </div>
                  <DatabaseZap size={22} style={{ color: data.coverage_pct >= 85 ? "#30d158" : "#ff9f0a" }} />
                </div>
                <div className="mt-4 grid gap-2 text-[12px]" style={{ color: "rgba(255,255,255,0.56)" }}>
                  <p>Security master: <b>{data.security_master_count}</b> stocks</p>
                  <p>Fund portfolio rows: <b>{data.fund_portfolio_row_count}</b></p>
                  <p>Mapped exposure: <b>{shortMoney(data.mapped_value)}</b></p>
                  <p>Unmapped exposure: <b>{shortMoney(data.unmapped_value)}</b></p>
                </div>
              </div>
            </section>

            <SectorTile
              sectors={data.sector_allocation ?? []}
              coveragePct={data.sector_coverage_pct ?? 0}
              unmappedValue={data.sector_unmapped_value ?? 0}
            />

            <SectorGuidanceTile
              guidance={guidance}
              loading={guidanceLoading}
              error={guidanceError}
              onRefresh={() => loadGuidance(true)}
            />

            <section className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.42)" }}>
                    Stock-level exposure table
                  </p>
                  <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.46)" }}>
                    Type, source, stock, large/mid/small category, sector, holding weight and your exposure value.
                  </p>
                </div>
                <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.42)" }}>
                  Showing top {topRows.length} mapped rows
                </p>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[980px] border-collapse">
                  <thead>
                    <tr style={{ color: "rgba(255,255,255,0.42)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide">Type</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide">Source</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide">Stock name</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide">Category</th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide">Sector</th>
                      <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide">Weight</th>
                      <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topRows.map((row, idx) => <ExposureRow key={`${row.type}-${row.source}-${row.stock_name}-${idx}`} row={row} />)}
                  </tbody>
                </table>
              </div>
            </section>

            {(data.unmapped.missing_fund_composition.length > 0 || data.unmapped.unclassified_rows.length > 0) && (
              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg p-4" style={{ background: "rgba(255,159,10,0.055)", border: "1px solid rgba(255,159,10,0.16)" }}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#ff9f0a" }}>
                    Missing fund composition
                  </p>
                  <div className="mt-3 grid gap-2">
                    {data.unmapped.missing_fund_composition.slice(0, 10).map((row) => (
                      <div key={`${row.source}-${row.reason}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md px-3 py-2" style={{ background: "rgba(0,0,0,0.16)" }}>
                        <p className="truncate text-[12px] font-semibold">{row.source}</p>
                        <p className="text-right text-[12px] font-bold tabular-nums">{shortMoney(row.value)}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg p-4" style={{ background: "rgba(255,69,58,0.045)", border: "1px solid rgba(255,69,58,0.14)" }}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "#ff453a" }}>
                    Unmapped stocks
                  </p>
                  <div className="mt-3 grid gap-2">
                    {data.unmapped.unclassified_rows.slice(0, 10).map((row, idx) => (
                      <div key={`${row.source}-${row.stock_name}-${idx}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md px-3 py-2" style={{ background: "rgba(0,0,0,0.16)" }}>
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-semibold">{row.stock_name}</p>
                          <p className="truncate text-[10.5px]" style={{ color: "rgba(255,255,255,0.38)" }}>{row.reason}</p>
                        </div>
                        <p className="text-right text-[12px] font-bold tabular-nums">{shortMoney(row.value)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
