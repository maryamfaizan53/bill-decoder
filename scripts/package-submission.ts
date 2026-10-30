/**
 * npm run package — builds submission.zip exactly as the guide asks:
 *   output/level1.csv, output/level2.csv, source/<project code + README + .env.example>, demo/demo.(mp4|mov|webm) if present.
 * Never includes .env, node_modules, cache or bill images.
 */
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import Papa from "papaparse";

const zip = new AdmZip();
const fail = (m: string) => { console.error("❌ " + m); process.exit(1); };

for (const f of ["level1.csv", "level2.csv"]) {
  const p = path.join("output", f);
  if (!fs.existsSync(p)) fail(`${p} missing — run: npm run run-all -- --data test`);
  const rows = Papa.parse<Record<string, string>>(fs.readFileSync(p, "utf8"), { header: true, skipEmptyLines: true }).data;
  const col = f === "level1.csv" ? "json" : "answer";
  const empty = rows.filter((r) => !r[col]?.trim()).length;
  if (empty) fail(`${p} has ${empty} empty "${col}" cell(s) — re-run the pipeline (cached bills are skipped) before packaging.`);
  if (f === "level1.csv") rows.forEach((r) => { try { JSON.parse(r.json); } catch { fail(`${p}: invalid JSON for ${r.bill_id}`); } });
  console.log(`✓ ${p}: ${rows.length} rows, none empty`);
  zip.addLocalFile(p, "output");
}

const SOURCE = ["app", "components", "lib", "scripts", "eval", "samples", "package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "README.md", ".env.example", ".gitignore"];
for (const item of SOURCE) {
  if (!fs.existsSync(item)) continue;
  if (fs.statSync(item).isDirectory()) zip.addLocalFolder(item, `source/${item}`);
  else zip.addLocalFile(item, "source");
}
const envEx = fs.readFileSync(".env.example", "utf8");
if (/sk-ant-|AIza|sk-proj-/.test(envEx)) fail(".env.example seems to contain a real key!");

for (const ext of ["mp4", "mov", "webm"]) {
  const p = path.join("demo", `demo.${ext}`);
  if (fs.existsSync(p)) { zip.addLocalFile(p, "demo"); console.log(`✓ demo/demo.${ext} included`); }
}

zip.writeZip("submission.zip");
const mb = fs.statSync("submission.zip").size / 1024 / 1024;
console.log(`\n📦 submission.zip — ${mb.toFixed(2)} MB ${mb > 15 ? "❌ OVER 15 MB (shorten/compress the demo)" : "✓ under 15 MB"}`);
console.log(zip.getEntries().map((e) => "   " + e.entryName).filter((n) => !n.includes("/src/") && !n.includes("/eval/")).join("\n"));
console.log("   (+ source/src/*, source/eval/*)");
const all = zip.getEntries().map((e) => e.entryName);
if (all.some((n) => /(^|\/)\.env$/.test(n))) fail("a real .env got into the zip!");
