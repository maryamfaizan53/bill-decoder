/** Display helpers shared by the UI (no Node APIs here). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function pkr(n: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-PK", { minimumFractionDigits: Number.isInteger(abs) ? 0 : 2, maximumFractionDigits: 2 });
  const sign = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
  return `${sign}PKR ${s}`;
}

export function num(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-PK", { maximumFractionDigits: digits });
}

export function dateLabel(iso: string | null | undefined): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "—";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function monthShort(ym: string | null | undefined): string {
  const m = ym?.match(/^(\d{4})-(\d{2})$/);
  return m ? MONTHS[Number(m[2]) - 1] : String(ym ?? "");
}

export function monthLong(ym: string | null | undefined): string {
  const m = ym?.match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONTHS_LONG[Number(m[2]) - 1]} ${m[1]}` : String(ym ?? "");
}

export function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export const CHARGE_NAMES: Record<string, string> = {
  energy: "Energy (units used)",
  fixed: "Fixed charges",
  fpa: "Fuel adjustment (FPA/FCA)",
  quarterly_adjustment: "Quarterly adjustment",
  surcharge: "Surcharge",
  meter_rent: "Meter rent",
  subsidy: "Subsidy",
  other: "Other charges",
};

export const TAX_NAMES: Record<string, string> = {
  gst: "Sales tax (GST)",
  electricity_duty: "Electricity duty",
  income_tax: "Income tax",
  municipal_tax: "Municipal tax",
  other_tax: "Other taxes",
};

export const PROVIDER_NAMES: Record<string, string> = { KE: "K-Electric", LESCO: "LESCO", IESCO: "IESCO" };
