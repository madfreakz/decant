import { NextRequest } from "next/server";
import { scoreWines, type ScannedWine } from "@/lib/gemini";
import { findRecognitionMatch } from "@/lib/rated-wines-index";
import { searchWines } from "@/lib/vivino";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SSEEvent =
  | { type: "recognition"; index: number; rated: { winery: string; wine_name: string; vintage: number | null; user_rating: number; rated_at: string | null; region: string | null } }
  | { type: "scored"; result: Awaited<ReturnType<typeof scoreWines>> }
  | { type: "enrichment"; index: number; vivino: { avg_rating: number | null; ratings_count: number | null; region: string | null; vivino_url: string | null } }
  | { type: "enrichment_unavailable"; reason: string }
  | { type: "done" }
  | { type: "error"; message: string };

function send(controller: ReadableStreamDefaultController, event: SSEEvent) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { wines: ScannedWine[]; wineType?: "red" | "white" | "sparkling" };
  const wines = body.wines ?? [];
  const wineType = body.wineType;

  if (wines.length === 0) {
    return new Response(JSON.stringify({ error: "No wines provided" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 1. Recognition pass — fuzzy match against 405 already-rated wines
        const recognitionMatches: Record<number, { wineName: string; rating: number; date: string }> = {};
        wines.forEach((w, i) => {
          const match = findRecognitionMatch(w);
          if (match) {
            recognitionMatches[i] = {
              wineName: `${match.rated.winery} ${match.rated.wine_name}`,
              rating: match.rated.user_rating ?? 0,
              date: match.rated.rated_at ?? "",
            };
            send(controller, {
              type: "recognition",
              index: i,
              rated: {
                winery: match.rated.winery,
                wine_name: match.rated.wine_name,
                vintage: match.rated.vintage,
                user_rating: match.rated.user_rating ?? 0,
                rated_at: match.rated.rated_at,
                region: match.rated.region,
              },
            });
          }
        });

        // 2. Scoring pass — ONE LLM call with all wines + taste profile
        const scoringResult = await scoreWines(wines, recognitionMatches, wineType);
        send(controller, { type: "scored", result: scoringResult });

        // 3. Vivino enrichment — top 5 wines (verdict + alternates + next 2 scored), sequential
        const sortedByScore = [...scoringResult.scored].sort((a, b) => b.score - a.score);
        const topIndices = sortedByScore.slice(0, 5).map((s) => s.index);

        if (!process.env.VIVINO_SESSION_COOKIE) {
          send(controller, { type: "enrichment_unavailable", reason: "Vivino cookie not configured" });
        } else {
          for (const idx of topIndices) {
            const wine = wines[idx];
            const query = [wine.winery, wine.name, wine.vintage].filter(Boolean).join(" ").trim();
            if (!query) continue;
            try {
              const hits = await searchWines(query, 5);
              if (hits.length === 0) continue;
              // Score each hit by name similarity to filter out unrelated top results
              const wineryLower = (wine.winery ?? "").toLowerCase();
              const best = hits
                .map((h) => {
                  let score = 0;
                  if (wineryLower && h.winery?.toLowerCase().includes(wineryLower)) score += 10;
                  if (wineryLower && wineryLower.includes(h.winery?.toLowerCase() ?? "")) score += 8;
                  if (wine.region && h.region?.toLowerCase().includes(wine.region.toLowerCase())) score += 5;
                  if (wine.vintage && h.vintage_year === wine.vintage) score += 3;
                  if ((h.ratings_count ?? 0) > 100) score += 1;
                  return { hit: h, score };
                })
                .sort((a, b) => b.score - a.score)[0];
              // Require at least a winery hint match before claiming "enrichment"
              if (best.score < 8) continue;
              send(controller, {
                type: "enrichment",
                index: idx,
                vivino: {
                  avg_rating: best.hit.avg_rating,
                  ratings_count: best.hit.ratings_count,
                  region: best.hit.region,
                  vivino_url: best.hit.vivino_url,
                },
              });
            } catch (err) {
              console.warn(`Vivino enrichment failed for index ${idx}:`, err);
            }
          }
        }

        send(controller, { type: "done" });
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send(controller, { type: "error", message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
