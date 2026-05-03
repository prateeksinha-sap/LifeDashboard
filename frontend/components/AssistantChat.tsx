"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, CheckCircle2, Database, Loader2, Send, Sparkles, X } from "lucide-react";
import {
  askAssistant,
  AssistantMessage,
  AssistantResponse,
  AssistantStatus,
  fetchAssistantStatus,
} from "@/lib/api";

type ChatTurn = AssistantMessage & {
  dataUsed?: string[];
  provider?: string;
  model?: string | null;
  fallback?: boolean;
};

const STARTERS = [
  "Prepare my month-end review",
  "What changed from last month?",
  "Find spending leaks",
  "Break down my expenses for Apr 2026",
  "Where am I overspending?",
  "How can I improve my savings rate?",
  "What needs my attention this week?",
];

function modelLabel(status: AssistantStatus | null) {
  if (!status) return "Checking";
  if (status.provider === "deterministic" || status.enabled === false) return "Fast grounded";
  if (status.provider === "openai") return status.model || "OpenAI";
  if (status.provider === "anthropic") return status.model || "Claude";
  if (status.provider === "ollama") return status.model || "Local AI";
  if (status.provider === "ledger") return "Exact ledger";
  if (!status.online) return "Fallback ready";
  return status.model || "Local AI";
}

function ProviderBadge({ status }: { status: AssistantStatus | null }) {
  const fast = status?.provider === "deterministic" || status?.provider === "ledger" || status?.enabled === false;
  const online = Boolean(status?.online && !fast);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold"
      style={{
        color: online || fast ? "#30d158" : "#ff9f0a",
        background: online || fast ? "rgba(48,209,88,0.12)" : "rgba(255,159,10,0.12)",
        border: `1px solid ${online || fast ? "rgba(48,209,88,0.26)" : "rgba(255,159,10,0.28)"}`,
      }}
    >
      {online ? <Sparkles size={12} /> : <Database size={12} />}
      {modelLabel(status)}
    </span>
  );
}

function ProviderWarning({ status }: { status: AssistantStatus | null }) {
  if (!status?.openai?.configured || status.openai.working) return null;
  return (
    <div
      className="mx-4 mt-3 rounded-lg px-3 py-2 text-[12px] leading-snug"
      style={{
        background: "rgba(255,159,10,0.10)",
        border: "1px solid rgba(255,159,10,0.24)",
        color: "#ffb340",
      }}
    >
      <p className="font-semibold">gpt-5-mini is configured but not working right now.</p>
      <p className="mt-1" style={{ color: "rgba(255,255,255,0.66)" }}>
        {status.openai.message || "OpenAI is unavailable."}
      </p>
      <p className="mt-1" style={{ color: "rgba(255,255,255,0.54)" }}>
        Active fallback: {status.provider === "ollama" ? `${status.model} on Ollama` : status.provider}. {status.openai.next_step || "Check OpenAI billing/usage and retry."}
      </p>
    </div>
  );
}

export default function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [messages, setMessages] = useState<ChatTurn[]>([
    {
      role: "assistant",
      content:
        "Ask me about your dashboard data: expenses, categories, savings, net worth, bills, priorities, or what needs attention.",
      provider: "system",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetchAssistantStatus()
      .then(setStatus)
      .catch(() =>
        setStatus({
          provider: "ollama",
          model: null,
          enabled: false,
          online: false,
          model_present: false,
          fallback_available: true,
        }),
      );
  }, []);

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, busy, open]);

  const history = useMemo(
    () =>
      messages
        .filter((message) => message.provider !== "system")
        .map(({ role, content }) => ({ role, content })),
    [messages],
  );

  const submitQuestion = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    const userTurn: ChatTurn = { role: "user", content: trimmed };
    setMessages((current) => [...current, userTurn]);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const response: AssistantResponse = await askAssistant(trimmed, history);
      if (response.provider === "deterministic" || response.provider === "ledger") {
        setStatus((current) => ({
          provider: response.provider,
          model: response.model,
          enabled: response.provider !== "deterministic",
          online: true,
          model_present: true,
          fallback_available: current?.fallback_available ?? true,
        }));
      }
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: response.answer,
          dataUsed: response.data_used,
          provider: response.provider,
          model: response.model,
          fallback: response.fallback,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assistant failed");
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            "I could not reach the assistant service. The dashboard data is still safe; try again once the backend is running.",
          provider: "error",
          fallback: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitQuestion(input);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold shadow-2xl transition hover:scale-[1.02]"
        style={{
          color: "rgba(255,255,255,0.92)",
          background:
            "linear-gradient(135deg, rgba(191,90,242,0.88) 0%, rgba(10,132,255,0.88) 58%, rgba(48,209,88,0.68) 100%)",
          border: "1px solid rgba(255,255,255,0.18)",
          boxShadow: "0 18px 60px rgba(10,132,255,0.22)",
        }}
        aria-label="Open dashboard assistant"
      >
        <Bot size={18} />
        Ask AI
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-3 sm:p-5">
          <button
            type="button"
            aria-label="Close assistant backdrop"
            className="absolute inset-0 cursor-default"
            style={{ background: "rgba(0,0,0,0.34)" }}
            onClick={() => setOpen(false)}
          />

          <section
            className="relative flex h-[min(760px,calc(100vh-2rem))] w-full max-w-[520px] flex-col overflow-hidden rounded-lg"
            style={{
              background: "rgba(12,12,14,0.96)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 24px 90px rgba(0,0,0,0.58)",
              backdropFilter: "blur(28px)",
            }}
            aria-label="Dashboard assistant"
          >
            <header
              className="flex items-start justify-between gap-3 border-b px-4 py-3"
              style={{ borderColor: "rgba(255,255,255,0.08)" }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full"
                    style={{
                      background: "rgba(10,132,255,0.14)",
                      color: "#0a84ff",
                      border: "1px solid rgba(10,132,255,0.24)",
                    }}
                  >
                    <Bot size={17} />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.9)" }}>
                      Life Assistant
                    </h2>
                    <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.46)" }}>
                      Grounded in dashboard data
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ProviderBadge status={status} />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-white/10"
                  style={{ color: "rgba(255,255,255,0.62)" }}
                  aria-label="Close assistant"
                >
                  <X size={16} />
                </button>
              </div>
            </header>
            <ProviderWarning status={status} />

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
              <div className="flex flex-col gap-3">
                {messages.map((message, index) => {
                  const user = message.role === "user";
                  return (
                    <div key={`${message.role}-${index}`} className={`flex ${user ? "justify-end" : "justify-start"}`}>
                      <div
                        className="max-w-[88%] rounded-lg px-3 py-2.5"
                        style={{
                          background: user ? "rgba(10,132,255,0.22)" : "rgba(255,255,255,0.055)",
                          border: user ? "1px solid rgba(10,132,255,0.28)" : "1px solid rgba(255,255,255,0.08)",
                        }}
                      >
                        <p
                          className="whitespace-pre-wrap text-sm leading-relaxed"
                          style={{ color: user ? "rgba(255,255,255,0.94)" : "rgba(255,255,255,0.82)" }}
                        >
                          {message.content}
                        </p>
                        {!user && message.dataUsed?.length ? (
                          <div className="mt-3 border-t pt-2" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "#30d158" }}>
                              <CheckCircle2 size={12} />
                              Data used
                            </div>
                            <p className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.44)" }}>
                              {message.dataUsed.join(" | ")}
                            </p>
                            {message.fallback && (
                              <p className="mt-1 text-[11px]" style={{ color: "#ff9f0a" }}>
                                The smart model was unavailable or timed out, so this used deterministic dashboard logic.
                              </p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {busy && (
                  <div className="flex justify-start">
                    <div
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
                      style={{ background: "rgba(255,255,255,0.055)", color: "rgba(255,255,255,0.68)" }}
                    >
                      <Loader2 size={15} className="animate-spin" />
                      Reading dashboard data
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t px-4 py-3" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              {messages.length === 1 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => void submitQuestion(starter)}
                      className="rounded-full px-3 py-1.5 text-[12px] font-medium transition hover:bg-white/10"
                      style={{
                        color: "rgba(255,255,255,0.72)",
                        background: "rgba(255,255,255,0.055)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              )}

              {error && (
                <p className="mb-2 text-[12px]" style={{ color: "#ff453a" }}>
                  {error}
                </p>
              )}

              <form onSubmit={onSubmit} className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submitQuestion(input);
                    }
                  }}
                  rows={2}
                  placeholder="Ask about spending, savings, net worth, bills..."
                  className="min-h-[46px] flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none"
                  style={{
                    color: "rgba(255,255,255,0.9)",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}
                />
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    color: "white",
                    background: "rgba(10,132,255,0.82)",
                    border: "1px solid rgba(10,132,255,0.30)",
                  }}
                  aria-label="Send question"
                >
                  {busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
                </button>
              </form>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
