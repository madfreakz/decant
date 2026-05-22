import { NextRequest, NextResponse } from "next/server";
import { parseWinesFromText } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Warm-up endpoint: hit on /scan mount to defrost the lambda.
export async function GET() {
  return NextResponse.json({ ok: true, warm: true });
}

const MAX_TEXT = 50_000; // sanity cap on raw OCR input

export async function POST(req: NextRequest) {
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Empty text" }, { status: 400 });
  }
  if (text.length > MAX_TEXT) {
    return NextResponse.json({ error: "Text too large" }, { status: 413 });
  }

  const t0 = Date.now();
  try {
    const wines = await parseWinesFromText(text);
    const elapsed = Date.now() - t0;
    return NextResponse.json({ wines, elapsed_ms: elapsed });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("parseWinesFromText failed:", raw);
    const friendly = /503|UNAVAILABLE|overload|high demand/i.test(raw)
      ? "Gemini is overloaded right now. Try again in 30 seconds."
      : /429|RESOURCE_EXHAUSTED|quota/i.test(raw)
      ? "Hit the Gemini rate limit. Wait a minute."
      : "Couldn't parse wine list text. Retake the photo.";
    return NextResponse.json({ error: friendly, wines: [] }, { status: 500 });
  }
}
