import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePaperTrades } from "./paperResolver.js";
import type { JupPredictionClient } from "./jupPredictionClient.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "paper-res-"));
}

const cleanups: string[] = [];
afterEach(() => {
  for (const d of cleanups.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
  }
});

function tradeRow(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    v: 1,
    ts_iso: new Date().toISOString(),
    ts_unix: 1778500000,
    dedup_key: "dk-1",
    upstream_slug: "lol-tes-we-2026-05-09",
    side: "NO",
    upstream_price: 0.42,
    jup_market_id: "POLY-1-0",
    jup_buy_price_usd: 0.42,
    intended_size_fdry: 100,
    vault_nav_fdry: 1_000_000,
    ...overrides,
  });
}

function stubClient(
  marketResponses: Record<string, { status?: string; result?: string | null }>,
): JupPredictionClient {
  return {
    getTradingStatus: vi.fn(),
    searchEvents: vi.fn(),
    listEvents: vi.fn(),
    getMarket: vi.fn(async (id: string) => {
      const r = marketResponses[id];
      if (!r) throw new Error(`stub: no response for ${id}`);
      return {
        marketId: id,
        status: r.status ?? "open",
        result: r.result ?? null,
        marketResultPubkey: null,
        title: "stub",
        openTime: 0,
        closeTime: 0,
        isTeamMarket: false,
        rulesPrimary: "",
        pricing: {},
      } as never;
    }),
    getOrderbook: vi.fn(),
    createOrder: vi.fn(),
    closePosition: vi.fn(),
    claimPayout: vi.fn(),
  } as unknown as JupPredictionClient;
}

describe("resolvePaperTrades", () => {
  it("marks NO-side trade as won when market resolves to 'no'", async () => {
    const d = tmpDir();
    cleanups.push(d);
    const trades = join(d, "paper-trades.ndjson");
    const results = join(d, "paper-results.ndjson");
    writeFileSync(trades, tradeRow() + "\n");
    const client = stubClient({
      "POLY-1-0": { status: "closed", result: "no" },
    });
    const s = await resolvePaperTrades({
      tradesPath: trades,
      resultsPath: results,
      client,
    });
    expect(s.newly_resolved_won).toBe(1);
    expect(s.newly_resolved_lost).toBe(0);
    const out = JSON.parse(readFileSync(results, "utf8").trim());
    expect(out.status).toBe("won");
    // entry no = 1 - 0.42 = 0.58 → ROI = (1 - 0.58)/0.58 ≈ 0.7241
    expect(out.pnl_per_dollar).toBeCloseTo((1 - 0.58) / 0.58, 3);
  });

  it("marks NO-side trade as lost when market resolves to 'yes'", async () => {
    const d = tmpDir();
    cleanups.push(d);
    const trades = join(d, "paper-trades.ndjson");
    const results = join(d, "paper-results.ndjson");
    writeFileSync(trades, tradeRow() + "\n");
    const client = stubClient({
      "POLY-1-0": { status: "closed", result: "yes" },
    });
    const s = await resolvePaperTrades({
      tradesPath: trades,
      resultsPath: results,
      client,
    });
    expect(s.newly_resolved_lost).toBe(1);
    const out = JSON.parse(readFileSync(results, "utf8").trim());
    expect(out.status).toBe("lost");
    expect(out.pnl_per_dollar).toBe(-1);
  });

  it("marks open market as pending", async () => {
    const d = tmpDir();
    cleanups.push(d);
    const trades = join(d, "paper-trades.ndjson");
    const results = join(d, "paper-results.ndjson");
    writeFileSync(trades, tradeRow() + "\n");
    const client = stubClient({
      "POLY-1-0": { status: "open", result: null },
    });
    const s = await resolvePaperTrades({
      tradesPath: trades,
      resultsPath: results,
      client,
    });
    expect(s.still_pending).toBe(1);
    const out = JSON.parse(readFileSync(results, "utf8").trim());
    expect(out.status).toBe("pending");
  });

  it("is idempotent: re-running skips already-resolved trades", async () => {
    const d = tmpDir();
    cleanups.push(d);
    const trades = join(d, "paper-trades.ndjson");
    const results = join(d, "paper-results.ndjson");
    writeFileSync(trades, tradeRow() + "\n");
    const client = stubClient({
      "POLY-1-0": { status: "closed", result: "no" },
    });
    const s1 = await resolvePaperTrades({
      tradesPath: trades,
      resultsPath: results,
      client,
    });
    expect(s1.newly_resolved_won).toBe(1);
    const s2 = await resolvePaperTrades({
      tradesPath: trades,
      resultsPath: results,
      client,
    });
    expect(s2.already_resolved).toBe(1);
    expect(s2.newly_resolved_won).toBe(0);
    // Only one row in results file
    const lines = readFileSync(results, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
  });

  it("logs error and writes status='error' on jup api failure", async () => {
    const d = tmpDir();
    cleanups.push(d);
    const trades = join(d, "paper-trades.ndjson");
    const results = join(d, "paper-results.ndjson");
    writeFileSync(trades, tradeRow() + "\n");
    const errorClient = {
      getTradingStatus: vi.fn(),
      searchEvents: vi.fn(),
      listEvents: vi.fn(),
      getMarket: vi.fn(async () => {
        throw new Error("network down");
      }),
      getOrderbook: vi.fn(),
      createOrder: vi.fn(),
      closePosition: vi.fn(),
      claimPayout: vi.fn(),
    } as unknown as JupPredictionClient;
    const s = await resolvePaperTrades({
      tradesPath: trades,
      resultsPath: results,
      client: errorClient,
    });
    expect(s.errors).toBe(1);
    const out = JSON.parse(readFileSync(results, "utf8").trim());
    expect(out.status).toBe("error");
    expect(out.error).toContain("network down");
  });

  it("returns zero summary when trades file does not exist", async () => {
    const d = tmpDir();
    cleanups.push(d);
    const s = await resolvePaperTrades({
      tradesPath: join(d, "nonexistent.ndjson"),
      resultsPath: join(d, "results.ndjson"),
      client: stubClient({}),
    });
    expect(s.trades_total).toBe(0);
  });
});
