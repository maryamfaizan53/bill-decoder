import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

export async function readCache<T>(kind: string, id: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(config.cacheDir, kind, `${id}.json`), "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeCache(kind: string, id: string, value: unknown) {
  const dir = path.join(config.cacheDir, kind);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(value, null, 2));
}

export function log(...args: unknown[]) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}]`, ...args);
}

/** Retry on transient errors (rate limits, overload, network). The AI SDK also retries internally. */
export async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/api key|x-api-key|401|403|not allowed|authentication|invalid_request_error|\b400\b/i.test(msg)) throw e; // not transient
      if (i === attempts - 1) break;
      const wait = Math.min(30000, 2000 * 2 ** i);
      log(`⚠️  ${label}: ${msg.slice(0, 160)} — retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}
