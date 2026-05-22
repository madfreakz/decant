export type JournalEntry = {
  id: string;
  winery: string;
  wine_name: string;
  vintage: number | null;
  score: number;
  reasoning: string;
  recognized: boolean;
  ts: number;
};

const KEY = "decant:verdictJournal";
const MAX_ENTRIES = 12;

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function loadJournal(): JournalEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as JournalEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function saveVerdict(entry: Omit<JournalEntry, "id" | "ts">): JournalEntry {
  const full: JournalEntry = {
    ...entry,
    id: crypto.randomUUID(),
    ts: Date.now(),
  };
  if (!isBrowser()) return full;
  const existing = loadJournal();
  const dedupKey = `${entry.winery}|${entry.wine_name}|${entry.vintage}`;
  const filtered = existing.filter(
    (e) => `${e.winery}|${e.wine_name}|${e.vintage}` !== dedupKey
  );
  const next = [full, ...filtered].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
  return full;
}
