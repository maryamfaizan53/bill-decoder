/**
 * npm run report -- --data test   → report/index.html
 * A visual page for the demo video: each bill image next to its Level 1 fields and Level 2 answers.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { readCsv } from "../lib/pipeline/csv";
import { findBillImage, listBills } from "../lib/pipeline/image";
import { readCache } from "../lib/pipeline/util";
import type { Extraction } from "../lib/pipeline/extract";

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const dataDir = flag("data", "test");
const billsDir = path.join(dataDir, "bills");
const outDir = flag("out", "output");

const esc = (s: unknown) => String(s ?? "—").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const answers = new Map<string, { q: string; a: string; id: string }[]>();
try {
  const { rows } = await readCsv(path.join(outDir, "level2.csv"));
  for (const r of rows) {
    if (!answers.has(r.bill_id)) answers.set(r.bill_id, []);
    answers.get(r.bill_id)!.push({ id: r.question_id, q: r.question, a: r.answer });
  }
} catch { /* level2 not run yet */ }

const sections: string[] = [];
for (const id of await listBills(billsDir)) {
  const ex = await readCache<Extraction>("extract", id);
  if (!ex) continue;
  const img = path.relative("report", await findBillImage(billsDir, id)).split(path.sep).join("/");
  const l = ex.level1 as unknown as Record<string, unknown>;
  const scalar = Object.entries(l).filter(([, v]) => !Array.isArray(v));
  const lines = (xs: { type: string; amount: number }[]) =>
    xs.length ? xs.map((x) => `<tr><td>${esc(x.type)}</td><td class="n">${x.amount.toLocaleString("en-PK")}</td></tr>`).join("") : `<tr><td colspan=2 class="muted">none itemised</td></tr>`;
  sections.push(`<section>
  <h2>${esc(id)} <span class="tag">${esc(l.provider)}</span> <span class="tag">${esc(l.bill_month)}</span></h2>
  <div class="grid">
    <a href="${img}" target="_blank"><img src="${img}" alt="${esc(id)}"></a>
    <div>
      <h3>Level 1 — extracted fields</h3>
      <table>${scalar.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${esc(v)}</td></tr>`).join("")}</table>
      <h3>Charges</h3><table>${lines(ex.level1.charges)}</table>
      <h3>Taxes</h3><table>${lines(ex.level1.taxes)}</table>
      ${ex.checks.length ? `<p class="warn">Checks: ${ex.checks.map(esc).join("; ")}</p>` : `<p class="ok">All consistency checks passed</p>`}
      <details><summary>Raw JSON</summary><pre>${esc(JSON.stringify(ex.level1, null, 2))}</pre></details>
    </div>
  </div>
  ${(answers.get(id) ?? []).length ? `<h3>Level 2 — answers</h3><dl>${answers.get(id)!.map((x) => `<dt>${esc(x.id)} · ${esc(x.q)}</dt><dd>${esc(x.a)}</dd>`).join("")}</dl>` : ""}
</section>`);
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bill Decoder Report</title><style>
:root{--bg:#f6f6f3;--panel:#fff;--ink:#1d1d1b;--muted:#6b6b66;--line:#e2e1dc;--accent:#0f766e}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--panel:#1d1d1b;--ink:#ecebe6;--muted:#9a9993;--line:#2f2f2c;--accent:#2dd4bf}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
header{padding:24px 16px;max-width:1200px;margin:auto}h1{margin:0;font-size:26px}header p{color:var(--muted);margin:4px 0 0}
section{max-width:1200px;margin:0 auto 24px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
h2{margin:0 0 12px;font-size:20px}h3{margin:16px 0 6px;font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.tag{font-size:12px;background:var(--accent);color:#fff;border-radius:999px;padding:2px 8px;vertical-align:middle}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}@media(max-width:800px){.grid{grid-template-columns:1fr}}
img{width:100%;border:1px solid var(--line);border-radius:8px}table{border-collapse:collapse;width:100%;font-size:14px}
td{border-bottom:1px solid var(--line);padding:4px 6px}td.n{text-align:right;font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}.warn{color:#b45309}.ok{color:var(--accent)}dt{font-weight:600;margin-top:10px}dd{margin:2px 0 0}
pre{overflow:auto;font-size:12px}
</style></head><body><header><h1>⚡ Utility Bill Decoder</h1><p>Bills in <code>${esc(billsDir)}</code> · extracted with a vision LLM, verified by code</p></header>
${sections.join("\n") || "<section>No extractions yet. Run npm run run-all first.</section>"}</body></html>`;

await fs.mkdir("report", { recursive: true });
await fs.writeFile("report/index.html", html);
console.log("✅ wrote report/index.html — open it in your browser");
