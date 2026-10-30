"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { rememberFile } from "@/lib/clientFiles";

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];

/** Drop, choose or paste (Ctrl+V) a bill image. Uploads it, then opens the bill page. */
export function Dropzone() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      setError(null);
      if (!ACCEPT.includes(file.type)) {
        setError("That file type isn't supported. Use a PNG, JPG or WebP image of the bill.");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError("That file is over 10 MB. Use a smaller photo or a screenshot.");
        return;
      }
      setBusy(true);
      try {
        const body = new FormData();
        body.append("bill", file);
        const res = await fetch("/api/upload", { method: "POST", body });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "The upload failed. Try again.");
        rememberFile(json.id, file);
        router.push(`/bill/${json.id}`);
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
      }
    },
    [router],
  );

  // Paste a screenshot from the clipboard anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => ACCEPT.includes(f.type));
      if (file) upload(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [upload]);

  return (
    <div>
      <div
        className="dropzone flex min-h-[15rem] flex-col items-center justify-center gap-4 px-6 py-10 text-center"
        data-over={over}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          upload(e.dataTransfer.files[0]);
        }}
      >
        <BillGlyph />
        <div>
          <p className="heading text-xl">{busy ? "Uploading the bill…" : "Drop a photo of your bill here"}</p>
          <p className="mt-1 text-muted">
            K-Electric, LESCO or IESCO. A phone photo, scan or screenshot works. You can also paste with Ctrl+V.
          </p>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : "Choose a bill image"}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT.join(",")}
          className="sr-only"
          aria-label="Bill image"
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </div>
      {error && (
        <p role="alert" className="mt-3 text-debit">
          {error}
        </p>
      )}
    </div>
  );
}

function BillGlyph() {
  return (
    <svg width="54" height="64" viewBox="0 0 54 64" aria-hidden="true" className="text-grid">
      <path d="M6 2h30l12 12v46a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="var(--grid-soft)" stroke="currentColor" strokeWidth="2.5" />
      <path d="M36 2v12h12" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <rect x="11" y="22" width="20" height="4" rx="2" fill="currentColor" />
      <rect x="11" y="31" width="30" height="3" rx="1.5" fill="currentColor" opacity=".45" />
      <rect x="11" y="38" width="26" height="3" rx="1.5" fill="currentColor" opacity=".45" />
      <rect x="11" y="47" width="30" height="9" rx="2.5" fill="var(--meter-glass)" />
      <rect x="31" y="49.5" width="7" height="4" rx="1" fill="var(--meter)" />
    </svg>
  );
}
