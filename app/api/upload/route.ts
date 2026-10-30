import { MAX_UPLOAD_BYTES, saveUpload, UserFacingError } from "@/lib/server/bills";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("bill");
    if (!(file instanceof File)) throw new UserFacingError("Choose a bill image to upload.");
    if (file.size > MAX_UPLOAD_BYTES) throw new UserFacingError("That file is over 10 MB. Use a smaller photo or a screenshot.", 413);
    const id = await saveUpload(Buffer.from(await file.arrayBuffer()));
    return Response.json({ id });
  } catch (e) {
    return errorResponse(e);
  }
}

function errorResponse(e: unknown) {
  if (e instanceof UserFacingError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "The upload failed. Try again." }, { status: 500 });
}
