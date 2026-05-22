"use client";

import { useReducer, useRef, useState, useEffect, useMemo } from "react";
import { initialState, scanReducer } from "@/lib/scan-state";
import { dedupeWines } from "@/lib/dedupe";
import { PageThumbStrip } from "@/components/PageThumbStrip";
import { ProcessingSeal } from "@/components/ProcessingSeal";
import { VerdictHero } from "@/components/VerdictHero";
import { RecognitionCard } from "@/components/RecognitionCard";
import { AlternatePill } from "@/components/AlternatePill";
import { FullRankedSheet } from "@/components/FullRankedSheet";
import { WaxSeal } from "@/components/WaxSeal";
import { saveVerdict } from "@/lib/verdict-journal";
import type { ScannedWine, ScoringResult } from "@/lib/gemini";

type RecognitionData = {
  index: number;
  rated: {
    winery: string;
    wine_name: string;
    vintage: number | null;
    user_rating: number;
    rated_at: string | null;
    region: string | null;
  };
};

type EnrichmentData = {
  index: number;
  vivino: {
    avg_rating: number | null;
    ratings_count: number | null;
    food_pairings: string[];
    image_url: string | null;
    vivino_url: string | null;
    taste_structure: { acidity: number | null; tannin: number | null; intensity: number | null } | null;
  };
};

export default function ScanPage() {
  const [state, dispatch] = useReducer(scanReducer, initialState);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [scoring, setScoring] = useState<ScoringResult | null>(null);
  const [recognitions, setRecognitions] = useState<Record<number, RecognitionData["rated"]>>({});
  const [enrichments, setEnrichments] = useState<Record<number, EnrichmentData["vivino"]>>({});
  const [verdictExpanded, setVerdictExpanded] = useState(false);
  const [showFullList, setShowFullList] = useState(false);
  const [enrichmentUnavailable, setEnrichmentUnavailable] = useState(false);

  // Persist scan state to localStorage so iOS Safari background reaping doesn't nuke it
  useEffect(() => {
    if (state.phase === "capture" && state.pages.length > 0) {
      try {
        localStorage.setItem("decant:lastScan", JSON.stringify({
          ts: Date.now(),
          pages: state.pages,
        }));
      } catch {
        // ignore
      }
    }
  }, [state.pages, state.phase]);

  const allWines: ScannedWine[] = useMemo(() => {
    const merged = state.pages.flatMap((p) => p.wines);
    return dedupeWines(merged);
  }, [state.pages]);

  function handleFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = ""; // allow re-selecting same file

    const id = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(file);
    dispatch({
      type: "ADD_PAGE",
      page: { id, previewUrl, status: "uploading", wineCount: 0, wines: [] },
    });

    uploadPage(id, file);
  }

  async function uploadPage(id: string, file: File) {
    const form = new FormData();
    form.append("image", file);
    try {
      const res = await fetch("/api/ocr-page", { method: "POST", body: form });
      const data = (await res.json()) as { wines?: ScannedWine[]; error?: string };
      if (!res.ok || !data.wines) {
        dispatch({ type: "UPDATE_PAGE", id, patch: { status: "error" } });
        return;
      }
      dispatch({
        type: "UPDATE_PAGE",
        id,
        patch: { status: "done", wines: data.wines, wineCount: data.wines.length },
      });
    } catch (err) {
      console.error(err);
      dispatch({ type: "UPDATE_PAGE", id, patch: { status: "error" } });
    }
  }

  function handleRetake(id: string) {
    dispatch({ type: "REMOVE_PAGE", id });
    fileInputRef.current?.click();
  }

  function handleAddPage() {
    fileInputRef.current?.click();
  }

  async function handleReadList() {
    if (allWines.length === 0) return;
    dispatch({ type: "SET_PHASE", phase: "processing" });
    setScoring(null);
    setRecognitions({});
    setEnrichments({});

    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wines: allWines }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`Bad response: ${res.status}`);
      }
      const localRecognitions: Record<number, RecognitionData["rated"]> = {};
      await consumeSSE(res.body, (event) => {
        if (event.type === "recognition") {
          localRecognitions[event.index] = event.rated;
          setRecognitions((prev) => ({ ...prev, [event.index]: event.rated }));
        } else if (event.type === "scored") {
          setScoring(event.result);
          dispatch({ type: "SET_PHASE", phase: "verdict" });

          // Persist verdict to journal for the home-screen scroll
          const verdictIdx = event.result.verdict_index;
          const verdictWine = allWines[verdictIdx];
          const verdictScore = event.result.scored.find(
            (s: ScoringResult["scored"][number]) => s.index === verdictIdx
          );
          const recognition = localRecognitions[verdictIdx];
          if (verdictWine && verdictScore) {
            saveVerdict({
              winery: recognition?.winery ?? verdictWine.winery,
              wine_name: recognition?.wine_name ?? verdictWine.name,
              vintage: recognition?.vintage ?? verdictWine.vintage,
              score: recognition?.user_rating ?? verdictScore.score,
              reasoning: verdictScore.reasoning,
              recognized: !!recognition,
            });
          }
        } else if (event.type === "enrichment") {
          setEnrichments((prev) => ({ ...prev, [event.index]: event.vivino }));
        } else if (event.type === "enrichment_unavailable") {
          setEnrichmentUnavailable(true);
        }
      });
    } catch (err) {
      console.error("Scoring failed:", err);
      dispatch({ type: "SET_PHASE", phase: "capture" });
    }
  }

  function handleReset() {
    dispatch({ type: "RESET" });
    setScoring(null);
    setRecognitions({});
    setEnrichments({});
    setVerdictExpanded(false);
    setShowFullList(false);
    setEnrichmentUnavailable(false);
  }

  // ---- Render phases ----

  if (state.phase === "processing") {
    return (
      <ProcessingSeal
        totalWines={allWines.length}
        recognitionCount={Object.keys(recognitions).length}
      />
    );
  }

  if (state.phase === "verdict" && scoring) {
    const verdictIdx = scoring.verdict_index;
    const verdictScore = scoring.scored.find((s) => s.index === verdictIdx);
    const verdictWine = allWines[verdictIdx];
    const verdictRecognition = recognitions[verdictIdx];

    const saferIdx = scoring.safer_pick_index;
    const wildIdx = scoring.wild_card_index;
    const saferWine = saferIdx != null ? allWines[saferIdx] : null;
    const wildWine = wildIdx != null ? allWines[wildIdx] : null;

    return (
      <main className="min-h-dvh px-5 py-8 max-w-md mx-auto">
        <header className="flex items-center justify-between mb-6">
          <button
            onClick={handleReset}
            className="text-sm tracking-wide"
            style={{ color: "var(--color-ink)", opacity: 0.5 }}
          >
            New scan
          </button>
          <WaxSeal size={28} />
        </header>

        {verdictRecognition ? (
          <>
            <RecognitionCard
              winery={verdictRecognition.winery}
              wineName={verdictRecognition.wine_name}
              vintage={verdictRecognition.vintage}
              region={verdictRecognition.region}
              userRating={verdictRecognition.user_rating}
              ratedAt={verdictRecognition.rated_at}
            />
            {verdictScore && (
              <div className="mt-4 text-center">
                <button
                  className="text-sm font-display italic"
                  style={{ color: "var(--color-bordeaux)" }}
                  onClick={() => setVerdictExpanded((v) => !v)}
                >
                  Still scoring {verdictScore.score.toFixed(1)} tonight →
                </button>
              </div>
            )}
          </>
        ) : verdictWine && verdictScore ? (
          <VerdictHero
            wine={verdictWine}
            scored={verdictScore}
            enrichment={enrichments[verdictIdx] ?? null}
            expanded={verdictExpanded}
            onExpand={() => setVerdictExpanded((v) => !v)}
          />
        ) : null}

        {(saferWine || wildWine) && (
          <div className="mt-4 flex gap-3">
            {saferWine && (
              <AlternatePill
                label="Closer to home"
                wineName={`${saferWine.winery} ${saferWine.name}`}
                variant="safer"
              />
            )}
            {wildWine && (
              <AlternatePill
                label="Worth a gamble"
                wineName={`${wildWine.winery} ${wildWine.name}`}
                variant="wild"
              />
            )}
          </div>
        )}

        {enrichmentUnavailable && (
          <p
            className="mt-6 text-center font-display italic text-sm"
            style={{ color: "var(--color-kraft)" }}
          >
            Vivino's not answering. The pick still stands.
          </p>
        )}

        <button
          onClick={() => setShowFullList(true)}
          className="mt-8 w-full py-3 text-sm tracking-wide font-display italic"
          style={{
            color: "var(--color-ink)",
            opacity: 0.7,
            borderTop: "1px solid var(--color-paper-shadow)",
          }}
        >
          See the full list ↑
        </button>

        <FullRankedSheet
          wines={allWines}
          scored={scoring.scored}
          open={showFullList}
          onClose={() => setShowFullList(false)}
        />
      </main>
    );
  }

  // ---- Capture phase ----

  const canRead = state.pages.some((p) => p.status === "done" && p.wineCount > 0);
  const totalWines = allWines.length;

  return (
    <main className="min-h-dvh flex flex-col px-5 py-8 max-w-md mx-auto">
      <header className="flex items-center gap-2 mb-8">
        <WaxSeal size={28} />
        <span
          className="font-display italic text-lg"
          style={{ color: "var(--color-ink)" }}
        >
          Decant
        </span>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFilePicked}
        className="hidden"
      />

      {state.pages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <h1
            className="font-display text-3xl leading-tight max-w-xs"
            style={{ color: "var(--color-ink)" }}
          >
            Point this at the wine list when it arrives.
          </h1>
        </div>
      ) : (
        <section className="flex-1 flex flex-col items-center justify-center">
          <div
            className="mb-6 text-center font-display italic text-sm"
            style={{ color: "var(--color-kraft)" }}
          >
            {totalWines} wine{totalWines === 1 ? "" : "s"} read so far
          </div>
          <PageThumbStrip
            pages={state.pages}
            onRetake={handleRetake}
            onAddPage={handleAddPage}
          />
        </section>
      )}

      <footer className="mt-8 space-y-3">
        {state.pages.length === 0 ? (
          <button
            onClick={handleAddPage}
            className="w-full text-center py-4 rounded-md tracking-wide"
            style={{
              background: "var(--color-bordeaux)",
              color: "var(--color-cream)",
              fontFamily: "var(--font-ui)",
            }}
          >
            Read a wine list
          </button>
        ) : (
          <>
            <button
              onClick={handleReadList}
              disabled={!canRead}
              className="w-full text-center py-4 rounded-md tracking-wide transition-opacity"
              style={{
                background: "var(--color-bordeaux)",
                color: "var(--color-cream)",
                fontFamily: "var(--font-ui)",
                opacity: canRead ? 1 : 0.4,
              }}
            >
              Read this list
            </button>
          </>
        )}
      </footer>
    </main>
  );
}

type SSEEventIn =
  | { type: "recognition"; index: number; rated: RecognitionData["rated"] }
  | { type: "scored"; result: ScoringResult }
  | { type: "enrichment"; index: number; vivino: EnrichmentData["vivino"] }
  | { type: "enrichment_unavailable"; reason: string }
  | { type: "done" }
  | { type: "error"; message: string };

async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SSEEventIn) => void
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch (err) {
        console.warn("SSE parse error:", err);
      }
    }
  }
}
