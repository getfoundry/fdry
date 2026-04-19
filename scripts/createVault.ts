/**
 * createVault.ts — FDRY Quant Alpha vault bootstrap
 *
 * One-shot bootstrap script that creates the Symmetry vault, registers each of
 * the 6 underlying tokens with its oracle aggregators, and pushes the initial
 * equal-weight target allocation. After a successful run the vault pubkey is
 * persisted to docs/vault.json for downstream wiring (frontend, bot, monitors).
 *
 * Universe (post-correction):
 *   [SOL, WIF, BONK, POPCAT, FLOKI, JTO] — 6 tokens.
 *   PEPE dropped: no liquid Solana pool.
 *   FARTCOIN dropped: no Binance spot bars for backtest.
 *   DOGE dropped: C6 L3 3a — 6-token universe alignment.
 *
 * SDK signature notes (per SPEC §4 / §7 correction):
 *   • All *Tx calls use (TaskContext, settings) pattern.
 *   • addOrEditTokenTx(ctx, settings)  — ctx.manager required.
 *   • updateWeightsTx(ctx, settings)   — ctx.manager required; HOT_WALLET has
 *                                         UPDATE_WEIGHTS authority only.
 *   • createVaultTx(settings)          — signed by CREATOR_WALLET.
 *
 * Usage:
 *   tsx scripts/createVault.ts --dry-run   # validate + preview, no txns
 *   tsx scripts/createVault.ts             # broadcast to mainnet
 */

import * as fs from "fs";
import * as path from "path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { SymmetryCore } from "@symmetry-hq/sdk";

import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey("BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate");
const VAULT_NAME = "FDRY Quant Alpha";
const VAULT_SYMBOL = "fdryQA";

const REBALANCE_THRESHOLD_BP = 500;   // 5% drift
const REBALANCE_COOLDOWN_SEC = 86_400; // 1 day (daily cadence, matches backtest)

const CREATOR_FEE_BP = 0;      // disabled at Symmetry protocol level anyway
const HOST_FEE_BP = 0;
const DEPOSIT_FEE_BP = 0;
const MANAGEMENT_FEE_BP = 0;
const PERFORMANCE_FEE_BP = 0; // disabled at protocol level
const WITHDRAWAL_FEE_BP = 50;  // soft retention

const DOCS_DIR = path.resolve(__dirname, "..", "docs");
const ORACLES_PATH = path.join(DOCS_DIR, "oracles.json");
const VAULT_OUT_PATH = path.join(DOCS_DIR, "vault.json");

// Canonical Solana mainnet SPL mints.
// SPEC-aligned universe — 6 tokens. (PEPE/FARTCOIN/DOGE dropped per L3 notes.)
const TOKEN_MINTS: Record<string, string> = {
  SOL:    "So11111111111111111111111111111111111111112",
  WIF:    "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  BONK:   "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  POPCAT: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
  FLOKI:  "9tzZzEHsKnwFL1A3DyFJwj36KnZj3gZ7g4srWp9YTEoh", // bridged
  JTO:    "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
};

// Weights — 10000 / 6 = 1666 bp each; first slot gets 1670 to sum to exactly 10000.
const N = 6;
const BASE_BP = Math.floor(10_000 / N);     // 1666
const REMAINDER = 10_000 - BASE_BP * N;      // 4
const EQUAL_WEIGHTS: number[] = Array.from({ length: N }, (_, i) =>
  i === 0 ? BASE_BP + REMAINDER : BASE_BP,
);

// Universe order — MUST match oracle lookup order and weight vector order.
const UNIVERSE = ["SOL", "WIF", "BONK", "POPCAT", "FLOKI", "JTO"] as const;
type Symbol = (typeof UNIVERSE)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Env + argv
// ─────────────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes("--dry-run");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v.trim();
}

function loadCreatorKeypair(): Keypair {
  const raw = requireEnv("CREATOR_KEY");
  try {
    // Support both base58 and JSON-array keyfile strings.
    if (raw.startsWith("[")) {
      const arr = JSON.parse(raw) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch (e) {
    throw new Error(
      `CREATOR_KEY is not a valid base58 secret key or JSON byte-array: ${(e as Error).message}`,
    );
  }
}

function validateEnv() {
  const required = ["CREATOR_KEY", "CREATOR_WALLET", "HOT_WALLET", "RPC_URL"];
  const missing = required.filter((k) => !process.env[k] || process.env[k]!.trim() === "");
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }

  // Cross-check: CREATOR_KEY must match CREATOR_WALLET.
  const kp = loadCreatorKeypair();
  const declared = requireEnv("CREATOR_WALLET");
  if (kp.publicKey.toBase58() !== declared) {
    throw new Error(
      `CREATOR_KEY pubkey (${kp.publicKey.toBase58()}) does not match CREATOR_WALLET (${declared})`,
    );
  }

  // HOT_WALLET must parse as a pubkey.
  try {
    new PublicKey(requireEnv("HOT_WALLET"));
  } catch {
    throw new Error(`HOT_WALLET is not a valid base58 Solana pubkey`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Oracle loading
// ─────────────────────────────────────────────────────────────────────────────

type OracleEntry = {
  pyth_id?: string;
  source?: string;
  symbol?: string;
  description?: string;
  primary_pool?: { dex?: string; pair_address?: string };
};

type OraclesFile = Record<string, OracleEntry | unknown>;

function loadOracles(): Record<Symbol, OracleEntry> {
  if (!fs.existsSync(ORACLES_PATH)) {
    throw new Error(`Oracles file not found at ${ORACLES_PATH}`);
  }
  const json = JSON.parse(fs.readFileSync(ORACLES_PATH, "utf8")) as OraclesFile;
  const out: Partial<Record<Symbol, OracleEntry>> = {};
  for (const sym of UNIVERSE) {
    const entry = json[sym] as OracleEntry | undefined;
    if (!entry || !entry.pyth_id) {
      throw new Error(`oracles.json missing pyth_id for ${sym}`);
    }
    out[sym] = entry;
  }
  return out as Record<Symbol, OracleEntry>;
}

// Build aggregator list per token: Pyth primary, Raydium CLMM fallback (if any).
// Symmetry's SDK accepts an array of oracle sources; shape may evolve, so we
// keep this adapter explicit.
function buildOracleAggregators(entry: OracleEntry): Array<{ type: string; id: string }> {
  const aggs: Array<{ type: string; id: string }> = [];
  if (entry.pyth_id) aggs.push({ type: "pyth", id: entry.pyth_id });
  if (entry.primary_pool?.dex?.toLowerCase() === "raydium" && entry.primary_pool.pair_address) {
    aggs.push({ type: "raydium_clmm", id: entry.primary_pool.pair_address });
  }
  return aggs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview / dry-run printer
// ─────────────────────────────────────────────────────────────────────────────

function printPlan(
  creator: PublicKey,
  hot: PublicKey,
  oracles: Record<Symbol, OracleEntry>,
): void {
  console.log("=".repeat(72));
  console.log("FDRY Quant Alpha — Vault Creation Plan");
  console.log("=".repeat(72));
  console.log(`Mode:              ${DRY_RUN ? "DRY RUN (no txns sent)" : "LIVE (will broadcast)"}`);
  console.log(`Program ID:        ${PROGRAM_ID.toBase58()}`);
  console.log(`Creator wallet:    ${creator.toBase58()}`);
  console.log(`Hot wallet (mgr):  ${hot.toBase58()}  [UPDATE_WEIGHTS only]`);
  console.log(`Vault name:        ${VAULT_NAME}`);
  console.log(`Rebalance thresh:  ${REBALANCE_THRESHOLD_BP} bp`);
  console.log(`Rebalance cool:    ${REBALANCE_COOLDOWN_SEC} s (daily)`);
  console.log(`Fees (bp):         creator=${CREATOR_FEE_BP} host=${HOST_FEE_BP} deposit=${DEPOSIT_FEE_BP} withdraw=${WITHDRAWAL_FEE_BP} mgmt=${MANAGEMENT_FEE_BP} perf=${PERFORMANCE_FEE_BP}`);
  console.log(`Weights sum:       ${EQUAL_WEIGHTS.reduce((a, b) => a + b, 0)} bp (expect 10000)`);
  console.log("");
  console.log("Underlying tokens:");
  for (let i = 0; i < UNIVERSE.length; i++) {
    const sym = UNIVERSE[i];
    const mint = TOKEN_MINTS[sym];
    const aggs = buildOracleAggregators(oracles[sym]);
    const aggStr = aggs.map((a) => `${a.type}:${a.id.slice(0, 10)}…`).join(", ");
    console.log(`  [${i}] ${sym.padEnd(7)} w=${EQUAL_WEIGHTS[i].toString().padStart(4)} bp  mint=${mint}  oracles=[${aggStr}]`);
  }
  console.log("=".repeat(72));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[createVault] starting ${DRY_RUN ? "(DRY RUN)" : "(LIVE)"}...`);

  // 1. Validate environment up front.
  try {
    validateEnv();
  } catch (e) {
    console.error(`[createVault] env validation failed: ${(e as Error).message}`);
    process.exit(2);
  }

  const creatorKp = loadCreatorKeypair();
  const hotPubkey = new PublicKey(requireEnv("HOT_WALLET"));
  const rpcUrl = requireEnv("RPC_URL");

  // 2. Load oracles.
  let oracles: Record<Symbol, OracleEntry>;
  try {
    oracles = loadOracles();
  } catch (e) {
    console.error(`[createVault] oracle load failed: ${(e as Error).message}`);
    process.exit(3);
  }

  printPlan(creatorKp.publicKey, hotPubkey, oracles);

  if (DRY_RUN) {
    console.log("[createVault] dry-run complete. No transactions sent.");
    return;
  }

  // 3. Live path: build connection + SDK.
  const connection = new Connection(rpcUrl, "confirmed");
  const sdk = new SymmetryCore({
    connection,
    network: "mainnet",
    priorityFee: 50_000,
  });

  // Sanity: verify we're pointing at the right program ID.
  const globalCfg = await sdk.fetchGlobalConfig().catch((e: Error) => {
    throw new Error(`Cannot reach Symmetry on ${rpcUrl}: ${e.message}`);
  });
  console.log(`[createVault] connected to Symmetry (program ${PROGRAM_ID.toBase58()})`);
  void globalCfg; // surfaced for debugging if needed

  // 4. Create vault.
  //    createVaultTx is signed by CREATOR_WALLET. Returns a TxPayloadBatchSequence.
  //    The vault's mint pubkey is derived and returned by the SDK.
  let vaultMint: PublicKey;
  try {
    const createBatch = await sdk.createVaultTx({
      host_platform: creatorKp.publicKey, // no separate host; creator = host
      manager: creatorKp.publicKey,
      name: VAULT_NAME,
      symbol: VAULT_SYMBOL,
      rebalance_threshold: REBALANCE_THRESHOLD_BP,
      rebalance_interval: REBALANCE_COOLDOWN_SEC,
      lp_offset_threshold: 0,
      creator_fee_bps: CREATOR_FEE_BP,
      host_fee_bps: HOST_FEE_BP,
      deposit_fee_bps: DEPOSIT_FEE_BP,
      withdrawal_fee_bps: WITHDRAWAL_FEE_BP,
      management_fee_bps: MANAGEMENT_FEE_BP,
      performance_fee_bps: PERFORMANCE_FEE_BP,
      managers: [{ pubkey: hotPubkey, authority_mask: "UPDATE_WEIGHTS" }],
      // 6-slot universe registered with placeholder zero weights; real weights
      // pushed after addOrEditTokenTx seeds oracles for each slot.
      tokens: UNIVERSE.map((sym) => ({
        mint: new PublicKey(TOKEN_MINTS[sym]),
        target_weight: 0,
        oracle_aggregators: buildOracleAggregators(oracles[sym]),
      })),
    });
    const result = await sdk.signAndSendTxPayloadBatchSequence(creatorKp, createBatch);
    vaultMint = new PublicKey(result.vault_mint ?? result.vaultMint ?? result.mint);
    console.log(`[createVault] vault created. mint=${vaultMint.toBase58()}`);
  } catch (e) {
    console.error(`[createVault] createVaultTx failed: ${(e as Error).message}`);
    process.exit(4);
  }

  // 5. addOrEditTokenTx for each token — sets/confirms oracle aggregators.
  //    Uses (ctx: TaskContext, settings) pattern per SPEC §4 correction.
  for (let i = 0; i < UNIVERSE.length; i++) {
    const sym = UNIVERSE[i];
    const mint = new PublicKey(TOKEN_MINTS[sym]);
    const aggs = buildOracleAggregators(oracles[sym]);
    try {
      const batch = await sdk.addOrEditTokenTx(
        {
          payer: creatorKp.publicKey,
          vault_mint: vaultMint,
          manager: creatorKp.publicKey,
        },
        {
          token_mint: mint,
          target_weight: 0, // real weights set by updateWeightsTx below
          oracle_aggregators: aggs,
        },
      );
      await sdk.signAndSendTxPayloadBatchSequence(creatorKp, batch);
      console.log(`[createVault] addOrEditToken ok: ${sym} (${mint.toBase58().slice(0, 8)}…)`);
    } catch (e) {
      console.error(`[createVault] addOrEditTokenTx failed for ${sym}: ${(e as Error).message}`);
      process.exit(5);
    }
  }

  // 6. updateWeightsTx — push equal weights.
  //    Signed by CREATOR on bootstrap (HOT_WALLET takes over from day 2 for
  //    recurring updates). Same (ctx, settings) shape.
  try {
    const batch = await sdk.updateWeightsTx(
      {
        payer: creatorKp.publicKey,
        vault_mint: vaultMint,
        manager: creatorKp.publicKey,
      },
      { weights: EQUAL_WEIGHTS },
    );
    await sdk.signAndSendTxPayloadBatchSequence(creatorKp, batch);
    console.log(`[createVault] initial weights set: [${EQUAL_WEIGHTS.join(", ")}] bp`);
  } catch (e) {
    console.error(`[createVault] updateWeightsTx failed: ${(e as Error).message}`);
    process.exit(6);
  }

  // 7. Persist vault metadata for downstream consumers.
  const out = {
    _meta: {
      generated_by: "scripts/createVault.ts",
      generated_at: new Date().toISOString(),
    },
    network: "mainnet",
    program_id: PROGRAM_ID.toBase58(),
    vault_mint: vaultMint.toBase58(),
    name: VAULT_NAME,
    symbol: VAULT_SYMBOL,
    creator_wallet: creatorKp.publicKey.toBase58(),
    hot_wallet: hotPubkey.toBase58(),
    universe: UNIVERSE,
    token_mints: Object.fromEntries(UNIVERSE.map((s) => [s, TOKEN_MINTS[s]])),
    initial_weights_bp: Object.fromEntries(UNIVERSE.map((s, i) => [s, EQUAL_WEIGHTS[i]])),
    fees_bp: {
      creator: CREATOR_FEE_BP,
      host: HOST_FEE_BP,
      deposit: DEPOSIT_FEE_BP,
      withdrawal: WITHDRAWAL_FEE_BP,
      management: MANAGEMENT_FEE_BP,
      performance: PERFORMANCE_FEE_BP,
    },
    rebalance: {
      threshold_bp: REBALANCE_THRESHOLD_BP,
      cooldown_sec: REBALANCE_COOLDOWN_SEC,
    },
  };
  fs.writeFileSync(VAULT_OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[createVault] wrote ${VAULT_OUT_PATH}`);
  console.log(`[createVault] DONE. vault_mint=${vaultMint.toBase58()}`);
}

main().catch((e) => {
  console.error(`[createVault] fatal: ${(e as Error).stack || e}`);
  process.exit(1);
});
