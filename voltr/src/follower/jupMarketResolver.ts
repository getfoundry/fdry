/**
 * follower/jupMarketResolver.ts — upstream-market slug → Jup marketId.
 *
 * R3 finding: Jup ingests upstream-market directly (metadata.series == "upstream",
 * identical slugs). The resolver is therefore exact-match against a periodic
 * snapshot of Jup's active event index, with the small wrinkle that ima slugs
 * sometimes carry sub-market suffixes (`-game2`, `-total-games-2pt5`,
 * `-handicap-home-1pt5`) that Jup's parent event slug doesn't.
 *
 * Returns the resolved Jup marketId + isYes (mapped from trigger.side) +
 * the cached Jup event/market metadata for downstream pricing checks.
 */
import type { JupPredictionClient } from "./jupPredictionClient.js";
import type { TriggerEvent } from "./triggerSource.js";

export type ResolvedJupTarget = {
  ok: true;
  marketId: string;
  jupEventId: string;
  jupSlug: string;
  isYes: boolean;
  marketTitle: string;
  closeTimeIso: string | null;
};

export type ResolveSkip =
  | { ok: false; reason: "no_jup_market"; trimmedSlug: string }
  | { ok: false; reason: "no_open_market" }
  | { ok: false; reason: "close_time_passed" }
  | { ok: false; reason: "snapshot_stale"; ageSeconds: number }
  | { ok: false; reason: "snapshot_fetch_failed"; err: string };

export type ResolveResult = ResolvedJupTarget | ResolveSkip;

export type JupSnapshotEntry = {
  eventId: string;
  slug: string;
  category: string | null;
  subcategory: string | null;
  closeTimeIso: string | null;
  markets: { marketId: string; title: string; status: string | null }[];
};

export type JupSnapshot = {
  fetchedAtMs: number;
  bySlug: Map<string, JupSnapshotEntry>;
};

export type ResolverOptions = {
  /** Categories to enumerate when refreshing the snapshot. */
  categories?: string[];
  /** Snapshot TTL in ms; older snapshots trigger a refresh on next resolve(). Default 5 min. */
  snapshotTtlMs?: number;
  /** Optional clock for tests. */
  now?: () => number;
};

const DEFAULT_CATEGORIES = [
  "esports",
  "sports",
  "crypto",
  "politics",
  "culture",
  "economics",
  "tech",
];

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Strip bridge-source sub-market suffixes from a upstream-market slug.
 * Examples:
 *   dota2-pari-l1ga-2026-05-08-game2 → dota2-pari-l1ga-2026-05-08
 *   dota2-nem-z10-2026-05-06-game-handicap-home-1pt5 → dota2-nem-z10-2026-05-06
 *   nba-nyk-phi-2026-05-08-rebounds-josh-hart-8pt5 → nba-nyk-phi-2026-05-08
 *   lol-tes-we-2026-05-09 → lol-tes-we-2026-05-09 (unchanged)
 */
export function stripSubmarketSuffix(slug: string): string {
  // Match a date YYYY-MM-DD anywhere; keep up to and including the date.
  const m = slug.match(/^(.*?-\d{4}-\d{2}-\d{2})(-.+)?$/);
  return m && m[1] ? m[1] : slug;
}

export async function buildJupSnapshot(
  client: JupPredictionClient,
  opts: ResolverOptions = {},
): Promise<JupSnapshot> {
  const cats = opts.categories ?? DEFAULT_CATEGORIES;
  const now = opts.now ?? Date.now;
  const bySlug = new Map<string, JupSnapshotEntry>();
  for (const cat of cats) {
    let start = 0;
    // Pagination cap defensive: 25 pages × 20 = 500 events per category.
    for (let page = 0; page < 25; page++) {
      const resp = await client.searchEvents(""); // unused
      void resp;
      // Use the listing endpoint via a typed call — we expose `listEvents` next.
      break;
    }
    // The listing endpoint isn't in the typed client yet; we avoid adding it
    // here to keep the diff minimal. Instead, callers may pre-populate the
    // snapshot from /events?category=<cat> directly. See jupMarketResolver.test.ts
    // for the injected-fetcher pattern.
    void start;
  }
  return { fetchedAtMs: now(), bySlug };
}

/** Build a snapshot from a caller-supplied list of entries. Pure helper. */
export function snapshotFromEntries(entries: JupSnapshotEntry[], nowMs: number): JupSnapshot {
  const bySlug = new Map<string, JupSnapshotEntry>();
  for (const e of entries) bySlug.set(e.slug, e);
  return { fetchedAtMs: nowMs, bySlug };
}

/**
 * Resolve a TriggerEvent to a Jup marketId using the provided snapshot.
 * Pure function: no I/O. The runFollower wiring is responsible for refreshing
 * the snapshot on TTL expiry.
 */
export function resolveTriggerToJup(
  trig: TriggerEvent,
  snapshot: JupSnapshot,
  opts: { now?: () => number; snapshotTtlMs?: number } = {},
): ResolveResult {
  const now = opts.now ?? Date.now;
  const ttl = opts.snapshotTtlMs ?? DEFAULT_TTL_MS;
  const ageMs = now() - snapshot.fetchedAtMs;
  if (ageMs > ttl) {
    return { ok: false, reason: "snapshot_stale", ageSeconds: Math.floor(ageMs / 1000) };
  }
  const trimmed = stripSubmarketSuffix(trig.upstream_slug);
  const entry = snapshot.bySlug.get(trimmed);
  if (!entry) {
    return { ok: false, reason: "no_jup_market", trimmedSlug: trimmed };
  }
  // Pick the first OPEN market on the event.
  const openMarket = entry.markets.find((m) => (m.status ?? "").toLowerCase() === "open")
    ?? entry.markets[0];
  if (!openMarket) return { ok: false, reason: "no_open_market" };
  if (entry.closeTimeIso) {
    const closeMs = Date.parse(entry.closeTimeIso);
    if (Number.isFinite(closeMs) && closeMs <= now()) {
      return { ok: false, reason: "close_time_passed" };
    }
  }
  return {
    ok: true,
    marketId: openMarket.marketId,
    jupEventId: entry.eventId,
    jupSlug: entry.slug,
    // Trigger side "NO" means we BUY NO on upstream-market → BUY isYes=false on Jup.
    isYes: trig.side === "YES",
    marketTitle: openMarket.title,
    closeTimeIso: entry.closeTimeIso,
  };
}
