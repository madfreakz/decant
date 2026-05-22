"use client";

import { useEffect, useState } from "react";
import { WaxSeal } from "./WaxSeal";

const STATIC_LINES = [
  "Cross-checking your trusted producers.",
  "Looking for something earthy enough.",
  "Almost there.",
];

const VAULT_FACTS = [
  "Your last 5★ was a Faugères. The Syrah was relentless.",
  "You've never met a Brunello you didn't like.",
  "Pinot Noir from the Côte de Nuits. It's a pattern.",
  "Pomerol 1982 set the bar high. Few menus clear it.",
  "Châteauneuf-du-Pape. Clos Saint Jean. Twice. Five stars each time.",
];

type Props = {
  totalWines: number;
  recognitionCount: number;
};

export function ProcessingSeal({ totalWines, recognitionCount }: Props) {
  const lines = [
    `Reading ${totalWines} wines.`,
    ...STATIC_LINES,
    recognitionCount > 0
      ? `${recognitionCount === 1 ? "One" : recognitionCount} you've had before.`
      : "Nothing you've tried before.",
    ...VAULT_FACTS.slice(0, 2),
  ];

  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % lines.length), 2800);
    return () => clearInterval(t);
  }, [lines.length]);

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <WaxSeal size={88} rotating />
      <p
        key={idx}
        className="mt-12 font-display italic text-lg text-center max-w-md transition-opacity duration-200"
        style={{ color: "var(--color-ink)", opacity: 0.7 }}
      >
        {lines[idx]}
      </p>
    </div>
  );
}
