import { GoogleGenAI, Type } from "@google/genai";
import { TASTE_PROFILE } from "./taste-profile";

// Always create a fresh instance — no singleton, no cross-call state
function getAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY must be set");
  return new GoogleGenAI({ apiKey });
}

const OCR_MODEL = "gemini-2.5-flash-lite";
const SCORING_MODEL = "gemini-2.5-flash";

// ---- OCR: image → structured wine list ----

const OCR_PROMPT = `You are reading a restaurant wine list. Extract every wine you can identify.

For each wine, capture:
- winery (producer name, e.g. "Château Margaux", "Vietti", "Clos Saint Jean")
- name (the wine/cuvée name, e.g. "Castiglione", "Deus Ex Machina"; may be empty if just the winery is shown)
- vintage (4-digit year if visible, otherwise null)
- region (appellation if visible, e.g. "Saint-Émilion", "Barolo")
- varietal (grape if visible, e.g. "Pinot Noir", "Sangiovese")
- price_usd (the BOTTLE price as a number, no symbols)
- by_glass (true if only a glass price is shown, false if a bottle price exists)

PRICE EXTRACTION IS CRITICAL — every wine on a menu has a price. Look hard:
- Prices are usually 2–3 digit numbers (35, 85, 145) on the right side of the line
- "12/45" or "12 / 45" or "12•45" = glass price / bottle price. Take 45.
- "25 | 120" = same pattern. Take 120.
- If only one number is shown and the wine is listed under a "By the Glass" section, that's the glass price → set by_glass=true and put that number in price_usd
- If only one number is shown otherwise, it's the bottle price → by_glass=false
- Strip dollar signs, commas, and any "$" or "USD"
- Only set price_usd=null if the wine genuinely has no number visible

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

function isOverloadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /503|UNAVAILABLE|overload|high demand/i.test(msg);
}

async function callOCR(model: string, imageBase64: string, mimeType: string): Promise<string | null> {
  const ai = getAI();
  const res = await ai.models.generateContent({
    model,
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
      maxOutputTokens: 8192,
    },
  });
  return res.text ?? null;
}

export async function ocrWineList(imageBase64: string, mimeType: string): Promise<ScannedWine[]> {
  // Race Lite vs Flash — whichever responds first wins. On a good day
  // Lite returns in ~1.3s and we use it. When Lite is overloaded, Flash
  // (on a separate quota pool) usually returns in ~5s and we use that
  // instead. Costs 2x per OCR (~$0.005 total) but keeps latency consistent.
  const t0 = Date.now();
  const attempts = [
    callOCR(OCR_MODEL, imageBase64, mimeType).then(
      (text) => ({ text, source: OCR_MODEL, ok: !!text }),
      (err) => ({ text: null as string | null, source: OCR_MODEL, ok: false, err })
    ),
    callOCR(SCORING_MODEL, imageBase64, mimeType).then(
      (text) => ({ text, source: SCORING_MODEL, ok: !!text }),
      (err) => ({ text: null as string | null, source: SCORING_MODEL, ok: false, err })
    ),
  ];

  // Promise.any-style: first success wins, fall back to last error if all fail.
  type Winner = { text: string; source: string };
  const winnerBox: { value: Winner | null } = { value: null };
  let lastErr: unknown = null;
  await new Promise<void>((resolve) => {
    let settled = 0;
    for (const p of attempts) {
      p.then((r) => {
        settled++;
        if (r.ok && r.text && !winnerBox.value) {
          winnerBox.value = { text: r.text, source: r.source };
          resolve();
          return;
        }
        if ("err" in r) lastErr = r.err;
        if (settled === attempts.length) resolve();
      });
    }
  });

  const won = winnerBox.value;
  if (!won) {
    throw lastErr ?? new Error("OCR: both models failed");
  }
  console.log(`OCR won by ${won.source} in ${Date.now() - t0}ms`);

  try {
    const parsed = JSON.parse(won.text) as { wines: ScannedWine[] };
    return parsed.wines ?? [];
  } catch (parseErr) {
    console.error("OCR JSON parse failed:", parseErr, won.text.slice(0, 200));
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

Notes: ≤8 words capturing tasting character. No full sentences. Examples: "Earthy Barolo, trusted producer." / "Structured Merlot, Right Bank." / "Fruit-forward Napa Cab."

ALSO pick a top "verdict" (the single best wine) and two alternates:
- safer_pick: high-confidence, slightly lower ceiling than the verdict
- wild_card: lower-confidence but aligned with Mark's adventurous tendencies (one stretch he might love)

Use the wine INDEX (0-based, matching the input order) to reference picks.

${TASTE_PROFILE}`;

export type ScoredWine = {
  index: number;
  score: number;
  reasoning: string;
  notes: string;
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
          notes: { type: Type.STRING },
          confidence: {
            type: Type.STRING,
            enum: ["high", "medium", "low"],
          },
          skip_reason: { type: Type.STRING, nullable: true },
        },
        required: ["index", "score", "reasoning", "notes", "confidence"],
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
  recognitionMatches: Record<number, { wineName: string; rating: number; date: string }>,
  wineTypeConstraint?: string,
  budget?: number
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

  const constraints: string[] = [];
  if (wineTypeConstraint) {
    constraints.push(`Mark wants only ${wineTypeConstraint.toUpperCase()} wines tonight. All three picks (verdict, safer_pick, wild_card) MUST be ${wineTypeConstraint}.`);
  }
  if (budget) {
    constraints.push(`Mark's target price tonight: $${budget}. All three picks should be at or under this price. Hard ceiling: $${Math.round(budget * 1.3)}. NEVER pick something more expensive than the ceiling, even if it scores higher — the experience of overpaying ruins the wine for him.`);
  }
  const constraint = constraints.length > 0 ? constraints.join("\n") + "\n\n" : "";

  const userPrompt = `${constraint}Here is the wine list (indexed). Score every wine and pick the verdict + alternates.

${wineLines}`;

  // Race Lite (fast, no thinking) vs Flash (slower, with thinking) — take whichever returns first.
  // Flash Lite scores in ~3s when available; Flash with thinkingBudget takes 7-12s.
  const callScoring = (model: string, withThinking: boolean) =>
    ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: SCORING_PROMPT,
        responseMimeType: "application/json",
        responseSchema: SCORING_SCHEMA,
        temperature: 0.4,
        ...(withThinking ? { thinkingConfig: { thinkingBudget: 128 } } : {}),
        maxOutputTokens: 3072,
      },
    });

  const t0 = Date.now();
  const attempts = [
    callScoring(OCR_MODEL, false).then(
      (res) => ({ text: res.text ?? null, source: OCR_MODEL, ok: !!res.text }),
      (err) => ({ text: null as string | null, source: OCR_MODEL, ok: false, err })
    ),
    callScoring(SCORING_MODEL, true).then(
      (res) => ({ text: res.text ?? null, source: SCORING_MODEL, ok: !!res.text }),
      (err) => ({ text: null as string | null, source: SCORING_MODEL, ok: false, err })
    ),
  ];

  type Winner = { text: string; source: string };
  const winnerBox: { value: Winner | null } = { value: null };
  let lastErr: unknown = null;
  await new Promise<void>((resolve) => {
    let settled = 0;
    for (const p of attempts) {
      p.then((r) => {
        settled++;
        if (r.ok && r.text && !winnerBox.value) {
          winnerBox.value = { text: r.text, source: r.source };
          resolve();
          return;
        }
        if ("err" in r) lastErr = r.err;
        if (settled === attempts.length) resolve();
      });
    }
  });

  const won = winnerBox.value;
  if (!won) {
    throw lastErr ?? new Error("Scoring: both models failed");
  }
  console.log(`Scoring won by ${won.source} in ${Date.now() - t0}ms`);

  const text = won.text;
  if (!text) throw new Error("Empty scoring response");
  return JSON.parse(text) as ScoringResult;
}
