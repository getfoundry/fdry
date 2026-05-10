import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFollower, type RunFollowerOptions } from "./runFollower.js";
import type { SignedSignalEnvelope, SignalRow } from "./signal.js";
import type { JupPredictionClient } from "./jupPredictionClient.js";

// ---- module mocks: stub out slices the orchestrator wires together ----

vi.mock("./processSignal.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./processSignal.js")>();
  return {
    ...orig,
    processSignal: vi.fn(),
  };
});

vi.mock("./predictionMap.js", () => ({
  mapSignalToMarket: vi.fn(async () => ({
    ok: true as const,
    marketId: "MKT",
    isYes: true,
    jupBuyPriceUsd: 0.5,
    liquidityUsd: 10_000,
  })),
}));

vi.mock("./guards.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./guards.js")>();
  return {
    ...orig,
    checkGuards: vi.fn(() => ({ ok: true as const, size_fdry: 100 })),
  };
});

vi.mock("./jupPredictionClient.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./jupPredictionClient.js")>();
  return {
    ...orig,
    createJupPredictionClient: vi.fn(() => ({}) as JupPredictionClient),
  };
});

import { processSignal } from "./processSignal.js";

const mockedProcess = processSignal as unknown as ReturnType<typeof vi.fn>;

// ---- helpers ----

function makeRow(suffix = "a"): SignalRow {
  return {
    v: 1,
    ts: `2026-01-01T00:00:0${suffix.length}Z`,
    action: "open",
    slug: `mkt-${suffix}`,
    side: "YES",
    token_id: `tok-${suffix}`,
    price: 0.5,
    size_usd: 100,
    size_shares: 200,
    evm_tx: `0x${suffix.padEnd(40, "0")}`,
    paper: false,
  };
}

function makeEnv(suffix = "a"): SignedSignalEnvelope {
  return { row: makeRow(suffix), sig: "sig", signer: "signer" };
}

function makeStorePath(): string {
  return join(
    tmpdir(),
    `runFollower-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
}

function baseOpts(
  overrides: Partial<RunFollowerOptions> = {},
): RunFollowerOptions {
  return {
    storePath: makeStorePath(),
    pollIntervalMs: 10,
    jupApiKey: "test-key",
    signerAllowedPubkey: "signer",
    vault: {
      pda: "VAULT",
      navFdry: 1_000_000,
      deployedFdry: 0,
      dayPnlFdry: 0,
      cumPnlFdry: 0,
    },
    manager: { pubkey: "MANAGER" },
    fetchSinceCursor: vi.fn(async () => ({ rows: [], nextCursor: null })),
    bootOverride: vi.fn(async () => ({ ok: true, checks: [] })),
    // Sentinel path that will never exist, in a tmp dir we control.
    killSwitchOptions: {
      envVarName: "FDRY_FOLLOWER_HALT_TEST_DOES_NOT_EXIST",
      sentinelFilePath: join(tmpdir(), `nope-${Math.random()}-${Date.now()}`),
      envSnapshot: {},
    },
    verifySignature: () => true,
    sleep: () => Promise.resolve(),
    now: () => 1_700_000_000_000,
    jupClientOverride: {} as JupPredictionClient,
    ...overrides,
  };
}

beforeEach(() => {
  mockedProcess.mockReset();
});

afterEach(async () => {
  // best-effort cleanup
});

// ---- tests ----

describe("runFollower", () => {
  it("returns immediately with haltedAt iteration 0 when boot fails", async () => {
    const opts = baseOpts({
      bootOverride: vi.fn(async () => ({
        ok: false,
        checks: [
          { name: "env.JUP_PREDICTION_API_KEY", ok: false, reason: "missing" },
        ],
      })),
      fetchSinceCursor: vi.fn(),
    });
    const summary = await runFollower(opts);
    expect(summary.iterations).toBe(0);
    expect(summary.haltedAt?.iteration).toBe(0);
    expect(summary.haltedAt?.reason).toContain("boot_failed");
    expect(summary.haltedAt?.reason).toContain("env.JUP_PREDICTION_API_KEY");
    expect(opts.fetchSinceCursor).not.toHaveBeenCalled();
  });

  it("happy path: single envelope, would_sign, state persists with dedupKey", async () => {
    const env = makeEnv("a");
    const fetchSinceCursor = vi
      .fn<RunFollowerOptions["fetchSinceCursor"]>()
      .mockResolvedValueOnce({ rows: [env], nextCursor: "cur-1" })
      .mockImplementation(async () => {
        // Stop the loop on second call by aborting.
        controller.abort();
        return { rows: [], nextCursor: "cur-1" };
      });

    const controller = new AbortController();
    mockedProcess.mockImplementation(async (_env, deps) => {
      deps.recordIntent({
        dedupKey: "DK-a",
        row: env.row,
        marketId: "MKT",
        sizeFdry: 100,
        unsignedTxBase64: "TX",
        jupResponse: {},
      });
      return {
        kind: "would_sign",
        dedupKey: "DK-a",
        marketId: "MKT",
        sizeFdry: 100,
        unsignedTxBase64: "TX",
      };
    });

    const opts = baseOpts({ fetchSinceCursor, signal: controller.signal });
    const summary = await runFollower(opts);
    expect(summary.wouldSignCount).toBe(1);
    expect(summary.rowsProcessed).toBe(1);

    const raw = await fs.readFile(opts.storePath, "utf8");
    const persisted = JSON.parse(raw);
    expect(persisted.processedDedupKeys).toContain("DK-a");
    expect(persisted.intendedPositions).toHaveLength(1);
    expect(persisted.intendedPositions[0].marketId).toBe("MKT");
    expect(persisted.lastCursor).toBe("cur-1");
  });

  it("kill switch trips on iteration 3 → halted, no further fetches", async () => {
    const fetchSinceCursor = vi.fn(async () => ({
      rows: [],
      nextCursor: null,
    }));
    let killCalls = 0;
    const opts = baseOpts({
      fetchSinceCursor,
      killSwitchOptions: {
        envVarName: "X_NO_SUCH",
        sentinelFilePath: "/dev/null/nope",
        envSnapshot: {},
        fileExists: async () => {
          killCalls += 1;
          return killCalls >= 3; // trip on 3rd call
        },
      },
    });
    const summary = await runFollower(opts);
    expect(summary.iterations).toBe(3);
    expect(summary.haltedAt?.iteration).toBe(3);
    expect(summary.haltedAt?.reason).toContain("kill_switch");
    // Two no-row fetches (iters 1, 2), zero on iter 3 (kill aborts before fetch).
    expect(fetchSinceCursor).toHaveBeenCalledTimes(2);
  });

  it("AbortSignal aborts gracefully before next sleep returns", async () => {
    const controller = new AbortController();
    const fetchSinceCursor = vi.fn(async () => {
      controller.abort();
      return { rows: [], nextCursor: null };
    });
    const opts = baseOpts({ fetchSinceCursor, signal: controller.signal });
    const summary = await runFollower(opts);
    expect(summary.iterations).toBeGreaterThanOrEqual(1);
    expect(summary.haltedAt).toBeUndefined();
  });

  it("dedup: same dedupKey across two batches → second skipped, wouldSignCount stays 1", async () => {
    const env = makeEnv("a");
    const controller = new AbortController();
    const fetchSinceCursor = vi
      .fn<RunFollowerOptions["fetchSinceCursor"]>()
      .mockResolvedValueOnce({ rows: [env], nextCursor: "c1" })
      .mockResolvedValueOnce({ rows: [env], nextCursor: "c2" })
      .mockImplementation(async () => {
        controller.abort();
        return { rows: [], nextCursor: "c2" };
      });

    mockedProcess.mockImplementation(async (_env, deps) => {
      // Real dedup logic: consult alreadySeen.
      const dk = "DK-a";
      if (deps.alreadySeen(dk)) {
        return { kind: "skipped", dedupKey: dk, reason: "dedup_replay" };
      }
      deps.recordIntent({
        dedupKey: dk,
        row: env.row,
        marketId: "MKT",
        sizeFdry: 100,
        unsignedTxBase64: "TX",
        jupResponse: {},
      });
      return {
        kind: "would_sign",
        dedupKey: dk,
        marketId: "MKT",
        sizeFdry: 100,
        unsignedTxBase64: "TX",
      };
    });

    const opts = baseOpts({ fetchSinceCursor, signal: controller.signal });
    const summary = await runFollower(opts);
    expect(summary.wouldSignCount).toBe(1);
    expect(summary.skippedCount).toBe(1);
    expect(summary.rowsProcessed).toBe(2);

    const persisted = JSON.parse(await fs.readFile(opts.storePath, "utf8"));
    expect(persisted.intendedPositions).toHaveLength(1);
    expect(
      persisted.processedDedupKeys.filter((k: string) => k === "DK-a"),
    ).toHaveLength(1);
  });

  it("processSignal throws → caught, skipped++, throwCount++, loop continues without crash", async () => {
    const controller = new AbortController();
    const env = makeEnv("a");
    const fetchSinceCursor = vi
      .fn<RunFollowerOptions["fetchSinceCursor"]>()
      .mockResolvedValueOnce({ rows: [env], nextCursor: "c1" })
      .mockImplementation(async () => {
        controller.abort();
        return { rows: [], nextCursor: "c1" };
      });

    mockedProcess.mockRejectedValueOnce(new Error("kaboom"));

    const errors: unknown[] = [];
    const opts = baseOpts({
      fetchSinceCursor,
      signal: controller.signal,
      logger: {
        info: () => {},
        warn: () => {},
        error: (_m, x) => errors.push(x),
      },
    });
    const summary = await runFollower(opts);
    expect(summary.skippedCount).toBe(1);
    expect(summary.throwCount).toBe(1);
    expect(summary.wouldSignCount).toBe(0);
    expect(summary.haltedAt).toBeUndefined();
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("processSignal throws on row 2 of 3 → cursor is NOT advanced, failed row will be re-fetched", async () => {
    const controller = new AbortController();
    const envs = [makeEnv("a"), makeEnv("b"), makeEnv("c")];
    const seenCursors: (string | null)[] = [];
    const fetchSinceCursor = vi
      .fn<RunFollowerOptions["fetchSinceCursor"]>()
      .mockImplementationOnce(async (cursor) => {
        seenCursors.push(cursor);
        return { rows: envs, nextCursor: "cur-after-batch" };
      })
      .mockImplementation(async (cursor) => {
        seenCursors.push(cursor);
        controller.abort();
        return { rows: [], nextCursor: cursor };
      });

    let call = 0;
    mockedProcess.mockImplementation(async (_env, deps) => {
      call += 1;
      if (call === 2) {
        throw new Error("row-2-boom");
      }
      const dk = `DK-${call}`;
      deps.recordIntent({
        dedupKey: dk,
        row: _env.row,
        marketId: "MKT",
        sizeFdry: 100,
        unsignedTxBase64: "TX",
        jupResponse: {},
      });
      return {
        kind: "would_sign",
        dedupKey: dk,
        marketId: "MKT",
        sizeFdry: 100,
        unsignedTxBase64: "TX",
      };
    });

    const opts = baseOpts({ fetchSinceCursor, signal: controller.signal });
    const summary = await runFollower(opts);

    // Throw was counted.
    expect(summary.throwCount).toBe(1);
    // Cursor on disk was NOT advanced past the failed batch.
    const persisted = JSON.parse(await fs.readFile(opts.storePath, "utf8"));
    expect(persisted.lastCursor).not.toBe("cur-after-batch");
    // Second fetch resumed from the SAME cursor as the first (re-fetch).
    expect(seenCursors.length).toBeGreaterThanOrEqual(2);
    expect(seenCursors[1]).toBe(seenCursors[0]);
  });

  it("dry-run: would_sign result is logged but intent NOT persisted", async () => {
    const controller = new AbortController();
    const env = makeEnv("a");
    const fetchSinceCursor = vi
      .fn<RunFollowerOptions["fetchSinceCursor"]>()
      .mockResolvedValueOnce({ rows: [env], nextCursor: "c1" })
      .mockImplementation(async () => {
        controller.abort();
        return { rows: [], nextCursor: "c1" };
      });

    mockedProcess.mockImplementation(async (_env, deps) => {
      deps.recordIntent({
        dedupKey: "DK-a",
        row: env.row,
        marketId: "MKT",
        sizeFdry: 100,
        unsignedTxBase64: "TX",
        jupResponse: {},
      });
      return {
        kind: "would_sign",
        dedupKey: "DK-a",
        marketId: "MKT",
        sizeFdry: 100,
        unsignedTxBase64: "TX",
      };
    });

    const opts = baseOpts({
      fetchSinceCursor,
      signal: controller.signal,
      dryRun: true,
    });
    const summary = await runFollower(opts);
    expect(summary.wouldSignCount).toBe(1);
    const persisted = JSON.parse(await fs.readFile(opts.storePath, "utf8"));
    expect(persisted.intendedPositions).toHaveLength(0);
  });
});
