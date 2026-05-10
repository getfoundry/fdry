/**
 * voltr/src/main.ts — Manager cron entrypoint.
 *
 * Run by Railway cron `0 5 * * * UTC` (one UTC-daily rotation). Flow:
 *   1. Load env + strategy registry
 *   2. Read latest v6b signal JSON; fail-closed if stale/missing/invalid
 *   3. Translate signal → long-only weights (v0 policy: no shorts)
 *   4. Fetch current vault state (allocations + NAV)
 *   5. Apply guards (shape + sanity + cooldown)
 *   6. Plan rotation (deltas → withdraws + deposits)
 *   7. Build + sign + send tx sequence
 *   8. Append to ledger; alert telegram/healthcheck
 *
 * Exit codes:
 *   0 = success or no-op (within no-trade band, cooldown, all-cash)
 *   1 = stale/missing signal
 *   2 = guard violation
 *   3 = tx failure
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Connection, Keypair } from "@solana/web3.js";
import { readSignalFile, longOnlyWeights } from "./signal.js";
import {
  applyGuards,
  maxDelta,
  type GuardContext,
  UNIVERSE_SIZE,
  TOTAL_BP,
  COOLDOWN_SECONDS,
} from "./guards.js";
import { alertStartup, alertRotateOk, alertRotateFail, alertTelegram } from "./alerts.js";
import { fetchVaultState, loadStrategyRegistry, sendBatch, buildDepositIx, buildWithdrawIx, VoltrClient } from "./vault.js";
import { planRotation, summarizePlan } from "./rotate.js";

const LOG_PATH = process.env.LOG_PATH ?? "~/Projects/fdry/logs/voltr.log";
const LEDGER_PATH = process.env.LEDGER_PATH ?? "~/Projects/fdry/logs/voltr_ledger.jsonl";
const STATE_PATH = process.env.STATE_PATH ?? "~/Projects/fdry/logs/voltr_state.json";
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";

type Env = {
  MANAGER_KEY: string;
  RPC_URL: string;
};

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }) + "\n";
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, line);
  if (process.stdout.isTTY || DRY_RUN) process.stdout.write(line);
}

function loadEnv(): Env {
  const required = ["MANAGER_KEY", "RPC_URL"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length && !DRY_RUN) throw new Error(`missing env: ${missing.join(",")}`);
  return {
    MANAGER_KEY: process.env.MANAGER_KEY ?? "",
    RPC_URL: process.env.RPC_URL ?? "https://api.devnet.solana.com",
  };
}

function appendLedger(entry: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

function readState(): { lastRotationTs: number | null; lastSignalHash: string | null } {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { lastRotationTs: null, lastSignalHash: null };
  }
}

function writeState(s: { lastRotationTs: number; lastSignalHash: string }): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s));
}

async function main(): Promise<number> {
  let env: Env;
  try {
    env = loadEnv();
  } catch (e) {
    log("error", "env load failed", { err: String(e) });
    return 1;
  }

  // 1. Read signal.
  const sig = await readSignalFile();
  if (!sig.ok) {
    log("error", "signal stale/missing", { reason: sig.reason });
    await alertRotateFail(`signal stale: ${sig.reason}`).catch(() => {});
    return 1;
  }
  const signal = sig.signal;
  const signalHash = crypto.createHash("sha256").update(JSON.stringify(signal)).digest("hex");
  log("info", "signal loaded", {
    path: sig.path,
    ageMs: sig.ageMs,
    confidence: signal.confidence,
    hash: signalHash.slice(0, 12),
  });

  // Idempotency: skip if we already rotated on this signal.
  const state = readState();
  if (state.lastSignalHash === signalHash) {
    log("info", "idempotency hit, already rotated on this signal", { hash: signalHash.slice(0, 12) });
    return 0;
  }

  // 2. Signal → long-only weights.
  const weightsBp = longOnlyWeights(signal);
  const universe = signal.universe;
  const weightsArray = universe.map((t) => weightsBp[t] ?? 0);
  log("info", "long-only weights computed", { weights: weightsBp });

  // 3. Dry-run short-circuit: show intent, no SDK calls.
  if (DRY_RUN && !env.MANAGER_KEY) {
    log("info", "dry-run (no MANAGER_KEY): intent only", {
      universe,
      weights: weightsBp,
      ranker: signal.ranker,
      confidence: signal.confidence,
    });
    return 0;
  }

  // 4. Load strategy registry + open Voltr client.
  let registry;
  try {
    registry = loadStrategyRegistry();
  } catch (e) {
    log("error", "strategy registry missing", { err: String(e) });
    await alertRotateFail(`strategies.json missing or invalid: ${String(e)}`).catch(() => {});
    return 1;
  }

  const connection = new Connection(env.RPC_URL, "confirmed");
  const manager = Keypair.fromSecretKey(Buffer.from(JSON.parse(env.MANAGER_KEY)));

  // 5. Fetch vault state.
  let vstate;
  try {
    vstate = await fetchVaultState(connection, manager, registry);
  } catch (e) {
    log("error", "fetchVaultState failed", { err: String(e) });
    await alertRotateFail(`fetchVaultState: ${String(e)}`).catch(() => {});
    return 1;
  }
  log("info", "vault state", { nav: vstate.totalValueUsdc, idle: vstate.idleUsdc });

  // 6. Current weights = allocations / total NAV (in bp).
  const currentWeightsBp: Record<string, number> = {};
  const total = vstate.totalValueUsdc || 1;
  for (const t of universe) {
    currentWeightsBp[t] = Math.round(((vstate.allocationsUsdc[t] ?? 0) / total) * TOTAL_BP);
  }
  // Fold idle into CASH.
  currentWeightsBp["CASH"] =
    (currentWeightsBp["CASH"] ?? 0) + Math.round((vstate.idleUsdc / total) * TOTAL_BP);
  const currentWeightsArray = universe.map((t) => currentWeightsBp[t] ?? 0);

  // 7. Cooldown guard.
  const nowTs = Math.floor(Date.now() / 1000);
  if (state.lastRotationTs && nowTs - state.lastRotationTs < COOLDOWN_SECONDS) {
    log("info", "cooldown active, skip", {
      elapsed: nowTs - state.lastRotationTs,
      needed: COOLDOWN_SECONDS,
    });
    return 0;
  }

  // 8. Apply guards.
  if (universe.length !== UNIVERSE_SIZE) {
    log("error", "universe length mismatch", { expected: UNIVERSE_SIZE, got: universe.length });
    return 2;
  }
  const hotSolBalance = (await connection.getBalance(manager.publicKey)) / 1e9;
  const guardCtx: GuardContext = {
    hotSolBalance,
    vaultNavUsdc: vstate.totalValueUsdc,
    confidence: signal.confidence,
    ranker: signal.ranker,
  };
  const gr = applyGuards(currentWeightsArray, weightsArray, guardCtx);
  if (!gr.ok) {
    log("error", "guard violation", { guard: gr.failedGuard, reason: gr.reason });
    await alertRotateFail(`guard ${gr.failedGuard}: ${gr.reason}`).catch(() => {});
    return 2;
  }
  const delta = maxDelta(currentWeightsArray, weightsArray);
  log("info", "guards passed", { maxDeltaBp: delta });

  // 9. Plan rotation.
  const plan = planRotation(
    vstate.allocationsUsdc,
    vstate.idleUsdc,
    weightsBp,
    vstate.totalValueUsdc,
    registry.strategies,
  );
  const planSummary = summarizePlan(plan);
  log("info", "rotation plan", { summary: planSummary, maxStepUsdc: plan.maxStepUsdc });

  if (plan.withdraws.length === 0 && plan.deposits.length === 0) {
    log("info", "within no-trade band, skip");
    writeState({ lastRotationTs: nowTs, lastSignalHash: signalHash });
    return 0;
  }

  // 10. Dry-run: show plan, skip tx submission.
  if (DRY_RUN) {
    log("info", "dry-run: plan only, no tx", {
      withdraws: plan.withdraws.map((s) => ({ token: s.token, usdc: s.amountUsdc })),
      deposits: plan.deposits.map((s) => ({ token: s.token, usdc: s.amountUsdc })),
    });
    return 0;
  }

  // 11. Build instructions. Withdraws first so idle USDC exists.
  const client = new VoltrClient(connection, manager);
  const ixs = [];
  try {
    for (const w of plan.withdraws) {
      ixs.push(await buildWithdrawIx(client, manager.publicKey, registry, w.strategy, w.amountUsdc));
    }
    for (const d of plan.deposits) {
      ixs.push(await buildDepositIx(client, manager.publicKey, registry, d.strategy, d.amountUsdc));
    }
  } catch (e) {
    log("error", "ix build failed", { err: String(e) });
    await alertRotateFail(`ix build: ${String(e)}`).catch(() => {});
    return 3;
  }

  // 12. Send.
  let sigs: string[] = [];
  try {
    sigs = await sendBatch(connection, manager, ixs);
  } catch (e) {
    log("error", "tx submit failed", { err: String(e) });
    await alertRotateFail(`tx submit: ${String(e)}`).catch(() => {});
    return 3;
  }

  // 13. Commit state + ledger + alert.
  appendLedger({
    event: "rotate",
    sigs,
    old_weights_bp: currentWeightsBp,
    new_weights_bp: weightsBp,
    plan_summary: planSummary,
    nav_usdc: vstate.totalValueUsdc,
    signal_hash: signalHash,
    signal_confidence: signal.confidence,
  });
  writeState({ lastRotationTs: nowTs, lastSignalHash: signalHash });
  await alertRotateOk(sigs, planSummary).catch((e) => log("warn", "telegram failed", { err: String(e) }));
  log("info", "rotation complete", { nSigs: sigs.length });
  return 0;
}

await alertStartup().catch(() => {});
main()
  .then((code) => process.exit(code))
  .catch(async (e) => {
    log("error", "unhandled", { err: String(e) });
    await alertRotateFail(`unhandled: ${String(e)}`).catch(() => {});
    process.exit(3);
  });
