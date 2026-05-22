import ratedWines from "./rated-wines.json";

export type RatedWine = (typeof ratedWines)[number];

export function getAllRatedWines(): RatedWine[] {
  return ratedWines as RatedWine[];
}

function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(
      /\b(château|chateau|domaine|estate|winery|bodega|tenuta|azienda|maison|weingut|cantina|cave|clos)\b/gi,
      ""
    )
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

export type ScannedWine = {
  winery?: string;
  name: string;
  vintage?: number | null;
  region?: string | null;
  varietal?: string | null;
};

export type RecognitionMatch = {
  rated: RatedWine;
  confidence: "high" | "medium" | "low";
};

export function findRecognitionMatch(scanned: ScannedWine): RecognitionMatch | null {
  const wines = getAllRatedWines();
  const sWinery = normalize(scanned.winery);
  const sName = normalize(scanned.name);
  const sFull = normalize(`${scanned.winery ?? ""} ${scanned.name}`);

  if (!sName || sName.length < 3) return null;

  let best: { wine: RatedWine; score: number; confidence: RecognitionMatch["confidence"] } | null = null;

  for (const wine of wines) {
    // High confidence: exact winery match + wine name overlap, ideally vintage match too
    if (sWinery && wine.norm_winery && sWinery === wine.norm_winery) {
      const nameOverlap = wineNameOverlap(sName, wine.norm_wine);
      if (nameOverlap > 0.5) {
        const vintageMatch =
          scanned.vintage != null && wine.vintage != null && scanned.vintage === wine.vintage;
        const conf: RecognitionMatch["confidence"] = vintageMatch ? "high" : "medium";
        const score = 100 + nameOverlap * 10 + (vintageMatch ? 5 : 0);
        if (!best || score > best.score) best = { wine, score, confidence: conf };
        continue;
      }
    }

    // Medium confidence: full-string Levenshtein < 3 against the full normalized title
    if (sFull && wine.norm_full && Math.abs(sFull.length - wine.norm_full.length) < 8) {
      const dist = levenshtein(sFull, wine.norm_full);
      if (dist < 3) {
        const score = 80 - dist * 5;
        if (!best || score > best.score) best = { wine, score, confidence: "medium" };
      }
    }
  }

  if (!best) return null;
  return { rated: best.wine, confidence: best.confidence };
}

function wineNameOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const aTokens = new Set(a.split(/\s+/).filter((t) => t.length > 2));
  const bTokens = new Set(b.split(/\s+/).filter((t) => t.length > 2));
  if (!aTokens.size || !bTokens.size) return 0;
  let shared = 0;
  for (const t of aTokens) if (bTokens.has(t)) shared++;
  return shared / Math.max(aTokens.size, bTokens.size);
}
