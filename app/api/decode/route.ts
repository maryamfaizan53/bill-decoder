/**
 * Runs the pipeline and streams newline-delimited JSON so the page can show each step:
 *   {"type":"progress","step":"read","status":"update","pass":2,"of":3}
 *   {"type":"result","data":{...}}   or   {"type":"error","message":"..."}
 *
 * GET  /api/decode?id=KESC_0008          bill already stored on this server (samples, earlier uploads)
 * POST /api/decode  (form: id, bill)     same, but carries the image too. On serverless hosts the
 *                                        upload may have landed on a different instance, so the
 *                                        browser re-sends the file it still holds.
 */
import { decodeBill, findImage, MAX_UPLOAD_BYTES, saveUpload, UserFacingError, validId } from "@/lib/server/bills";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return stream(async () => id);
}

export async function POST(req: Request) {
  return stream(async () => {
    const form = await req.formData();
    const id = validId(String(form.get("id") ?? ""));
    if (await findImage(id)) return id;
    const file = form.get("bill");
    if (!(file instanceof File)) throw new UserFacingError("This bill could not be found. Upload it again.", 404);
    if (file.size > MAX_UPLOAD_BYTES) throw new UserFacingError("That file is over 10 MB. Use a smaller photo or a screenshot.", 413);
    const saved = await saveUpload(Buffer.from(await file.arrayBuffer()));
    if (saved !== id) throw new UserFacingError("The uploaded file doesn't match this bill. Upload it again.", 409);
    return id;
  });
}

function stream(resolveId: () => Promise<string>) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const id = await resolveId();
        const data = await decodeBill(id, (e) => send({ type: "progress", ...e }));
        send({ type: "result", data });
      } catch (e) {
        if (!(e instanceof UserFacingError)) console.error(e);
        send({ type: "error", message: e instanceof UserFacingError ? e.message : friendly(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

function friendly(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (/api key|x-api-key|401|authentication/i.test(msg)) return "The API key was rejected. Check API_KEY in .env.";
  if (/rate|429|overloaded|529/i.test(msg)) return "The model is busy right now. Wait a minute and try again.";
  if (/credit|billing|402/i.test(msg)) return "The API account is out of credit. Add credit and try again.";
  return "The bill could not be read. Try a sharper, straighter photo.";
}
