"use client";

import { useState } from "react";
import { VerdictHero } from "@/components/VerdictHero";
import { RecognitionCard } from "@/components/RecognitionCard";
import { AlternatePill } from "@/components/AlternatePill";
import { ProcessingSeal } from "@/components/ProcessingSeal";
import { WaxSeal } from "@/components/WaxSeal";
import { FullRankedSheet } from "@/components/FullRankedSheet";

const SAMPLE_WINE = {
  winery: "Vietti",
  name: "Castiglione",
  vintage: 2018,
  region: "Barolo",
  varietal: "Nebbiolo",
  price_usd: 94,
  by_glass: false,
};

const SAMPLE_SCORE = {
  index: 0,
  score: 4.3,
  reasoning: "Earthy Nebbiolo from a producer you've trusted before.",
  confidence: "high" as const,
  skip_reason: null,
};

const SAMPLE_ENRICHMENT = {
  taste_structure: { acidity: 0.74, tannin: 0.78, intensity: 0.88 },
  avg_rating: 4.4,
  food_pairings: ["beef", "lamb", "aged cheese"],
};

const FULL_LIST_WINES = [
  SAMPLE_WINE,
  { winery: "Clos Saint Jean", name: "Châteauneuf-du-Pape", vintage: 2019, region: "Châteauneuf-du-Pape", varietal: "Grenache", price_usd: 145, by_glass: false },
  { winery: "Tenuta Il Poggione", name: "Brunello di Montalcino", vintage: 2018, region: "Montalcino", varietal: "Sangiovese", price_usd: 120, by_glass: false },
  { winery: "House", name: "Pinot Noir", vintage: null, region: null, varietal: "Pinot Noir", price_usd: 14, by_glass: true },
  { winery: "Frog's Leap", name: "Zinfandel", vintage: 2021, region: "Napa", varietal: "Zinfandel", price_usd: 65, by_glass: false },
];

const FULL_LIST_SCORES = [
  { index: 0, score: 4.3, reasoning: "Earthy Nebbiolo from a producer you've trusted before.", confidence: "high" as const, skip_reason: null },
  { index: 1, score: 4.8, reasoning: "Clos Saint Jean is a benchmark — this is your sweet spot.", confidence: "high" as const, skip_reason: null },
  { index: 2, score: 4.5, reasoning: "Most reliable Brunello producer, classic Tier 1.", confidence: "high" as const, skip_reason: null },
  { index: 3, score: 1.5, reasoning: "Generic Pinot Noir, no producer. Pass.", confidence: "low" as const, skip_reason: "generic" },
  { index: 4, score: 3.2, reasoning: "Decent Zin but young, lacks the earthy depth you'd want.", confidence: "medium" as const, skip_reason: "fruit-forward" },
];

export default function DemoPage() {
  const [view, setView] = useState<"verdict" | "recognition" | "processing" | "list">("verdict");
  const [showFullList, setShowFullList] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <main className="min-h-dvh px-5 py-8 max-w-md mx-auto">
      <header className="flex items-center justify-between mb-4">
        <span className="text-xs uppercase tracking-wider" style={{ color: "var(--color-kraft)" }}>
          design preview
        </span>
        <WaxSeal size={28} />
      </header>

      <nav className="mb-6 flex gap-2 text-xs">
        {(["verdict", "recognition", "processing", "list"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="px-2 py-1 rounded"
            style={{
              background: view === v ? "var(--color-bordeaux)" : "transparent",
              color: view === v ? "var(--color-cream)" : "var(--color-ink)",
              border: "1px solid var(--color-paper-shadow)",
            }}
          >
            {v}
          </button>
        ))}
      </nav>

      {view === "verdict" && (
        <>
          <VerdictHero
            wine={SAMPLE_WINE}
            scored={SAMPLE_SCORE}
            enrichment={SAMPLE_ENRICHMENT}
            expanded={expanded}
            onExpand={() => setExpanded((v) => !v)}
          />
          <div className="mt-4 flex gap-3">
            <AlternatePill
              label="Closer to home"
              wineName="Tenuta Il Poggione Brunello"
              variant="safer"
            />
            <AlternatePill
              label="Worth a gamble"
              wineName="Faiveley Latricières-Chambertin"
              variant="wild"
            />
          </div>
        </>
      )}

      {view === "recognition" && (
        <>
          <RecognitionCard
            winery="Château Pavie"
            wineName="Saint-Émilion Grand Cru"
            vintage={2015}
            region="Saint-Émilion"
            userRating={4.8}
            ratedAt="2024-03-12"
          />
          <div className="mt-4 text-center">
            <button
              className="text-sm font-display italic"
              style={{ color: "var(--color-bordeaux)" }}
            >
              Still scoring 4.4 tonight →
            </button>
          </div>
        </>
      )}

      {view === "processing" && (
        <ProcessingSeal totalWines={47} recognitionCount={3} />
      )}

      {view === "list" && (
        <button
          onClick={() => setShowFullList(true)}
          className="w-full py-4 rounded-md tracking-wide"
          style={{
            background: "var(--color-bordeaux)",
            color: "var(--color-cream)",
          }}
        >
          Open the full list
        </button>
      )}

      <FullRankedSheet
        wines={FULL_LIST_WINES}
        scored={FULL_LIST_SCORES}
        open={showFullList}
        onClose={() => setShowFullList(false)}
      />
    </main>
  );
}
