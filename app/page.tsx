import { WaxSeal } from "@/components/WaxSeal";
import { VerdictJournal } from "@/components/VerdictJournal";

export default function Home() {
  return (
    <main className="min-h-dvh flex flex-col px-6 py-10 max-w-md mx-auto">
      <header className="flex items-center gap-3">
        <WaxSeal size={32} />
        <span className="font-display italic text-lg" style={{ color: "var(--color-ink)" }}>
          Decant
        </span>
      </header>

      <section className="flex-1 flex flex-col justify-center max-w-md">
        <h1
          className="font-display text-4xl leading-tight"
          style={{ color: "var(--color-ink)" }}
        >
          Point this at the wine list when it arrives.
        </h1>
        <p
          className="mt-5 font-display italic text-base"
          style={{ color: "var(--color-kraft)" }}
        >
          Tonight's verdict, grounded in the bottles you've already loved.
        </p>
      </section>

      <VerdictJournal />

      <footer className="mt-8">
        <a
          href="/scan"
          className="block w-full text-center py-4 rounded-md font-medium tracking-wide"
          style={{
            background: "var(--color-bordeaux)",
            color: "var(--color-cream)",
            fontFamily: "var(--font-ui)",
          }}
        >
          Read a wine list
        </a>
      </footer>
    </main>
  );
}
