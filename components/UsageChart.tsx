"use client";

import { useState } from "react";
import type { HistoryRow } from "@/lib/pipeline/history";
import { monthLong, monthShort, num, pkr } from "@/lib/format";

/**
 * Units per month from the bill's own history table/chart. The current month is the
 * lit (amber) bar; net-metering months with negative units hang below the baseline.
 */
export function UsageChart({ rows, currentMonth, currentUnits }: { rows: HistoryRow[]; currentMonth: string | null; currentUnits: number | null }) {
  const data = rows
    .filter((r) => r.units !== null && /^\d{4}-\d{2}$/.test(r.month))
    .map((r) => ({ ...r, current: r.is_current || r.month === currentMonth }));
  if (currentMonth && currentUnits !== null && !data.some((d) => d.current))
    data.push({ month: currentMonth, units: currentUnits, bill: null, payment: null, is_current: true, current: true });
  const [focus, setFocus] = useState<number | null>(null);
  if (data.length < 2) return <p className="text-muted">This bill doesn't print a usage history.</p>;

  const values = data.map((d) => d.units as number);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const W = 640, H = 220, padTop = 26, padBottom = 34;
  const plotH = H - padTop - padBottom;
  const zeroY = padTop + (max / range) * plotH;
  const slot = W / data.length;
  const barW = Math.min(34, slot * 0.62);
  const shown = focus ?? data.findIndex((d) => d.current);
  const sel = data[shown];

  return (
    <div>
      <div className="mb-2 flex min-h-[2.75rem] flex-wrap items-baseline gap-x-3" aria-live="polite">
        {sel && (
          <>
            <span className="heading text-lg">{monthLong(sel.month)}</span>
            <span className="num text-lg font-semibold">{num(sel.units)} units</span>
            {sel.bill !== null && <span className="num text-muted">billed {pkr(sel.bill)}</span>}
            {sel.payment !== null && sel.bill !== null && <span className="num text-muted">paid {pkr(sel.payment)}</span>}
            {sel.current && <span className="text-muted">this bill</span>}
          </>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="group" aria-label="Units used per month" onMouseLeave={() => setFocus(null)}>
        <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="var(--rule)" strokeWidth="1.5" />
        {data.map((d, i) => {
          const v = d.units as number;
          const h = (Math.abs(v) / range) * plotH;
          const x = i * slot + (slot - barW) / 2;
          const y = v >= 0 ? zeroY - h : zeroY;
          const active = i === shown;
          const showYear = i === 0 || d.month.endsWith("-01");
          return (
            <g
              key={d.month}
              tabIndex={0}
              role="img"
              aria-label={`${monthLong(d.month)}: ${num(v)} units${d.current ? ", this bill" : ""}`}
              onMouseEnter={() => setFocus(i)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
              className="cursor-default outline-none"
            >
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 1.5)}
                rx="3"
                fill={d.current ? "var(--meter)" : v < 0 ? "var(--credit)" : "var(--grid)"}
                opacity={d.current || active ? 1 : 0.55}
                stroke={active ? "var(--ink)" : "none"}
                strokeWidth="1.5"
              />
              {(d.current || active) && (
                <text x={x + barW / 2} y={v >= 0 ? y - 7 : y + h + 15} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--ink)" className="num">
                  {num(v)}
                </text>
              )}
              <text x={i * slot + slot / 2} y={H - 16} textAnchor="middle" fontSize="12" fill="var(--muted)">
                {monthShort(d.month)}
              </text>
              {showYear && (
                <text x={i * slot + slot / 2} y={H - 2} textAnchor="middle" fontSize="11" fill="var(--muted)" fontWeight="600">
                  {d.month.slice(0, 4)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
