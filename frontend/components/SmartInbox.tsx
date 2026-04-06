"use client";

/**
 * SmartInbox.tsx — iOS Notification Center aesthetic
 * ──────────────────────────────────────────────────────
 * Swipe-to-dismiss email cards with category badges.
 * ──────────────────────────────────────────────────────
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { INBOX_ITEMS, InboxBadge, InboxItem } from "@/lib/mockData";

/* Badge colour palette — Apple system colours */
const BADGE_STYLES: Record<InboxBadge, { bg: string; text: string }> = {
  Vibgyor: { bg: "rgba(191,90,242,0.14)", text: "#bf5af2" },
  Bill:    { bg: "rgba(255,59,48,0.14)",  text: "#ff453a"  },
  Alert:   { bg: "rgba(255,159,10,0.14)", text: "#ff9f0a"  },
};

export default function SmartInbox() {
  const [items, setItems] = useState<InboxItem[]>(INBOX_ITEMS);

  const dismiss = (id: number) =>
    setItems((prev) => prev.filter((i) => i.id !== id));

  return (
    <div className="flex flex-col h-full gap-4">

      {/* ── Section header ── */}
      <div className="flex items-center justify-between">
        <p
          className="text-[11px] font-medium uppercase tracking-[0.12em]"
          style={{ color: "rgba(255,255,255,0.35)" }}
        >
          Smart Inbox
        </p>
        {items.length > 0 && (
          <span
            className="text-[11px] font-semibold w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: "#0a84ff", color: "#fff" }}
          >
            {items.length}
          </span>
        )}
      </div>

      {/* ── Notification list ── */}
      <ul className="flex flex-col gap-2 overflow-y-auto">
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const badge = BADGE_STYLES[item.badge];
            return (
              <motion.li
                key={item.id}
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0,  scale: 1    }}
                exit={{
                  opacity: 0,
                  x: 60,
                  scale: 0.94,
                  height: 0,
                  marginBottom: 0,
                  transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
                }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                className="flex items-start gap-3 rounded-2xl px-3.5 py-3 group cursor-default"
                style={{
                  background: "rgba(255,255,255,0.038)",
                  border:     "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {/* Category badge */}
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 mt-0.5"
                  style={{ background: badge.bg, color: badge.text }}
                >
                  {item.badge}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p
                    className="text-[12px] font-semibold truncate"
                    style={{ color: "rgba(255,255,255,0.75)" }}
                  >
                    {item.sender}
                  </p>
                  <p
                    className="text-[12px] leading-[1.4] mt-0.5 line-clamp-2"
                    style={{ color: "rgba(255,255,255,0.38)" }}
                  >
                    {item.subject}
                  </p>
                </div>

                {/* Dismiss */}
                <button
                  onClick={() => dismiss(item.id)}
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

        {items.length === 0 && (
          <li
            className="text-center text-[13px] py-8"
            style={{ color: "rgba(255,255,255,0.22)" }}
          >
            All caught up
          </li>
        )}
      </ul>
    </div>
  );
}
