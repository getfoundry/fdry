#!/usr/bin/env tsx
/**
 * scripts/seed.ts
 *
 * Seeds the Symmetry FDRY Treasury vault with $10k-USDC-worth of SOL from
 * CREATOR_WALLET. This is the first-deposit bootstrap (per VAULT_V1_SHIP_PLAN
 * Task B). CREATOR is the first and only depositor until external deposits
 * open.
 *
 * Flow (Symmetry 3-step deposit pattern):
 *   1. Pyth SOL/USD spot -> SOL amount = $10,000 / spot
 *   2. sdk.buyVaultTx({ buyer, vault_mint, contributions: [{ SOL_MINT, amount }] })
 *   3. sdk.signAndSendTxPayloadBatchSequence(wallet, buyBatch)
 *   4. sdk.lockDepositsTx({ buyer, vault_mint }) + sign-and-send
 *   5. Poll keeper: wait for CREATOR's vault_token (stFDRY) balance to mint
 *   6. Log shares received; append ledger/deposits.jsonl
 *
 * Usage:
 *   tsx scripts/seed.ts                 # live
 *   tsx scripts/seed.ts --dry-run       # preflight only, no txs
 *   tsx scripts/seed.ts --amount-usd=5000   # override target notional
 *
 * Env:
 *   CREATOR_WALLET            — base58 secret key OR JSON array OR path to keypair JSON
 *   RPC_URL                   — Solana RPC (default: https://api.mainnet-beta.solana.com)
 *   PYTH_HERMES_URL           — default: https://hermes.pyth.network
 *   SYMMETRY_NETWORK          — "mainnet" | "devnet" (default: mainnet)
 *   KEEPER_POLL_TIMEOUT_SEC   — default: 600 (10 min)
 *   KEEPER_POLL_INTERVAL_SEC  — default: 10
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError } from "@solana/spl-token";
import { SymmetryCore } from "@symmetry-hq/sdk";
import bs58 from "bs58";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// Pyth SOL/USD feed id (mirrors docs/oracles.json "SOL".pyth_id)
const PYTH_SOL_USD_FEED_ID =
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

const __dirname_esm = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname_esm, "..");
const VAULT_JSON_PATH = path.join(REPO_ROOT, "docs", "vault.json");
const LEDGER_PATH = path.join(REPO_ROOT, "ledger", "deposits.jsonl");

const DEFAULT_TARGET_USD = 10_000;
const MIN_SOL_HEADROOM = 0.05; // leave this much SOL for fees after deposit
const MAX_TX_RETRIES = 5;
const BASE_BACKOFF_MS = 500;

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let targetUsd = DEFAULT_TARGET_USD;
  for (const a of args) {
    if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--amount-usd=")) {
      const v = Number(a.split("=")[1]);
      if (!Number.isFinite(v) || v <= 0) throw new Error(`invalid --amount-usd: ${a}`);
      targetUsd = v;
    } else if (a === "-h" || a === "--help") {
      console.log("Usage: tsx scripts/seed.ts [--dry-run] [--amount-usd=10000]");
      process.exit(0);
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return { dryRun, targetUsd };
}

// ---------------------------------------------------------------------------
// Keypair loading — accepts path | JSON array | base58 string
// ---------------------------------------------------------------------------

function loadCreatorKeypair(): Keypair {
  const raw = process.env.CREATOR_KEY;
  if (!raw) {
    throw new Error(
      "CREATOR_WALLET env not set. Provide path to keypair JSON, JSON array, or base58 secret key."
    );
  }
  // path?
  if (fs.existsSync(raw)) {
    const txt = fs.readFileSync(raw, "utf8").trim();
    return parseKeypairString(txt);
  }
  return parseKeypairString(raw);
}

function parseKeypairString(s: string): Keypair {
  const t = s.trim();
  if (t.startsWith("[")) {
    const arr = JSON.parse(t);
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw new Error("keypair JSON array must be length 64");
    }
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  // base58
  return Keypair.fromSecretKey(bs58.decode(t));
}

// ---------------------------------------------------------------------------
// Pyth spot price via Hermes
// ---------------------------------------------------------------------------

async function fetchPythSolUsd(): Promise<number> {
  const base = process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network";
  const url = `${base}/v2/updates/price/latest?ids[]=${PYTH_SOL_USD_FEED_ID}`;
  return retry("pyth", async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`pyth http ${res.status}`);
    const body = (await res.json()) as any;
    const parsed = body?.parsed?.[0]?.price;
    if (!parsed?.price || parsed.expo === undefined) {
      throw new Error("pyth response missing price/expo");
    }
    const price = Number(parsed.price) * Math.pow(10, Number(parsed.expo));
    if (!Number.isFinite(price) || price <= 0) throw new Error("pyth price non-positive");
    return price;
  });
}

// ---------------------------------------------------------------------------
// Retry helper (exponential backoff + jitter)
// ---------------------------------------------------------------------------

async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < MAX_TX_RETRIES; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const wait = BASE_BACKOFF_MS * 2 ** i + Math.floor(Math.random() * 250);
      console.warn(
        `[retry:${label}] attempt ${i + 1}/${MAX_TX_RETRIES} failed: ${
          (e as Error).message
        }. sleeping ${wait}ms`
      );
      await sleep(wait);
    }
  }
  throw new Error(`[retry:${label}] exhausted ${MAX_TX_RETRIES} attempts: ${(lastErr as Error)?.message}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Vault pubkey loader
// ---------------------------------------------------------------------------

function loadVaultPubkey(): PublicKey {
  if (!fs.existsSync(VAULT_JSON_PATH)) {
    throw new Error(
      `${VAULT_JSON_PATH} not found. Run scripts/createVault.ts first to create the Symmetry vault.`
    );
  }
  const j = JSON.parse(fs.readFileSync(VAULT_JSON_PATH, "utf8"));
  const key = j.VAULT_PUBKEY ?? j.vault_pubkey ?? j.vaultMint ?? j.vault_mint;
  if (!key) throw new Error("vault.json missing VAULT_PUBKEY");
  return new PublicKey(key);
}

// ---------------------------------------------------------------------------
// Balance helpers
// ---------------------------------------------------------------------------

async function getSolBalance(conn: Connection, owner: PublicKey): Promise<number> {
  const lamports = await retry("sol-balance", () => conn.getBalance(owner, "confirmed"));
  return lamports / LAMPORTS_PER_SOL;
}

async function getVaultTokenBalance(
  conn: Connection,
  owner: PublicKey,
  vaultMint: PublicKey
): Promise<bigint> {
  const ata = await getAssociatedTokenAddress(vaultMint, owner, true);
  try {
    const acct = await retry("ata-fetch", () => getAccount(conn, ata, "confirmed"));
    return acct.amount;
  } catch (e) {
    if (e instanceof TokenAccountNotFoundError) return 0n;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Keeper poll — waits for CREATOR vault_token balance to increase
// ---------------------------------------------------------------------------

async function waitForKeeper(
  conn: Connection,
  creator: PublicKey,
  vaultMint: PublicKey,
  baselineShares: bigint
): Promise<bigint> {
  const timeoutSec = Number(process.env.KEEPER_POLL_TIMEOUT_SEC ?? 600);
  const intervalSec = Number(process.env.KEEPER_POLL_INTERVAL_SEC ?? 10);
  const deadline = Date.now() + timeoutSec * 1000;

  console.log(
    `[keeper] polling vault_token balance every ${intervalSec}s (timeout ${timeoutSec}s)...`
  );
  while (Date.now() < deadline) {
    const bal = await getVaultTokenBalance(conn, creator, vaultMint);
    if (bal > baselineShares) {
      const minted = bal - baselineShares;
      console.log(`[keeper] shares minted: ${minted.toString()} (total ${bal.toString()})`);
      return minted;
    }
    process.stdout.write(".");
    await sleep(intervalSec * 1000);
  }
  throw new Error(
    `keeper did not process deposit within ${timeoutSec}s. Check vault intents & keeper liveness.`
  );
}

// ---------------------------------------------------------------------------
// Ledger write (append-only JSONL)
// ---------------------------------------------------------------------------

type DepositRecord = {
  ts: string;
  kind: "seed";
  creator: string;
  vault_mint: string;
  contribution_mint: string;
  contribution_amount_lamports: string;
  contribution_amount_sol: number;
  target_usd: number;
  pyth_sol_usd: number;
  shares_minted: string;
  buy_signatures: string[];
  lock_signatures: string[];
  dry_run: boolean;
};

function appendDeposit(rec: DepositRecord) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(rec) + "\n", "utf8");
  console.log(`[ledger] appended: ${LEDGER_PATH}`);
}

// ---------------------------------------------------------------------------
// Batch send helper — normalizes any shape returned by
// signAndSendTxPayloadBatchSequence into a flat string[] of signatures.
// ---------------------------------------------------------------------------

function flattenSigs(result: unknown): string[] {
  if (!result) return [];
  if (typeof result === "string") return [result];
  if (Array.isArray(result)) return result.flatMap(flattenSigs);
  if (typeof result === "object") {
    const r: any = result;
    if (typeof r.signature === "string") return [r.signature];
    if (Array.isArray(r.signatures)) return r.signatures.flatMap(flattenSigs);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { dryRun, targetUsd } = parseArgs();
  const rpcUrl = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const network = (process.env.SYMMETRY_NETWORK ?? "mainnet") as "mainnet" | "devnet";

  console.log("========================================");
  console.log("FDRY Treasury — seed.ts");
  console.log("========================================");
  console.log(`network        : ${network}`);
  console.log(`rpc            : ${rpcUrl}`);
  console.log(`target usd     : $${targetUsd.toLocaleString()}`);
  console.log(`dry-run        : ${dryRun}`);

  const connection = new Connection(rpcUrl, "confirmed");
  const creator = loadCreatorKeypair();
  const vaultMint = loadVaultPubkey();

  console.log(`creator wallet : ${creator.publicKey.toBase58()}`);
  console.log(`vault mint     : ${vaultMint.toBase58()}`);

  // Pyth spot
  const solUsd = await fetchPythSolUsd();
  const solAmount = targetUsd / solUsd;
  const lamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));

  console.log(`pyth SOL/USD   : $${solUsd.toFixed(4)}`);
  console.log(`seed amount    : ${solAmount.toFixed(6)} SOL (${lamports} lamports)`);

  // Starting balances
  const startSol = await getSolBalance(connection, creator.publicKey);
  const baselineShares = await getVaultTokenBalance(connection, creator.publicKey, vaultMint);
  console.log(`start SOL bal  : ${startSol.toFixed(6)}`);
  console.log(`start shares   : ${baselineShares.toString()}`);

  // Pre-checks
  const requiredSol = solAmount + MIN_SOL_HEADROOM;
  if (startSol < requiredSol) {
    throw new Error(
      `insufficient SOL: have ${startSol.toFixed(6)}, need ${requiredSol.toFixed(6)} ` +
        `(${solAmount.toFixed(6)} deposit + ${MIN_SOL_HEADROOM} fee headroom)`
    );
  }

  if (dryRun) {
    console.log("----------------------------------------");
    console.log("DRY RUN — no transactions will be sent.");
    console.log("----------------------------------------");
    console.log("would call:");
    console.log(`  1. sdk.buyVaultTx({`);
    console.log(`       buyer: ${creator.publicKey.toBase58()},`);
    console.log(`       vault_mint: ${vaultMint.toBase58()},`);
    console.log(`       contributions: [{ mint: ${SOL_MINT.toBase58()}, amount: ${lamports} }]`);
    console.log(`     })`);
    console.log(`  2. sdk.signAndSendTxPayloadBatchSequence(creator, buyBatch)`);
    console.log(`  3. sdk.lockDepositsTx({ buyer, vault_mint })`);
    console.log(`  4. sdk.signAndSendTxPayloadBatchSequence(creator, lockBatch)`);
    console.log(`  5. poll vault_token balance until keeper mints shares`);
    console.log(`  6. append record to ${LEDGER_PATH}`);
    console.log("Dry run complete.");
    return;
  }

  // ---- Live ----
  const sdk = new SymmetryCore({
    connection,
    network,
    priorityFee: 50_000,
  } as any);

  console.log("----------------------------------------");
  console.log("[1/4] building buyVaultTx...");
  const buyBatch = await retry("buyVaultTx", () =>
    (sdk as any).buyVaultTx({
      buyer: creator.publicKey,
      vault_mint: vaultMint,
      contributions: [{ mint: SOL_MINT, amount: lamports }],
    })
  );

  console.log("[2/4] signing + sending buy batch...");
  const buyRes = await retry("send-buy", () =>
    (sdk as any).signAndSendTxPayloadBatchSequence(creator, buyBatch)
  );
  const buySigs = flattenSigs(buyRes);
  console.log(`      buy signatures: ${buySigs.join(", ") || "(sdk-managed)"}`);

  console.log("[3/4] building + sending lockDepositsTx...");
  const lockBatch = await retry("lockDepositsTx", () =>
    (sdk as any).lockDepositsTx({
      buyer: creator.publicKey,
      vault_mint: vaultMint,
    })
  );
  const lockRes = await retry("send-lock", () =>
    (sdk as any).signAndSendTxPayloadBatchSequence(creator, lockBatch)
  );
  const lockSigs = flattenSigs(lockRes);
  console.log(`      lock signatures: ${lockSigs.join(", ") || "(sdk-managed)"}`);

  console.log("[4/4] waiting for keeper to process intent...");
  const mintedShares = await waitForKeeper(
    connection,
    creator.publicKey,
    vaultMint,
    baselineShares
  );

  // Ending balances
  const endSol = await getSolBalance(connection, creator.publicKey);
  const endShares = await getVaultTokenBalance(connection, creator.publicKey, vaultMint);

  console.log("========================================");
  console.log("SEED COMPLETE");
  console.log("========================================");
  console.log(`SOL     : ${startSol.toFixed(6)} -> ${endSol.toFixed(6)} (Δ ${(endSol - startSol).toFixed(6)})`);
  console.log(`shares  : ${baselineShares.toString()} -> ${endShares.toString()} (+${mintedShares.toString()} stFDRY)`);
  console.log(`buy sigs: ${buySigs.join(", ")}`);
  console.log(`lock sigs: ${lockSigs.join(", ")}`);

  const rec: DepositRecord = {
    ts: new Date().toISOString(),
    kind: "seed",
    creator: creator.publicKey.toBase58(),
    vault_mint: vaultMint.toBase58(),
    contribution_mint: SOL_MINT.toBase58(),
    contribution_amount_lamports: lamports.toString(),
    contribution_amount_sol: solAmount,
    target_usd: targetUsd,
    pyth_sol_usd: solUsd,
    shares_minted: mintedShares.toString(),
    buy_signatures: buySigs,
    lock_signatures: lockSigs,
    dry_run: false,
  };
  appendDeposit(rec);
}

main().catch((e) => {
  console.error("FATAL:", e?.stack ?? e);
  process.exit(1);
});
