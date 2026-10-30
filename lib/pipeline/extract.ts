/**
 * Level 1 extraction pipeline for one bill:
 *   1. Prepare images (full page + 2 zoomed crops).
 *   2. Run N independent extraction passes with the vision model.
 *   3. Normalise every pass in code (numbers, dates, enums).
 *   4. Majority-vote each field across passes (self-consistency).
 *   5. Run arithmetic consistency checks; if they fail, one targeted "re-read" pass.
 */
import { generateText, type ModelMessage } from "ai";
import { config, getModel } from "./config";
import { prepareImages, type PreparedImage } from "./image";
import {
  chargeType, parseJsonObject, providerFromId, taxType, toDate, toMonth, toNumber, toStr,
} from "./normalize";
import { EXAMPLE_KE_0008, EXTRACT_SYSTEM, repairPrompt } from "./prompts";
import { log, readCache, withRetry, writeCache } from "./util";

export type Line = { type: string; amount: number };

export type Level1 = {
  provider: string | null;
  tariff: string | null;
  sanctioned_load_kw: number | null;
  bill_month: string | null;
  reading_date: string | null;
  issue_date: string | null;
  due_date: string | null;
  previous_reading: number | null;
  current_reading: number | null;
  units_consumed: number | null;
  charges: Line[];
  total_charges: number | null;
  taxes: Line[];
  total_taxes: number | null;
  current_bill: number | null;
  arrears: number | null;
  payable_within_due_date: number | null;
  payable_after_due_date: number | null;
};

/** Level 1 fields + extra context used by Level 2. */
export type Extraction = { level1: Level1; extra: Record<string, unknown>; checks: string[]; runs: number };

/** Live progress for the web UI. Steps happen in this order. */
export type ProgressStep = "prepare" | "read" | "vote" | "check" | "reread" | "history" | "done";
export type ProgressEvent = { step: ProgressStep; status: "start" | "update" | "done" | "skip"; detail?: string; pass?: number; of?: number };
export type ExtractOptions = { force?: boolean; onProgress?: (e: ProgressEvent) => void };

const SCALARS = [
  "provider", "tariff", "sanctioned_load_kw", "bill_month", "reading_date", "issue_date", "due_date",
  "previous_reading", "current_reading", "units_consumed", "total_charges", "total_taxes",
  "current_bill", "arrears", "payable_within_due_date", "payable_after_due_date",
] as const;

function normaliseLevel1(raw: Record<string, unknown>, billId: string): Level1 {
  const lines = (v: unknown, kind: "charge" | "tax"): Line[] =>
    (Array.isArray(v) ? v : [])
      .map((x): Line | null => {
        const o = (x ?? {}) as Record<string, unknown>;
        const amount = toNumber(o.amount);
        if (amount === null || amount === 0) return null; // guide: skip blank and 0 lines
        const type: string = kind === "charge" ? chargeType(o.type) : taxType(o.type);
        const signed = type === "subsidy" && amount > 0 ? -amount : amount; // subsidies are deductions
        return { type, amount: signed };
      })
      .filter((x): x is Line => x !== null);

  const prov = toStr(raw.provider)?.toUpperCase().replace("K-ELECTRIC", "KE").replace("KESC", "KE") ?? null;
  return {
    provider: prov && ["KE", "LESCO", "IESCO"].includes(prov) ? prov : providerFromId(billId),
    tariff: toStr(raw.tariff),
    sanctioned_load_kw: toNumber(raw.sanctioned_load_kw),
    bill_month: toMonth(raw.bill_month),
    reading_date: toDate(raw.reading_date),
    issue_date: toDate(raw.issue_date),
    due_date: toDate(raw.due_date),
    previous_reading: toNumber(raw.previous_reading),
    current_reading: toNumber(raw.current_reading),
    units_consumed: toNumber(raw.units_consumed),
    charges: lines(raw.charges, "charge"),
    total_charges: toNumber(raw.total_charges),
    taxes: lines(raw.taxes, "tax"),
    total_taxes: toNumber(raw.total_taxes),
    current_bill: toNumber(raw.current_bill),
    arrears: toNumber(raw.arrears),
    payable_within_due_date: toNumber(raw.payable_within_due_date),
    payable_after_due_date: toNumber(raw.payable_after_due_date),
  };
}

function imageContent(images: PreparedImage[]) {
  return images.flatMap((img) => [
    { type: "text" as const, text: `[${img.label}]` },
    { type: "file" as const, data: img.data, mediaType: img.mediaType },
  ]);
}

async function onePass(images: PreparedImage[], billId: string, pass: number, extraMessages: ModelMessage[] = []) {
  const provider = providerFromId(billId);
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        ...imageContent(images),
        {
          type: "text",
          text: `Bill file id: ${billId}${provider ? ` (provider: ${provider})` : ""}.\n${EXAMPLE_KE_0008}\n\nNow extract THIS bill. Return only the JSON object.`,
        },
      ],
    },
    ...extraMessages,
  ];
  const { text } = await withRetry(
    () => generateText({ model: getModel(), system: EXTRACT_SYSTEM, messages, temperature: pass === 0 ? 0 : 0.3, maxOutputTokens: 6000, maxRetries: 4 }),
    `${billId} pass ${pass + 1}`,
  );
  return { raw: parseJsonObject(text), text };
}

const key = (v: unknown) => JSON.stringify(v);

function vote<T>(values: T[]): T {
  const counts = new Map<string, { v: T; n: number; first: number }>();
  values.forEach((v, i) => {
    const k = key(v);
    const c = counts.get(k);
    if (c) c.n++;
    else counts.set(k, { v, n: 1, first: i });
  });
  // prefer non-null values when tied with null; then the earliest (temperature 0) pass
  return [...counts.values()].sort((a, b) => b.n - a.n || Number(a.v === null) - Number(b.v === null) || a.first - b.first)[0].v;
}

const sum = (xs: Line[]) => Math.round(xs.reduce((s, x) => s + x.amount, 0) * 100) / 100;

export function consistencyChecks(l: Level1): string[] {
  const issues: string[] = [];
  const near = (a: number, b: number, tol = 1.5) => Math.abs(a - b) <= tol;
  if (l.provider === "KE") {
    if (l.total_charges !== null && l.charges.length && !near(sum(l.charges), l.total_charges))
      issues.push(`charges add up to ${sum(l.charges)} but total_charges is ${l.total_charges}`);
    if (l.total_taxes !== null && l.taxes.length && !near(sum(l.taxes), l.total_taxes))
      issues.push(`taxes add up to ${sum(l.taxes)} but total_taxes is ${l.total_taxes}`);
    if (l.total_charges !== null && l.total_taxes !== null && l.current_bill !== null && !near(l.total_charges + l.total_taxes, l.current_bill))
      issues.push(`total_charges + total_taxes = ${l.total_charges + l.total_taxes} but current_bill is ${l.current_bill}`);
  }
  if (l.previous_reading !== null && l.current_reading !== null && l.units_consumed !== null) {
    const diff = l.current_reading - l.previous_reading;
    if (diff > 0 && !near(diff, l.units_consumed, 1.5) && l.provider !== "KE")
      issues.push(`current_reading - previous_reading = ${diff} but units_consumed is ${l.units_consumed} (check readings; a multiplier may apply)`);
  }
  if (l.issue_date && l.due_date && l.due_date < l.issue_date) issues.push(`due_date ${l.due_date} is before issue_date ${l.issue_date}`);
  if (l.payable_after_due_date !== null && l.payable_within_due_date !== null && l.payable_within_due_date > 0 && l.payable_after_due_date < l.payable_within_due_date)
    issues.push(`payable_after_due_date ${l.payable_after_due_date} is lower than payable_within_due_date ${l.payable_within_due_date}`);
  for (const f of ["provider", "bill_month", "due_date", "current_bill", "payable_within_due_date"] as const)
    if (l[f] === null) issues.push(`${f} is null — re-check whether it is printed`);
  return issues;
}

export async function extractBill(billId: string, file: string, opts: ExtractOptions = {}): Promise<Extraction> {
  const emit = (e: ProgressEvent) => opts.onProgress?.(e);
  if (!opts.force) {
    const c = await readCache<Extraction>("extract", billId);
    if (c) {
      log(`💾 ${billId}: using cached extraction`);
      const before = JSON.stringify(c.level1);
      c.level1 = fixCreditSign(c.level1, billId);
      if (JSON.stringify(c.level1) !== before) await writeCache("extract", billId, c);
      return c;
    }
  }
  emit({ step: "prepare", status: "start" });
  const images = await prepareImages(file);
  emit({ step: "prepare", status: "done", detail: `${images.length} views` });
  log(`🔎 ${billId}: ${config.extractRuns} extraction pass(es) with ${config.modelName}`);

  const runs = Math.max(1, config.extractRuns);
  let finished = 0;
  emit({ step: "read", status: "start", pass: 0, of: runs });
  const passes = await Promise.allSettled(
    Array.from({ length: runs }, (_, i) =>
      onePass(images, billId, i).finally(() => emit({ step: "read", status: "update", pass: ++finished, of: runs })),
    ),
  );
  emit({ step: "read", status: "done", pass: finished, of: runs });
  const ok = passes.flatMap((p) => (p.status === "fulfilled" ? [p.value] : []));
  if (!ok.length) throw (passes[0] as PromiseRejectedResult).reason;

  emit({ step: "vote", status: "start" });
  const normalised = ok.map((p) => normaliseLevel1(p.raw, billId));

  // 1) vote every scalar field
  const voted = {} as Level1;
  for (const f of SCALARS) (voted as Record<string, unknown>)[f] = vote(normalised.map((n) => n[f]));
  // 2) take charges/taxes from the pass that best agrees with the voted totals
  const score = (n: Level1) =>
    SCALARS.filter((f) => key(n[f]) === key(voted[f])).length +
    (voted.total_charges !== null && Math.abs(sum(n.charges) - voted.total_charges) <= 1.5 ? 5 : 0) +
    (voted.total_taxes !== null && Math.abs(sum(n.taxes) - voted.total_taxes) <= 1.5 ? 5 : 0) +
    (voted.total_taxes !== null && n.taxes.length === 0 && voted.provider !== "KE" ? 2 : 0);
  const bestIdx = normalised.map((n, i) => ({ i, s: score(n) })).sort((a, b) => b.s - a.s)[0].i;
  voted.charges = vote(normalised.map((n) => n.charges));
  if (normalised.filter((n) => key(n.charges) === key(voted.charges)).length < 2) voted.charges = normalised[bestIdx].charges;
  voted.taxes = vote(normalised.map((n) => n.taxes));
  if (normalised.filter((n) => key(n.taxes) === key(voted.taxes)).length < 2) voted.taxes = normalised[bestIdx].taxes;

  let level1 = order(voted);
  let extra = stripCore(ok[bestIdx].raw);
  emit({ step: "vote", status: "done", detail: `${ok.length} readings combined` });
  emit({ step: "check", status: "start" });
  let checks = consistencyChecks(level1);
  emit({ step: "check", status: "done", detail: checks.length ? `${checks.length} to re-check` : "all totals agree" });

  // 3) one targeted re-read if checks fail
  const hadIssues = checks.length > 0;
  if (!hadIssues) emit({ step: "reread", status: "skip" });
  if (checks.length) {
    emit({ step: "reread", status: "start", detail: checks.join("; ") });
    log(`🩺 ${billId}: checks flagged ${checks.length} issue(s) → re-reading: ${checks.join("; ")}`);
    try {
      const repair = await onePass(images, billId, 0, [
        { role: "assistant", content: ok[bestIdx].text },
        { role: "user", content: repairPrompt(checks, ok[bestIdx].raw) },
      ]);
      const fixed = order(normaliseLevel1(repair.raw, billId));
      const fixedChecks = consistencyChecks(fixed);
      if (fixedChecks.length < checks.length) {
        level1 = fixed;
        const fresh = stripCore(repair.raw);
        for (const [k, v] of Object.entries(fresh)) {
          const empty = v === null || v === undefined || (Array.isArray(v) && v.length === 0) || v === "";
          if (!empty) extra[k] = v; // keep earlier details when the re-read did not return them
        }
        checks = fixedChecks;
        log(`✅ ${billId}: re-read fixed ${checks.length === 0 ? "all" : "some"} issues`);
      } else {
        log(`ℹ️  ${billId}: re-read did not improve; keeping voted values`);
      }
    } catch (e) {
      log(`⚠️  ${billId}: re-read failed (${(e as Error).message}); keeping voted values`);
    }
  }

  if (hadIssues) emit({ step: "reread", status: "done", detail: checks.length ? `${checks.length} still flagged` : "all fixed" });
  level1 = fixCreditSign(level1, billId);
  const result: Extraction = { level1, extra, checks, runs: ok.length };
  await writeCache("extract", billId, result);
  log(`📄 ${billId}: done (${level1.provider}, ${level1.bill_month}, payable ${level1.payable_within_due_date})${checks.length ? ` — remaining warnings: ${checks.length}` : ""}`);
  return result;
}

/**
 * Credit balances: bills print them with a "CR" suffix (e.g. "54770CR"), which the model sometimes drops.
 * On every layout, the amount payable by the due date equals current bill + arrears. If our number matches
 * that sum in size but has the opposite sign, the CR was lost -> restore the sign. Never changes magnitudes.
 */
function fixCreditSign(l: Level1, billId: string): Level1 {
  const w = l.payable_within_due_date;
  if (w === null || w === 0 || l.current_bill === null || l.arrears === null) return l;
  const expected = l.current_bill + l.arrears;
  if (expected !== 0 && Math.sign(w) !== Math.sign(expected) && Math.abs(Math.abs(w) - Math.abs(expected)) <= 1) {
    log(`🔁 ${billId}: payable_within_due_date ${w} -> ${-w} (credit "CR" sign: current_bill + arrears = ${expected.toFixed(2)})`);
    return { ...l, payable_within_due_date: -w };
  }
  return l;
}

/** Exact key order of the guide's template. */
function order(l: Level1): Level1 {
  return {
    provider: l.provider, tariff: l.tariff, sanctioned_load_kw: l.sanctioned_load_kw,
    bill_month: l.bill_month, reading_date: l.reading_date, issue_date: l.issue_date, due_date: l.due_date,
    previous_reading: l.previous_reading, current_reading: l.current_reading, units_consumed: l.units_consumed,
    charges: l.charges.map((c) => ({ type: c.type, amount: c.amount })), total_charges: l.total_charges,
    taxes: l.taxes.map((t) => ({ type: t.type, amount: t.amount })), total_taxes: l.total_taxes,
    current_bill: l.current_bill, arrears: l.arrears,
    payable_within_due_date: l.payable_within_due_date, payable_after_due_date: l.payable_after_due_date,
  };
}

function stripCore(raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of ["meter_rows", "line_details", "usage_history", "payment_history", "late_payment_amounts", "percentages", "other_info", "notes"])
    out[k] = raw[k] ?? null;
  return out;
}
