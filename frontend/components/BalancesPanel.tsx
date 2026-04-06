"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SlidersHorizontal, X, Check, Loader2, AlertCircle } from "lucide-react";

const BASE = "http://localhost:8000";

const FIELDS = [
  { key: "EPF",        label: "EPF",        prefix: "₹", color: "#5ac8fa", hint: "EPFO portal balance" },
  { key: "PPF",        label: "PPF",        prefix: "₹", color: "#30d158", hint: "Axis Bank PPF account" },
  { key: "NPS",        label: "NPS",        prefix: "₹", color: "#ff375f", hint: "NPS statement balance" },
  { key: "BANK",       label: "Bank Cash",  prefix: "₹", color: "#ffd60a", hint: "Axis Bank savings balance" },
  { key: "GOLD_GRAMS", label: "Gold",       prefix: "",  color: "#ff9f0a", hint: "Physical gold in grams" },
];

export default function BalancesPanel() {
  const [open,    setOpen]    = useState(false);
  const [values,  setValues]  = useState<Record<string, string>>({});
  const [status,  setStatus]  = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errMsg,  setErrMsg]  = useState("");

  // Load current values from backend whenever panel opens
  useEffect(() => {
    if (!open) return;
    setStatus("idle");
    fetch(`${BASE}/api/wealth/manual`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Record<string, number>) => {
        const init: Record<string, string> = {};
        FIELDS.forEach((f) => {
          const v = data[f.key];
          init[f.key] = (v && v > 0) ? String(v) : "";
        });
        setValues(init);
      })
      .catch((e) => {
        setErrMsg(`Could not load balances: ${e.message}`);
        setStatus("error");
      });
  }, [open]);

  const handleChange = (key: string, raw: string) => {
    const cleaned = raw.replace(/[^\d.]/g, "");
    setValues((prev) => ({ ...prev, [key]: cleaned }));
  };

  const handleSave = async () => {
    setStatus("saving");
    setErrMsg("");
    try {
      const results = await Promise.allSettled(
        FIELDS.map((f) => {
          const v = parseFloat(values[f.key] || "0");
          return fetch(`${BASE}/api/wealth/manual`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ asset_type: f.key, value: isNaN(v) ? 0 : v }),
          }).then((r) => {
            if (!r.ok) throw new Error(`${f.label} save failed (HTTP ${r.status})`);
            return r.json();
          });
        })
      );

      const failures = results
        .filter((r) => r.status === "rejected")
        .map((r) => (r as PromiseRejectedResult).reason?.message);

      if (failures.length > 0) {
        setErrMsg(failures.join(", "));
        setStatus("error");
        return;
      }

      setStatus("saved");
      // Tell WealthCenter to refresh without a page reload
      window.dispatchEvent(new Event("wealth-updated"));
      setTimeout(() => {
        setStatus("idle");
        setOpen(false);
      }, 1200);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setErrMsg(`Save failed: ${msg}. Is the backend running?`);
      setStatus("error");
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full transition-all"
        style={{
          background: "rgba(255,255,255,0.06)",
          color:      "rgba(255,255,255,0.55)",
          border:     "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <SlidersHorizontal size={13} strokeWidth={2} />
        Balances
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="bd"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)" }}
              onClick={() => setOpen(false)}
            />

            <motion.div
              key="panel"
              initial={{ opacity: 0, scale: 0.94, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{    opacity: 0, scale: 0.94, y: -16 }}
              transition={{ type: "spring", stiffness: 340, damping: 28 }}
              className="fixed z-50 top-[72px] right-6 w-[340px] rounded-3xl p-6 flex flex-col gap-5"
              style={{
                background:     "rgba(22,22,26,0.96)",
                border:         "1px solid rgba(255,255,255,0.1)",
                backdropFilter: "blur(40px) saturate(180%)",
                boxShadow:      "0 32px 80px rgba(0,0,0,0.7)",
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[15px] font-semibold" style={{ color: "rgba(255,255,255,0.92)" }}>
                    Update Balances
                  </p>
                  <p className="text-[12px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
                    Enter your current account values
                  </p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}
                >
                  <X size={14} />
                </button>
              </div>

              {/* Fields */}
              <div className="flex flex-col gap-3">
                {FIELDS.map((field) => (
                  <div key={field.key}>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[12px] font-semibold flex items-center gap-1.5"
                        style={{ color: field.color }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: field.color }} />
                        {field.label}
                      </label>
                      <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.22)" }}>
                        {field.hint}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border:     `1px solid rgba(255,255,255,${values[field.key] ? "0.12" : "0.06"})`,
                        transition: "border-color 0.15s",
                      }}>
                      {field.prefix && (
                        <span className="text-[14px] font-medium shrink-0"
                          style={{ color: "rgba(255,255,255,0.3)" }}>
                          {field.prefix}
                        </span>
                      )}
                      <input
                        type="text"
                        inputMode="numeric"
                        value={values[field.key] ?? ""}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        placeholder="0"
                        className="flex-1 bg-transparent outline-none text-[15px] font-semibold tabular-nums"
                        style={{ color: "rgba(255,255,255,0.9)" }}
                      />
                      {field.key === "GOLD_GRAMS" && (
                        <span className="text-[12px] shrink-0"
                          style={{ color: "rgba(255,255,255,0.3)" }}>
                          grams
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Error message */}
              <AnimatePresence>
                {status === "error" && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-[12px]"
                    style={{
                      background: "rgba(255,69,58,0.1)",
                      border:     "1px solid rgba(255,69,58,0.25)",
                      color:      "#ff453a",
                    }}
                  >
                    <AlertCircle size={13} className="shrink-0 mt-0.5" />
                    <span>{errMsg || "Save failed. Make sure the backend is running."}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Save button */}
              <button
                onClick={handleSave}
                disabled={status === "saving" || status === "saved"}
                className="flex items-center justify-center gap-2 py-3 rounded-2xl text-[14px] font-semibold transition-all"
                style={{
                  background: status === "saved"
                    ? "rgba(48,209,88,0.2)"
                    : status === "error"
                    ? "rgba(255,69,58,0.15)"
                    : "rgba(10,132,255,0.9)",
                  color:  status === "saved" ? "#30d158" : status === "error" ? "#ff453a" : "#ffffff",
                  border: status === "saved"
                    ? "1px solid rgba(48,209,88,0.4)"
                    : status === "error"
                    ? "1px solid rgba(255,69,58,0.3)"
                    : "1px solid transparent",
                  opacity: status === "saving" ? 0.7 : 1,
                }}
              >
                {status === "saving" && <><Loader2 size={15} className="animate-spin" /> Saving…</>}
                {status === "saved"  && <><Check size={15} /> Saved! Dashboard updated.</>}
                {status === "error"  && <>Try again</>}
                {status === "idle"   && <>Save & Update Dashboard</>}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
