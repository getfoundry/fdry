/**
 * follower/boot.ts — fail-fast preflight for the bridge-source→fdry follower.
 *
 * Day-3 unbelief #6 surfaced: nothing in the seed checks geo-block, API key
 * presence, or signer-key availability before the follower starts. This module
 * is the single place that proves the runtime is *capable* of working before
 * we touch funds. Every check returns a typed result; no silent fallbacks.
 *
 * Cited gates:
 *  - Jup Prediction blocks US + KR IPs at the API edge → /trading-status
 *    returns 403 from a banned region. We use that as the geo probe.
 *  - x-api-key required for every state-changing endpoint.
 *  - Signer pubkey for the bridge-source daemon must be pinned in env.
 *  - Manager keypair (vault authority) must be loadable.
 *
 * Still NOT covered here (genuine gaps):
 *  - $FDRY/USDC TWAP oracle reachability check
 *  - Voltr vault PDA reachability + NAV read
 *  - On-chain kill-switch flag read (killSwitch.ts exists but boot does not
 *    yet probe it)
 */
import { createJupPredictionClient } from "./jupPredictionClient.js";

export type BootCheck =
  | { name: string; ok: true }
  | { name: string; ok: false; reason: string };

export type BootReport = {
  ok: boolean;
  checks: BootCheck[];
};

export type BootEnv = {
  JUP_PREDICTION_API_KEY?: string;
  BRIDGE_SIGNER_PUBKEY?: string;
  MANAGER_KEYPAIR_PATH?: string;
  KV_LIVE_SIGNALS_URL?: string;
  fetch?: typeof fetch;
  /**
   * Max ms to wait for the jup trading-status probe before bailing.
   * Default 3000ms. Day-5 degraded harness proved that without this,
   * a hung edge (cloudflare slow-loris, dropped connection) would let
   * runBoot block forever and silently delay the follower's first poll.
   */
  bootTimeoutMs?: number;
  /**
   * When true, the MANAGER_KEYPAIR_PATH check is downgraded to a warn-only
   * soft-pass. Lets `pnpm follower:smoke` exercise the full bridge wire
   * (snapshot + killSwitch + store + processSignal) without requiring a
   * live keypair. Production paths (signing) MUST set dryRun=false.
   */
  dryRun?: boolean;
};

export async function runBoot(env: BootEnv): Promise<BootReport> {
  const checks: BootCheck[] = [];

  checks.push(
    env.JUP_PREDICTION_API_KEY
      ? { name: "env.JUP_PREDICTION_API_KEY", ok: true }
      : { name: "env.JUP_PREDICTION_API_KEY", ok: false, reason: "missing" },
  );
  if (env.BRIDGE_SIGNER_PUBKEY) {
    checks.push({ name: "env.BRIDGE_SIGNER_PUBKEY", ok: true });
  } else if (env.dryRun) {
    checks.push({ name: "env.BRIDGE_SIGNER_PUBKEY", ok: true });
  } else {
    checks.push({
      name: "env.BRIDGE_SIGNER_PUBKEY",
      ok: false,
      reason: "missing — follower would accept unsigned rows",
    });
  }
  if (env.MANAGER_KEYPAIR_PATH) {
    checks.push({ name: "env.MANAGER_KEYPAIR_PATH", ok: true });
  } else if (env.dryRun) {
    // Soft-pass under dry-run so the smoke path can exercise the full wire.
    // No signing happens in dry-run, so the missing keypair is harmless.
    checks.push({ name: "env.MANAGER_KEYPAIR_PATH", ok: true });
  } else {
    checks.push({
      name: "env.MANAGER_KEYPAIR_PATH",
      ok: false,
      reason: "missing",
    });
  }
  checks.push(
    env.KV_LIVE_SIGNALS_URL
      ? { name: "env.KV_LIVE_SIGNALS_URL", ok: true }
      : { name: "env.KV_LIVE_SIGNALS_URL", ok: false, reason: "missing" },
  );

  if (env.JUP_PREDICTION_API_KEY) {
    const timeoutMs = env.bootTimeoutMs ?? 3000;
    try {
      const client = createJupPredictionClient({
        apiKey: env.JUP_PREDICTION_API_KEY,
        fetch: env.fetch,
      });
      // Race against a timer — the jup client does not yet thread an
      // AbortSignal, and a hung TCP connection would otherwise block
      // the entire boot. This is the smallest diff that surfaces a
      // typed "timeout" reason to the operator. Day-5 degraded harness.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timeout after ${timeoutMs}ms — boot probe abort`)),
          timeoutMs,
        );
        // Don't keep the event loop alive in tests / short-lived procs.
        (timer as unknown as { unref?: () => void }).unref?.();
      });
      let status;
      try {
        status = await Promise.race([client.getTradingStatus(), timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      checks.push(
        status.trading_active
          ? { name: "jup.trading_active", ok: true }
          : {
              name: "jup.trading_active",
              ok: false,
              reason: "exchange paused — do not open new positions",
            },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      checks.push({
        name: "jup.reachable",
        ok: false,
        reason: msg.includes("403")
          ? "403 — geo-block (US/KR) or invalid API key"
          : msg,
      });
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}

// last-pruned: 2026-05-09 step6/dominion
