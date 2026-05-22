import { NextRequest, NextResponse } from "next/server";
import { scoreWines, type ScannedWine } from "@/lib/gemini";
import { findRecognitionMatch } from "@/lib/rated-wines-index";
import { searchWines } from "@/lib/vivino";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Warm-up endpoint: hit on type-select screen so the lambda is defrosted
// by the time the user actually picks Red/White/Sparkling.
export async function GET() {
  return NextResponse.json({ ok: true, warm: true });
}

type Recognition = {
  winery: string;
  wine_name: string;
  vintage: number | null;
  user_rating: number;
  rated_at: string | null;
  region: string | null;
};

type Enrichment = {
  avg_rating: number | null;
  ratings_count: number | null;
  region: string | null;
  vivino_url: string | null;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    wines: ScannedWine[];
    wineType?: "red" | "white" | "sparkling";
    budget?: number;
  };
  const wines = body.wines ?? [];
  if (wines.length === 0) {
    return NextResponse.json({ error: "No wines provided" }, { status: 400 });
  }

  const t0 = Date.now();

  // 1. Recognition pass (in-memory, instant)
  const recognitions: Record<number, Recognition> = {};
  const recognitionMatches: Record<number, { wineName: string; rating: number; date: string }> = {};
  wines.forEach((w, i) => {
    const match = findRecognitionMatch(w);
    if (match) {
      recognitionMatches[i] = {
        wineName: `${match.rated.winery} ${match.rated.wine_name}`,
        rating: match.rated.user_rating ?? 0,
        date: match.rated.rated_at ?? "",
      };
      recognitions[i] = {
        winery: match.rated.winery,
        wine_name: match.rated.wine_name,
        vintage: match.rated.vintage,
        user_rating: match.rated.user_rating ?? 0,
        rated_at: match.rated.rated_at,
        region: match.rated.region,
      };
    }
  });

  // 2. Scoring (Gemini, the slow part)
  let scoring;
  try {
    scoring = await scoreWines(wines, recognitionMatches, body.wineType, body.budget);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("scoreWines failed:", raw);
    const friendly = /503|UNAVAILABLE|overload|high demand/i.test(raw)
      ? "Gemini is overloaded right now. Try again in 30 seconds."
      : /429|RESOURCE_EXHAUSTED|quota/i.test(raw)
      ? "Hit the Gemini rate limit. Wait a minute."
      : "Couldn't pick a verdict. Try again.";
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
  const scoringMs = Date.now() - t0;
  console.log(`scoring complete in ${scoringMs}ms`);

  // 3. Vivino enrichment for the top 3 — fire all in parallel with a 4s wall-clock cap.
  // Vivino is cosmetic; never block the response for it.
  const enrichments: Record<number, Enrichment> = {};
  let enrichmentUnavailable = false;
  if (!process.env.VIVINO_SESSION_COOKIE) {
    enrichmentUnavailable = true;
  } else {
    const topIndices = [...scoring.scored].sort((a, b) => b.score - a.score).slice(0, 3).map((s) => s.index);
    const enrichOne = async (idx: number) => {
      const wine = wines[idx];
      const query = [wine.winery, wine.name, wine.vintage].filter(Boolean).join(" ").trim();
      if (!query) return;
      try {
        const hits = await searchWines(query, 5);
        if (hits.length === 0) return;
        const wineryLower = (wine.winery ?? "").toLowerCase();
        const best = hits
          .map((h) => {
            let s = 0;
            if (wineryLower && h.winery?.toLowerCase().includes(wineryLower)) s += 10;
            if (wineryLower && wineryLower.includes(h.winery?.toLowerCase() ?? "")) s += 8;
            if (wine.region && h.region?.toLowerCase().includes(wine.region.toLowerCase())) s += 5;
            if (wine.vintage && h.vintage_year === wine.vintage) s += 3;
            if ((h.ratings_count ?? 0) > 100) s += 1;
            return { hit: h, score: s };
          })
          .sort((a, b) => b.score - a.score)[0];
        if (best.score < 8) return;
        enrichments[idx] = {
          avg_rating: best.hit.avg_rating,
          ratings_count: best.hit.ratings_count,
          region: best.hit.region,
          vivino_url: best.hit.vivino_url,
        };
      } catch (err) {
        console.warn(`Vivino enrichment failed for index ${idx}:`, err);
      }
    };
    const enrichmentTimeout = new Promise<void>((resolve) => setTimeout(resolve, 4000));
    await Promise.race([Promise.all(topIndices.map(enrichOne)), enrichmentTimeout]);
  }

  const totalMs = Date.now() - t0;
  console.log(`recommend total: ${totalMs}ms (scoring: ${scoringMs}ms, enrichment: ${totalMs - scoringMs}ms)`);

  return NextResponse.json({
    scoring,
    recognitions,
    enrichments,
    enrichmentUnavailable,
    timings: { scoring_ms: scoringMs, total_ms: totalMs },
  });
}
