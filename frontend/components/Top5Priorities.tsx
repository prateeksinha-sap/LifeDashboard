"use client";

import { useEffect, useState, KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Pencil, Check, Plus } from "lucide-react";
import { fetchPriorities, updatePriorities, Priority } from "@/lib/api";

const Q_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  Q1: { label: "Urgent + Important",    color: "#ff453a", bg: "rgba(255,69,58,0.12)",   border: "rgba(255,69,58,0.28)"   },
  Q2: { label: "Important, Not Urgent", color: "#0a84ff", bg: "rgba(10,132,255,0.12)",  border: "rgba(10,132,255,0.28)"  },
  Q3: { label: "Urgent, Not Important", color: "#ff9f0a", bg: "rgba(255,159,10,0.12)",  border: "rgba(255,159,10,0.28)"  },
  Q4: { label: "Neither",              color: "#8e8e93", bg: "rgba(142,142,147,0.12)", border: "rgba(142,142,147,0.22)" },
};

const RANK_COLORS = ["#bf5af2", "#0a84ff", "#30d158", "#ff9f0a", "#5ac8fa", "#ff453a", "#ffd60a"];

export default function Top5Priorities() {
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [editText,   setEditText]   = useState("");
  const [editQ,      setEditQ]      = useState("Q2");
  const [adding,     setAdding]     = useState(false);
  const [newText,    setNewText]    = useState("");
  const [newQ,       setNewQ]       = useState("Q2");
  const [saving,     setSaving]     = useState(false);

  useEffect(() => {
    fetchPriorities()
      .then((data) => setPriorities(data.slice(0, 7)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async (updated: Priority[]) => {
    setSaving(true);
    try {
      const result = await updatePriorities(
        updated.map((p, i) => ({
          rank: i + 1,
          text: p.text,
          eisenhower_quadrant: p.eisenhower_quadrant,
        }))
      );
      setPriorities(result.slice(0, 7));
    } catch { /* silent */ } finally {
      setSaving(false);
    }
  };

  const startEdit = (p: Priority) => {
    setEditingId(p.id);
    setEditText(p.text);
    setEditQ(p.eisenhower_quadrant);
  };

  const commitEdit = () => {
    if (!editText.trim() || editingId == null) { setEditingId(null); return; }
    const updated = priorities.map((p) =>
      p.id === editingId ? { ...p, text: editText.trim(), eisenhower_quadrant: editQ } : p
    );
    setEditingId(null);
    save(updated);
  };

  const deleteItem = (id: number) => {
    save(priorities.filter((p) => p.id !== id));
  };

  const commitAdd = () => {
    if (!newText.trim()) { setAdding(false); setNewText(""); return; }
    const fake: Priority = {
      id: Date.now(), rank: priorities.length + 1,
      text: newText.trim(), eisenhower_quadrant: newQ,
    };
    const updated = [...priorities, fake];
    setAdding(false); setNewText(""); setNewQ("Q2");
    save(updated);
  };

  const handleEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter")  commitEdit();
    if (e.key === "Escape") setEditingId(null);
  };

  const handleAddKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter")  commitAdd();
    if (e.key === "Escape") { setAdding(false); setNewText(""); }
  };

  return (
    <div className="flex flex-col h-full gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em]"
          style={{ color: "rgba(255,255,255,0.35)" }}>
          Top Priorities
        </p>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
          style={{ background: "rgba(191,90,242,0.1)", color: "#bf5af2", border: "1px solid rgba(191,90,242,0.2)" }}>
          This Week
        </span>
      </div>

      {/* Quadrant legend */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {Object.entries(Q_META).map(([key, m]) => (
          <span key={key} className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded"
            style={{ background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>
            {key}
          </span>
        ))}
        <span className="text-[9.5px] ml-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>Eisenhower</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-4 h-4 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(191,90,242,0.3)", borderTopColor: "#bf5af2" }} />
        </div>
      ) : (
        <ul className="flex flex-col gap-2 flex-1 overflow-y-auto min-h-0">
          <AnimatePresence initial={false}>
            {priorities.map((p, i) => {
              const rankColor = RANK_COLORS[i] ?? "#8e8e93";
              const qm = Q_META[p.eisenhower_quadrant] ?? Q_META["Q2"];
              const isEditing = editingId === p.id;

              return (
                <motion.li
                  key={p.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
                  className="flex items-start gap-2.5 group"
                >
                  {/* Rank bubble */}
                  <span className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0 mt-0.5"
                    style={{ background: `${rankColor}18`, color: rankColor, border: `1px solid ${rankColor}35` }}>
                    {i + 1}
                  </span>

                  {isEditing ? (
                    /* ── Edit mode ── */
                    <div className="flex-1 flex flex-col gap-1.5">
                      <input
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={handleEditKey}
                        className="w-full bg-transparent text-[13px] outline-none border-b pb-0.5"
                        style={{ color: "rgba(255,255,255,0.9)", borderColor: "rgba(255,255,255,0.2)" }}
                      />
                      <div className="flex items-center gap-1.5">
                        {Object.entries(Q_META).map(([key, m]) => (
                          <button key={key}
                            onClick={() => setEditQ(key)}
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded transition-all"
                            style={{
                              background: editQ === key ? m.bg : "transparent",
                              color:      editQ === key ? m.color : "rgba(255,255,255,0.25)",
                              border:     `1px solid ${editQ === key ? m.border : "transparent"}`,
                            }}>
                            {key}
                          </button>
                        ))}
                        <button onClick={commitEdit}
                          className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg"
                          style={{ background: "rgba(48,209,88,0.12)", color: "#30d158" }}>
                          <Check size={10} /> Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Display mode ── */
                    <>
                      <span className="flex-1 text-[13px] leading-snug font-[430]"
                        style={{ color: "rgba(255,255,255,0.78)" }}>
                        {p.text}
                      </span>

                      {/* Quadrant badge + action buttons */}
                      <div className="flex items-center gap-1 shrink-0 mt-0.5">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{ background: qm.bg, color: qm.color, border: `1px solid ${qm.border}` }}
                          title={qm.label}>
                          {p.eisenhower_quadrant}
                        </span>
                        <button
                          onClick={() => startEdit(p)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                          style={{ color: "rgba(255,255,255,0.3)" }}>
                          <Pencil size={10} strokeWidth={2} />
                        </button>
                        <button
                          onClick={() => deleteItem(p.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                          style={{ color: "rgba(255,69,58,0.5)" }}>
                          <X size={10} strokeWidth={2} />
                        </button>
                      </div>
                    </>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>

          {/* ── Add new ── */}
          {adding ? (
            <motion.li
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2.5"
            >
              <span className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0 mt-0.5"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.1)" }}>
                {priorities.length + 1}
              </span>
              <div className="flex-1 flex flex-col gap-1.5">
                <input
                  autoFocus
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  onKeyDown={handleAddKey}
                  placeholder="New priority…"
                  className="w-full bg-transparent text-[13px] outline-none border-b pb-0.5"
                  style={{ color: "rgba(255,255,255,0.9)", borderColor: "rgba(255,255,255,0.2)" }}
                />
                <div className="flex items-center gap-1.5">
                  {Object.entries(Q_META).map(([key, m]) => (
                    <button key={key}
                      onClick={() => setNewQ(key)}
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded transition-all"
                      style={{
                        background: newQ === key ? m.bg : "transparent",
                        color:      newQ === key ? m.color : "rgba(255,255,255,0.25)",
                        border:     `1px solid ${newQ === key ? m.border : "transparent"}`,
                      }}>
                      {key}
                    </button>
                  ))}
                  <button onClick={commitAdd}
                    className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg"
                    style={{ background: "rgba(48,209,88,0.12)", color: "#30d158" }}>
                    <Check size={10} /> Add
                  </button>
                </div>
              </div>
            </motion.li>
          ) : (
            priorities.length < 7 && (
              <li>
                <button
                  onClick={() => setAdding(true)}
                  className="flex items-center gap-1.5 text-[11px] mt-1 transition-opacity opacity-40 hover:opacity-80"
                  style={{ color: "rgba(255,255,255,0.5)" }}>
                  <Plus size={11} strokeWidth={2} /> Add priority
                </button>
              </li>
            )
          )}
        </ul>
      )}

      {saving && (
        <p className="text-[9px] text-right" style={{ color: "rgba(255,255,255,0.2)" }}>saving…</p>
      )}
    </div>
  );
}
