import type { ScannedWine } from "./gemini";

export type WineType = "red" | "white" | "sparkling" | "unknown";

export function detectWineType(wine: ScannedWine): WineType {
  const text = [wine.varietal, wine.region, wine.name, wine.winery]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Sparkling takes precedence over everything
  if (/champagne|prosecco|cava|franciacorta|cr[eé]mant|brut|p[eé]tillant|sparkling|sekt|moscato d.asti/.test(text)) {
    return "sparkling";
  }

  // White grapes
  if (/chardonnay|sauvignon blanc|riesling|pinot gr[ie]gio|pinot gris|albari[nñ]o|arneis|gr[uü]ner|veltliner|viognier|vermentino|verdicchio|falanghina|fiano|greco|chenin blanc|roussanne|marsanne|gew[uü]rz|torront[eé]s|muscat|inzolia|catarratto/.test(text)) {
    return "white";
  }

  // White regions
  if (/chablis|meursault|pouilly.fum[eé]|sancerre|alsace|mosel|rheingau|soave|gavi|greco di tufo/.test(text)) {
    return "white";
  }

  // Red grapes
  if (/pinot noir|cabernet|merlot|syrah|shiraz|grenache|garnacha|sangiovese|nebbiolo|barbera|tempranillo|malbec|zinfandel|primitivo|mourv[eè]dre|petite sirah|carm[eé]n[eè]re|dolcetto|montepulciano|aglianico|nero d.avola/.test(text)) {
    return "red";
  }

  // Red regions
  if (/barolo|barbaresco|brunello|chianti|amarone|valpolicella|rioja|priorat|saint-[eé]milion|pomerol|pauillac|margaux|c[oô]te de nuits|c[oô]te de beaune|ch[aâ]teauneuf|c[oô]tes du rh[oô]ne|ribera del duero|toro|cahors|madiran/.test(text)) {
    return "red";
  }

  return "unknown";
}
