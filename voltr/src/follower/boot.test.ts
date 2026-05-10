/**
 * Tests for runBoot — fail-fast preflight.
 *
 * Lost-sheep edge chased here (Day-3 unbelief #6): the boot probe must
 * distinguish a 403 geo-block (US/KR edge) from a generic API failure, and
 * must surface every missing-env reason in its own check entry so the operator
 * sees a list, not a single opaque "boot failed".
 */

import { describe, it, expect } from "vitest";
import { runBoot, type BootEnv } from "./boot.js";

const FULL_ENV: Omit<BootEnv, "fetch"> = {
  JUP_PREDICTION_API_KEY: "test-key",
  BRIDGE_SIGNER_PUBKEY: "SignerPubkey1111111111111111111111111111111",
  MANAGER_KEYPAIR_PATH: "/tmp/mgr.json",
  KV_LIVE_SIGNALS_URL: "https://kv.example.com/live",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function findCheck(report: Awaited<ReturnType<typeof runBoot>>, name: string) {
  const c = report.checks.find((x) => x.name === name);
  if (!c) throw new Error(`expected check ${name} in report`);
  return c;
}

describe("runBoot env presence", () => {
  it("ok:false with reason 'missing' when JUP_PREDICTION_API_KEY missing", async () => {
    const env: BootEnv = { ...FULL_ENV, JUP_PREDICTION_API_KEY: undefined };
    const r = await runBoot(env);
    expect(r.ok).toBe(false);
    const c = findCheck(r, "env.JUP_PREDICTION_API_KEY");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toMatch(/missing/);
  });

  it("ok:false when BRIDGE_SIGNER_PUBKEY missing", async () => {
    const env: BootEnv = {
      ...FULL_ENV,
      BRIDGE_SIGNER_PUBKEY: undefined,
      // Provide a fetch so the jup probe doesn't try real network.
      fetch: (async () => jsonResponse({ trading_active: true })) as unknown as typeof fetch,
    };
    const r = await runBoot(env);
    expect(r.ok).toBe(false);
    const c = findCheck(r, "env.BRIDGE_SIGNER_PUBKEY");
    expect(c.ok).toBe(false);
  });

  it("ok:false when MANAGER_KEYPAIR_PATH missing", async () => {
    const env: BootEnv = {
      ...FULL_ENV,
      MANAGER_KEYPAIR_PATH: undefined,
      fetch: (async () => jsonResponse({ trading_active: true })) as unknown as typeof fetch,
    };
    const r = await runBoot(env);
    expect(r.ok).toBe(false);
    const c = findCheck(r, "env.MANAGER_KEYPAIR_PATH");
    expect(c.ok).toBe(false);
  });

  it("ok:false when KV_LIVE_SIGNALS_URL missing", async () => {
    const env: BootEnv = {
      ...FULL_ENV,
      KV_LIVE_SIGNALS_URL: undefined,
      fetch: (async () => jsonResponse({ trading_active: true })) as unknown as typeof fetch,
    };
    const r = await runBoot(env);
    expect(r.ok).toBe(false);
    const c = findCheck(r, "env.KV_LIVE_SIGNALS_URL");
    expect(c.ok).toBe(false);
  });
});

describe("runBoot jup probe", () => {
  it("flags geo-block on 403 (distinct from generic failure)", async () => {
    const fetch403: typeof fetch = (async () =>
      new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
    const env: BootEnv = { ...FULL_ENV, fetch: fetch403 };
    const r = await runBoot(env);
    expect(r.ok).toBe(false);
    const c = findCheck(r, "jup.reachable");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toMatch(/geo-block/);
  });

  it("ok:true when env complete and trading_active=true", async () => {
    const fetchOk: typeof fetch = (async () =>
      jsonResponse({ trading_active: true })) as unknown as typeof fetch;
    const env: BootEnv = { ...FULL_ENV, fetch: fetchOk };
    const r = await runBoot(env);
    expect(r.ok).toBe(true);
    const c = findCheck(r, "jup.trading_active");
    expect(c.ok).toBe(true);
  });

  it("ok:false on trading_active=false (reason includes 'exchange paused')", async () => {
    const fetchPaused: typeof fetch = (async () =>
      jsonResponse({ trading_active: false })) as unknown as typeof fetch;
    const env: BootEnv = { ...FULL_ENV, fetch: fetchPaused };
    const r = await runBoot(env);
    expect(r.ok).toBe(false);
    const c = findCheck(r, "jup.trading_active");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toMatch(/exchange paused/);
  });

  it("dryRun=true soft-passes missing MANAGER_KEYPAIR_PATH and BRIDGE_SIGNER_PUBKEY (smoke path)", async () => {
    // No keypair, no signer — but dryRun says "we're not signing, just exercising".
    // The boot must not block the smoke path with these two checks.
    const fetchOk: typeof fetch = (async () =>
      jsonResponse({ trading_active: true })) as unknown as typeof fetch;
    const env: BootEnv = {
      JUP_PREDICTION_API_KEY: "test-key",
      KV_LIVE_SIGNALS_URL: "injected://x",
      // Intentionally absent: BRIDGE_SIGNER_PUBKEY, MANAGER_KEYPAIR_PATH
      dryRun: true,
      fetch: fetchOk,
    };
    const r = await runBoot(env);
    expect(r.ok).toBe(true);
    expect(findCheck(r, "env.MANAGER_KEYPAIR_PATH").ok).toBe(true);
    expect(findCheck(r, "env.BRIDGE_SIGNER_PUBKEY").ok).toBe(true);
  });

  it("dryRun=false (default) hard-fails on missing MANAGER_KEYPAIR_PATH (production guard)", async () => {
    const fetchOk: typeof fetch = (async () =>
      jsonResponse({ trading_active: true })) as unknown as typeof fetch;
    const env: BootEnv = {
      JUP_PREDICTION_API_KEY: "test-key",
      BRIDGE_SIGNER_PUBKEY: "S".repeat(43),
      KV_LIVE_SIGNALS_URL: "injected://x",
      // dryRun omitted → defaults to false
      fetch: fetchOk,
    };
    const r = await runBoot(env);
    expect(r.ok).toBe(false);
    const c = findCheck(r, "env.MANAGER_KEYPAIR_PATH");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe("missing");
  });
});
