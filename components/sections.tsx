/** Presentational sections of the decoded bill. Pure functions of the decode result. */
import type { Level1 } from "@/lib/pipeline/extract";
import { CHARGE_NAMES, TAX_NAMES, dateLabel, daysBetween, num, pkr } from "@/lib/format";

export function SectionTitle({ en, ur, id }: { en: string; ur: string; id?: string }) {
  return (
    <div className="section-title">
      <h2 id={id} className="heading text-xl">{en}</h2>
      <span className="urdu text-muted" lang="ur">{ur}</span>
    </div>
  );
}

/* ---------------- Key dates ---------------- */
export function Timeline({ l }: { l: Level1 }) {
  const points = [
    { key: "reading", label: "Meter read", date: l.reading_date },
    { key: "issue", label: "Bill issued", date: l.issue_date },
    { key: "due", label: "Pay by", date: l.due_date },
  ].filter((p) => p.date);
  if (!points.length) return <p className="text-muted">The bill's dates could not be read.</p>;
  const toDue = daysBetween(l.issue_date, l.due_date);

  return (
    <div>
      {/* Dots are evenly spaced; the gap between two dates is written on the line between them. */}
      <ol className="grid" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
        {points.map((p, i) => {
          const gap = i > 0 ? daysBetween(points[i - 1].date, p.date) : null;
          const last = i === points.length - 1;
          return (
            <li key={p.key} className="relative">
              <div className="relative flex h-8 items-center">
                {!last && <span className="absolute left-3 right-0 top-1/2 h-[3px] -translate-y-1/2 bg-grid" aria-hidden="true" />}
                {i > 0 && <span className="absolute left-0 right-[calc(100%-0.75rem)] top-1/2 h-[3px] -translate-y-1/2 bg-grid" aria-hidden="true" />}
                <span className={`relative z-10 block h-[0.95rem] w-[0.95rem] rounded-full border-[3px] ${p.key === "due" ? "border-ink bg-ink" : "border-grid bg-paper"}`} />
                {!last && (
                  <span className="num absolute left-1/2 top-[-0.35rem] z-10 -translate-x-1/2 whitespace-nowrap bg-paper px-1.5 text-xs text-muted">
                    {daysBetween(p.date, points[i + 1].date)} days
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted">{p.label}</p>
              <p className={`num ${p.key === "due" ? "font-bold" : "font-semibold"}`}>{dateLabel(p.date)}</p>
              {gap !== null && <span className="sr-only">{gap} days after the previous date</span>}
            </li>
          );
        })}
      </ol>
      {toDue !== null && (
        <p className="mt-4 text-muted">
          You have <span className="font-semibold text-ink">{toDue} days</span> from the issue date to pay without a late surcharge.
        </p>
      )}
    </div>
  );
}

/* ---------------- Where the money goes ---------------- */
type LineDetail = { label?: string; section?: string; amount?: unknown; units?: unknown; rate?: unknown };
const SEGMENT_COLORS = ["#0e6e6a", "#2f8f86", "#5aaea3", "#86c6bb", "#b3dcd2", "#d7ece6", "#3d6f86", "#6d98ab"];

export function MoneyBreakdown({ l, extra, facts }: { l: Level1; extra: Record<string, unknown>; facts: Record<string, unknown> }) {
  const byType = new Map<string, number>();
  for (const c of l.charges) byType.set(c.type, (byType.get(c.type) ?? 0) + c.amount);
  const positives = [...byType.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const deductions = [...byType.entries()].filter(([, v]) => v < 0);
  const taxTotal = l.total_taxes ?? l.taxes.reduce((s, t) => s + t.amount, 0);
  const segments = [
    ...positives.map(([type, v], i) => ({ key: type, name: CHARGE_NAMES[type] ?? type, value: v, color: SEGMENT_COLORS[i % SEGMENT_COLORS.length] })),
    ...(taxTotal > 0 ? [{ key: "taxes", name: "Taxes and duties", value: taxTotal, color: "var(--ink)" }] : []),
  ];
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const details = (Array.isArray(extra.line_details) ? (extra.line_details as LineDetail[]) : []).filter(
    (d) => (d.section === "charges" || d.section === "taxes") && typeof d.amount === "number" && !/^(net |total )?electricity charges$|^net electricity|^taxes$/i.test(d.label ?? ""),
  );

  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded-[4px]" role="img" aria-label={segments.map((s) => `${s.name} ${pkr(s.value)}`).join(", ")}>
        {segments.map((s) => (
          <div key={s.key} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.name}: ${pkr(s.value)}`} />
        ))}
      </div>
      <ul className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {segments.map((s) => (
          <li key={s.key} className="flex items-baseline justify-between gap-3 border-b border-dashed border-rule pb-1.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 flex-none rounded-sm" style={{ background: s.color }} />
              {s.name}
            </span>
            <span className="num whitespace-nowrap font-semibold">{pkr(s.value)}</span>
          </li>
        ))}
        {deductions.map(([type, v]) => (
          <li key={type} className="flex items-baseline justify-between gap-3 border-b border-dashed border-rule pb-1.5 text-credit">
            <span>{CHARGE_NAMES[type] ?? type} (deducted)</span>
            <span className="num whitespace-nowrap font-semibold">{pkr(v)}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-rule pt-4 text-sm sm:text-base">
        <Stat label="Charges" value={pkr(l.total_charges)} />
        <Stat label="Taxes" value={pkr(l.total_taxes)} />
        <Stat label="This month's bill" value={pkr(l.current_bill)} strong />
      </dl>

      <ul className="mt-4 space-y-1 text-muted">
        {typeof facts.taxes_pct_of_current_bill === "number" && (
          <li>Taxes are <span className="num font-semibold text-ink">{num(facts.taxes_pct_of_current_bill as number)}%</span> of this month's bill.</li>
        )}
        {typeof facts.average_cost_per_unit_current_bill === "number" && (
          <li>
            Each unit cost you <span className="num font-semibold text-ink">{pkr(facts.average_cost_per_unit_current_bill as number)}</span> on average, taxes included.
          </li>
        )}
      </ul>

      {details.length > 0 && (
        <details className="mt-4 group">
          <summary className="cursor-pointer font-semibold text-grid">Every line as printed on the bill</summary>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 font-medium">Line</th>
                <th className="py-1 text-right font-medium">Units</th>
                <th className="py-1 text-right font-medium">Rate</th>
                <th className="py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="num">
              {details.map((d, i) => (
                <tr key={i} className="border-t border-rule">
                  <td className="py-1.5 pr-2">
                    {d.label}
                    {d.section === "taxes" && <span className="ml-2 text-muted">tax</span>}
                  </td>
                  <td className="py-1.5 text-right">{typeof d.units === "number" ? num(d.units) : ""}</td>
                  <td className="py-1.5 text-right">{typeof d.rate === "number" ? num(d.rate, 4) : ""}</td>
                  <td className="py-1.5 text-right font-semibold">{pkr(d.amount as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {l.taxes.length > 0 && details.length === 0 && (
        <ul className="mt-3 text-sm text-muted">
          {l.taxes.map((t, i) => (
            <li key={i}>{TAX_NAMES[t.type] ?? t.type}: <span className="num">{pkr(t.amount)}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className={`num mt-0.5 ${strong ? "text-lg font-bold" : "font-semibold"}`}>{value}</dd>
    </div>
  );
}

/* ---------------- Checks ---------------- */
type Check = { title: string; state: "ok" | "differs" | "na"; detail: string };

export function buildChecks(l: Level1): Check[] {
  const near = (a: number, b: number, tol = 1.5) => Math.abs(a - b) <= tol;
  const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  const fpa = sum(l.charges.filter((c) => c.type === "fpa"));
  const out: Check[] = [];

  if (l.charges.length && l.total_charges !== null) {
    const s = sum(l.charges);
    const ok = near(s, l.total_charges) || near(s - fpa, l.total_charges);
    out.push({ title: "Charge lines add up to the charges subtotal", state: ok ? "ok" : "differs", detail: `${pkr(s)} in lines, ${pkr(l.total_charges)} printed${!near(s, l.total_charges) && ok ? " (fuel adjustment is listed outside the subtotal on this bill)" : ""}` });
  } else out.push({ title: "Charge lines add up to the charges subtotal", state: "na", detail: "No subtotal printed" });

  if (l.taxes.length && l.total_taxes !== null) {
    const s = sum(l.taxes);
    out.push({ title: "Tax lines add up to the tax subtotal", state: near(s, l.total_taxes) ? "ok" : "differs", detail: `${pkr(s)} in lines, ${pkr(l.total_taxes)} printed` });
  } else out.push({ title: "Tax lines add up to the tax subtotal", state: "na", detail: l.total_taxes !== null ? "This bill prints one combined tax amount" : "No tax subtotal printed" });

  if (l.total_charges !== null && l.total_taxes !== null && l.current_bill !== null) {
    const s = l.total_charges + l.total_taxes;
    const ok = near(s, l.current_bill, 2) || near(s + fpa, l.current_bill, 2);
    out.push({ title: "Charges plus taxes equal this month's bill", state: ok ? "ok" : "differs", detail: `${pkr(Math.round(s * 100) / 100)} vs ${pkr(l.current_bill)} printed` });
  }

  if (l.current_bill !== null && l.arrears !== null && l.payable_within_due_date !== null) {
    const s = l.current_bill + l.arrears;
    const ok = near(s, l.payable_within_due_date, 2) || near(s + fpa, l.payable_within_due_date, 2);
    out.push({ title: "This month's bill plus previous dues equals the amount payable", state: ok ? "ok" : "differs", detail: `${pkr(Math.round(s * 100) / 100)} vs ${pkr(l.payable_within_due_date)} printed` });
  }

  if (l.previous_reading !== null && l.current_reading !== null && l.units_consumed !== null) {
    const d = Math.round((l.current_reading - l.previous_reading) * 100) / 100;
    out.push({ title: "Meter readings match the units billed", state: near(d, l.units_consumed, 1.5) ? "ok" : "differs", detail: `${num(l.current_reading)} − ${num(l.previous_reading)} = ${num(d)} units, ${num(l.units_consumed)} billed` });
  } else if (l.units_consumed !== null) {
    out.push({ title: "Meter readings match the units billed", state: "na", detail: "Several meter registers on this bill, so there is no single reading pair" });
  }
  return out;
}

export function Checks({ l, runs }: { l: Level1; runs: number }) {
  const checks = buildChecks(l);
  const passed = checks.filter((c) => c.state === "ok").length;
  const applicable = checks.filter((c) => c.state !== "na").length;
  return (
    <div>
      <p className="mb-3 text-muted">
        Read {runs} {runs === 1 ? "time" : "times"} and combined field by field. {passed} of {applicable} sums on this bill agree with each other.
      </p>
      <ul className="space-y-2.5">
        {checks.map((c) => (
          <li key={c.title} className="flex gap-3">
            <CheckIcon state={c.state} />
            <div>
              <p className="font-semibold leading-snug">{c.title}</p>
              <p className="num text-sm text-muted">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckIcon({ state }: { state: Check["state"] }) {
  const label = state === "ok" ? "Agrees" : state === "differs" ? "Differs" : "Not applicable";
  if (state === "ok")
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" className="mt-0.5 flex-none text-credit" role="img" aria-label={label}>
        <circle cx="11" cy="11" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M6.5 11.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (state === "differs")
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" className="mt-0.5 flex-none text-debit" role="img" aria-label={label}>
        <circle cx="11" cy="11" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M11 6v6.5M11 15.5v.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" className="mt-0.5 flex-none text-muted" role="img" aria-label={label}>
      <circle cx="11" cy="11" r="10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
      <path d="M7 11h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
