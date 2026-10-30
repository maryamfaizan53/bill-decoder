/**
 * npm run eval — score Level 1 output against hand-checked answers in eval/expected/*.json,
 * using the guide's rules: text/dates exact, numbers within ±1, lists compared item by item.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { readCache } from "../lib/pipeline/util";
import type { Extraction } from "../lib/pipeline/extract";

type Obj = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1;
  return a === b;
}

function listScore(exp: Obj[], got: Obj[]) {
  const left = [...got];
  let hit = 0;
  for (const e of exp) {
    const i = left.findIndex((g) => g.type === e.type && same(g.amount, e.amount));
    if (i >= 0) { hit++; left.splice(i, 1); }
  }
  return { hit, total: Math.max(exp.length, got.length) };
}

const files = (await fs.readdir("eval/expected")).filter((f) => f.endsWith(".json"));
let fieldHits = 0, fieldTotal = 0;
for (const f of files) {
  const id = path.basename(f, ".json");
  const exp = JSON.parse(await fs.readFile(path.join("eval/expected", f), "utf8")) as Obj;
  const got = (await readCache<Extraction>("extract", id))?.level1 as Obj | undefined;
  if (!got) { console.log(`– ${id}: no extraction yet (run: npm run level1 -- --bills samples)`); continue; }
  const misses: string[] = [];
  for (const [k, v] of Object.entries(exp)) {
    fieldTotal++;
    if (Array.isArray(v)) {
      const s = listScore(v as Obj[], (got[k] as Obj[]) ?? []);
      if (s.hit === s.total) fieldHits++;
      else misses.push(`${k}: expected ${JSON.stringify(v)} got ${JSON.stringify(got[k])}`);
    } else if (same(got[k], v)) fieldHits++;
    else misses.push(`${k}: expected ${JSON.stringify(v)} got ${JSON.stringify(got[k])}`);
  }
  console.log(`${misses.length ? "✗" : "✓"} ${id}: ${Object.keys(exp).length - misses.length}/${Object.keys(exp).length} fields`);
  misses.forEach((m) => console.log("    ", m));
}
if (fieldTotal) console.log(`\nOverall: ${fieldHits}/${fieldTotal} fields correct (${((fieldHits / fieldTotal) * 100).toFixed(1)}%)`);
