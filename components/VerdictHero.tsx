import type { ScannedWine, ScoredWine } from "@/lib/gemini";
import { WaxSeal } from "./WaxSeal";

type Enrichment = {
  taste_structure: { acidity: number | null; tannin: number | null; intensity: number | null } | null;
  avg_rating: number | null;
  food_pairings: string[];
};

type Props = {
  wine: ScannedWine;
  scored: ScoredWine;
  enrichment?: Enrichment | null;
  expanded?: boolean;
  onExpand?: () => void;
};

export function VerdictHero({ wine, scored, enrichment, expanded, onExpand }: Props) {
  const conf = scored.confidence;
  const confColor =
    conf === "high" ? "var(--color-bordeaux)" : conf === "medium" ? "var(--color-aged-gold)" : "var(--color-paper-shadow)";

  return (
    <article
      className="relative w-full rounded-md p-6 verdict-reveal"
      style={{
        background:
          "linear-gradient(180deg, var(--color-cream) 0%, var(--color-cream-shade) 100%)",
        border: "1px solid var(--color-paper-shadow)",
        boxShadow: "inset 0 0 0 1px rgba(217, 207, 194, 0.4)",
      }}
    >
      <header className="flex items-center gap-3 mb-6">
        <WaxSeal size={36} />
        <span
          className="font-display italic text-sm tracking-wide"
          style={{ color: "var(--color-kraft)" }}
        >
          Tonight's verdict
        </span>
      </header>

      <div className="space-y-1">
        <div
          className="font-display italic text-lg"
          style={{ color: "var(--color-kraft)" }}
        >
          {wine.winery}
        </div>
        <h2
          className="font-display text-4xl leading-tight"
          style={{
            color: "var(--color-ink)",
            letterSpacing: "-0.01em",
          }}
        >
          {wine.name || "—"}
        </h2>
        <div
          className="font-display text-base"
          style={{ color: "var(--color-ink)", opacity: 0.7 }}
        >
          {[wine.region, wine.vintage].filter(Boolean).join("  ")}
        </div>
      </div>

      <div
        className="my-6 h-px"
        style={{ background: "var(--color-paper-shadow)" }}
      />

      <div className="flex items-end gap-4">
        <StructureBars structure={enrichment?.taste_structure ?? null} />
        <div className="flex items-baseline gap-1">
          <span
            className="font-mono text-3xl"
            style={{ color: "var(--color-ink)" }}
          >
            {scored.score.toFixed(1)}
          </span>
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: confColor }}
            aria-label={`${conf} confidence`}
          />
        </div>
      </div>

      <p
        className="mt-5 font-display italic text-lg leading-snug"
        style={{ color: "var(--color-ink)", opacity: 0.85 }}
      >
        {expanded ? scored.reasoning : (scored.notes || scored.reasoning)}
      </p>

      {expanded && enrichment && (
        <div
          className="mt-5 pt-5"
          style={{ borderTop: "1px solid var(--color-paper-shadow)" }}
        >
          {enrichment.avg_rating != null && (
            <div className="text-sm" style={{ color: "var(--color-kraft)" }}>
              Vivino community: <span className="font-mono">{enrichment.avg_rating.toFixed(1)}★</span>
            </div>
          )}
          {enrichment.food_pairings.length > 0 && (
            <div
              className="mt-2 font-display italic text-sm"
              style={{ color: "var(--color-kraft)" }}
            >
              Pairs with {enrichment.food_pairings.slice(0, 2).join(", ")}.
            </div>
          )}
        </div>
      )}

      <footer className="mt-6 flex items-center justify-between">
        <span
          className="text-sm"
          style={{ color: "var(--color-ink)", opacity: 0.6, fontFamily: "var(--font-ui)" }}
        >
          {wine.price_usd != null ? `$${wine.price_usd}` : ""}
        </span>
        <button
          onClick={onExpand}
          className="text-sm tracking-wide"
          style={{ color: "var(--color-ink)", opacity: 0.6 }}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? "▲" : "▼"}
        </button>
      </footer>
    </article>
  );
}

function StructureBars({
  structure,
}: {
  structure: { acidity: number | null; tannin: number | null; intensity: number | null } | null;
}) {
  const bars = [
    structure?.intensity ?? 0.7,
    structure?.tannin ?? 0.65,
    structure?.acidity ?? 0.6,
  ];
  return (
    <div className="flex flex-col gap-1.5">
      {bars.map((v, i) => (
        <div
          key={i}
          className="rounded-sm overflow-hidden"
          style={{
            width: 56,
            height: 5,
            background: "var(--color-paper-shadow)",
          }}
        >
          <div
            style={{
              width: `${Math.max(0, Math.min(1, v)) * 100}%`,
              height: "100%",
              background: "var(--color-bordeaux)",
            }}
          />
        </div>
      ))}
    </div>
  );
}
