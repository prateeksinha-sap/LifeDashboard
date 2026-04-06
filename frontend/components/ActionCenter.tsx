"use client";

import { useState, useEffect, KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { fetchTodos, createTodo, patchTodo, Todo } from "@/lib/api";

export default function ActionCenter() {
  const [todos,    setTodos] = useState<Todo[]>([]);
  const [inputVal, setInput] = useState("");
  const [loading,  setLoading] = useState(true);

  useEffect(() => {
    fetchTodos()
      .then(setTodos)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (id: number, currentDone: boolean) => {
    // Optimistic update
    setTodos((prev) => prev.map((t) => t.id === id ? { ...t, done: !currentDone } : t));
    try {
      await patchTodo(id, { done: !currentDone });
    } catch {
      // Revert on error
      setTodos((prev) => prev.map((t) => t.id === id ? { ...t, done: currentDone } : t));
    }
  };

  const addTodo = async () => {
    const text = inputVal.trim();
    if (!text) return;
    setInput("");
    try {
      const newTodo = await createTodo(text);
      setTodos((prev) => [...prev, newTodo]);
    } catch {
      setInput(text); // restore on failure
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") addTodo();
  };

  const pending   = todos.filter((t) => !t.done);
  const completed = todos.filter((t) =>  t.done);

  return (
    <div className="flex flex-col h-full gap-4">

      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em]"
          style={{ color: "rgba(255,255,255,0.35)" }}>
          Reminders
        </p>
        {pending.length > 0 && (
          <span className="text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full"
            style={{
              background: "rgba(255,159,10,0.14)",
              color:      "#ff9f0a",
              border:     "1px solid rgba(255,159,10,0.2)",
            }}>
            {pending.length} open
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-4 h-4 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(255,159,10,0.3)", borderTopColor: "#ff9f0a" }} />
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {pending.map((todo) => (
                <motion.li
                  key={todo.id}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0, transition: { duration: 0.18 } }}
                  className="flex items-center gap-3 py-1.5 cursor-pointer group"
                  onClick={() => toggle(todo.id, todo.done)}
                >
                  <motion.span
                    whileTap={{ scale: 0.82 }}
                    className="shrink-0 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center transition-colors duration-150"
                    style={{ borderColor: "rgba(255,255,255,0.18)" }}
                  />
                  <span className="text-[13.5px] font-[420]"
                    style={{ color: "rgba(255,255,255,0.75)" }}>
                    {todo.text}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          <AnimatePresence>
            {completed.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="h-px mb-3" style={{ background: "rgba(255,255,255,0.05)" }} />
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] mb-2"
                  style={{ color: "rgba(255,255,255,0.20)" }}>
                  Completed · {completed.length}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {completed.map((todo) => (
                    <motion.li
                      key={todo.id}
                      layout
                      className="flex items-center gap-3 cursor-pointer"
                      onClick={() => toggle(todo.id, todo.done)}
                    >
                      <motion.span
                        initial={{ scale: 0.6 }}
                        animate={{ scale: 1 }}
                        className="shrink-0 w-[18px] h-[18px] rounded-full flex items-center justify-center"
                        style={{ background: "#30d158" }}
                      >
                        <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                          <path d="M1 3.5L3.5 6L8 1" stroke="#000" strokeWidth="1.6"
                            strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </motion.span>
                      <span className="text-[13px] line-through"
                        style={{ color: "rgba(255,255,255,0.22)" }}>
                        {todo.text}
                      </span>
                    </motion.li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      <div className="flex items-center gap-2 mt-auto pt-3"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <button
          onClick={addTodo}
          aria-label="Add"
          className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors"
          style={{ background: "rgba(10,132,255,0.18)", color: "#0a84ff" }}
        >
          <Plus size={12} strokeWidth={2.5} />
        </button>
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="New reminder…"
          className="flex-1 bg-transparent text-[13.5px] outline-none"
          style={{ color: "rgba(255,255,255,0.65)" }}
        />
      </div>
    </div>
  );
}
