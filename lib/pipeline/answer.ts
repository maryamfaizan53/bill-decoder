/**
 * Level 2: answer customer questions about one bill.
 * - Context = Level 1 JSON + extra extracted context + facts pre-computed in code + the bill image.
 * - The model must use a `calculate` tool (mathjs) for every number, so arithmetic is exact.
 * - All questions for a bill are answered in one agent run; any missing answer is retried one by one.
 */
import { generateText, isStepCount, tool } from "ai";
import { evaluate, format } from "mathjs";
import { z } from "zod";
import { getModel } from "./config";
import type { Extraction, Line } from "./extract";
import { prepareImages } from "./image";
import { readHistory, type HistoryRow } from "./history";
import { parseJsonObject, toMonth, toNumber } from "./normalize";
import { ANSWER_SYSTEM } from "./prompts";
import { log, readCache, withRetry, writeCache } from "./util";

export type Question = { question_id: string; question: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Facts computed deterministically so the model does not have to. */
export function computeFacts(ex: Extraction, history?: HistoryRow[] | null) {
  const l = ex.level1;
  const f: Record<string, unknown> = {};
  const sum = (xs: Line[]) => r2(xs.reduce((s, x) => s + x.amount, 0));
  if (l.charges.length) f.sum_of_charge_lines = sum(l.charges);
  if (l.taxes.length) f.sum_of_tax_lines = sum(l.taxes);
  const byType = (xs: Line[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x.type] = r2((m[x.type] ?? 0) + x.amount)), m), {});
  f.charges_by_type = byType(l.charges);
  f.taxes_by_type = byType(l.taxes);
  if (l.total_taxes !== null && l.current_bill) f.taxes_pct_of_current_bill = r2((l.total_taxes / l.current_bill) * 100);
  if (l.total_charges !== null && l.current_bill) f.charges_pct_of_current_bill = r2((l.total_charges / l.current_bill) * 100);
  if (l.current_bill !== null && l.units_consumed) f.average_cost_per_unit_current_bill = r2(l.current_bill / l.units_consumed);
  if (l.total_charges !== null && l.units_consumed) f.average_charges_per_unit_before_tax = r2(l.total_charges / l.units_consumed);
  if (l.payable_after_due_date !== null && l.payable_within_due_date !== null)
    f.late_payment_extra = r2(l.payable_after_due_date - l.payable_within_due_date);
  if (l.issue_date && l.due_date)
    f.days_from_issue_to_due = Math.round((Date.parse(l.due_date) - Date.parse(l.issue_date)) / 86400000);
  if (l.reading_date && l.due_date)
    f.days_from_reading_to_due = Math.round((Date.parse(l.due_date) - Date.parse(l.reading_date)) / 86400000);

  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const label = (ym: string | null) => {
    const m = ym?.match(/^(\d{4})-(\d{2})$/);
    return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(ym);
  };
  const raw = (history ?? (Array.isArray(ex.extra.usage_history) ? ex.extra.usage_history : [])) as {
    month?: string; units?: number | string | null; bill?: number | string | null; bill_amount?: number | string | null; is_current?: boolean;
  }[];
  const months = raw
    .map((h) => ({ month: h.month ?? null, units: num(h.units), bill: num(h.bill ?? h.bill_amount), current: !!h.is_current || (!!l.bill_month && h.month === l.bill_month) }))
    .filter((m) => m.units !== null);
  const prev = months.filter((m) => !m.current);
  // current month: from the history if shown, else from the bill itself
  const cur = months.find((m) => m.current) ?? (l.units_consumed !== null && l.bill_month ? { month: l.bill_month, units: l.units_consumed, bill: l.current_bill, current: true } : null);
  const all = cur ? [...prev, cur] : prev;
  const stats = (rows: typeof months, tag: string) => {
    if (!rows.length) return;
    const u = rows.map((m) => m.units as number);
    const total = u.reduce((a, b) => a + b, 0);
    f[`${tag}_months_count`] = rows.length;
    f[`${tag}_total_units`] = r2(total);
    f[`${tag}_avg_units`] = r2(total / rows.length);
    const max = rows.reduce((a, b) => ((b.units as number) > (a.units as number) ? b : a));
    const min = rows.reduce((a, b) => ((b.units as number) < (a.units as number) ? b : a));
    f[`${tag}_max`] = `${label(max.month)}: ${max.units} units`;
    f[`${tag}_min`] = `${label(min.month)}: ${min.units} units`;
    for (const t of [100, 150, 200, 250, 300, 400, 500]) {
      const hits = rows.filter((m) => (m.units as number) > t);
      f[`${tag}_months_above_${t}_units`] = `${hits.length}${hits.length ? ": " + hits.map((m) => `${label(m.month)} (${m.units})`).join(", ") : ""}`;
    }
  };
  if (months.length || cur) {
    f.history_table = all.map((m) => ({ month: label(m.month), units: m.units, bill: m.bill, current_month: m.current }));
    stats(prev, "history_previous_months_excluding_current");
    stats(all, "history_including_current_month");
    if (cur && prev.length) {
      const last = prev[prev.length - 1];
      f.change_vs_previous_month = `${label(last.month)} ${last.units} -> ${label(cur.month)} ${cur.units} units: ${r2((cur.units as number) - (last.units as number))} units (${last.units ? r2((((cur.units as number) - (last.units as number)) / Math.abs(last.units as number)) * 100) + "%" : "n/a"})`;
      const ly = cur.month ? prev.find((m) => m.month === `${Number(cur.month!.slice(0, 4)) - 1}${cur.month!.slice(4)}`) : undefined;
      if (ly) f.change_vs_same_month_last_year = `${label(ly.month)} ${ly.units} -> ${cur.units} units: ${r2((cur.units as number) - (ly.units as number))} units`;
      const avg = f.history_previous_months_excluding_current_avg_units as number;
      if (avg) f.current_vs_previous_months_avg = `${cur.units} vs avg ${avg}: ${r2((cur.units as number) - avg)} units (${r2((((cur.units as number) - avg) / Math.abs(avg)) * 100)}%)`;
    }
  }

  // Largest charge: compare individual printed lines and types (printed % splits refer to ALL electricity charges together).
  if (l.charges.length) {
    const lines = Array.isArray(ex.extra.line_details) ? (ex.extra.line_details as { label?: string; section?: string; amount?: unknown }[]) : [];
    const chargeLines = lines.filter((x) => x.section === "charges" && num(x.amount) !== null && !/electricity charges$|^total|net electricity|subtotal/i.test(String(x.label ?? "")));
    const biggestLine = chargeLines.sort((a, b) => (num(b.amount) as number) - (num(a.amount) as number))[0];
    if (biggestLine) f.largest_single_charge_line = `${biggestLine.label}: PKR ${num(biggestLine.amount)}${l.current_bill ? ` (${r2(((num(biggestLine.amount) as number) / l.current_bill) * 100)}% of current bill)` : ""}`;
    const types = Object.entries(f.charges_by_type as Record<string, number>).sort((a, b) => b[1] - a[1]);
    if (types.length) f.largest_charge_type = `${types[0][0]}: PKR ${types[0][1]}${l.current_bill ? ` (${r2((types[0][1] / l.current_bill) * 100)}% of current bill)` : ""}`;
    const fixed = (f.charges_by_type as Record<string, number>).fixed ?? 0;
    if (l.current_bill !== null && l.units_consumed) {
      f.fixed_charges_total = fixed;
      f.estimate_method_for_unit_changes = `estimate = fixed charges (PKR ${fixed}) + (current bill PKR ${l.current_bill} - fixed charges) x (new units / ${l.units_consumed}); slab rates and taxes are assumed unchanged`;
    }
  }
  return f;
}

const num = (v: unknown): number | null => toNumber(v);

const calculate = tool({
  description:
    "Evaluate an arithmetic expression exactly (mathjs syntax). Use for every sum, difference, average, percentage, count or estimate. Example: (569.62 / 3430.24) * 100",
  inputSchema: z.object({ expression: z.string(), purpose: z.string().optional() }),
  execute: async ({ expression }) => {
    try {
      const v = evaluate(expression);
      return { expression, result: typeof v === "number" ? Number(format(v, { precision: 12 })) : String(v) };
    } catch (e) {
      return { expression, error: (e as Error).message };
    }
  },
});

export async function answerQuestions(billId: string, file: string, ex: Extraction, questions: Question[], opts: { force?: boolean } = {}) {
  const cacheId = `${billId}`;
  const cached = (!opts.force && (await readCache<Record<string, string>>("answers", cacheId))) || {};
  const todo = questions.filter((q) => !cached[`${q.question_id}::${q.question}`]);
  if (!todo.length) { log(`💾 ${billId}: using cached answers`); return pick(cached, questions); }

  const [image] = await prepareImages(file, false);
  const focused = await readHistory(billId, file, ex.level1.provider, ex.level1.bill_month);
  const history = mergeHistory(focused, ex.extra.usage_history, ex.level1.bill_month);
  const extra = history ? { ...ex.extra, usage_history: history } : ex.extra;
  const context = `BILL ${billId}
LEVEL 1 DATA (extracted from the bill):
${JSON.stringify(ex.level1)}

EXTRA PRINTED DETAILS (line details, meter rows, usage/payment history, late-payment amounts, percentages, other info):
${JSON.stringify(extra)}

FACTS PRE-COMPUTED IN CODE (exact):
${JSON.stringify(computeFacts(ex, history), null, 1)}`;

  const run = async (qs: Question[]) => {
    const { text } = await withRetry(
      () =>
        generateText({
          model: getModel(),
          system: ANSWER_SYSTEM,
          tools: { calculate },
          stopWhen: isStepCount(25),
          temperature: 0,
          maxOutputTokens: 6000,
          maxRetries: 4,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: context },
                { type: "text", text: "[Bill image, for checking anything not in the data]" },
                { type: "file", data: image.data, mediaType: image.mediaType },
                {
                  type: "text",
                  text: `Answer each question below. Use the calculate tool for all arithmetic. When finished, reply with ONLY a JSON object mapping question_id to the answer text, e.g. {"Q1": "...", "Q2": "..."}.

${qs.map((q) => `${q.question_id}: ${q.question}`).join("\n")}`,
                },
              ],
            },
          ],
        }),
      `${billId} answers`,
    );
    return parseJsonObject(text) as Record<string, string>;
  };

  log(`💬 ${billId}: answering ${todo.length} question(s)`);
  let got: Record<string, string> = {};
  try { got = await run(todo); } catch (e) { log(`⚠️  ${billId}: batch answer failed (${(e as Error).message}); falling back to one-by-one`); }

  for (const q of todo) {
    let a = typeof got[q.question_id] === "string" ? got[q.question_id].trim() : "";
    if (!a) {
      try { a = String((await run([q]))[q.question_id] ?? "").trim(); } catch (e) { log(`⚠️  ${billId} ${q.question_id}: ${(e as Error).message}`); }
    }
    if (!a) a = "Sorry, I could not determine this from the bill."; // never leave a cell empty
    cached[`${q.question_id}::${q.question}`] = a;
  }
  await writeCache("answers", cacheId, cached);
  return pick(cached, questions);
}

/**
 * Combine the focused history read with the history from the main extraction:
 * the focused read wins; any month it left blank (or missed) is filled from the main read.
 */
export function mergeHistory(focused: HistoryRow[] | null, main: unknown, billMonth: string | null): HistoryRow[] | null {
  const mainRows = (Array.isArray(main) ? main : []) as Record<string, unknown>[];
  const fromMain = new Map<string, HistoryRow>();
  for (const r of mainRows) {
    const m = toMonth(r.month);
    if (!m) continue;
    fromMain.set(m, { month: m, units: toNumber(r.units), bill: toNumber(r.bill ?? r.bill_amount), payment: toNumber(r.payment), is_current: !!r.is_current || m === billMonth });
  }
  if (!focused?.length) return fromMain.size ? [...fromMain.values()].sort((a, b) => a.month.localeCompare(b.month)) : null;
  const out = new Map<string, HistoryRow>();
  for (const r of focused) {
    const alt = fromMain.get(r.month);
    out.set(r.month, {
      ...r,
      units: r.units ?? alt?.units ?? null,
      bill: r.bill ?? alt?.bill ?? null,
      payment: r.payment ?? alt?.payment ?? null,
    });
  }
  for (const [m, r] of fromMain) if (!out.has(m) && /^\d{4}-\d{2}$/.test(m)) out.set(m, r);
  return [...out.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function pick(cached: Record<string, string>, questions: Question[]) {
  return Object.fromEntries(questions.map((q) => [q.question_id, cached[`${q.question_id}::${q.question}`]]));
}
