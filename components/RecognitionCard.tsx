type Props = {
  winery: string;
  wineName: string;
  vintage: number | null;
  region: string | null;
  userRating: number;
  ratedAt: string | null;
};

export function RecognitionCard({
  winery,
  wineName,
  vintage,
  region,
  userRating,
  ratedAt,
}: Props) {
  const dateLabel = ratedAt
    ? new Date(ratedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "";

  return (
    <article
      className="relative w-full rounded-md p-6 recognition-enter"
      style={{
        background: "var(--color-cream)",
        border: "1px solid var(--color-paper-shadow)",
        transform: "rotate(-1.2deg)",
      }}
    >
      <header
        className="mb-6 flex items-center justify-center"
        style={{
          borderBottom: "1px solid var(--color-aged-gold)",
          paddingBottom: 8,
        }}
      >
        <span
          className="font-display italic text-sm tracking-wide"
          style={{ color: "var(--color-aged-gold)" }}
        >
          {dateLabel || "Tasted"}
        </span>
      </header>

      <h2
        className="font-display italic text-3xl leading-tight"
        style={{ color: "var(--color-ink)" }}
      >
        You've had this.
      </h2>

      <div className="mt-5 space-y-1">
        <div
          className="font-display italic text-base"
          style={{ color: "var(--color-kraft)" }}
        >
          {winery}
        </div>
        <div
          className="font-display text-2xl"
          style={{ color: "var(--color-ink)" }}
        >
          {wineName}
        </div>
        <div
          className="font-display text-base"
          style={{ color: "var(--color-ink)", opacity: 0.7 }}
        >
          {[region, vintage].filter(Boolean).join("  ")}
        </div>
      </div>

      <div className="mt-6 flex items-baseline gap-2">
        <span
          className="font-mono text-4xl"
          style={{ color: "var(--color-aged-gold)" }}
        >
          {userRating.toFixed(1)}
        </span>
        <span
          className="font-display text-2xl"
          style={{ color: "var(--color-aged-gold)" }}
        >
          ★
        </span>
      </div>

      <div
        className="mt-6 font-display italic text-sm"
        style={{ color: "var(--color-ink)", opacity: 0.6 }}
      >
        Order it again →
      </div>
    </article>
  );
}
