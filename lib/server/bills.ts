/**
 * Server-side glue between the web app and the pipeline in lib/pipeline.
 * Bills are identified by a short id: sample bills use their file name (KESC_0008),
 * uploads use a content hash (bill_3f9a…) so the same photo is never decoded twice.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { answerQuestions, computeFacts, mergeHistory } from "@/lib/pipeline/answer";
import { config, isModelConfigured } from "@/lib/pipeline/config";
import { extractBill, type Extraction, type ProgressEvent } from "@/lib/pipeline/extract";
import { readHistory, type HistoryRow } from "@/lib/pipeline/history";
import { readCache } from "@/lib/pipeline/util";

const ROOT = /* turbopackIgnore: true */ process.cwd();
const SAMPLES_DIR = path.join(ROOT, "samples");
const SNAPSHOT_DIR = path.join(SAMPLES_DIR, "snapshots");
// Serverless hosts (Vercel) only allow writes under /tmp; elsewhere uploads live in .data/uploads.
const UPLOAD_DIR = process.env.UPLOAD_DIR || (process.env.VERCEL ? "/tmp/bill-decoder/uploads" : path.join(ROOT, ".data", "uploads"));
const EXTS = [".png", ".jpg", ".jpeg", ".webp"];
const ID_RE = /^[A-Za-z0-9_-]{3,64}$/;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type BillSource = "sample" | "upload";
export type Sample = { id: string; title: string };
export type Snapshot = { bill_id: string; title: string; extraction: Extraction; answers: Record<string, string> };

export type DecodeResult = {
  id: string;
  title: string;
  source: BillSource;
  mode: "live" | "saved";
  model: string | null;
  extraction: Extraction;
  history: HistoryRow[] | null;
  facts: Record<string, unknown>;
  savedQuestions: string[];
};

export class UserFacingError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const PROVIDER_NAMES: Record<string, string> = { KE: "K-Electric", LESCO: "LESCO", IESCO: "IESCO" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function titleFor(level1: Extraction["level1"]): string {
  const who = (level1.provider && PROVIDER_NAMES[level1.provider]) || "Electricity bill";
  const m = level1.bill_month?.match(/^(\d{4})-(\d{2})$/);
  return m ? `${who}, ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : who;
}

export function validId(id: string) {
  if (!ID_RE.test(id)) throw new UserFacingError("That bill link is not valid.", 404);
  return id;
}

async function exists(p: string) {
  return fs.access(p).then(() => true, () => false);
}

/** Finds the image for a bill id, in the samples folder or the uploads folder. */
export async function findImage(id: string): Promise<{ file: string; source: BillSource } | null> {
  validId(id);
  for (const [dir, source] of [[SAMPLES_DIR, "sample"], [UPLOAD_DIR, "upload"]] as const) {
    for (const ext of EXTS) {
      const file = path.join(/* turbopackIgnore: true */ dir, id + ext);
      if (await exists(file)) return { file, source };
    }
  }
  return null;
}

export async function readSnapshot(id: string): Promise<Snapshot | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(SNAPSHOT_DIR, `${validId(id)}.json`), "utf8")) as Snapshot;
  } catch {
    return null;
  }
}

export async function listSamples(): Promise<Sample[]> {
  const files = (await fs.readdir(SAMPLES_DIR)).filter((f) => EXTS.includes(path.extname(f).toLowerCase())).sort();
  return Promise.all(
    files.map(async (f) => {
      const id = path.basename(f, path.extname(f));
      return { id, title: (await readSnapshot(id))?.title ?? id };
    }),
  );
}

/** Stores an uploaded bill image after checking it really is an image. Returns its id. */
export async function saveUpload(buf: Buffer): Promise<string> {
  if (buf.length > MAX_UPLOAD_BYTES) throw new UserFacingError("That file is over 10 MB. Use a smaller photo or a screenshot.", 413);
  let format: string | undefined;
  try {
    format = (await sharp(buf).metadata()).format;
  } catch {
    throw new UserFacingError("That file is not an image. Upload a PNG, JPG or WebP photo of the bill.", 415);
  }
  const ext = format === "jpeg" ? ".jpg" : format === "png" ? ".png" : format === "webp" ? ".webp" : null;
  if (!ext) throw new UserFacingError("Only PNG, JPG and WebP images are supported.", 415);
  const id = `bill_${crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12)}`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const file = path.join(UPLOAD_DIR, id + ext);
  if (!(await exists(file))) await fs.writeFile(file, buf);
  return id;
}

/** Runs the full Level 1 pipeline (or loads the saved result for a sample when no API key is set). */
export async function decodeBill(id: string, onProgress?: (e: ProgressEvent) => void): Promise<DecodeResult> {
  const found = await findImage(id);
  if (!found) throw new UserFacingError("This bill could not be found. Upload it again.", 404);

  if (!isModelConfigured()) {
    const snap = found.source === "sample" ? await readSnapshot(id) : null;
    if (!snap)
      throw new UserFacingError("No API key is set, so only the sample bills can be shown. Add API_KEY to .env and restart the app to decode your own bills.", 503);
    const history = mergeHistory(null, snap.extraction.extra.usage_history, snap.extraction.level1.bill_month);
    return {
      id, title: snap.title, source: "sample", mode: "saved", model: null,
      extraction: snap.extraction, history, facts: computeFacts(snap.extraction, history),
      savedQuestions: Object.keys(snap.answers),
    };
  }

  const extraction = await extractBill(id, found.file, { onProgress });
  onProgress?.({ step: "history", status: "start" });
  const focused = await readHistory(id, found.file, extraction.level1.provider, extraction.level1.bill_month);
  const history = mergeHistory(focused, extraction.extra.usage_history, extraction.level1.bill_month);
  onProgress?.({ step: "history", status: "done", detail: history ? `${history.length} months` : "not printed" });
  onProgress?.({ step: "done", status: "done" });
  const snap = found.source === "sample" ? await readSnapshot(id) : null;
  return {
    id, title: snap?.title ?? titleFor(extraction.level1), source: found.source, mode: "live", model: config.modelName,
    extraction, history, facts: computeFacts(extraction, history), savedQuestions: [],
  };
}

/** What the browser already holds for a decoded bill; lets another server instance answer without re-reading. */
export type ClientContext = { extraction?: Extraction; history?: HistoryRow[] | null };

function looksLikeExtraction(x: unknown): x is Extraction {
  const e = x as Extraction;
  return !!e && typeof e === "object" && !!e.level1 && typeof e.level1 === "object" && Array.isArray(e.level1.charges) && typeof e.extra === "object";
}

/** Answers one question about a decoded bill. */
export async function askBill(id: string, question: string, client: ClientContext = {}): Promise<{ answer: string; mode: "live" | "saved" }> {
  const q = question.trim().replace(/\s+/g, " ");
  if (q.length < 3) throw new UserFacingError("Type a question about the bill first.");
  if (q.length > 400) throw new UserFacingError("Keep the question under 400 characters.");
  validId(id);
  const found = await findImage(id);

  if (!isModelConfigured()) {
    const snap = found?.source === "sample" ? await readSnapshot(id) : null;
    const saved = snap?.answers[q];
    if (saved) return { answer: saved, mode: "saved" };
    throw new UserFacingError("Answering new questions needs an API key. Add API_KEY to .env and restart the app.", 503);
  }

  // Prefer this server's own reading; otherwise use the one the browser got from the decode step.
  const cached = await readCache<Extraction>("extract", id);
  const extraction = cached ?? (looksLikeExtraction(client.extraction) ? client.extraction : null);
  if (!extraction) {
    if (!found) throw new UserFacingError("This bill could not be found. Upload it again.", 404);
    throw new UserFacingError("Open the bill again so it can be read before asking questions.", 409);
  }
  const history = Array.isArray(client.history) ? client.history : undefined;
  const qid = `web_${crypto.createHash("sha1").update(q).digest("hex").slice(0, 8)}`;
  const answers = await answerQuestions(id, found?.file ?? null, extraction, [{ question_id: qid, question: q }], { history });
  return { answer: answers[qid], mode: "live" };
}
