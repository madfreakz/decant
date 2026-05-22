import type { ScannedWine } from "./gemini";

function normalize(s: string): string {
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

function key(w: ScannedWine): string {
  return [normalize(w.winery), normalize(w.name), w.vintage ?? "x"].join("|");
}

export function dedupeWines(wines: ScannedWine[]): ScannedWine[] {
  const seen = new Map<string, ScannedWine>();
  for (const w of wines) {
    const k = key(w);
    if (!seen.has(k)) {
      seen.set(k, w);
    } else {
      // Prefer the one with more metadata
      const existing = seen.get(k)!;
      const newScore = [w.region, w.varietal, w.vintage, w.price_usd].filter(Boolean).length;
      const oldScore = [existing.region, existing.varietal, existing.vintage, existing.price_usd].filter(Boolean).length;
      if (newScore > oldScore) seen.set(k, w);
    }
  }
  return Array.from(seen.values());
}
