"use client";

import { useEffect, useState } from "react";
import { loadJournal, type JournalEntry } from "@/lib/verdict-journal";
import { WaxSeal } from "./WaxSeal";

export function VerdictJournal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);

  useEffect(() => {
    setEntries(loadJournal());
  }, []);

  if (entries.length === 0) return null;

  return (
    <section className="mt-8">
      <div
        className="px-1 mb-3 text-[11px] uppercase tracking-wider"
        style={{ color: "var(--color-kraft)", fontFamily: "var(--font-ui)" }}
      >
        Recent verdicts
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
        {entries.map((e, i) => (
          <article
            key={e.id}
            className="flex-shrink-0 rounded-md p-3 flex flex-col gap-2"
            style={{
              width: 120,
              height: 168,
              background: "var(--color-cream)",
              border: "1px solid var(--color-paper-shadow)",
              transform: `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`,
            }}
          >
            <WaxSeal size={22} />
            <div
              className="font-display text-sm leading-tight"
              style={{ color: "var(--color-ink)" }}
            >
              {e.wine_name || e.winery}
            </div>
            <div
              className="font-display italic text-xs"
              style={{ color: "var(--color-kraft)" }}
            >
              {e.winery}
              {e.vintage ? `  ${e.vintage}` : ""}
            </div>
            <div className="mt-auto flex items-baseline justify-between">
              <span
                className="font-mono text-sm"
                style={{ color: e.recognized ? "var(--color-aged-gold)" : "var(--color-ink)" }}
              >
                {e.score.toFixed(1)}
              </span>
              <span
                className="text-[10px]"
                style={{ color: "var(--color-kraft)", fontFamily: "var(--font-ui)" }}
              >
                {new Date(e.ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
