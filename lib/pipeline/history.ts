/**
 * Focused usage-history reader (used by Level 2).
 *
 * Why: history questions ("months above 200 units", "average consumption") depend on reading
 * many small numbers. On K-Electric bills they are written VERTICALLY inside bar-chart bars,
 * which the full-page read gets wrong. So we:
 *   1. crop the history area and upscale it (KE: also a copy rotated 90° so the digits are horizontal),
 *   2. read it 3 times and take the majority value per month,
 *   3. for KE, assign YYYY-MM in code by counting back from the bill month (13 bars, last = current).
 */
import fs from "node:fs/promises";
import sharp, { type Sharp } from "sharp";
import { generateText } from "ai";
import { getModel } from "./config";
import { parseJsonObject, toMonth, toNumber } from "./normalize";
import { log, readCache, withRetry, writeCache } from "./util";

export type HistoryRow = { month: string; units: number | null; bill: number | null; payment: number | null; is_current: boolean };

const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

async function crops(file: string, provider: string | null) {
  const { data, info } = await sharp(await fs.readFile(file)).rotate().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const enc = (img: Sharp) => img.resize({ width: 1568, height: 1568, fit: "inside" }).normalise().sharpen({ sigma: 0.6 }).jpeg({ quality: 90 }).toBuffer();
  if (provider === "KE") {
    // "13 Month Usage History" box: left half, ~40%-56% of page height.
    const box = { left: 0, top: Math.round(H * 0.4), width: Math.round(W * 0.52), height: Math.round(H * 0.16) };
    const crop = sharp(data).extract(box);
    const cropBuf = await crop.toBuffer();
    return [
      { label: "Zoom: 13 Month Usage History chart", data: await enc(sharp(cropBuf)) },
      { label: "Same chart rotated 90° clockwise: digits now read horizontally; oldest month at the TOP, current month at the BOTTOM", data: await enc(sharp(cropBuf).rotate(90)) },
    ];
  }
  // LESCO / IESCO: BILL HISTORY table is in the lower half.
  const top = Math.round(H * 0.5);
  return [{ label: "Zoom: lower half of the bill with the BILL HISTORY table", data: await enc(sharp(data).extract({ left: 0, top, width: W, height: H - top })) }];
}

const PROMPT_KE = `This is the "13 Month Usage History" bar chart of a K-Electric bill (two views of the same chart).
There are 13 bars, oldest on the LEFT, newest (current month, usually the dark/black bar) on the RIGHT.
Each bar has the units number written vertically inside it, and the month abbreviation (Jun, Jul, ...) printed under it.
Read every bar carefully digit by digit (use the rotated view for the digits).
Return ONLY JSON: {"bars":[{"month_label":"Jun","units":943}, ... 13 items, left to right]}`;

const PROMPT_TABLE = `This is the BILL HISTORY table of a LESCO/IESCO electricity bill. It usually has TWO column groups side by side
(left: older months, right: newer months), each with MONTH, STATUS, UNITS, BILL (RS.), PAYMENT (RS.).
Read EVERY row of BOTH groups. Keep negative signs (net metering). Use null for blank cells.
In photos the numbers are often printed slightly ABOVE their row or overlapping the header line: assign each number to the nearest
month row in order. Units are whole numbers (e.g. 225, -809, -1955); bills are amounts (e.g. -21,364). Do not leave a cell null
if any number is printed for it.
Return ONLY JSON: {"rows":[{"month":"as printed, e.g. AUG 25","units":440,"bill":52906,"payment":52906}, ...]} oldest first.`;

function mode(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  if (!v.length) return null;
  const counts = new Map<number, number>();
  for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best[1] > 1 || v.length === 1) return best[0];
  const s = [...v].sort((a, b) => a - b); // all different: take the median read
  return s[Math.floor(s.length / 2)];
}

export async function readHistory(billId: string, file: string, provider: string | null, billMonth: string | null, opts: { force?: boolean } = {}): Promise<HistoryRow[] | null> {
  if (!opts.force) {
    const c = await readCache<HistoryRow[]>("history", billId);
    if (c) return c;
  }
  try {
    const imgs = await crops(file, provider);
    const content = [
      ...imgs.flatMap((i) => [{ type: "text" as const, text: `[${i.label}]` }, { type: "file" as const, data: i.data, mediaType: "image/jpeg" }]),
      { type: "text" as const, text: provider === "KE" ? PROMPT_KE : PROMPT_TABLE },
    ];
    const reads = await Promise.allSettled(
      [0, 0.3, 0.3].map((temperature, i) =>
        withRetry(
          async () => parseJsonObject((await generateText({ model: getModel(), messages: [{ role: "user", content }], temperature, maxOutputTokens: 2000, maxRetries: 3 })).text),
          `${billId} history read ${i + 1}`,
        ),
      ),
    );
    const ok = reads.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!ok.length) return null;

    let rows: HistoryRow[] = [];
    if (provider === "KE") {
      const bars = ok.map((o) => (Array.isArray(o.bars) ? (o.bars as { month_label?: string; units?: unknown }[]) : []));
      const n = mode(bars.map((b) => b.length)) ?? 13;
      const good = bars.filter((b) => b.length === n);
      for (let i = 0; i < n; i++) {
        const units = mode(good.map((b) => toNumber(b[i]?.units)));
        const label = String(good[0]?.[i]?.month_label ?? "").slice(0, 3).toLowerCase();
        let month = billMonth ? shiftMonth(billMonth, i - (n - 1)) : "";
        // sanity check: printed month label should match the counted month
        if (month && label && MON.indexOf(label) >= 0 && MON[Number(month.slice(5)) - 1] !== label) {
          log(`⚠️  ${billId}: history label "${label}" does not match counted month ${month}`);
        }
        if (!month) month = label;
        rows.push({ month, units, bill: null, payment: null, is_current: i === n - 1 });
      }
    } else {
      const byMonth = new Map<string, { units: (number | null)[]; bill: (number | null)[]; payment: (number | null)[] }>();
      for (const o of ok) {
        for (const r of (Array.isArray(o.rows) ? o.rows : []) as Record<string, unknown>[]) {
          const m = toMonth(r.month);
          if (!m) continue;
          if (!byMonth.has(m)) byMonth.set(m, { units: [], bill: [], payment: [] });
          const e = byMonth.get(m)!;
          e.units.push(toNumber(r.units));
          e.bill.push(toNumber(r.bill));
          e.payment.push(toNumber(r.payment));
        }
      }
      rows = [...byMonth.entries()]
        .filter(([, e]) => e.units.length >= Math.min(2, ok.length)) // seen in most reads
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, e]) => ({ month, units: mode(e.units), bill: mode(e.bill), payment: mode(e.payment), is_current: month === billMonth }));
    }
    await writeCache("history", billId, rows);
    log(`📊 ${billId}: history ${rows.map((r) => `${r.month}:${r.units}`).join(" ")}`);
    return rows;
  } catch (e) {
    log(`⚠️  ${billId}: history read failed (${(e as Error).message}); using main extraction`);
    return null;
  }
}
