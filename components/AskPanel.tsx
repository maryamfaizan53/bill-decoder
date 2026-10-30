"use client";

import { useRef, useState } from "react";

type Turn = { q: string; a?: string; error?: string; mode?: "live" | "saved" };

const SUGGESTED = [
  "How much of my bill is taxes?",
  "How many months in my history went above 200 units?",
  "How much extra will I pay if I pay after the due date?",
  "What is the average cost per unit on this bill?",
  "Did my consumption go up or down compared to last month?",
  "Estimate my bill next month if I use 20% fewer units.",
];

export function AskPanel({
  id,
  live,
  savedQuestions,
  context,
}: {
  id: string;
  live: boolean;
  savedQuestions: string[];
  /** The decoded bill, sent along so any server instance can answer without reading the bill again. */
  context?: { extraction: unknown; history: unknown };
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const suggestions = live ? SUGGESTED : savedQuestions;

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setInput("");
    setTurns((t) => [...t, { q }]);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, question: q, ...context }) });
      const json = await res.json();
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? (res.ok ? { ...x, a: json.answer, mode: json.mode } : { ...x, error: json.error }) : x)));
    } catch {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: "The answer could not be fetched. Check your connection and ask again." } : x)));
    } finally {
      setBusy(false);
      field.current?.focus();
    }
  }

  return (
    <div>
      {turns.length > 0 && (
        <ol className="mb-5 space-y-5" aria-live="polite">
          {turns.map((t, i) => (
            <li key={i}>
              <p className="font-semibold">{t.q}</p>
              {t.a && (
                <div className="mt-1.5 border-l-[3px] border-grid pl-3 leading-relaxed">
                  <p>{t.a}</p>
                  {t.mode === "saved" && <p className="mt-1 text-sm text-muted">Saved answer for this sample bill.</p>}
                </div>
              )}
              {t.error && <p role="alert" className="mt-1.5 border-l-[3px] border-debit pl-3 text-debit">{t.error}</p>}
              {!t.a && !t.error && <p className="mt-1.5 animate-pulse pl-3 text-muted motion-reduce:animate-none">Working it out from the bill…</p>}
            </li>
          ))}
        </ol>
      )}

      {suggestions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" className="chip" disabled={busy} onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {live ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <label htmlFor="question" className="sr-only">Your question about this bill</label>
          <textarea
            ref={field}
            id="question"
            rows={1}
            value={input}
            maxLength={400}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            placeholder="Ask anything about this bill, e.g. why is my bill higher than last month?"
            className="min-h-[2.75rem] flex-1 resize-none rounded-lg border border-rule bg-surface px-3 py-2.5 focus:border-grid focus:outline-none"
          />
          <button type="submit" className="btn btn-primary justify-center" disabled={busy || input.trim().length < 3}>
            {busy ? "Answering…" : "Ask"}
          </button>
        </form>
      ) : (
        <p className="text-muted">{suggestions.length ? "Add an API key to ask your own questions. The questions above have saved answers." : "Add an API key to ask questions about this bill."}</p>
      )}
    </div>
  );
}
