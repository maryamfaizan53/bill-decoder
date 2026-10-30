/**
 * Command-line entry point.
 *
 *   npm run run-all -- --data test            # both CSVs for test/bills (+ test/csv templates) -> output/
 *   npm run level1  -- --data test
 *   npm run level2  -- --data test
 *   npm run extract -- samples/KESC_0008.png           # print Level 1 JSON for one bill
 *   npm run ask     -- samples/KESC_0008.png "How much of my bill is taxes?"
 *
 * Options: --out <dir> (default: output)  --force (ignore cache)  --only <BILL_ID>
 */
import fs from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { answerQuestions, type Question } from "../lib/pipeline/answer";
import { config } from "../lib/pipeline/config";
import { readCsv, writeCsv, type Row } from "../lib/pipeline/csv";
import { extractBill, type Extraction } from "../lib/pipeline/extract";
import { findBillImage, listBills } from "../lib/pipeline/image";
import { log } from "../lib/pipeline/util";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name: string, d?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : d;
};
const has = (name: string) => argv.includes(`--${name}`);
const VALUE_FLAGS = ["--data", "--bills", "--out", "--only"];
const positional = argv.slice(1).filter((a, i, arr) => !a.startsWith("--") && !VALUE_FLAGS.includes(arr[i - 1]));

const dataDir = flag("data", "test")!;
const billsDir = flag("bills", path.join(dataDir, "bills"))!;
const csvDir = path.join(dataDir, "csv");
const outDir = flag("out", "output")!;
const force = has("force");
const only = flag("only");

const exists = (p: string) => fs.access(p).then(() => true, () => false);

async function level1(): Promise<Map<string, Extraction>> {
  const template = path.join(csvDir, "level1.csv");
  let fields = ["bill_id", "json"];
  let rows: Row[];
  if (await exists(template)) ({ rows, fields } = await readCsv(template));
  else {
    log(`ℹ️  ${template} not found → processing every image in ${billsDir}`);
    rows = (await listBills(billsDir)).map((id) => ({ bill_id: id, json: "" }));
  }
  const ids = [...new Set(rows.map((r) => r.bill_id.trim()))].filter((id) => !only || id === only);
  log(`▶ Level 1: ${ids.length} bill(s) · model ${config.modelName} · ${config.extractRuns} pass(es) · concurrency ${config.concurrency}`);

  const limit = pLimit(config.concurrency);
  const results = new Map<string, Extraction>();
  const failures: string[] = [];
  await Promise.all(
    ids.map((id) =>
      limit(async () => {
        try {
          results.set(id, await extractBill(id, await findBillImage(billsDir, id), { force }));
        } catch (e) {
          failures.push(id);
          log(`❌ ${id}: ${(e as Error).message}`);
        }
      }),
    ),
  );

  for (const r of rows) {
    const ex = results.get(r.bill_id.trim());
    if (ex) r.json = JSON.stringify(ex.level1); // one line, no newlines
  }
  if (!only) {
    await writeCsv(path.join(outDir, "level1.csv"), fields, rows);
    log(`✅ wrote ${path.join(outDir, "level1.csv")} (${rows.length} rows)`);
  }
  if (failures.length) log(`⚠️  failed: ${failures.join(", ")} — re-run the same command; finished bills are cached.`);
  return results;
}

async function sampleQuestions(): Promise<Question[]> {
  const { rows } = await readCsv(path.join("eval", "sample_questions.csv"));
  return rows.map((r) => ({ question_id: r.question_id, question: r.question }));
}

async function level2(extractions?: Map<string, Extraction>) {
  const template = path.join(csvDir, "level2.csv");
  let fields = ["bill_id", "question_id", "question", "answer"];
  let rows: Row[];
  if (await exists(template)) ({ rows, fields } = await readCsv(template));
  else {
    log(`ℹ️  ${template} not found → using eval/sample_questions.csv for every bill`);
    const qs = await sampleQuestions();
    rows = (await listBills(billsDir)).flatMap((id) => qs.map((q) => ({ bill_id: id, question_id: q.question_id, question: q.question, answer: "" })));
  }
  const byBill = new Map<string, Question[]>();
  for (const r of rows) {
    const id = r.bill_id.trim();
    if (only && id !== only) continue;
    if (!byBill.has(id)) byBill.set(id, []);
    byBill.get(id)!.push({ question_id: r.question_id, question: r.question });
  }
  log(`▶ Level 2: ${byBill.size} bill(s) · ${rows.length} question row(s)`);

  const limit = pLimit(config.concurrency);
  const answers = new Map<string, Record<string, string>>();
  await Promise.all(
    [...byBill.entries()].map(([id, qs]) =>
      limit(async () => {
        try {
          const file = await findBillImage(billsDir, id);
          const ex = extractions?.get(id) ?? (await extractBill(id, file, { force: false }));
          answers.set(id, await answerQuestions(id, file, ex, qs, { force }));
        } catch (e) {
          log(`❌ ${id}: ${(e as Error).message}`);
        }
      }),
    ),
  );

  let empty = 0;
  for (const r of rows) {
    const a = answers.get(r.bill_id.trim())?.[r.question_id];
    if (a) r.answer = a.replace(/\s*\n+\s*/g, " ").trim();
    if (!r.answer) empty++;
  }
  if (!only) {
    await writeCsv(path.join(outDir, "level2.csv"), fields, rows);
    log(`✅ wrote ${path.join(outDir, "level2.csv")} (${rows.length} rows${empty ? `, ${empty} EMPTY — re-run to fill` : ""})`);
  }
  return answers;
}

async function main() {
  const t0 = Date.now();
  if (cmd === "level1") await level1();
  else if (cmd === "level2") await level2();
  else if (cmd === "all") await level2(await level1());
  else if (cmd === "extract") {
    const file = positional[0];
    if (!file) throw new Error("Usage: npm run extract -- <bill image>");
    const id = path.basename(file, path.extname(file));
    const ex = await extractBill(id, file, { force });
    console.log(JSON.stringify(ex.level1, null, 2));
    if (ex.checks.length) console.log("\nWarnings:", ex.checks);
  } else if (cmd === "ask") {
    const [file, ...q] = positional;
    if (!file || !q.length) throw new Error('Usage: npm run ask -- <bill image> "your question"');
    const id = path.basename(file, path.extname(file));
    const ex = await extractBill(id, file);
    const question = q.join(" ");
    const res = await answerQuestions(`${id}__ask`, file, ex, [{ question_id: "Q", question }], { force: true });
    console.log(`\nQ: ${question}\nA: ${res.Q}\n`);
  } else {
    console.log("Commands: run-all | level1 | level2 | extract <image> | ask <image> <question>   (options: --data <dir> --out <dir> --force --only <id>)");
    return;
  }
  log(`⏱  finished in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((e) => {
  console.error(`\n❌ ${(e as Error).message}`);
  process.exit(1);
});
