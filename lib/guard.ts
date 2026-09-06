// Request guard for the public API routes.
//
// Decant is a single-user PWA on a public Vercel URL with no login, and all
// three API routes spend real Gemini quota on Mark's key. Before this, anyone
// who found the URL could POST at will. This is defense in depth, not a wall:
//
//  1. Same-origin check (POST only) — the app's own fetch() always sends an
//     Origin matching Host. curl and drive-by scripts don't. Trivially forged
//     by anyone who reads this file, but it stops the untargeted case.
//  2. Per-IP sliding window — in-memory, so it is PER LAMBDA INSTANCE, not
//     global. A distributed caller can dodge it by landing on cold instances.
//     Deliberate: decant is used a handful of times a month, so a shared
//     Upstash counter would sit idle long enough to get archived on the free
//     tier (see memory: decant-upstash-keepalive). Instance-local is the right
//     size for the threat. Revisit if the app ever gets real traffic.
//  3. Hard input caps — enforced per route, independent of caller identity.
//     This is the layer that actually bounds worst-case spend.

export type GuardFailure = { status: number; error: string };

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

// ip -> timestamps within the current window
const hits = new Map<string, number[]>();
let lastSweep = 0;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** Drop stale buckets so the Map can't grow without bound on a warm instance. */
function sweep(now: number): void {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [ip, times] of hits) {
    const live = times.filter((t) => now - t < WINDOW_MS);
    if (live.length === 0) hits.delete(ip);
    else hits.set(ip, live);
  }
}

function rateLimit(req: Request): GuardFailure | null {
  const now = Date.now();
  sweep(now);
  const ip = clientIp(req);
  const times = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= MAX_PER_WINDOW) {
    return { status: 429, error: "Too many requests. Wait a minute and try again." };
  }
  times.push(now);
  hits.set(ip, times);
  return null;
}

/**
 * Same-origin check. A browser fetch() to our own API sends an Origin whose
 * host equals the Host header. GET warm-ups don't send Origin at all, so this
 * only runs for POST.
 */
function sameOrigin(req: Request): GuardFailure | null {
  const origin = req.headers.get("origin");
  if (!origin) {
    // No Origin on a POST means it did not come from a browser page.
    return { status: 403, error: "Forbidden" };
  }
  const host = req.headers.get("host");
  if (!host) return null; // can't compare; let the rate limiter carry it
  try {
    if (new URL(origin).host !== host) {
      return { status: 403, error: "Forbidden" };
    }
  } catch {
    return { status: 403, error: "Forbidden" };
  }
  return null;
}

/** Returns a failure to respond with, or null to proceed. */
export function guardRequest(req: Request): GuardFailure | null {
  if (req.method === "POST") {
    const origin = sameOrigin(req);
    if (origin) return origin;
  }
  return rateLimit(req);
}
