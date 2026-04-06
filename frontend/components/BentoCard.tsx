"use client";

/**
 * BentoCard.tsx
 * ──────────────────────────────────────────────────────
 * Glassmorphism card wrapper.
 *
 * Props:
 *   children  — card content
 *   className — extra Tailwind classes
 *   style     — inline overrides (e.g. gridRow: "span 2")
 *   glow      — enables a gradient-border shimmer (WealthCenter)
 * ──────────────────────────────────────────────────────
 */

import { motion } from "framer-motion";
import { CSSProperties, ReactNode } from "react";

interface BentoCardProps {
  children:   ReactNode;
  className?: string;
  style?:     CSSProperties;
  glow?:      boolean;   // gradient border variant
}

export default function BentoCard({
  children,
  className = "",
  style,
  glow = false,
}: BentoCardProps) {
  const baseStyle: CSSProperties = glow
    ? {
        /* Gradient border trick: paint bg inside padding-box,
           gradient on border-box */
        background:
          "linear-gradient(rgba(255,255,255,0.042), rgba(255,255,255,0.042)) padding-box, " +
          "linear-gradient(135deg, rgba(191,90,242,0.5) 0%, rgba(10,132,255,0.4) 50%, rgba(48,209,88,0.25) 100%) border-box",
        border: "1px solid transparent",
        ...style,
      }
    : {
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        ...style,
      };

  return (
    <motion.div
      style={baseStyle}
      className={`rounded-3xl p-5 overflow-hidden relative ${className}`}
      /* Subtle glass depth shadow */
      initial={{
        boxShadow: "0 0 0 0.5px rgba(255,255,255,0.04), 0 24px 48px rgba(0,0,0,0.45)",
      }}
      whileHover={{
        scale: 1.015,
        boxShadow: "0 0 0 0.5px rgba(255,255,255,0.10), 0 32px 64px rgba(0,0,0,0.55)",
        ...(glow
          ? {}
          : { borderColor: "rgba(255,255,255,0.16)" }),
      }}
      transition={{
        type: "spring",
        stiffness: 320,
        damping: 24,
      }}
    >
      {/* Subtle inner highlight at top edge — like real glass */}
      <div
        className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 30%, rgba(255,255,255,0.12) 70%, transparent 100%)",
        }}
      />
      {children}
    </motion.div>
  );
}
