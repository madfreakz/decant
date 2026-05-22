import axios, { AxiosError } from "axios";

const VIVINO_BASE_URL = "https://www.vivino.com";
const VIVINO_API_BASE = "https://www.vivino.com/api";

const MIN_REQUEST_INTERVAL_MS = 700;
const RETRY_AFTER_429_MS = 60_000;
const RETRY_AFTER_5XX_MS = 2_000;
const CACHE_TTL_MS = 60 * 60 * 1000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";

// Per-invocation cache. Serverless cold starts drop it; that's fine.
const cache = new Map<string, { data: unknown; expiresAt: number }>();

async function getCached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data as T;
  const data = await fetcher();
  // Don't cache falsy results (null, empty array) — we want to retry next time
  if (data != null && !(Array.isArray(data) && data.length === 0)) {
    cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return data;
}

let lastRequestAt = 0;
async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

function baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `${VIVINO_BASE_URL}/`,
    Origin: VIVINO_BASE_URL,
    ...extra,
  };
  const cookie = process.env.VIVINO_SESSION_COOKIE;
  if (cookie) h["Cookie"] = cookie;
  return h;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  await throttle();
  try {
    return await fn();
  } catch (err) {
    const e = err as AxiosError;
    if (e.response?.status === 429) {
      const wait =
        Number(e.response.headers["retry-after"] ?? 0) * 1000 || RETRY_AFTER_429_MS;
      await new Promise((r) => setTimeout(r, wait));
      await throttle();
      return fn();
    }
    if (e.response && e.response.status >= 500) {
      await new Promise((r) => setTimeout(r, RETRY_AFTER_5XX_MS));
      await throttle();
      return fn();
    }
    throw err;
  }
}

const apiHttp = axios.create({
  baseURL: VIVINO_API_BASE,
  timeout: 15_000,
});

// Always rebuild headers per request so env changes pick up
function apiGet(path: string, params?: Record<string, unknown>) {
  return apiHttp.get(path, {
    params,
    headers: baseHeaders({
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    }),
  });
}

// Some wine_ids 404 against /api/wines/{id} because they're routing IDs, not vintage IDs.
// The real vintage ID lives in the wine page HTML as `"vintage":{"id":N}`.
async function scrapeVintageId(wineUrl: string): Promise<number | null> {
  try {
    const res = await withRetry(() =>
      axios.get(wineUrl, { headers: baseHeaders(), timeout: 15_000 })
    );
    const html = String(res.data);
    const m = html.match(/"vintage":\{"id":(\d+)/);
    return m ? parseInt(m[1]) : null;
  } catch {
    return null;
  }
}

export type VivinoSearchHit = {
  wine_id: number;
  name: string;
  winery: string;
  region: string | null;
  country: string | null;
  avg_rating: number | null;
  ratings_count: number | null;
  vivino_url: string | null;
  vintage_year: number | null;
};

export type VivinoTasteStructure = {
  acidity: number | null;
  sweetness: number | null;
  tannin: number | null;
  intensity: number | null;
  fizziness: number | null;
};

export type VivinoDetails = {
  wine_id: number;
  name: string;
  winery: string;
  region: string | null;
  country: string | null;
  grape_varieties: string[];
  abv: number | null;
  avg_rating: number | null;
  ratings_count: number | null;
  food_pairings: string[];
  image_url: string | null;
  vivino_url: string | null;
  taste_structure: VivinoTasteStructure | null;
};

function parseSearchHits(raw: unknown): VivinoSearchHit[] {
  const d = raw as { explore_vintage?: { matches?: unknown[] } };
  const matches = d?.explore_vintage?.matches ?? [];
  return matches.flatMap((item) => {
    const m = item as Record<string, unknown>;
    const vintage = m.vintage as Record<string, unknown> | undefined;
    const wine = vintage?.wine as Record<string, unknown> | undefined;
    const winery = wine?.winery as Record<string, unknown> | undefined;
    const region = wine?.region as Record<string, unknown> | undefined;
    const country = region?.country as Record<string, unknown> | undefined;
    const stats = vintage?.statistics as Record<string, unknown> | undefined;
    if (!wine) return [];
    return [
      {
        wine_id: Number(wine.id),
        name: String(wine.name ?? ""),
        winery: String(winery?.name ?? ""),
        region: region ? String(region.name) : null,
        country: country ? String(country.name) : null,
        avg_rating:
          stats?.ratings_average != null ? Number(stats.ratings_average) : null,
        ratings_count:
          stats?.ratings_count != null ? Number(stats.ratings_count) : null,
        vintage_year: vintage?.year != null ? Number(vintage.year) : null,
        vivino_url: wine.seo_name
          ? `https://www.vivino.com/wines/${wine.seo_name}`
          : null,
      },
    ];
  });
}

export async function searchWines(query: string, perPage = 10): Promise<VivinoSearchHit[]> {
  return getCached(`search:${query}:${perPage}`, async () => {
    // Vivino's /explore/explore requires at least one filter beyond `q`.
    // Use min_rating=1 (every rated wine matches) as a no-op filter to satisfy validation.
    const res = await withRetry(() =>
      apiGet("/explore/explore", {
        q: query,
        per_page: perPage,
        page: 1,
        min_rating: 1.0,
      })
    );
    return parseSearchHits(res.data);
  });
}

function parseTasteStructure(raw: unknown): VivinoTasteStructure | null {
  const d = raw as Record<string, unknown>;
  const tastes = (d.tastes ?? d) as Record<string, unknown>;
  const structure = tastes?.structure as Record<string, unknown> | undefined;
  if (!structure) return null;
  const norm = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    if (!isFinite(n)) return null;
    return Math.max(0, Math.min(1, n / 5));
  };
  return {
    acidity: norm(structure.acidity),
    sweetness: norm(structure.sweetness),
    tannin: norm(structure.tannin),
    intensity: norm(structure.intensity),
    fizziness: norm(structure.fizziness),
  };
}

function parseDetails(rawDetails: unknown, rawTastes: unknown): VivinoDetails {
  const d = rawDetails as Record<string, unknown>;
  const vintageObj = d.vintage as Record<string, unknown> | undefined;
  const wine = (vintageObj?.wine ?? d.wine ?? d) as Record<string, unknown>;
  const winery = wine.winery as Record<string, unknown> | undefined;
  const region = wine.region as Record<string, unknown> | undefined;
  const country = region?.country as Record<string, unknown> | undefined;
  const stats = (vintageObj?.statistics ?? wine.statistics) as
    | Record<string, unknown>
    | undefined;
  const grapes = (wine.grapes as Array<Record<string, unknown>>) ?? [];
  const food = (wine.food as Array<Record<string, unknown>>) ?? [];

  return {
    wine_id: Number(wine.id),
    name: String(wine.name ?? ""),
    winery: String(winery?.name ?? ""),
    region: region ? String(region.name) : null,
    country: country ? String(country.name) : null,
    grape_varieties: grapes.map((g) => String(g.name ?? "")).filter(Boolean),
    abv: wine.alcohol != null ? Number(wine.alcohol) : null,
    avg_rating: stats?.ratings_average != null ? Number(stats.ratings_average) : null,
    ratings_count: stats?.ratings_count != null ? Number(stats.ratings_count) : null,
    food_pairings: food.map((f) => String(f.name ?? "")).filter(Boolean),
    image_url:
      ((wine.label_image_url ??
        (wine.image as Record<string, unknown> | undefined)?.location) as
        | string
        | undefined) ?? null,
    vivino_url: wine.seo_name
      ? `https://www.vivino.com/wines/${wine.seo_name}`
      : null,
    taste_structure: parseTasteStructure(rawTastes),
  };
}

export async function getWineDetailsWithTaste(
  wineId: number,
  wineUrl?: string | null
): Promise<VivinoDetails | null> {
  return getCached(`details+taste:${wineId}`, async () => {
    try {
      // Try wine endpoint first
      let detailsData: unknown;
      try {
        const detailsRes = await withRetry(() => apiGet(`/wines/${wineId}`));
        detailsData = detailsRes.data;
      } catch (err) {
        const e = err as AxiosError;
        if (e.response?.status === 404 && wineUrl) {
          // Fall back to vintage endpoint via page scrape
          const vintageId = await scrapeVintageId(wineUrl);
          if (!vintageId) return null;
          const vintageRes = await withRetry(() => apiGet(`/vintages/${vintageId}`));
          detailsData = vintageRes.data;
        } else {
          throw err;
        }
      }
      // Tastes endpoint uses the same wine_id; if it 404s, structure stays null
      let tastesData: unknown = {};
      try {
        const tastesRes = await withRetry(() => apiGet(`/wines/${wineId}/tastes`));
        tastesData = tastesRes.data;
      } catch {
        // structure will be null; we still have details
      }
      return parseDetails(detailsData, tastesData);
    } catch {
      return null;
    }
  });
}

export class VivinoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VivinoUnavailableError";
  }
}

export async function checkVivinoHealth(): Promise<boolean> {
  try {
    const hits = await searchWines("château margaux", 1);
    return hits.length > 0;
  } catch {
    return false;
  }
}
