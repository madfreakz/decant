"use client";

import type { CapturedPage } from "@/lib/scan-state";

type Props = {
  pages: CapturedPage[];
  onRetake: (id: string) => void;
  onAddPage: () => void;
};

export function PageThumbStrip({ pages, onRetake, onAddPage }: Props) {
  return (
    <div className="flex flex-wrap items-start gap-3 justify-center">
      {pages.map((page, i) => (
        <button
          key={page.id}
          onClick={() => onRetake(page.id)}
          className="block transition-transform active:scale-95"
          style={{
            transform: `rotate(${i % 2 === 0 ? -2 : 2}deg)`,
          }}
        >
          <div
            className="relative w-20 h-28 rounded overflow-hidden"
            style={{
              border: "1px solid var(--color-paper-shadow)",
              background: "var(--color-cream)",
              boxShadow: "inset 0 0 0 1px rgba(217, 207, 194, 0.4)",
            }}
          >
            {page.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={page.previewUrl}
                alt={`Page ${i + 1}`}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs" style={{ color: "var(--color-kraft)" }}>
                {page.status === "uploading" ? "…" : ""}
              </div>
            )}
          </div>
          <div
            className="mt-1 text-center text-[10px] uppercase tracking-wider"
            style={{ color: "var(--color-kraft)", fontFamily: "var(--font-ui)" }}
          >
            {page.status === "done"
              ? `${page.wineCount} wine${page.wineCount === 1 ? "" : "s"}`
              : page.status === "uploading"
              ? "Reading…"
              : page.status === "error"
              ? "Try again"
              : ""}
          </div>
        </button>
      ))}

      <button
        onClick={onAddPage}
        className="block transition-transform active:scale-95"
        style={{ transform: `rotate(${pages.length % 2 === 0 ? -2 : 2}deg)` }}
      >
        <div
          className="w-20 h-28 rounded flex items-center justify-center"
          style={{
            border: "1px dashed var(--color-paper-shadow)",
            background: "transparent",
            color: "var(--color-kraft)",
          }}
        >
          <span className="text-2xl font-display">+</span>
        </div>
        <div
          className="mt-1 text-center text-[10px] uppercase tracking-wider"
          style={{ color: "var(--color-kraft)", fontFamily: "var(--font-ui)" }}
        >
          Add a page
        </div>
      </button>
    </div>
  );
}
