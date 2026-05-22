"use client";

import type { ScannedWine, ScoredWine } from "@/lib/gemini";

type Props = {
  wines: ScannedWine[];
  scored: ScoredWine[];
  open: boolean;
  onClose: () => void;
};

export function FullRankedSheet({ wines, scored, open, onClose }: Props) {
  if (!open) return null;

  const sortedScored = [...scored].sort((a, b) => b.score - a.score);
  const goodPicks = sortedScored.filter((s) => s.score >= 3.5);
  const skips = sortedScored.filter((s) => s.score < 3.5);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "var(--color-cream)" }}
    >
      <header
        className="px-6 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--color-paper-shadow)" }}
      >
        <h3
          className="font-display italic text-lg"
          style={{ color: "var(--color-ink)" }}
        >
          The full list
        </h3>
        <button
          onClick={onClose}
          className="text-sm tracking-wide"
          style={{ color: "var(--color-ink)", opacity: 0.6 }}
        >
          Close
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <ul className="space-y-3">
          {goodPicks.map((s) => {
            const w = wines[s.index];
            return (
              <li
                key={s.index}
                className="flex items-baseline justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div
                    className="font-display truncate"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {w.winery} {w.name}
                    {w.vintage && (
                      <span style={{ color: "var(--color-ink)", opacity: 0.6 }}>
                        {" "}
                        {w.vintage}
                      </span>
                    )}
                  </div>
                  <div
                    className="font-display italic text-xs mt-0.5"
                    style={{ color: "var(--color-kraft)" }}
                  >
                    {s.reasoning}
                  </div>
                </div>
                <span className="font-mono" style={{ color: "var(--color-ink)" }}>
                  {s.score.toFixed(1)}
                </span>
              </li>
            );
          })}
        </ul>

        {skips.length > 0 && (
          <>
            <div
              className="mt-8 mb-4 text-[10px] uppercase tracking-wider text-center"
              style={{
                color: "var(--color-kraft)",
                fontFamily: "var(--font-ui)",
                borderTop: "1px dotted var(--color-aged-gold)",
                paddingTop: 16,
              }}
            >
              Skip these
            </div>
            <ul className="space-y-2">
              {skips.map((s) => {
                const w = wines[s.index];
                return (
                  <li
                    key={s.index}
                    className="flex items-baseline justify-between gap-3"
                    style={{ opacity: 0.6 }}
                  >
                    <div className="flex-1 min-w-0">
                      <div
                        className="font-display truncate text-sm"
                        style={{ color: "var(--color-ink)" }}
                      >
                        {w.winery} {w.name}
                      </div>
                    </div>
                    {s.skip_reason && (
                      <span
                        className="font-display italic text-xs"
                        style={{ color: "var(--color-kraft)" }}
                      >
                        {s.skip_reason}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
