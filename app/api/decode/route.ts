/**
 * GET /api/decode?id=KESC_0008
 * Streams newline-delimited JSON so the page can show each pipeline step as it happens:
 *   {"type":"progress","step":"read","status":"update","pass":2,"of":3}
 *   {"type":"result","data":{...}}   or   {"type":"error","message":"..."}
 */
import { decodeBill, UserFacingError } from "@/lib/server/bills";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
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
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

function friendly(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (/api key|x-api-key|401|authentication/i.test(msg)) return "The API key was rejected. Check API_KEY in .env.";
  if (/rate|429|overloaded|529/i.test(msg)) return "The model is busy right now. Wait a minute and try again.";
  if (/credit|billing|402/i.test(msg)) return "The API account is out of credit. Add credit and try again.";
  return "The bill could not be read. Try a sharper, straighter photo.";
}
