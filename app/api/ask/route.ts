import { askBill, UserFacingError } from "@/lib/server/bills";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { id, question } = (await req.json()) as { id?: string; question?: string };
    const res = await askBill(String(id ?? ""), String(question ?? ""));
    return Response.json(res);
  } catch (e) {
    if (e instanceof UserFacingError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    const msg = e instanceof Error ? e.message : "";
    const error = /rate|429|overloaded/i.test(msg) ? "The model is busy right now. Ask again in a minute." : "The answer could not be generated. Try asking again.";
    return Response.json({ error }, { status: 500 });
  }
}
