import fs from "node:fs/promises";
import path from "node:path";
import { findImage, UserFacingError } from "@/lib/server/bills";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const found = await findImage(id);
    if (!found) return new Response("Not found", { status: 404 });
    const body = await fs.readFile(found.file);
    return new Response(new Uint8Array(body), {
      headers: { "content-type": TYPES[path.extname(found.file).toLowerCase()] ?? "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" },
    });
  } catch (e) {
    if (e instanceof UserFacingError) return new Response(e.message, { status: e.status });
    return new Response("Error", { status: 500 });
  }
}
