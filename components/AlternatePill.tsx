type Props = {
  label: string;
  wineName: string;
  variant: "safer" | "wild";
  onClick?: () => void;
};

export function AlternatePill({ label, wineName, variant, onClick }: Props) {
  const accent = variant === "safer" ? "var(--color-bottle-green)" : "var(--color-aged-gold)";
  return (
    <button
      onClick={onClick}
      className="flex-1 px-4 py-3 rounded-md text-left transition-transform active:scale-[0.97]"
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
    </button>
  );
}
