"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, Upload, X, Trash2, RefreshCw, Check, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/config";

interface Stock {
  id:            number;
  symbol:        string;
  company_name:  string | null;
  quantity:      number;
  avg_price:     number;
  current_price: number;
  value:         number;
  gain_loss:     number;
  gain_pct:      number;
}

export default function StocksPanel() {
  const [open,      setOpen]      = useState(false);
  const [stocks,    setStocks]    = useState<Stock[]>([]);
  const [uploading, setUploading] = useState(false);
  const [refreshing,setRefreshing]= useState(false);
  const [message,   setMessage]   = useState<{ text: string; ok: boolean } | null>(null);
  const [mounted,   setMounted]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  const load = () =>
    fetch(`${API_BASE}/api/wealth/stocks`)
      .then((r) => r.json())
      .then(setStocks)
      .catch(() => {});

  useEffect(() => { if (open) load(); }, [open]);

  const flash = (text: string, ok = true) => {
    setMessage({ text, ok });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res  = await fetch(`${API_BASE}/api/wealth/stocks/import`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");
      flash(`Imported ${data.imported} stocks${data.sheet ? ` from ${data.sheet}` : ""}`);
      load();
      // Reload page so WealthCenter refreshes
      setTimeout(() => window.location.reload(), 1200);
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : "Upload failed", false);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (symbol: string) => {
    await fetch(`${API_BASE}/api/wealth/stocks/${symbol}`, { method: "DELETE" });
    setStocks((prev) => prev.filter((s) => s.symbol !== symbol));
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`${API_BASE}/api/wealth/stocks/refresh-prices`, { method: "POST" });
      await load();
      flash("Prices refreshed");
    } catch {
      flash("Refresh failed", false);
    } finally {
      setRefreshing(false);
    }
  };

  const totalValue    = stocks.reduce((s, x) => s + x.value, 0);
  const totalGainLoss = stocks.reduce((s, x) => s + x.gain_loss, 0);

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full transition-all"
        style={{
          background: "rgba(10,132,255,0.1)",
          color:      "#0a84ff",
          border:     "1px solid rgba(10,132,255,0.2)",
        }}
        title="Manage Zerodha stock holdings"
      >
        <TrendingUp size={13} strokeWidth={2} />
        Stocks
      </button>

      {mounted && createPortal(
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              key="bd"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0"
              style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)", zIndex: 9998 }}
              onClick={() => setOpen(false)}
            />

            {/* Panel */}
            <motion.div
              key="panel"
              initial={{ opacity: 0, scale: 0.94, y: -16 }}
              animate={{ opacity: 1, scale: 1,    y: 0 }}
              exit={{    opacity: 0, scale: 0.94, y: -16 }}
              transition={{ type: "spring", stiffness: 340, damping: 28 }}
              className="fixed top-[72px] right-6 w-[420px] rounded-3xl p-6 flex flex-col gap-4"
              style={{
                zIndex:         9999,
                background:     "rgba(22,22,26,0.92)",
                border:         "1px solid rgba(255,255,255,0.1)",
                backdropFilter: "blur(40px) saturate(180%)",
                boxShadow:      "0 32px 80px rgba(0,0,0,0.6)",
                maxHeight:      "80vh",
                overflowY:      "auto",
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[15px] font-semibold" style={{ color: "rgba(255,255,255,0.92)" }}>
                    Zerodha Holdings
                  </p>
                  <p className="text-[12px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
                    Import Zerodha XLSX or CSV from Console holdings
                  </p>
                </div>
                <button onClick={() => setOpen(false)}
                  className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
                  <X size={14} />
                </button>
              </div>

              {/* Upload + Refresh row */}
              <div className="flex gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl text-[13px] font-semibold transition-all"
                  style={{
                    background: "rgba(10,132,255,0.85)",
                    color:      "#fff",
                    opacity:    uploading ? 0.6 : 1,
                  }}
                >
                  {uploading
                    ? <><Loader2 size={14} className="animate-spin" /> Importing…</>
                    : <><Upload size={14} /> Import file</>}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xlsm,.csv,.txt"
                  className="hidden"
                  onChange={handleFile}
                />
                <button
                  onClick={handleRefresh}
                  disabled={refreshing || stocks.length === 0}
                  className="w-10 h-10 rounded-2xl flex items-center justify-center transition-all"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    color:      "rgba(255,255,255,0.5)",
                    opacity:    stocks.length === 0 ? 0.4 : 1,
                  }}
                  title="Refresh live prices"
                >
                  <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
                </button>
              </div>

              {/* Flash message */}
              <AnimatePresence>
                {message && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium"
                    style={{
                      background: message.ok ? "rgba(48,209,88,0.12)" : "rgba(255,69,58,0.12)",
                      color:      message.ok ? "#30d158" : "#ff453a",
                      border:     `1px solid ${message.ok ? "rgba(48,209,88,0.25)" : "rgba(255,69,58,0.25)"}`,
                    }}
                  >
                    {message.ok ? <Check size={13} /> : <X size={13} />}
                    {message.text}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Instructions (shown when empty) */}
              {stocks.length === 0 && !uploading && (
                <div className="text-center py-4">
                  <p className="text-[13px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                    No stocks yet.
                  </p>
                  <p className="text-[12px] mt-1" style={{ color: "rgba(255,255,255,0.2)" }}>
                    1. Open console.zerodha.com<br />
                    2. Portfolio → Holdings<br />
                    3. Download holdings as XLSX or CSV<br />
                    4. Import it above
                  </p>
                </div>
              )}

              {/* Summary row */}
              {stocks.length > 0 && (
                <div className="flex justify-between px-1">
                  <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                    {stocks.length} stocks · ₹{(totalValue / 1_00_000).toFixed(2)}L
                  </span>
                  <span className="text-[12px] font-semibold"
                    style={{ color: totalGainLoss >= 0 ? "#30d158" : "#ff453a" }}>
                    {totalGainLoss >= 0 ? "+" : ""}₹{Math.abs(totalGainLoss).toLocaleString("en-IN", { maximumFractionDigits: 0 })} P&L
                  </span>
                </div>
              )}

              {/* Holdings list */}
              {stocks.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {stocks.map((s) => (
                    <div key={s.symbol}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl group"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      {/* Symbol pill */}
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg shrink-0"
                        style={{ background: "rgba(10,132,255,0.15)", color: "#0a84ff" }}>
                        {s.symbol}
                      </span>

                      {/* Name + qty */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium truncate"
                          style={{ color: "rgba(255,255,255,0.75)" }}>
                          {s.company_name || s.symbol}
                        </p>
                        <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                          {s.quantity} shares · avg ₹{s.avg_price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                        </p>
                      </div>

                      {/* Value + gain */}
                      <div className="text-right shrink-0">
                        <p className="text-[12px] font-semibold tabular-nums"
                          style={{ color: "rgba(255,255,255,0.8)" }}>
                          ₹{s.value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                        </p>
                        <p className="text-[11px] font-medium tabular-nums"
                          style={{ color: s.gain_pct >= 0 ? "#30d158" : "#ff453a" }}>
                          {s.gain_pct >= 0 ? "+" : ""}{s.gain_pct.toFixed(1)}%
                        </p>
                      </div>

                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(s.symbol)}
                        className="opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
                        style={{ color: "#ff453a" }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>,
      document.body
      )}
    </>
  );
}
