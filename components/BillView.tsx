"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProgressEvent, ProgressStep } from "@/lib/pipeline/extract";
import type { DecodeResult } from "@/lib/server/bills";
import type { HistoryRow } from "@/lib/pipeline/history";
import { PROVIDER_NAMES, dateLabel, monthLong, num, pkr } from "@/lib/format";
import { recallFile } from "@/lib/clientFiles";
import { AskPanel } from "./AskPanel";
import { Meter } from "./Meter";
import { Checks, MoneyBreakdown, SectionTitle, Timeline } from "./sections";
import { UsageChart } from "./UsageChart";

type StepState = "waiting" | "active" | "done" | "skip";
const STEPS: { key: ProgressStep; label: string }[] = [
  { key: "prepare", label: "Preparing the image" },
  { key: "read", label: "Reading the bill" },
  { key: "vote", label: "Combining the readings" },
  { key: "check", label: "Checking the totals" },
  { key: "reread", label: "Re-reading lines that don't add up" },
  { key: "history", label: "Reading the usage history" },
];

export function BillView({ id }: { id: string }) {
  const [steps, setSteps] = useState<Record<string, { state: StepState; detail?: string }>>({});
  const [result, setResult] = useState<DecodeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const file = recallFile(id);
        let res: Response;
        if (file) {
          const body = new FormData();
          body.append("id", id);
          body.append("bill", file);
          res = await fetch("/api/decode", { method: "POST", body });
        } else {
          res = await fetch(`/api/decode?id=${encodeURIComponent(id)}`);
        }
        if (!res.body) throw new Error("No response from the server.");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line || cancelled) continue;
            const msg = JSON.parse(line);
            if (msg.type === "progress") applyProgress(msg as ProgressEvent);
            else if (msg.type === "result") setResult(msg.data as DecodeResult);
            else if (msg.type === "error") setError(msg.message);
          }
        }
      } catch {
        if (!cancelled) setError("The connection to the server dropped. Reload the page to try again.");
      }
    })();
    function applyProgress(e: ProgressEvent) {
      setSteps((s) => {
        const state: StepState = e.status === "start" || e.status === "update" ? "active" : e.status === "skip" ? "skip" : "done";
        const detail = e.step === "read" && e.of ? `${e.pass ?? 0} of ${e.of} readings done` : e.detail;
        return { ...s, [e.step]: { state, detail: detail ?? s[e.step]?.detail } };
      });
    }
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (result || error) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [result, error, started]);

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6">
      <Link href="/" className="text-sm font-semibold text-grid hover:underline">
        Decode another bill
      </Link>
      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-12">
        <BillImage id={id} />
        <div className="min-w-0">
          {error ? (
            <ErrorPanel message={error} />
          ) : result ? (
            <Result r={result} />
          ) : (
            <Progress steps={steps} elapsed={elapsed} />
          )}
        </div>
      </div>
    </main>
  );
}

function BillImage({ id }: { id: string }) {
  const [zoom, setZoom] = useState(false);
  return (
    <figure className="lg:sticky lg:top-4 lg:self-start">
      <button
        type="button"
        onClick={() => setZoom((z) => !z)}
        aria-label={zoom ? "Shrink the bill" : "Show the bill full size"}
        className={`block w-full rounded-md border border-rule bg-surface ${zoom ? "max-h-[85vh] cursor-zoom-out overflow-auto" : "max-h-[38vh] cursor-zoom-in overflow-hidden lg:max-h-none"}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/bills/${id}/image`} alt="The uploaded electricity bill" className={zoom ? "w-[200%] max-w-none" : "w-full object-cover object-top"} />
      </button>
      <figcaption className="mt-2 text-sm text-muted">
        {zoom ? "Click again to shrink the bill." : "Click the bill to see it full size."} Personal details stay on the image and are never extracted.
      </figcaption>
    </figure>
  );
}

function Progress({ steps, elapsed }: { steps: Record<string, { state: StepState; detail?: string }>; elapsed: number }) {
  return (
    <section aria-labelledby="progress-title" aria-live="polite">
      <h1 id="progress-title" className="display text-3xl sm:text-4xl">Reading your bill</h1>
      <p className="mt-2 text-muted">This usually takes 20 to 60 seconds. Elapsed: <span className="num">{elapsed}s</span></p>
      <ol className="mt-8 space-y-4">
        {STEPS.map((s) => {
          const st = steps[s.key]?.state ?? "waiting";
          return (
            <li key={s.key} className="flex items-start gap-3">
              <span className="step-dot mt-1.5" data-state={st} />
              <div>
                <p className={st === "waiting" ? "text-muted" : "font-semibold"}>{s.label}</p>
                <p className="text-sm text-muted">{st === "skip" ? "Not needed: every total agreed" : steps[s.key]?.detail ?? ""}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <section role="alert">
      <h1 className="display text-3xl">This bill couldn't be decoded</h1>
      <p className="mt-3 max-w-[60ch] text-lg">{message}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/" className="btn btn-primary">Upload a different bill</Link>
        <button type="button" className="btn btn-quiet" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    </section>
  );
}

function Result({ r }: { r: DecodeResult }) {
  const l = r.extraction.level1;
  const extra = r.extraction.extra;
  const within = l.payable_within_due_date;
  const after = l.payable_after_due_date;
  const notes = Array.isArray(extra.notes) ? (extra.notes as string[]) : [];
  const late = Array.isArray(extra.late_payment_amounts) ? (extra.late_payment_amounts as { label?: string; amount?: number }[]) : [];

  let meterLabel = "Amount payable";
  if (within !== null && within < 0) meterLabel = "Credit on your account";
  else if (within === 0) meterLabel = "Nothing to pay this month";
  else if (l.due_date) meterLabel = `Pay by ${dateLabel(l.due_date)}`;

  return (
    <div className="space-y-12">
      <header>
        <p className="text-muted">
          {r.mode === "saved" ? "Saved, hand-checked result" : `Read live by ${r.model}`}
        </p>
        <h1 className="display mt-1 text-3xl sm:text-[2.6rem]">{r.title}</h1>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-muted">
          {l.provider && <Fact k="Company" v={PROVIDER_NAMES[l.provider] ?? l.provider} />}
          {l.tariff && <Fact k="Tariff" v={l.tariff} />}
          {l.sanctioned_load_kw !== null && <Fact k="Sanctioned load" v={`${num(l.sanctioned_load_kw)} kW`} />}
          {l.units_consumed !== null && <Fact k="Units this month" v={num(l.units_consumed)} />}
        </dl>
      </header>

      <section aria-labelledby="pay-title">
        <SectionTitle id="pay-title" en="Amount to pay" ur="ادا کرنے کی رقم" />
        <p className="mb-3 text-lg font-semibold">{meterLabel}</p>
        {within !== null ? <Meter value={within} label={`${meterLabel}: ${pkr(within)}`} /> : <p className="text-muted">The amount payable could not be read.</p>}
        <ul className="mt-4 space-y-1.5">
          {after !== null && within !== null && within > 0 && (
            <li>
              After the due date: <span className="num font-semibold">{pkr(after)}</span>{" "}
              <span className="num font-semibold text-debit">({pkr(after - within, { sign: true })} late surcharge)</span>
            </li>
          )}
          {late.length > 1 && within !== null && within > 0 && (
            <li className="text-sm text-muted">
              Late amounts printed: {late.filter((x) => typeof x.amount === "number").map((x) => `${x.label ? `${x.label}: ` : ""}${pkr(x.amount!)}`).join("; ")}
            </li>
          )}
          {l.current_bill !== null && (
            <li className="text-muted">
              This month's bill <span className="num font-semibold text-ink">{pkr(l.current_bill)}</span>
              {l.arrears !== null && l.arrears !== 0 && (
                <>
                  {" "}and previous {l.arrears < 0 ? "credit" : "dues"} <span className={`num font-semibold ${l.arrears < 0 ? "text-credit" : "text-debit"}`}>{pkr(l.arrears)}</span>
                </>
              )}
            </li>
          )}
          {notes.map((n) => (
            <li key={n} className="text-muted">{n}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="dates-title">
        <SectionTitle id="dates-title" en="Key dates" ur="اہم تاریخیں" />
        <Timeline l={l} />
      </section>

      <section aria-labelledby="money-title">
        <SectionTitle id="money-title" en="Where the money goes" ur="رقم کہاں جاتی ہے" />
        <MoneyBreakdown l={l} extra={extra} facts={r.facts} />
      </section>

      <section aria-labelledby="usage-title">
        <SectionTitle id="usage-title" en="Units used" ur="استعمال شدہ یونٹ" />
        <UsageChart rows={r.history ?? []} currentMonth={l.bill_month} currentUnits={l.units_consumed} />
        <UsageFacts rows={r.history ?? []} month={l.bill_month} units={l.units_consumed} />
      </section>

      <section aria-labelledby="ask-title">
        <SectionTitle id="ask-title" en="Ask about this bill" ur="اس بل کے بارے میں پوچھیں" />
        <AskPanel id={r.id} live={r.mode === "live"} savedQuestions={r.savedQuestions} context={{ extraction: r.extraction, history: r.history }} />
      </section>

      <section aria-labelledby="checks-title">
        <SectionTitle id="checks-title" en="Checks on the reading" ur="جانچ" />
        <Checks l={l} runs={r.extraction.runs} />
        <details className="mt-6">
          <summary className="cursor-pointer font-semibold text-grid">Extracted fields as JSON</summary>
          <JsonBlock value={l} />
        </details>
      </section>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-1.5">
      <dt>{k}</dt>
      <dd className="num font-semibold text-ink">{v}</dd>
    </div>
  );
}

function UsageFacts({ rows, month, units }: { rows: HistoryRow[]; month: string | null; units: number | null }) {
  // Plain-language comparisons, calculated here from the history (same numbers the answers use).
  const prev = rows.filter((r) => r.units !== null && r.month !== month && !r.is_current);
  if (!prev.length || units === null) return null;
  const vals = prev.map((r) => r.units as number);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const last = prev[prev.length - 1];
  const lastYear = month ? prev.find((r) => r.month === `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`) : undefined;
  const diff = (a: number, b: number) => {
    const d = a - b;
    const pct = b !== 0 ? Math.abs((d / Math.abs(b)) * 100) : null;
    if (Math.abs(d) < 0.5) return "about the same";
    return `${num(Math.abs(d), 0)} units ${d > 0 ? "more" : "fewer"}${pct !== null ? ` (${num(pct, 1)}%)` : ""}`;
  };
  const cmp = (a: number, b: number) => { const t = diff(a, b); return `${t} ${t === "about the same" ? "as" : "than"}`; };
  const lines = [
    `${cmp(units, avg)} the average of the ${prev.length} earlier months (${num(avg, 1)} units).`,
    `${cmp(units, last.units as number)} ${monthLong(last.month)} (${num(last.units)} units).`,
  ];
  if (lastYear && lastYear.units !== null) lines.push(`${cmp(units, lastYear.units)} ${monthLong(lastYear.month)} (${num(lastYear.units)} units).`);
  return (
    <div className="mt-3">
      <p className="text-sm font-semibold">This month used</p>
      <ul className="num mt-1 space-y-0.5 text-sm text-muted">
        {lines.map((x) => (
          <li key={x}>{x.charAt(0).toUpperCase() + x.slice(1)}</li>
        ))}
      </ul>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-3">
      <button
        type="button"
        className="btn btn-quiet absolute right-2 top-2 px-3 py-1 text-sm"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy JSON"}
      </button>
      <pre className="num max-h-[28rem] overflow-auto rounded-md border border-rule bg-surface p-4 text-[0.82rem] leading-relaxed">{text}</pre>
    </div>
  );
}
