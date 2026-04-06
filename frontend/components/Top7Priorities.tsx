"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { fetchPriorities, Priority } from "@/lib/api";

const ACCENT_COLORS = [
  "#bf5af2",
  "#0a84ff",
  "#30d158",
  "#ff9f0a",
  "#5ac8fa",
  "#ff375f",
  "#ffd60a",
];

const containerVariants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.055 } },
};

const itemVariants = {
  hidden:  { opacity: 0, x: -16 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: "spring" as const, stiffness: 280, damping: 24 },
  },
};

export default function Top7Priorities() {
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    fetchPriorities()
      .then(setPriorities)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-full gap-4">

      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em]"
          style={{ color: "rgba(255,255,255,0.35)" }}>
          This Week
        </p>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
          style={{
            background: "rgba(191,90,242,0.1)",
            color:      "#bf5af2",
            border:     "1px solid rgba(191,90,242,0.2)",
          }}>
          {priorities.length} Goals
        </span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-4 h-4 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(191,90,242,0.3)", borderTopColor: "#bf5af2" }} />
        </div>
      ) : (
        <motion.ul
          className="flex flex-col gap-2.5"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {priorities.map((priority, i) => {
            const color = ACCENT_COLORS[i % ACCENT_COLORS.length];
            return (
              <motion.li
                key={priority.id}
                variants={itemVariants}
                className="flex items-center gap-3 group"
              >
                <span
                  className="flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold shrink-0"
                  style={{
                    background: `${color}18`,
                    color,
                    border: `1px solid ${color}35`,
                    fontFamily: "-apple-system, var(--font-inter-var), sans-serif",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {priority.rank}
                </span>

                <span className="text-[13.5px] leading-snug font-[430]"
                  style={{ color: "rgba(255,255,255,0.78)" }}>
                  {priority.text}
                </span>

                <span className="ml-auto opacity-0 group-hover:opacity-30 transition-opacity text-[10px]"
                  style={{ color: "rgba(255,255,255,0.6)" }}>
                  ›
                </span>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </div>
  );
}
