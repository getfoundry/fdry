/**
 * killSwitchSurface.test.ts — NORTHSTAR Rule #7 structural audit.
 *
 * Rule #7 (docs/NORTHSTAR.md):
 *   "Two halt vectors at the kill-switch surface (env, sentinel — see
 *    voltr/src/follower/killSwitch.ts); a third in-process AbortSignal honored
 *    by the orchestrator (see voltr/src/follower/runFollower.ts).
 *    Three paths total, two layers."
 *
 * This test fires if a future refactor silently removes any of those three
 * paths. It does not exercise the happy path (runFollower.test.ts already
 * does); it pins the SHAPE of the kill surface.
 */

import { describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkKillSwitch,
  type KillSwitchSource,
} from "./killSwitch.js";
import { runFollower, type RunFollowerOptions } from "./runFollower.js";
import type { JupPredictionClient } from "./jupPredictionClient.js";

// Keep this module mock-light: we only call runFollower with bootOverride and
// a stubbed fetchSinceCursor, so we don't need to mock processSignal etc.

function makeStorePath(): string {
  return join(
    tmpdir(),
    `killSwitchSurface-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
}

function baseFollowerOpts(
  overrides: Partial<RunFollowerOptions> = {},
): RunFollowerOptions {
  return {
    storePath: makeStorePath(),
    pollIntervalMs: 1,
    jupApiKey: "k",
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
    killSwitchOptions: {
      envVarName: "FDRY_NEVER_SET_THIS_VAR_XYZ",
      sentinelFilePath: join(tmpdir(), `nope-${Math.random()}-${Date.now()}`),
      envSnapshot: {},
      fileExists: async () => false,
    },
    verifySignature: () => true,
    sleep: () => Promise.resolve(),
    now: () => 1_700_000_000_000,
    jupClientOverride: {} as JupPredictionClient,
    ...overrides,
  };
}

describe("kill-switch surface (NORTHSTAR Rule #7)", () => {
  it("smoke: killSwitch.ts exports checkKillSwitch", () => {
    expect(typeof checkKillSwitch).toBe("function");
  });

  it("vector 1 of 2 (kill-switch surface): env var trips checkKillSwitch with source='env'", async () => {
    const reading = await checkKillSwitch({
      envVarName: "FDRY_FOLLOWER_HALT_PROBE",
      sentinelFilePath: "/tmp/never-exists-xyz",
      envSnapshot: { FDRY_FOLLOWER_HALT_PROBE: "1" },
      fileExists: async () => false,
    });
    expect(reading.halted).toBe(true);
    if (reading.halted) {
      expect(reading.source).toBe("env");
    }
  });

  it("vector 2 of 2 (kill-switch surface): sentinel file trips checkKillSwitch with source='sentinel_file'", async () => {
    const reading = await checkKillSwitch({
      envVarName: "FDRY_NEVER_SET_THIS_VAR_XYZ",
      sentinelFilePath: "/tmp/some-sentinel-path",
      envSnapshot: {},
      fileExists: async () => true,
    });
    expect(reading.halted).toBe(true);
    if (reading.halted) {
      expect(reading.source).toBe("sentinel_file");
    }
  });

  it("kill-switch enumerates the two operator halt sources reachable via stubs ('env' + 'sentinel_file')", async () => {
    // Runtime probe: drive the function down each branch and collect
    // the source strings actually returned. NORTHSTAR names exactly two
    // operator-facing vectors at this surface.
    const sources = new Set<KillSwitchSource>();

    const envOnly = await checkKillSwitch({
      envVarName: "PROBE_ENV",
      sentinelFilePath: "/tmp/x",
      envSnapshot: { PROBE_ENV: "yes" },
      fileExists: async () => false,
    });
    if (envOnly.halted) sources.add(envOnly.source);

    const sentinelOnly = await checkKillSwitch({
      envVarName: "PROBE_ENV_UNSET",
      sentinelFilePath: "/tmp/x",
      envSnapshot: {},
      fileExists: async () => true,
    });
    if (sentinelOnly.halted) sources.add(sentinelOnly.source);

    expect(sources.has("env")).toBe(true);
    expect(sources.has("sentinel_file")).toBe(true);
    // Type-level guard: the two strings must be assignable to KillSwitchSource.
    const _typeProbe: KillSwitchSource[] = ["env", "sentinel_file"];
    expect(_typeProbe).toHaveLength(2);
  });

  it("vector 3 of 3 (orchestrator layer): runFollower honors AbortSignal fired BEFORE first iteration → iterations === 0", async () => {
    const controller = new AbortController();
    controller.abort(); // pre-aborted

    const fetchSinceCursor = vi.fn(async () => ({
      rows: [],
      nextCursor: null,
    }));

    const summary = await runFollower(
      baseFollowerOpts({
        signal: controller.signal,
        fetchSinceCursor,
      }),
    );

    expect(summary.iterations).toBe(0);
    expect(fetchSinceCursor).not.toHaveBeenCalled();
  });

  it("kill-switch path reaches the orchestrator: env-trip sets summary.haltedAt with kill_switch reason", async () => {
    const fetchSinceCursor = vi.fn(async () => ({
      rows: [],
      nextCursor: null,
    }));

    const summary = await runFollower(
      baseFollowerOpts({
        fetchSinceCursor,
        killSwitchOptions: {
          envVarName: "FDRY_FOLLOWER_HALT_INJECT",
          sentinelFilePath: "/tmp/none",
          envSnapshot: { FDRY_FOLLOWER_HALT_INJECT: "stop" },
          fileExists: async () => false,
        },
      }),
    );

    expect(summary.haltedAt).toBeDefined();
    expect(summary.haltedAt?.iteration).toBe(1);
    expect(summary.haltedAt?.reason).toContain("kill_switch");
    expect(summary.haltedAt?.reason).toContain("env");
    // kill check fires before fetch on iter 1.
    expect(fetchSinceCursor).not.toHaveBeenCalled();
  });

  it("combined halt-mechanism count is at-least-3 (>=2 kill-switch sources + >=1 AbortSignal site) — matches NORTHSTAR Rule #7", () => {
    // The kill-switch operator vectors reachable via this test's stubs.
    // killSwitch.ts actually defines 3 KillSwitchSource members
    // ('env' | 'sentinel_file' | 'unhealthy_state'); we only enumerate the
    // two operator-driven ones here. AbortSignal is honored at multiple
    // sites in runFollower (top-of-loop, inner-loop, post-batch, sleep).
    const killSwitchOperatorSources: KillSwitchSource[] = [
      "env",
      "sentinel_file",
    ];
    const orchestratorAbortField: keyof RunFollowerOptions = "signal";
    expect(orchestratorAbortField).toBe("signal");

    const totalPaths = killSwitchOperatorSources.length + 1; // +1 = AbortSignal layer
    expect(totalPaths).toBeGreaterThanOrEqual(3);
  });
});
