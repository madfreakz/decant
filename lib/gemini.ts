import { GoogleGenAI, Type } from "@google/genai";
import { TASTE_PROFILE } from "./taste-profile";

// Always create a fresh instance — no singleton, no cross-call state
function getAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY must be set");
  return new GoogleGenAI({ apiKey });
}

const MODEL = "gemini-2.5-flash";

// ---- OCR: image → structured wine list ----

const OCR_PROMPT = `You are reading a restaurant wine list. Extract every wine you can identify.

For each wine, capture:
- winery (producer name, e.g. "Château Margaux", "Vietti", "Clos Saint Jean")
- name (the wine/cuvée name, e.g. "Castiglione", "Deus Ex Machina"; may be empty if just the winery is shown)
- vintage (4-digit year if visible, otherwise null)
- region (appellation if visible, e.g. "Saint-Émilion", "Barolo")
- varietal (grape if visible, e.g. "Pinot Noir", "Sangiovese")
- price_usd (numeric, no symbols; null if missing)
- by_glass (true if listed as "by the glass" / "BTG", false if bottle-only or ambiguous)

Rules:
- One entry per distinct wine. If multiple vintages of the same wine appear on one line, output the most prominent.
- Ignore food items, headers, descriptions, prices alone.
- If a name is illegible, return your best partial guess rather than skipping.
- Do not invent wines that aren't on the page.`;

export type ScannedWine = {
  winery: string;
  name: string;
  vintage: number | null;
  region: string | null;
  varietal: string | null;
  price_usd: number | null;
  by_glass: boolean;
};

const OCR_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    wines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          winery: { type: Type.STRING },
          name: { type: Type.STRING },
          vintage: { type: Type.INTEGER, nullable: true },
          region: { type: Type.STRING, nullable: true },
          varietal: { type: Type.STRING, nullable: true },
          price_usd: { type: Type.NUMBER, nullable: true },
          by_glass: { type: Type.BOOLEAN },
        },
        required: ["winery", "name", "by_glass"],
      },
    },
  },
  required: ["wines"],
};

export async function ocrWineList(imageBase64: string, mimeType: string): Promise<ScannedWine[]> {
  const ai = getAI();
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: imageBase64, mimeType } },
          { text: OCR_PROMPT },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: OCR_SCHEMA,
      temperature: 0.1,
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 8192,
    },
  });

  const text = res.text;
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { wines: ScannedWine[] };
    return parsed.wines ?? [];
  } catch (err) {
    console.error("OCR JSON parse failed:", err, text.slice(0, 200));
    return [];
  }
}

// ---- Scoring: wine list → ranked verdicts ----

const SCORING_PROMPT = `You are Mark's sommelier. He has a deeply specific taste profile (below). Given a wine list, score each wine 1.0-5.0 (one decimal) on how much Mark would like it, based on his profile.

Voice for reasoning: confident, present-tense, slightly dry. Like a sommelier-friend, not a chatbot. Italic-serif voice. ONE short sentence per wine. Examples:
- "Earthy Nebbiolo from a producer you've trusted before."
- "Right Bank Merlot, the structured kind you keep going back to."
- "Aged Côtes du Rhône — the price is the only surprise here."
- "Generic Pinot Noir, no producer. Pass."
- "Fruit-forward Napa Cab. Not your thing."

Score calibration:
- 4.6-5.0: trusted producer + tier-1 grape/region + good vintage. Rare.
- 4.0-4.5: strong producer or strong region match. Solid pick.
- 3.5-3.9: decent but not a sweet spot. Safe.
- 3.0-3.4: ambiguous or unfamiliar; could go either way.
- 1.0-2.9: actively wrong for Mark (fruit-bomb, generic, young Cab, etc.)

Confidence:
- "high": producer in trusted list OR exact region tier-1 match
- "medium": grape + region inference, no producer match
- "low": ambiguous wine (just "Pinot Noir" with no producer), or unfamiliar region

Skip reason (for wines scoring < 3.5): ONE word, lowercase, italic-style. Pick from: oaky, fruit-forward, too young, thin, jammy, flabby, confected, unfamiliar, generic.

ALSO pick a top "verdict" (the single best wine) and two alternates:
- safer_pick: high-confidence, slightly lower ceiling than the verdict
- wild_card: lower-confidence but aligned with Mark's adventurous tendencies (one stretch he might love)

Use the wine INDEX (0-based, matching the input order) to reference picks.

${TASTE_PROFILE}`;

export type ScoredWine = {
  index: number;
  score: number;
  reasoning: string;
  confidence: "high" | "medium" | "low";
  skip_reason: string | null;
};

export type ScoringResult = {
  scored: ScoredWine[];
  verdict_index: number;
  safer_pick_index: number | null;
  wild_card_index: number | null;
};

const SCORING_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    scored: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          index: { type: Type.INTEGER },
          score: { type: Type.NUMBER },
          reasoning: { type: Type.STRING },
          confidence: {
            type: Type.STRING,
            enum: ["high", "medium", "low"],
          },
          skip_reason: { type: Type.STRING, nullable: true },
        },
        required: ["index", "score", "reasoning", "confidence"],
      },
    },
    verdict_index: { type: Type.INTEGER },
    safer_pick_index: { type: Type.INTEGER, nullable: true },
    wild_card_index: { type: Type.INTEGER, nullable: true },
  },
  required: ["scored", "verdict_index"],
};

export async function scoreWines(
  wines: ScannedWine[],
  recognitionMatches: Record<number, { wineName: string; rating: number; date: string }>
): Promise<ScoringResult> {
  const ai = getAI();

  const wineLines = wines
    .map((w, i) => {
      const note = recognitionMatches[i]
        ? ` [Mark has rated this ${recognitionMatches[i].rating}★ on ${recognitionMatches[i].date} — recognize it but still score it]`
        : "";
      return `[${i}] ${w.winery} ${w.name}${w.vintage ? ` ${w.vintage}` : ""}${w.region ? ` (${w.region})` : ""}${w.varietal ? ` — ${w.varietal}` : ""}${w.price_usd != null ? ` — $${w.price_usd}` : ""}${w.by_glass ? " (by the glass)" : ""}${note}`;
    })
    .join("\n");

  const userPrompt = `Here is the wine list (indexed). Score every wine and pick the verdict + alternates.

${wineLines}`;

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    config: {
      systemInstruction: SCORING_PROMPT,
      responseMimeType: "application/json",
      responseSchema: SCORING_SCHEMA,
      temperature: 0.4,
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 8192,
    },
  });

  const text = res.text;
  if (!text) throw new Error("Empty scoring response");
  return JSON.parse(text) as ScoringResult;
}
