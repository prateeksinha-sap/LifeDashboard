"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Newspaper } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { API_BASE } from "@/lib/config";

type NewsItem = {
  title: string;
  url: string;
  source: string;
  published: string;
  published_iso?: string | null;
  age_hours?: number | null;
  impact_score: number;
  impact: string[];
  actions: string[];
};

function formatPublished(item: NewsItem): string {
  if (typeof item.age_hours === "number") {
    if (item.age_hours < 1) return "Just now";
    if (item.age_hours < 24) return `${Math.round(item.age_hours)}h ago`;
    return `${Math.round(item.age_hours / 24)}d ago`;
  }
  if (!item.published_iso) return item.published || "Date unknown";
  return new Date(item.published_iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function NewsImpact() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/news/personalized?days=7`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data.status !== "ok") setError(data.message || "News unavailable.");
        setItems(data.items ?? []);
      })
      .catch(() => setError("Could not fetch news."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2" style={{ borderColor: "rgba(10,132,255,0.3)", borderTopColor: "#0a84ff" }} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.35)" }}>Impact News</p>
          <p className="mt-0.5 text-[10px]" style={{ color: "rgba(255,255,255,0.24)" }}>Latest 7 days, filtered for personal impact</p>
        </div>
        <Newspaper size={16} style={{ color: "#0a84ff" }} />
      </div>

      {error && (
        <div className="rounded-xl px-3 py-2 text-[11px]" style={{ background: "rgba(255,159,10,0.08)", border: "1px solid rgba(255,159,10,0.16)", color: "#ff9f0a" }}>
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState title="No impact news yet" detail="Set NEWS_TOPICS in backend .env, or check internet access for the news feed." />
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {items.map((item) => (
            <li key={item.url} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <a href={item.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-[12px] font-semibold leading-snug" style={{ color: "rgba(255,255,255,0.76)" }}>
                {item.title}
                <ExternalLink size={11} className="mt-0.5 shrink-0" />
              </a>
              <p className="mt-1 flex items-center justify-between gap-2 text-[10px]" style={{ color: "rgba(255,255,255,0.28)" }}>
                <span>{item.source}</span>
                <span>{formatPublished(item)}</span>
              </p>
              {item.impact[0] && (
                <p className="mt-2 flex gap-1.5 text-[11px] leading-snug" style={{ color: "rgba(255,255,255,0.46)" }}>
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" style={{ color: "#ff9f0a" }} />
                  {item.impact[0]}
                </p>
              )}
              {item.actions[0] && (
                <p className="mt-1 text-[11px] leading-snug" style={{ color: "#30d158" }}>{item.actions[0]}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
