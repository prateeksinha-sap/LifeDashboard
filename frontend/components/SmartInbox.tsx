"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCheck, Mail, X } from "lucide-react";
import { Actionable, fetchActionables, markActionableDone } from "@/lib/api";
import EmptyState from "@/components/EmptyState";

const PRIORITY_STYLE: Record<string, { bg: string; text: string }> = {
  High:   { bg: "rgba(255,69,58,0.15)",  text: "#ff453a" },
  Medium: { bg: "rgba(255,159,10,0.15)", text: "#ff9f0a" },
  Low:    { bg: "rgba(48,209,88,0.13)",  text: "#30d158" },
};

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
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
      />
      <div
        style={{
          position: "fixed",
          zIndex: 9999,
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: "min(480px, 90vw)",
          background: "rgba(22,22,28,0.98)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 20,
          padding: "24px",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {item.source === "Gmail" && (
              <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ background: "rgba(10,132,255,0.14)", color: "#0a84ff", border: "1px solid rgba(10,132,255,0.22)" }}>
                <Mail size={9} /> Gmail
              </span>
            )}
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: pri.bg, color: pri.text }}>
              {item.priority}
            </span>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full p-1" style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.05)" }}>
            <X size={13} strokeWidth={2} />
          </button>
        </div>

        <p className="mb-3 text-[14px] font-semibold leading-snug" style={{ color: "rgba(255,255,255,0.88)" }}>
          {item.task_description}
        </p>

        {item.subject && (
          <p className="mb-1 text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
            <span style={{ color: "rgba(255,255,255,0.22)" }}>Subject: </span>{item.subject}
          </p>
        )}
        {item.sender && (
          <p className="mb-1 text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
            <span style={{ color: "rgba(255,255,255,0.22)" }}>From: </span>{item.sender}
          </p>
        )}
        {item.due_date && (
          <p className="mb-3 text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
            <span style={{ color: "rgba(255,255,255,0.22)" }}>Due: </span>{item.due_date}
          </p>
        )}

        <button
          onClick={() => { onDone(item.id); onClose(); }}
          className="mt-2 w-full rounded-xl py-2.5 text-[13px] font-semibold"
          style={{ background: "rgba(48,209,88,0.14)", color: "#30d158", border: "1px solid rgba(48,209,88,0.22)" }}
        >
          <CheckCheck size={13} className="mr-1.5 inline" />
          Mark Done
        </button>
      </div>
    </>,
    document.body,
  );
}

export default function SmartInbox() {
  const [items, setItems] = useState<Actionable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [detail, setDetail] = useState<Actionable | null>(null);
  const [mounted, setMounted] = useState(false);

  const loadItems = () => {
    fetchActionables("Pending")
      .then((data) => {
        setItems(data);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    loadItems();
    window.addEventListener("gmail-synced", loadItems);
    window.addEventListener("actionables-updated", loadItems);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("gmail-synced", loadItems);
      window.removeEventListener("actionables-updated", loadItems);
    };
  }, []);

  const dismiss = async (id: number) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await markActionableDone(id);
      window.dispatchEvent(new Event("actionables-updated"));
    } catch { /* keep optimistic dismissal */ }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "rgba(10,132,255,0.3)", borderTopColor: "#0a84ff" }} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.35)" }}>
          Smart Inbox
        </p>
        {items.length > 0 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold" style={{ background: "#0a84ff", color: "#fff" }}>
            {items.length}
          </span>
        )}
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const pri = PRIORITY_STYLE[item.priority] ?? PRIORITY_STYLE.Medium;
            return (
              <motion.li
                key={item.id}
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 60, scale: 0.94, height: 0, marginBottom: 0, transition: { duration: 0.22 } }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                className="group flex cursor-pointer items-start gap-3 rounded-2xl px-3.5 py-3"
                style={{ background: "rgba(255,255,255,0.038)", border: "1px solid rgba(255,255,255,0.06)" }}
                onClick={() => setDetail(item)}
              >
                <div className="mt-0.5 flex shrink-0 flex-col items-center gap-1">
                  {item.source === "Gmail" && <Mail size={11} style={{ color: "#0a84ff" }} />}
                  <span className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: pri.bg, color: pri.text }}>
                    {item.priority}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  {item.sender && (
                    <p className="truncate text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.75)" }}>
                      {item.sender.replace(/<[^>]+>/g, "").trim()}
                    </p>
                  )}
                  <p className="mt-0.5 line-clamp-2 text-[12px] leading-[1.4]" style={{ color: "rgba(255,255,255,0.45)" }}>
                    {item.task_description}
                  </p>
                  {item.due_date && <p className="mt-1 text-[10px]" style={{ color: "rgba(255,159,10,0.7)" }}>Due {item.due_date}</p>}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); dismiss(item.id); }}
                  aria-label="Dismiss"
                  className="mt-0.5 shrink-0 rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: "rgba(255,255,255,0.30)" }}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>

        {error && <li><EmptyState title="Inbox unavailable" detail="The backend could not load actionables." /></li>}
        {!error && items.length === 0 && (
          <li>
            <EmptyState
              title="No real inbox items"
              detail="Use Gmail Sync above to extract real emails into action items and bills."
            />
          </li>
        )}
      </ul>

      {mounted && detail && (
        <DetailModal item={detail} onClose={() => setDetail(null)} onDone={(id) => { dismiss(id); setDetail(null); }} />
      )}
    </div>
  );
}
