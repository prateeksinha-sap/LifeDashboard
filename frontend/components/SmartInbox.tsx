"use client";

/**
 * SmartInbox.tsx — AI-extracted email action items + fallback mock inbox
 * ──────────────────────────────────────────────────────────────────────
 * Fetches pending actionables from /api/actionables.
 * Gmail items are shown with a mail icon; priority badge is colour-coded.
 * Falls back to static mock data when the backend is offline.
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, Mail, CheckCheck } from "lucide-react";
import { fetchActionables, markActionableDone, Actionable } from "@/lib/api";
import { INBOX_ITEMS, InboxBadge, InboxItem } from "@/lib/mockData";

/* ── Mock inbox badge styles (used when backend offline) ── */
const BADGE_STYLES: Record<InboxBadge, { bg: string; text: string }> = {
  Vibgyor: { bg: "rgba(191,90,242,0.14)", text: "#bf5af2" },
  Bill:    { bg: "rgba(255,59,48,0.14)",  text: "#ff453a" },
  Alert:   { bg: "rgba(255,159,10,0.14)", text: "#ff9f0a" },
};

/* ── Priority colours ── */
const PRIORITY_STYLE: Record<string, { bg: string; text: string }> = {
  High:   { bg: "rgba(255,69,58,0.15)",   text: "#ff453a" },
  Medium: { bg: "rgba(255,159,10,0.15)",  text: "#ff9f0a" },
  Low:    { bg: "rgba(48,209,88,0.13)",   text: "#30d158" },
};

/* ── Detail modal ── */
function DetailModal({
  item,
  onClose,
  onDone,
}: {
  item: Actionable;
  onClose: () => void;
  onDone: (id: number) => void;
}) {
  const pri = PRIORITY_STYLE[item.priority] ?? PRIORITY_STYLE.Medium;
  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 9998,
          background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
        }}
      />
      {/* Panel */}
      <div style={{
        position: "fixed", zIndex: 9999,
        top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: "min(480px, 90vw)",
        background: "rgba(22,22,28,0.98)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 20, padding: "24px",
        boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
      }}>
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            {item.source === "Gmail" && (
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ background: "rgba(10,132,255,0.14)", color: "#0a84ff", border: "1px solid rgba(10,132,255,0.22)" }}>
                <Mail size={9} /> Gmail
              </span>
            )}
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
              style={{ background: pri.bg, color: pri.text }}>
              {item.priority}
            </span>
          </div>
          <button onClick={onClose}
            className="shrink-0 rounded-full p-1 transition-colors"
            style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.05)" }}>
            <X size={13} strokeWidth={2} />
          </button>
        </div>

        {/* Task */}
        <p className="text-[14px] font-semibold leading-snug mb-3"
          style={{ color: "rgba(255,255,255,0.88)" }}>
          {item.task_description}
        </p>

        {/* Meta */}
        {item.subject && (
          <p className="text-[11px] mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>
            <span style={{ color: "rgba(255,255,255,0.22)" }}>Subject: </span>
            {item.subject}
          </p>
        )}
        {item.sender && (
          <p className="text-[11px] mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>
            <span style={{ color: "rgba(255,255,255,0.22)" }}>From: </span>
            {item.sender}
          </p>
        )}
        {item.due_date && (
          <p className="text-[11px] mb-3" style={{ color: "rgba(255,255,255,0.35)" }}>
            <span style={{ color: "rgba(255,255,255,0.22)" }}>Due: </span>
            {item.due_date}
          </p>
        )}

        {/* Action */}
        <button
          onClick={() => { onDone(item.id); onClose(); }}
          className="w-full mt-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
          style={{ background: "rgba(48,209,88,0.14)", color: "#30d158", border: "1px solid rgba(48,209,88,0.22)" }}
        >
          <CheckCheck size={13} className="inline mr-1.5" />
          Mark Done
        </button>
      </div>
    </>,
    document.body,
  );
}

/* ── Main component ── */
export default function SmartInbox() {
  const [items,    setItems]    = useState<Actionable[]>([]);
  const [useMock,  setUseMock]  = useState(false);
  const [mock,     setMock]     = useState<InboxItem[]>(INBOX_ITEMS);
  const [loading,  setLoading]  = useState(true);
  const [detail,   setDetail]   = useState<Actionable | null>(null);
  const [mounted,  setMounted]  = useState(false);

  useEffect(() => {
    setMounted(true);
    fetchActionables("Pending")
      .then((data) => {
        setItems(data);
        setUseMock(data.length === 0);
      })
      .catch(() => setUseMock(true))
      .finally(() => setLoading(false));
  }, []);

  const dismiss = async (id: number) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    try { await markActionableDone(id); } catch { /* silent */ }
  };

  const dismissMock = (id: number) =>
    setMock((prev) => prev.filter((i) => i.id !== id));

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <div className="w-4 h-4 rounded-full border-2 animate-spin"
        style={{ borderColor: "rgba(10,132,255,0.3)", borderTopColor: "#0a84ff" }} />
    </div>
  );

  return (
    <div className="flex flex-col h-full gap-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em]"
          style={{ color: "rgba(255,255,255,0.35)" }}>
          Smart Inbox
        </p>
        {!useMock && items.length > 0 && (
          <span className="text-[11px] font-semibold w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: "#0a84ff", color: "#fff" }}>
            {items.length}
          </span>
        )}
        {useMock && mock.length > 0 && (
          <span className="text-[11px] font-semibold w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: "#0a84ff", color: "#fff" }}>
            {mock.length}
          </span>
        )}
      </div>

      {/* ── List ── */}
      <ul className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0">
        <AnimatePresence initial={false}>
          {!useMock
            ? items.map((item) => {
                const pri = PRIORITY_STYLE[item.priority] ?? PRIORITY_STYLE.Medium;
                return (
                  <motion.li
                    key={item.id}
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0,  scale: 1    }}
                    exit={{
                      opacity: 0, x: 60, scale: 0.94,
                      height: 0, marginBottom: 0,
                      transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
                    }}
                    transition={{ type: "spring", stiffness: 300, damping: 26 }}
                    className="flex items-start gap-3 rounded-2xl px-3.5 py-3 group cursor-pointer"
                    style={{
                      background: "rgba(255,255,255,0.038)",
                      border:     "1px solid rgba(255,255,255,0.06)",
                    }}
                    onClick={() => setDetail(item)}
                  >
                    {/* Source/priority badge */}
                    <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
                      {item.source === "Gmail" && (
                        <span style={{ color: "#0a84ff" }}><Mail size={11} /></span>
                      )}
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md"
                        style={{ background: pri.bg, color: pri.text }}>
                        {item.priority}
                      </span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {item.sender && (
                        <p className="text-[12px] font-semibold truncate"
                          style={{ color: "rgba(255,255,255,0.75)" }}>
                          {item.sender.replace(/<[^>]+>/g, "").trim()}
                        </p>
                      )}
                      <p className="text-[12px] leading-[1.4] mt-0.5 line-clamp-2"
                        style={{ color: "rgba(255,255,255,0.45)" }}>
                        {item.task_description}
                      </p>
                      {item.due_date && (
                        <p className="text-[10px] mt-1" style={{ color: "rgba(255,159,10,0.7)" }}>
                          Due {item.due_date}
                        </p>
                      )}
                    </div>

                    {/* Dismiss */}
                    <button
                      onClick={(e) => { e.stopPropagation(); dismiss(item.id); }}
                      aria-label="Dismiss"
                      className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-full p-0.5"
                      style={{ color: "rgba(255,255,255,0.30)" }}
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  </motion.li>
                );
              })
            : mock.map((item) => {
                const badge = BADGE_STYLES[item.badge];
                return (
                  <motion.li
                    key={item.id}
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0,  scale: 1    }}
                    exit={{
                      opacity: 0, x: 60, scale: 0.94,
                      height: 0, marginBottom: 0,
                      transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
                    }}
                    transition={{ type: "spring", stiffness: 300, damping: 26 }}
                    className="flex items-start gap-3 rounded-2xl px-3.5 py-3 group cursor-default"
                    style={{
                      background: "rgba(255,255,255,0.038)",
                      border:     "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 mt-0.5"
                      style={{ background: badge.bg, color: badge.text }}>
                      {item.badge}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold truncate"
                        style={{ color: "rgba(255,255,255,0.75)" }}>
                        {item.sender}
                      </p>
                      <p className="text-[12px] leading-[1.4] mt-0.5 line-clamp-2"
                        style={{ color: "rgba(255,255,255,0.38)" }}>
                        {item.subject}
                      </p>
                    </div>
                    <button
                      onClick={() => dismissMock(item.id)}
                      aria-label="Dismiss"
                      className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-full p-0.5"
                      style={{ color: "rgba(255,255,255,0.30)" }}
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  </motion.li>
                );
              })}
        </AnimatePresence>

        {/* Empty state */}
        {((useMock && mock.length === 0) || (!useMock && items.length === 0)) && (
          <li className="text-center text-[13px] py-8"
            style={{ color: "rgba(255,255,255,0.22)" }}>
            All caught up
          </li>
        )}
      </ul>

      {/* Gmail hint when no real data */}
      {useMock && (
        <p className="text-[10px] text-center" style={{ color: "rgba(255,255,255,0.15)" }}>
          Run <code style={{ color: "rgba(10,132,255,0.5)" }}>sync_gmail.py</code> to populate
        </p>
      )}

      {/* Detail modal */}
      {mounted && detail && (
        <DetailModal
          item={detail}
          onClose={() => setDetail(null)}
          onDone={(id) => {
            dismiss(id);
            setDetail(null);
          }}
        />
      )}
    </div>
  );
}
