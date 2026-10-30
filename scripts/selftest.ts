/**
 * npm run selftest — offline tests (no API key, no cost). A mock model stands in for the LLM.
 * Checks: number/date parsing, the full extraction pipeline with voting, the re-read path,
 * progress events for the web UI, Level 2 answering via the calculator tool, history facts,
 * and that every saved sample result matches the hand-checked answers.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { MockLanguageModelV4 } from "ai/test";
import { answerQuestions, computeFacts } from "../lib/pipeline/answer";
import { config, setModelForTests } from "../lib/pipeline/config";
import { consistencyChecks, extractBill, type Extraction, type ProgressEvent } from "../lib/pipeline/extract";
import { toDate, toMonth, toNumber } from "../lib/pipeline/normalize";

let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// ---------- 1. parsing ----------
assert.equal(toNumber("Rs. 19,964"), 19964);
assert.equal(toNumber("38209CR"), -38209);
assert.equal(toNumber("(1,442.74)"), -1442.74);
assert.equal(toNumber("NOT TO BE PAID"), null);
assert.equal(toDate("22nd Sep 2026"), "2026-09-22");
assert.equal(toDate("08 OCT 26"), "2026-10-08");
assert.equal(toDate("21-Apr-2026"), "2026-04-21");
assert.equal(toMonth("MAR 2026"), "2026-03");
assert.equal(toMonth("Apr-26"), "2026-04");
ok("numbers, credits and dates are normalised");

// ---------- 2. pipeline with a mock model ----------
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const fin = (u: string) => ({ unified: u, raw: undefined });
const KE8 = {
  provider: "K-Electric", tariff: "A1-R", sanctioned_load_kw: "3", bill_month: "Apr-26", reading_date: "03-Apr-26", issue_date: "07-Apr-2026",
  due_date: "21st Apr 2026", previous_reading: "8819", current_reading: "8970", units_consumed: "151",
  charges: [{ type: "fixed", amount: "900.00" }, { type: "energy", amount: "1,054.00" }, { type: "energy", amount: 663.51 }, { type: "quarterly_adjustment", amount: 52.91 }, { type: "fpa", amount: 125.27 }, { type: "surcharge", amount: 64.93 }, { type: "other", amount: 0 }],
  total_charges: "2,860.62", taxes: [{ type: "electricity_duty", amount: 29.41 }, { type: "gst", amount: 520.21 }, { type: "municipal_tax", amount: 20 }],
  total_taxes: 569.62, current_bill: 3430.24, arrears: "-0.53", payable_within_due_date: "Rs. 3,430", payable_after_due_date: 3716,
  usage_history: [{ month: "2025-07", units: 239 }, { month: "2025-08", units: 203 }, { month: "2026-03", units: 115 }, { month: "2026-04", units: 151, is_current: true }],
};
let extractCalls = 0;
let mode: "consistent" | "one-misread" | "always-wrong" = "consistent";
setModelForTests(
  new MockLanguageModelV4({
    doGenerate: async (opts: any) => {
      const sys = JSON.stringify(opts.prompt[0]);
      const last = opts.prompt.at(-1);
      if (sys.includes("data-entry")) {
        extractCalls++;
        const isRepair = JSON.stringify(opts.prompt).includes("automatic checks found");
        let body: Record<string, unknown> = KE8;
        if (mode === "one-misread" && extractCalls === 2) body = { ...KE8, current_bill: 3480.24 }; // outvoted by the other two
        if (mode === "always-wrong" && !isRepair) body = { ...KE8, total_charges: 2680.62 }; // fixed by the re-read
        return { content: [{ type: "text", text: "```json\n" + JSON.stringify(body) + "\n```" }], finishReason: fin("stop"), usage, warnings: [] } as any;
      }
      if (JSON.stringify(opts.prompt).includes("13 Month Usage History") || JSON.stringify(opts.prompt).includes("BILL HISTORY table")) {
        return { content: [{ type: "text", text: JSON.stringify({ rows: [] }) }], finishReason: fin("stop"), usage, warnings: [] } as any;
      }
      if (last.role !== "tool")
        return { content: [{ type: "tool-call", toolCallId: "c1", toolName: "calculate", input: JSON.stringify({ expression: "569.62/3430.24*100" }) }], finishReason: fin("tool-calls"), usage, warnings: [] } as any;
      const pct = Number(JSON.stringify(last.content[0].output).match(/16\.6\d*/)?.[0] ?? 0).toFixed(2);
      return { content: [{ type: "text", text: JSON.stringify({ Q1: `Taxes are PKR 569.62, or ${pct}% of the bill.` }) }], finishReason: fin("stop"), usage, warnings: [] } as any;
    },
  }) as any,
);

const tmp = ".cache/selftest";
await fs.rm(tmp, { recursive: true, force: true });
config.cacheDir = `${tmp}/cache`; // never touch the real cache
const expected = JSON.parse(await fs.readFile("eval/expected/KESC_0008.json", "utf8"));
const img = "samples/KESC_0008.png";

const events: ProgressEvent[] = [];
const ex1 = await extractBill("KESC_0008", img, { force: true, onProgress: (e) => events.push(e) });
assert.deepEqual(ex1.level1, expected);
assert.equal(ex1.runs, 3);
assert.deepEqual(ex1.checks, []);
ok("3 mock readings produce exactly the official KESC_0008 answer");

const order = events.map((e) => `${e.step}:${e.status}`);
for (const step of ["prepare:start", "prepare:done", "read:start", "read:done", "vote:done", "check:done", "reread:skip"]) assert.ok(order.includes(step), `missing ${step}`);
assert.ok(order.indexOf("prepare:done") < order.indexOf("read:done") && order.indexOf("read:done") < order.indexOf("check:done"));
assert.equal(events.filter((e) => e.step === "read" && e.status === "update").length, 3);
ok("progress events arrive in pipeline order (used by the web UI)");

mode = "one-misread";
extractCalls = 0;
const ex2 = await extractBill("KESC_0008", img, { force: true });
assert.equal(ex2.level1.current_bill, 3430.24);
ok("a single misread value is outvoted by the other two readings");

mode = "always-wrong";
extractCalls = 0;
const reread: ProgressEvent[] = [];
const ex3 = await extractBill("KESC_0008", img, { force: true, onProgress: (e) => reread.push(e) });
assert.equal(ex3.level1.total_charges, 2860.62);
assert.deepEqual(ex3.checks, []);
assert.ok(reread.some((e) => e.step === "reread" && e.status === "done"));
ok("totals that don't add up trigger a re-read, which fixes them");

mode = "consistent";
const answers = await answerQuestions("KESC_0008", img, ex1, [{ question_id: "Q1", question: "How much of my bill is taxes?" }], { force: true });
assert.match(answers.Q1, /16\.61%/);
ok("Level 2 answer uses the calculator tool result");

// ---------- 3. facts ----------
const facts = computeFacts(ex1, [
  ...[141, 138, 197, 239, 203, 176, 173, 187, 124, 96, 88, 115].map((u, i) => ({ month: `${i < 9 ? 2025 : 2026}-${String(((i + 3) % 12) + 1).padStart(2, "0")}`, units: u, bill: null, payment: null, is_current: false })),
  { month: "2026-04", units: 151, bill: null, payment: null, is_current: true },
]);
assert.equal(facts.taxes_pct_of_current_bill, 16.61);
assert.equal(facts.history_previous_months_excluding_current_avg_units, 156.42);
assert.match(String(facts.history_previous_months_excluding_current_months_above_200_units), /^2: July 2025 \(239\), August 2025 \(203\)$/);
ok("history facts match the guide's worked example (2 months above 200 units)");

// ---------- 4. saved sample results ----------
for (const f of (await fs.readdir("samples/snapshots")).filter((x) => x.endsWith(".json"))) {
  const snap = JSON.parse(await fs.readFile(`samples/snapshots/${f}`, "utf8")) as { bill_id: string; extraction: Extraction };
  const exp = JSON.parse(await fs.readFile(`eval/expected/${snap.bill_id}.json`, "utf8"));
  assert.deepEqual(snap.extraction.level1, exp, `${snap.bill_id} snapshot differs from eval/expected`);
  assert.deepEqual(consistencyChecks(snap.extraction.level1), [], `${snap.bill_id} snapshot fails consistency checks`);
  await fs.access(`samples/${snap.bill_id}.${snap.bill_id.startsWith("IESCO") ? "jpg" : "png"}`);
}
ok("every saved sample result matches the hand-checked answers and passes the checks");

await fs.rm(tmp, { recursive: true, force: true });
console.log(`\nAll ${passed} self-tests passed ✅`);
