"use client";

import type { RatedWine } from "@/lib/rated-wines-index";

type Props = {
  receipts: RatedWine[];
  open: boolean;
  onClose: () => void;
};

export function ReceiptsSheet({ receipts, open, onClose }: Props) {
  if (!open) return null;

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
          The receipts
        </h3>
        <button
          onClick={onClose}
          className="text-sm tracking-wide"
          style={{ color: "var(--color-ink)", opacity: 0.6 }}
        >
          Close
        </button>
      </header>

      <p
        className="px-6 pt-4 font-display italic text-sm"
        style={{ color: "var(--color-kraft)" }}
      >
        Why this pick fits — bottles you've rated that anchor the call.
      </p>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {receipts.length === 0 ? (
          <p
            className="font-display italic text-sm text-center mt-8"
            style={{ color: "var(--color-kraft)" }}
          >
            No direct matches in your vault — the pick is inferred from style alone.
          </p>
        ) : (
          <ul className="space-y-5">
            {receipts.map((r, i) => (
              <li key={i}>
                <div
                  className="font-display italic text-xs"
                  style={{ color: "var(--color-kraft)" }}
                >
                  {r.winery}
                </div>
                <div
                  className="font-display"
                  style={{ color: "var(--color-ink)" }}
                >
                  {r.wine_name}
                  {r.vintage ? (
                    <span style={{ color: "var(--color-ink)", opacity: 0.6 }}>
                      {" "}
                      {r.vintage}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex items-baseline gap-3 text-xs" style={{ color: "var(--color-kraft)" }}>
                  <span
                    className="font-mono"
                    style={{ color: "var(--color-aged-gold)" }}
                  >
                    {(r.user_rating ?? 0).toFixed(1)}★
                  </span>
                  {r.rated_at && (
                    <span>
                      {new Date(r.rated_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
