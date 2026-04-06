"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { fetchPriorities, Priority } from "@/lib/api";

// Eisenhower quadrant metadata
const Q_META: Record<string, { label: string; short: string; color: string; bg: string; border: string }> = {
  Q1: { label: "Urgent + Important",     short: "Q1", color: "#ff453a", bg: "rgba(255,69,58,0.12)",   border: "rgba(255,69,58,0.28)"   },
  Q2: { label: "Important, Not Urgent",  short: "Q2", color: "#0a84ff", bg: "rgba(10,132,255,0.12)",  border: "rgba(10,132,255,0.28)"  },
  Q3: { label: "Urgent, Not Important",  short: "Q3", color: "#ff9f0a", bg: "rgba(255,159,10,0.12)",  border: "rgba(255,159,10,0.28)"  },
  Q4: { label: "Neither",               short: "Q4", color: "#8e8e93", bg: "rgba(142,142,147,0.12)", border: "rgba(142,142,147,0.22)" },
};

const RANK_COLORS = ["#bf5af2", "#0a84ff", "#30d158", "#ff9f0a", "#5ac8fa"];

const containerVariants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden:  { opacity: 0, x: -14 },
  visible: {
    opacity: 1, x: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 26 },
  },
};

export default function Top5Priorities() {
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    fetchPriorities()
      .then((data) => setPriorities(data.slice(0, 5)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-full gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em]"
          style={{ color: "rgba(255,255,255,0.35)" }}>
          Top Priorities
        </p>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
          style={{
            background: "rgba(191,90,242,0.1)",
            color:      "#bf5af2",
            border:     "1px solid rgba(191,90,242,0.2)",
          }}>
          This Week
        </span>
      </div>

      {/* Quadrant legend — tiny pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {Object.entries(Q_META).map(([key, m]) => (
          <span key={key}
            className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded"
            style={{ background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>
            {m.short}
          </span>
        ))}
        <span className="text-[9.5px] ml-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>
          Eisenhower
        </span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-4 h-4 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(191,90,242,0.3)", borderTopColor: "#bf5af2" }} />
        </div>
      ) : (
        <motion.ul
          className="flex flex-col gap-2"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {priorities.map((p, i) => {
            const rankColor = RANK_COLORS[i] ?? "#8e8e93";
            const qm = Q_META[p.eisenhower_quadrant] ?? Q_META["Q2"];
            return (
              <motion.li
                key={p.id}
                variants={itemVariants}
                className="flex items-start gap-2.5 group"
              >
                {/* Rank bubble */}
                <span
                  className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0 mt-0.5"
                  style={{
                    background: `${rankColor}18`,
                    color:      rankColor,
                    border:     `1px solid ${rankColor}35`,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {p.rank}
                </span>

                {/* Text */}
                <span className="flex-1 text-[13px] leading-snug font-[430]"
                  style={{ color: "rgba(255,255,255,0.78)" }}>
                  {p.text}
                </span>

                {/* Quadrant badge */}
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                  style={{
                    background: qm.bg,
                    color:      qm.color,
                    border:     `1px solid ${qm.border}`,
                  }}
                  title={qm.label}
                >
                  {qm.short}
                </span>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </div>
  );
}
