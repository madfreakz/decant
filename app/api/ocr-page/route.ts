import { NextRequest, NextResponse } from "next/server";
import { ocrWineList } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Vercel's hard body limit is 4.5 MB. We enforce a slightly tighter limit here
// so the error is ours (with a clear message) rather than a 413 from the proxy.
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  let imageBase64: string;
  let mimeType: string;

  if (contentType.includes("application/json")) {
    // Base64 JSON path — used when canvas compression is unavailable (HEIC on Chrome iOS)
    let body: { imageBase64?: string; mimeType?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!body.imageBase64) {
      return NextResponse.json({ error: "Missing imageBase64 in body" }, { status: 400 });
    }
    // Rough size check: base64 string length ≈ bytes * 4/3
    const approxBytes = body.imageBase64.length * 0.75;
    if (approxBytes > MAX_BYTES) {
      return NextResponse.json(
        { error: `Image too large (≈${(approxBytes / 1e6).toFixed(1)} MB). Please retake with better lighting so the file is smaller.` },
        { status: 413 }
      );
    }
    imageBase64 = body.imageBase64;
    mimeType = body.mimeType || "image/heic";
  } else {
    // FormData path — normal JPEG/PNG from canvas compression
    const form = await req.formData();
    const file = form.get("image");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No image uploaded" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Image too large (${(file.size / 1e6).toFixed(1)} MB). Compression failed to reduce it enough.` },
        { status: 413 }
      );
    }
    mimeType = file.type || "image/jpeg";
    const buf = Buffer.from(await file.arrayBuffer());
    imageBase64 = buf.toString("base64");
  }

  const t0 = Date.now();
  try {
    const wines = await ocrWineList(imageBase64, mimeType);
    const elapsed = Date.now() - t0;
    return NextResponse.json({ wines, elapsed_ms: elapsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("ocrWineList failed:", message);
    return NextResponse.json({ error: message, wines: [] }, { status: 500 });
  }
}
