import { describe, it, expect } from "vitest";
import {
  stripSubmarketSuffix,
  resolveTriggerToJup,
  snapshotFromEntries,
  type JupSnapshotEntry,
} from "./jupMarketResolver.js";
import type { TriggerEvent } from "./triggerSource.js";

const NOW_MS = 1778500000_000;

const ENTRIES: JupSnapshotEntry[] = [
  {
    eventId: "POLY-435869",
    slug: "lol-tes-we-2026-05-09",
    category: "esports",
    subcategory: "lol",
    closeTimeIso: "2050-01-01T00:00:00Z",
    markets: [
      { marketId: "POLY-2128359-0", title: "Top Esports", status: "open" },
      { marketId: "POLY-2128359-1", title: "Team WE", status: "open" },
    ],
  },
  {
    eventId: "POLY-CLOSED",
    slug: "cs2-old-2026-05-01",
    category: "esports",
    subcategory: "cs2",
    closeTimeIso: "2024-01-01T00:00:00Z", // already passed
    markets: [{ marketId: "POLY-XYZ", title: "X", status: "open" }],
  },
  {
    eventId: "POLY-NOOPEN",
    slug: "nba-foo-2026-05-09",
    category: "sports",
    subcategory: "nba",
    closeTimeIso: "2050-01-01T00:00:00Z",
    markets: [{ marketId: "POLY-Q", title: "Q", status: "closed" }],
  },
];

const SNAP = snapshotFromEntries(ENTRIES, NOW_MS);

const baseTrig: TriggerEvent = {
  v: 1,
  ts: 1778500123,
  token_id: "abc",
  upstream_slug: "lol-tes-we-2026-05-09",
  side: "NO",
  upstream_no_ask: 0.42,
  upstream_yes_current: 0.58,
  upstream_yes_pre: 0.18,
  trigger_score: 7,
  quality_bucket: "S85",
  primary_tag: "Esports",
  subcategory: "lol",
  trigger_signature: "1m,3m,5m",
};

describe("stripSubmarketSuffix", () => {
  it("leaves a clean slug untouched", () => {
    expect(stripSubmarketSuffix("lol-tes-we-2026-05-09")).toBe("lol-tes-we-2026-05-09");
  });
  it("strips -game2 suffix", () => {
    expect(stripSubmarketSuffix("dota2-pari-l1ga-2026-05-08-game2"))
      .toBe("dota2-pari-l1ga-2026-05-08");
  });
  it("strips -game-handicap-home-1pt5 suffix", () => {
    expect(stripSubmarketSuffix("dota2-nem-z10-2026-05-06-game-handicap-home-1pt5"))
      .toBe("dota2-nem-z10-2026-05-06");
  });
  it("strips player-prop suffix", () => {
    expect(stripSubmarketSuffix("nba-nyk-phi-2026-05-08-rebounds-josh-hart-8pt5"))
      .toBe("nba-nyk-phi-2026-05-08");
  });
  it("returns the raw slug if no date pattern present", () => {
    expect(stripSubmarketSuffix("ethereum-up-or-down")).toBe("ethereum-up-or-down");
  });
});

describe("resolveTriggerToJup", () => {
  it("ok: exact slug → first open market, isYes=false for side=NO", () => {
    const r = resolveTriggerToJup(baseTrig, SNAP, { now: () => NOW_MS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.marketId).toBe("POLY-2128359-0");
    expect(r.isYes).toBe(false);
    expect(r.jupEventId).toBe("POLY-435869");
  });

  it("ok: side=YES sets isYes=true", () => {
    const r = resolveTriggerToJup({ ...baseTrig, side: "YES" }, SNAP, { now: () => NOW_MS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.isYes).toBe(true);
  });

  it("ok: trims sub-market suffix before lookup", () => {
    const trig = { ...baseTrig, upstream_slug: "lol-tes-we-2026-05-09-game1" };
    const r = resolveTriggerToJup(trig, SNAP, { now: () => NOW_MS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.jupSlug).toBe("lol-tes-we-2026-05-09");
  });

  it("skip: no_jup_market when slug not in snapshot", () => {
    const trig = { ...baseTrig, upstream_slug: "val-gone-2026-05-09" };
    const r = resolveTriggerToJup(trig, SNAP, { now: () => NOW_MS });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no_jup_market");
    if (r.reason === "no_jup_market") expect(r.trimmedSlug).toBe("val-gone-2026-05-09");
  });

  it("skip: close_time_passed for an event whose closeTime is in the past", () => {
    const trig = { ...baseTrig, upstream_slug: "cs2-old-2026-05-01" };
    const r = resolveTriggerToJup(trig, SNAP, { now: () => NOW_MS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("close_time_passed");
  });

  it("ok-but-degraded: picks closed market when no open ones exist (returns the first market)", () => {
    const trig = { ...baseTrig, upstream_slug: "nba-foo-2026-05-09" };
    const r = resolveTriggerToJup(trig, SNAP, { now: () => NOW_MS });
    // Spec: openMarket = first open OR first overall; downstream gates handle status
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.marketId).toBe("POLY-Q");
  });

  it("skip: snapshot_stale when older than TTL", () => {
    const r = resolveTriggerToJup(baseTrig, SNAP, {
      now: () => NOW_MS + 10 * 60 * 1000,
      snapshotTtlMs: 5 * 60 * 1000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("snapshot_stale");
  });
});

describe("snapshotFromEntries", () => {
  it("indexes entries by slug", () => {
    const s = snapshotFromEntries(ENTRIES, NOW_MS);
    expect(s.bySlug.size).toBe(ENTRIES.length);
    expect(s.bySlug.get("lol-tes-we-2026-05-09")?.eventId).toBe("POLY-435869");
    expect(s.fetchedAtMs).toBe(NOW_MS);
  });
});
