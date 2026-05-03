"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Actionable, Bill, fetchActionables, fetchBills } from "@/lib/api";
import EmptyState from "@/components/EmptyState";

type Item = {
  id: string;
  title: string;
  meta: string;
  tone: "danger" | "warn" | "info";
};

function money(value: number) {
  return `INR ${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default function TopActionsSummary() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    Promise.all([
      fetchActionables("Pending").catch(() => [] as Actionable[]),
      fetchBills().catch(() => [] as Bill[]),
    ])
      .then(([actions, bills]) => {
        const actionItems: Item[] = actions
          .filter((a) => a.priority === "High")
          .slice(0, 3)
          .map((a) => ({ id: `a-${a.id}`, title: a.task_description, meta: a.due_date ? `Due ${a.due_date}` : "High priority", tone: "danger" }));
        const billItems: Item[] = bills
          .filter((b) => b.days_until_due <= 7)
          .slice(0, 3)
          .map((b) => ({ id: `b-${b.id}`, title: b.name, meta: `${money(b.amount)} due in ${b.days_until_due}d`, tone: b.days_until_due <= 2 ? "danger" : "warn" }));
        setItems([...actionItems, ...billItems].slice(0, 3));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    window.addEventListener("gmail-synced", load);
    window.addEventListener("actionables-updated", load);
    return () => {
      window.removeEventListener("gmail-synced", load);
      window.removeEventListener("actionables-updated", load);
    };
  }, []);

  if (loading) return <div className="flex h-full items-center justify-center"><div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "rgba(255,159,10,0.25)", borderTopColor: "#ff9f0a" }} /></div>;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.42)" }}>Top 3 Actions</p>
          <p className="mt-1 text-[11px]" style={{ color: "rgba(255,255,255,0.32)" }}>Bills and urgent actionables</p>
        </div>
        {items.length === 0 ? <CheckCircle2 size={16} style={{ color: "#30d158" }} /> : <AlertTriangle size={16} style={{ color: "#ff9f0a" }} />}
      </div>

      {items.length === 0 ? (
        <EmptyState title="Nothing urgent" detail="High-priority actionables and near-term bills will appear here." />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const color = item.tone === "danger" ? "#ff453a" : item.tone === "warn" ? "#ff9f0a" : "#0a84ff";
            return (
              <li key={item.id} className="rounded-lg p-3" style={{ background: `${color}10`, border: `1px solid ${color}24` }}>
                <p className="line-clamp-2 text-[12px] font-semibold leading-snug" style={{ color: "rgba(255,255,255,0.78)" }}>{item.title}</p>
                <p className="mt-1 flex items-center gap-1 text-[11px]" style={{ color }}><Clock size={11} /> {item.meta}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
