/**
 * Daily rebalance cron for the Foundry vault.
 * Exit codes: 0 success/no-op, 1 stale signal, 2 guard violation, 3 tx failure.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";
import * as sdk from "@symmetry-hq/sdk";
import { readSignalFile, signalToWeights } from "./signal";
import { applyGuards, maxDelta } from "./guards";
import { alertTelegram } from "./alerts";

const LOG_PATH = "/Users/lekt9/Projects/fdry/logs/bot.log";
const LEDGER_PATH = "/Users/lekt9/Projects/fdry/logs/ledger.jsonl";
const IDEMPOTENCY_PATH = "/Users/lekt9/Projects/fdry/logs/last_run.json";
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";

type Env = {
  VAULT_PUBKEY: string;
  HOT_WALLET_KEY: string;
  RPC_URL: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
};

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }) + "\n";
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, line);
  if (process.stdout.isTTY || DRY_RUN) process.stdout.write(line);
}

function loadEnv(): Env {
  const required = ["VAULT_PUBKEY", "HOT_WALLET_KEY", "RPC_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
  const optionalInDryRun = new Set(["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]);
  const missing = required.filter((k) => !process.env[k] && !(DRY_RUN && optionalInDryRun.has(k)));
  if (missing.length) throw new Error(`missing env: ${missing.join(",")}`);
  return Object.fromEntries(required.map((k) => [k, process.env[k] ?? ""])) as unknown as Env;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function idempotencyKey(signalHash: string): string {
  return `${todayUtc()}:${signalHash.slice(0, 12)}`;
}

function checkIdempotency(key: string): boolean {
  if (!fs.existsSync(IDEMPOTENCY_PATH)) return true;
  try {
    const prev = JSON.parse(fs.readFileSync(IDEMPOTENCY_PATH, "utf8"));
    return prev.key !== key;
  } catch {
    return true;
  }
}

function recordIdempotency(key: string, sig: string | null): void {
  fs.mkdirSync(path.dirname(IDEMPOTENCY_PATH), { recursive: true });
  fs.writeFileSync(IDEMPOTENCY_PATH, JSON.stringify({ key, sig, ts: new Date().toISOString() }));
}

function appendLedger(entry: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

async function main(): Promise<number> {
  let env: Env;
  try {
    env = loadEnv();
  } catch (e) {
    log("error", "env load failed", { err: String(e) });
    return 1;
  }

  const signal = await readSignalFile();
  if (!signal.ok) {
    log("error", "signal stale or missing", { reason: signal.reason });
    await alertTelegram(env, `signal stale: ${signal.reason}`).catch(() => {});
    return 1;
  }

  const signalHash = crypto.createHash("sha256").update(JSON.stringify(signal.signal)).digest("hex");
  const idemKey = idempotencyKey(signalHash);
  if (!checkIdempotency(idemKey)) {
    log("info", "idempotency hit, already ran today for this signal", { key: idemKey });
    return 0;
  }

  const universe = signal.signal.universe;
  const newWeights = signalToWeights(signal.signal, universe);

  // In DRY_RUN with a placeholder vault pubkey, skip on-chain fetch and print intent.
  if (DRY_RUN) {
    log("info", "dry-run: forcing EW, intended weights update", {
      universe,
      newWeights,
      ranker: signal.signal.ranker,
      confidence: signal.signal.confidence,
    });
    return 0;
  }

  const vault = await sdk.fetchVault(env.VAULT_PUBKEY);
  const currentWeights: number[] = vault.tokens.map((t: { targetWeightBp: number }) => t.targetWeightBp);

  const guardCtx = {
    hotSolBalance: typeof vault.hotSolBalance === "number" ? vault.hotSolBalance : 0,
    vaultNavSol: typeof vault.navSol === "number" ? vault.navSol : 0,
    confidence: signal.signal.confidence,
    ranker: signal.signal.ranker,
  };
  const guardResult = applyGuards(currentWeights, newWeights, guardCtx);
  if (!guardResult.ok) {
    log("error", "guard violation", { reason: guardResult.reason });
    await alertTelegram(env, `guard: ${guardResult.reason}`).catch(() => {});
    return 2;
  }

  const delta = maxDelta(currentWeights, newWeights);
  if (delta < 100) {
    log("info", "weights unchanged < 100bp, skip", { delta });
    recordIdempotency(idemKey, null);
    return 0;
  }

  try {
    const kp = Keypair.fromSecretKey(Buffer.from(JSON.parse(env.HOT_WALLET_KEY)));
    const taskCtx = sdk.createTaskContext({ manager: kp.publicKey.toBase58(), rpcUrl: env.RPC_URL });
    const tx = await sdk.updateWeightsTx(taskCtx, { vault_mint: env.VAULT_PUBKEY, weights: newWeights });
    const sig = await sdk.signAndSendTxPayloadBatchSequence(tx, [kp]);
    appendLedger({ event: "rebalance", sig, old: currentWeights, new: newWeights, delta });
    recordIdempotency(idemKey, sig);
    await alertTelegram(env, `rebalance ok: ${sig}`).catch((e) => log("warn", "telegram failed", { err: String(e) }));
    log("info", "rebalance ok", { sig, delta });
    return 0;
  } catch (e) {
    log("error", "tx failure", { err: String(e) });
    await alertTelegram(env, `tx failed: ${String(e)}`).catch(() => {});
    return 3;
  }
}

main().then((code) => process.exit(code)).catch((e) => {
  log("error", "unhandled", { err: String(e) });
  process.exit(3);
});
