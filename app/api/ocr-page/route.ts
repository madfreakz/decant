import { NextRequest, NextResponse } from "next/server";
import { ocrWineList } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("image");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No image uploaded" }, { status: 400 });
  }

  const mimeType = file.type || "image/jpeg";
  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString("base64");

  const t0 = Date.now();
  try {
    const wines = await ocrWineList(base64, mimeType);
    const elapsed = Date.now() - t0;
    return NextResponse.json({ wines, elapsed_ms: elapsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, wines: [] }, { status: 500 });
  }
}
