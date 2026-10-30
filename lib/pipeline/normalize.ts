/**
 * Deterministic clean-up of model output. The model reads the bill; code enforces formats.
 */

/** "Rs. 19,964" -> 19964, "38209CR" -> -38209, "(1,442.74)" -> -1442.74, "" -> null */
export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s || /^(null|n\/a|na|-|—|none|blank)$/i.test(s)) return null;
  let neg = false;
  if (/\bCR\b|CR$/i.test(s)) { neg = true; s = s.replace(/CR/gi, ""); }
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/rs\.?|pkr|kwh|kw|units?/gi, "").replace(/[,\s]/g, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  const m = s.match(/^\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return neg ? -n : n;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function year(y: string): number {
  const n = Number(y);
  return y.length <= 2 ? 2000 + n : n;
}
const pad = (n: number) => String(n).padStart(2, "0");

/** Accepts ISO, "21st Apr 2026", "08 OCT 26", "21-Apr-2026", "21/04/2026", "03/08/26". Returns YYYY-MM-DD or null. */
export function toDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  if (!s || s === "null") return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[\s\-/.]+([a-z]{3,})[\s\-/.,]+(\d{2,4})$/);
  if (m && MONTHS[m[2].slice(0, 3)]) return `${year(m[3])}-${pad(MONTHS[m[2].slice(0, 3)])}-${pad(+m[1])}`;
  m = s.match(/^([a-z]{3,})[\s\-/.]+(\d{1,2}),?[\s\-/.]+(\d{2,4})$/);
  if (m && MONTHS[m[1].slice(0, 3)]) return `${year(m[3])}-${pad(MONTHS[m[1].slice(0, 3)])}-${pad(+m[2])}`;
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/); // Pakistani bills are day-first
  if (m) return `${year(m[3])}-${pad(+m[2])}-${pad(+m[1])}`;
  return null;
}

/** "Apr-26", "APR 2026", "2026-04", "04/2026" -> "2026-04" */
export function toMonth(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || s === "null") return null;
  let m = s.match(/^(\d{4})-(\d{1,2})(-\d{1,2})?$/);
  if (m) return `${m[1]}-${pad(+m[2])}`;
  m = s.match(/^([a-z]{3,})[\s\-/.,']+(\d{2,4})$/);
  if (m && MONTHS[m[1].slice(0, 3)]) return `${year(m[2])}-${pad(MONTHS[m[1].slice(0, 3)])}`;
  m = s.match(/^(\d{1,2})[/\-.](\d{2,4})$/);
  if (m) return `${year(m[2])}-${pad(+m[1])}`;
  return null;
}

export function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== "null" ? s : null;
}

export const CHARGE_TYPES = ["energy", "fixed", "fpa", "quarterly_adjustment", "surcharge", "meter_rent", "subsidy", "other"] as const;
export const TAX_TYPES = ["gst", "electricity_duty", "income_tax", "municipal_tax", "other_tax"] as const;

export function chargeType(t: unknown): (typeof CHARGE_TYPES)[number] {
  const s = String(t ?? "").toLowerCase().trim();
  return (CHARGE_TYPES as readonly string[]).includes(s) ? (s as never) : "other";
}
export function taxType(t: unknown): (typeof TAX_TYPES)[number] {
  const s = String(t ?? "").toLowerCase().trim();
  return (TAX_TYPES as readonly string[]).includes(s) ? (s as never) : "other_tax";
}

export function providerFromId(billId: string): "KE" | "LESCO" | "IESCO" | null {
  const u = billId.toUpperCase();
  if (u.startsWith("KESC") || u.startsWith("KE")) return "KE";
  if (u.startsWith("LESCO")) return "LESCO";
  if (u.startsWith("IESCO")) return "IESCO";
  return null;
}

/** Pull the first {...} JSON object out of a model reply (handles ```json fences and chatter). */
export function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model reply");
  return JSON.parse(cleaned.slice(start, end + 1));
}
