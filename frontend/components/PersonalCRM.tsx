"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fetchCRM, markCheckedIn, CRMContact } from "@/lib/api";
import EmptyState from "@/components/EmptyState";

function overdueLabel(c: CRMContact): string {
  if (c.overdue)          return `${c.days_overdue}d overdue`;
  if (c.days_since === 0) return "Today";
  if (c.days_since === 1) return "Yesterday";
  return `${c.days_since}d ago`;
}

function overdueColor(c: CRMContact): string {
  if (c.days_overdue > 7) return "#ff453a";
  if (c.overdue)          return "#ff9f0a";
  return "#30d158";
}

// Avatar initials from name
function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// Deterministic pastel color from name
const AVATAR_COLORS = ["#bf5af2", "#0a84ff", "#30d158", "#ff9f0a", "#5ac8fa", "#ff375f", "#ffd60a"];
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default function PersonalCRM() {
  const [contacts,   setContacts]   = useState<CRMContact[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [checking,   setChecking]   = useState<number | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());

  const load = () =>
    fetchCRM()
      .then(setContacts)
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleCheckIn = async (id: number) => {
    if (checking !== null) return;
    setChecking(id);
    try {
      await markCheckedIn(id);
      setCheckedIds((prev) => new Set([...prev, id]));
      // Re-fetch after a short delay so new days_since appears
      setTimeout(() => { load(); setCheckedIds(new Set()); }, 800);
    } catch {
      /* ignore */
    } finally {
      setChecking(null);
    }
  };

  const overdueCount = contacts.filter((c) => c.overdue).length;

  return (
    <div className="flex flex-col h-full gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em]"
          style={{ color: "rgba(255,255,255,0.35)" }}>
          People
        </p>
        {overdueCount > 0 && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: "rgba(255,69,58,0.12)",
              color:      "#ff453a",
              border:     "1px solid rgba(255,69,58,0.25)",
            }}>
            {overdueCount} overdue
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-4 h-4 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(191,90,242,0.3)", borderTopColor: "#bf5af2" }} />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {contacts.length === 0 && (
            <li>
              <EmptyState
                title="No people tracked"
                detail="Add contacts through the database seed script or API to surface overdue check-ins."
              />
            </li>
          )}
          <AnimatePresence initial={false}>
            {contacts.map((c) => {
              const color      = avatarColor(c.contact_name);
              const statusCol  = overdueColor(c);
              const isChecking = checking === c.id;
              const justDone   = checkedIds.has(c.id);

              return (
                <motion.li
                  key={c.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  className="flex items-center gap-2.5"
                >
                  {/* Avatar */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={{
                      background: `${color}22`,
                      color,
                      border:     `1.5px solid ${color}45`,
                    }}
                  >
                    {initials(c.contact_name)}
                  </div>

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-medium leading-tight truncate"
                      style={{ color: "rgba(255,255,255,0.8)" }}>
                      {c.contact_name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {c.relationship && (
                        <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.28)" }}>
                          {c.relationship}
                        </span>
                      )}
                      <span
                        className="text-[10px] font-semibold"
                        style={{ color: statusCol }}
                      >
                        {overdueLabel(c)}
                      </span>
                    </div>
                  </div>

                  {/* Check-in button */}
                  <button
                    onClick={() => handleCheckIn(c.id)}
                    disabled={isChecking || justDone}
                    className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-all shrink-0"
                    style={{
                      background: justDone
                        ? "rgba(48,209,88,0.15)"
                        : c.overdue
                        ? "rgba(255,69,58,0.1)"
                        : "rgba(255,255,255,0.05)",
                      color: justDone
                        ? "#30d158"
                        : c.overdue
                        ? "#ff453a"
                        : "rgba(255,255,255,0.35)",
                      border: `1px solid ${
                        justDone
                          ? "rgba(48,209,88,0.25)"
                          : c.overdue
                          ? "rgba(255,69,58,0.2)"
                          : "rgba(255,255,255,0.08)"
                      }`,
                      cursor: isChecking ? "wait" : "pointer",
                    }}
                  >
                    {isChecking ? "…" : justDone ? "✓" : "Ping"}
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
