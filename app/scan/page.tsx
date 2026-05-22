"use client";

import { useReducer, useRef, useState, useEffect, useMemo } from "react";
import { initialState, scanReducer } from "@/lib/scan-state";
import { dedupeWines } from "@/lib/dedupe";
import { detectWineType, type WineType } from "@/lib/wine-type";
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
  const [budget, setBudget] = useState(80);

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

  // Tries to compress via canvas. Returns null if the image can't be decoded
  // (e.g. HEIC on Chrome iOS where the WebKit canvas codec is unavailable).
  // Never hangs: rejects after 5 s if img.onload never fires.
  function tryCanvasCompress(file: File, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      let settled = false;

      const cleanup = () => {
        if (!settled) {
          settled = true;
          URL.revokeObjectURL(url);
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        console.warn("compressImage: img.onload timed out (HEIC decode unsupported?)");
        resolve(null);
      }, 20000);

      img.onload = () => {
        clearTimeout(timer);
        cleanup();
        try {
          const MAX = 1024; // OCR only needs legibility, not display quality
          const ratio = Math.min(MAX / img.naturalWidth, MAX / img.naturalHeight, 1);
          const w = Math.round(img.naturalWidth * ratio);
          const h = Math.round(img.naturalHeight * ratio);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            (b) => resolve(b ?? null),
            "image/jpeg",
            quality
          );
        } catch {
          resolve(null);
        }
      };

      img.onerror = () => {
        clearTimeout(timer);
        cleanup();
        resolve(null);
      };

      img.src = url;
    });
  }

  // Reads any Blob/File as base64. Used as the HEIC fallback path.
  function readAsBase64(blob: Blob): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const commaIdx = result.indexOf(",");
        const base64 = result.slice(commaIdx + 1);
        resolve({ base64, mimeType: blob.type || "image/jpeg" });
      };
      reader.onerror = () => reject(new Error("FileReader failed"));
      reader.readAsDataURL(blob);
    });
  }

  async function uploadPage(id: string, file: File) {
    const fileSizeMb = (file.size / 1e6).toFixed(1);
    console.log(`uploadPage start: ${fileSizeMb} MB, type="${file.type}", name="${file.name}"`);

    // Surface diagnostic info to the user — replaces silent "try again"
    const failWith = (msg: string) => {
      console.error("upload failed:", msg);
      dispatch({ type: "UPDATE_PAGE", id, patch: { status: "error", errorMessage: msg } });
    };

    // Canvas compression — works for JPEG/PNG, fails for HEIC on Chrome iOS
    const QUALITY_STEPS = [0.80, 0.60, 0.40];
    const SIZE_LIMIT = 1.5 * 1024 * 1024;
    let compressed: Blob | null = null;

    for (const q of QUALITY_STEPS) {
      const attempt = await tryCanvasCompress(file, q);
      if (attempt === null) break;
      compressed = attempt;
      if (compressed.size <= SIZE_LIMIT) break;
      console.warn(`compress q=${q}: ${(compressed.size / 1e6).toFixed(2)} MB, trying harder`);
    }

    // Hard rule: never send anything > 3 MB to the server (Vercel proxy
    // caps at 4.5 MB and base64 adds 33% overhead).
    const HARD_CAP = 3 * 1024 * 1024;

    if (compressed === null) {
      // Canvas couldn't decode. Either HEIC on Chrome iOS, or corrupt file.
      // Don't fall back to sending the original — it will be too big.
      if (file.size > HARD_CAP) {
        failWith(`${fileSizeMb}MB ${file.type || "image"} can't be processed. Open in Safari instead, or set Camera → Formats → Most Compatible.`);
        return;
      }
      // Small enough to send raw as base64; let Gemini decode it.
      console.warn("canvas failed but file is small — base64 fallback");
      try {
        const { base64, mimeType } = await readAsBase64(file);
        const res = await fetch("/api/ocr-page", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, mimeType }),
        });
        const data = (await res.json()) as { wines?: ScannedWine[]; error?: string };
        if (!res.ok || !data.wines) {
          failWith(`Server ${res.status}: ${data.error ?? "unknown error"}`);
          return;
        }
        dispatch({ type: "UPDATE_PAGE", id, patch: { status: "done", wines: data.wines, wineCount: data.wines.length } });
      } catch (err) {
        failWith(`Network error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    // Canvas succeeded. Send the compressed JPEG.
    if (compressed.size > HARD_CAP) {
      failWith(`Couldn't compress photo enough (${(compressed.size / 1e6).toFixed(1)}MB). Try a closer shot.`);
      return;
    }
    console.log(`upload: ${(compressed.size / 1024).toFixed(0)} KB JPEG`);

    const form = new FormData();
    form.append("image", compressed, "page.jpg");
    try {
      const res = await fetch("/api/ocr-page", { method: "POST", body: form });
      const data = (await res.json()) as { wines?: ScannedWine[]; error?: string };
      if (!res.ok || !data.wines) {
        failWith(`Server ${res.status}: ${data.error ?? "unknown error"}`);
        return;
      }
      dispatch({ type: "UPDATE_PAGE", id, patch: { status: "done", wines: data.wines, wineCount: data.wines.length } });
    } catch (err) {
      failWith(`Network error: ${err instanceof Error ? err.message : String(err)}`);
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
    dispatch({ type: "SET_PHASE", phase: "type-select" });
  }

  async function handleSelectWineType(wineType: "red" | "white" | "sparkling") {
    dispatch({ type: "SET_PHASE", phase: "processing" });
    setScoring(null);
    setRecognitions({});
    setEnrichments({});

    // budget >= 300 means "no limit" — don't constrain
    const effectiveBudget = budget >= 300 ? undefined : budget;
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wines: allWines, wineType, budget: effectiveBudget }),
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
    setBudget(80);
  }

  // ---- Render phases ----

  if (state.phase === "type-select") {
    const typeCounts: Record<string, number> = { red: 0, white: 0, sparkling: 0 };
    for (const w of allWines) {
      const t = detectWineType(w);
      if (t === "red" || t === "white" || t === "sparkling") typeCounts[t]++;
    }
    const types: { key: "red" | "white" | "sparkling"; label: string }[] = [
      { key: "red", label: "Red" },
      { key: "white", label: "White" },
      { key: "sparkling", label: "Sparkling" },
    ];
    return (
      <main className="min-h-dvh flex flex-col px-5 py-8 max-w-md mx-auto">
        <header className="flex items-center justify-between mb-8">
          <button
            onClick={handleReset}
            className="text-sm tracking-wide"
            style={{ color: "var(--color-ink)", opacity: 0.5 }}
          >
            New scan
          </button>
          <WaxSeal size={28} />
        </header>
        <div className="flex-1 flex flex-col justify-center">
          <h2
            className="font-display text-2xl mb-8 leading-tight"
            style={{ color: "var(--color-ink)" }}
          >
            What would you like tonight?
          </h2>

          <div className="mb-8">
            <div className="flex items-baseline justify-between mb-3">
              <span
                className="text-xs uppercase tracking-wider"
                style={{ color: "var(--color-kraft)", fontFamily: "var(--font-ui)" }}
              >
                Budget
              </span>
              <span
                className="font-mono text-lg"
                style={{ color: "var(--color-bordeaux)" }}
              >
                {budget >= 300 ? "no limit" : `$${budget}`}
              </span>
            </div>
            <input
              type="range"
              min={30}
              max={300}
              step={10}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="w-full accent-[var(--color-bordeaux)]"
              style={{ accentColor: "var(--color-bordeaux)" }}
            />
            <div
              className="flex justify-between mt-1 text-[10px] uppercase tracking-wider"
              style={{ color: "var(--color-kraft)", fontFamily: "var(--font-ui)" }}
            >
              <span>$30</span>
              <span>no limit</span>
            </div>
          </div>

          <div className="space-y-3">
            {types.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleSelectWineType(key)}
                className="w-full text-left py-4 px-5 rounded-md flex items-center justify-between"
                style={{
                  background: "var(--color-bordeaux)",
                  color: "var(--color-cream)",
                  fontFamily: "var(--font-ui)",
                }}
              >
                <span className="tracking-wide">{label}</span>
                {typeCounts[key] > 0 && (
                  <span className="text-sm opacity-70">
                    {typeCounts[key]} wine{typeCounts[key] === 1 ? "" : "s"}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

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
    const saferScore = saferIdx != null ? scoring.scored.find((s) => s.index === saferIdx) : null;
    const wildScore = wildIdx != null ? scoring.scored.find((s) => s.index === wildIdx) : null;

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
          <div className="mt-4 flex gap-3 overflow-hidden">
            {saferWine && saferScore && (
              <AlternatePill
                label="Closer to home"
                wineName={`${saferWine.winery} ${saferWine.name}`}
                notes={saferScore.notes}
                score={saferScore.score}
                price={saferWine.price_usd}
                variant="safer"
              />
            )}
            {wildWine && wildScore && (
              <AlternatePill
                label="Worth a gamble"
                wineName={`${wildWine.winery} ${wildWine.name}`}
                notes={wildScore.notes}
                score={wildScore.score}
                price={wildWine.price_usd}
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

  const stillScanning = state.pages.some((p) => p.status === "uploading");
  const canRead = !stillScanning && state.pages.some((p) => p.status === "done" && p.wineCount > 0);
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
        accept="image/jpeg"
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
            {stillScanning
              ? totalWines > 0
                ? `${totalWines} wine${totalWines === 1 ? "" : "s"} found, still scanning…`
                : "Scanning…"
              : `${totalWines} wine${totalWines === 1 ? "" : "s"} ready`}
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
              {stillScanning ? "Scanning pages…" : "Read this list"}
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
