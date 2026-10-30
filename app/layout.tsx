import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bill Decoder",
  description: "Reads K-Electric, LESCO and IESCO electricity bills from a photo and explains every line in plain English.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Bill Decoder home">
            <Logo />
            <span className="heading text-lg">Bill Decoder</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm text-muted">
            <Link href="/#how" className="hover:text-ink">How it works</Link>
          </nav>
        </header>
        {children}
        <footer className="mx-auto max-w-6xl px-4 pb-10 pt-16 text-sm text-muted sm:px-6">
          Built for Women Tech Quest 2026, Build with AI track. Bills are read by claude-haiku-4-5, and every number in an answer is calculated in code.
        </footer>
      </body>
    </html>
  );
}

/** A meter window with a single lit digit: the product's mark. */
function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <rect x="1" y="1" width="28" height="28" rx="7" fill="var(--meter-glass)" />
      <rect x="6" y="9" width="5" height="12" rx="1.5" fill="var(--meter-dim)" />
      <rect x="12.5" y="9" width="5" height="12" rx="1.5" fill="var(--meter-dim)" />
      <rect x="19" y="9" width="5" height="12" rx="1.5" fill="var(--meter)" />
    </svg>
  );
}
