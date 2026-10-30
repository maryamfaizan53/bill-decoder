"use client";

import { useEffect, useState } from "react";

/**
 * Amount shown as an electricity-meter readout: each digit is a reel that rolls
 * from 0 to its value once, when the result first appears.
 */
export function Meter({ value, label }: { value: number; label: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const whole = Math.round(Math.abs(value));
  const chars = whole.toLocaleString("en-PK").split("");
  const minDigits = 5;
  const digitCount = chars.filter((c) => /\d/.test(c)).length;
  const ghosts = Math.max(0, minDigits - digitCount);

  return (
    <div className="meter px-5 py-4 sm:px-7 sm:py-5" role="img" aria-label={label}>
      <div className="flex items-end gap-3">
        <span className="pb-1 text-sm font-semibold opacity-80 sm:text-base">PKR</span>
        <span className="meter-digits text-[3.4rem] sm:text-[4.6rem]" aria-hidden="true">
          {Array.from({ length: ghosts }, (_, i) => (
            <span key={`g${i}`} className="meter-ghost">0</span>
          ))}
          {chars.map((c, i) =>
            /\d/.test(c) ? (
              <span key={i} className="meter-cell">
                <span className="meter-reel" style={{ transform: `translateY(-${ready ? Number(c) : 0}em)` , transitionDelay: `${i * 70}ms` }}>
                  {Array.from({ length: 10 }, (_, d) => (
                    <span key={d}>{d}</span>
                  ))}
                </span>
              </span>
            ) : (
              <span key={i} className="opacity-60">{c}</span>
            ),
          )}
        </span>
        {value < 0 && <span className="pb-1 text-lg font-bold">CR</span>}
      </div>
    </div>
  );
}
