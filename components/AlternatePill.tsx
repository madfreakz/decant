type Props = {
  label: string;
  wineName: string;
  notes: string;
  score: number;
  price: number | null;
  variant: "safer" | "wild" | "verdict";
  onClick?: () => void;
};

export function AlternatePill({ label, wineName, notes, score, price, variant, onClick }: Props) {
  const accent =
    variant === "safer"
      ? "var(--color-bottle-green)"
      : variant === "verdict"
      ? "var(--color-bordeaux)"
      : "var(--color-aged-gold)";
  return (
    <button
      onClick={onClick}
      className="flex-1 min-w-0 px-4 py-3 rounded-md text-left transition-transform active:scale-[0.97]"
      style={{
        background: "var(--color-cream)",
        border: `1px solid var(--color-paper-shadow)`,
      }}
    >
      <div
        className="text-[10px] uppercase tracking-wider"
        style={{ color: accent, fontFamily: "var(--font-ui)" }}
      >
        {label}
      </div>
      <div
        className="mt-1 font-display text-sm leading-snug truncate"
        style={{ color: "var(--color-ink)" }}
      >
        {wineName}
      </div>
      <div
        className="mt-1 font-display italic text-xs leading-snug truncate"
        style={{ color: "var(--color-kraft)" }}
      >
        {notes}
      </div>
      <div
        className="mt-2 text-[11px] flex gap-2"
        style={{ color: "var(--color-ink)", opacity: 0.6, fontFamily: "var(--font-ui)" }}
      >
        <span className="font-mono">{score.toFixed(1)}</span>
        {price != null && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>${price}</span>
          </>
        )}
      </div>
    </button>
  );
}
