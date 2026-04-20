#!/usr/bin/env tsx
/**
 * addFdryToVault.ts
 *
 * Adds FDRY to the Symmetry vault basket with a `raydium_cpmm` oracle.
 *
 * Prereq: user has created a Raydium CPMM v2 pool for FDRY/WSOL on raydium.io
 * and recorded the pool pubkey.
 *
 * Usage:
 *   tsx scripts/addFdryToVault.ts --pool <POOL_PUBKEY> [--dry-run]
 *
 * After running this, run updateVaultWeights.ts to redistribute target weights.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { SymmetryCore } from "@symmetry-hq/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FDRY_MINT = "2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL";
const FDRY_DECIMALS = 9;

function loadKeypair(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY env missing");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function makeWallet(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    signTransaction: async <T>(tx: T): Promise<T> => { (tx as any).sign([kp]); return tx; },
    signAllTransactions: async <T>(txs: T[]): Promise<T[]> => { txs.forEach((t: any) => t.sign([kp])); return txs; },
    payer: kp,
  };
}

function getVault(): string {
  const envPubkey = process.env.VAULT_PUBKEY?.trim();
  if (envPubkey) return envPubkey;
  const p = path.resolve(__dirname, "..", "docs", "vault.json");
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8")).vault_pubkey;
  throw new Error("no VAULT_PUBKEY available");
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const poolIdx = args.findIndex((a) => a === "--pool");
  const pool = poolIdx >= 0 ? args[poolIdx + 1] : undefined;

  if (!pool) {
    console.error("usage: tsx scripts/addFdryToVault.ts --pool <RAYDIUM_CPMM_POOL_PUBKEY> [--dry-run]");
    console.error("  create the pool first at https://raydium.io/liquidity/create/  (select CPMM)");
    process.exit(1);
  }

  const rpc = process.env.RPC_URL!;
  const network = (process.env.SYMMETRY_NETWORK || "mainnet") as "mainnet" | "devnet";
  const kp = loadKeypair();
  const wallet = makeWallet(kp);
  const conn = new Connection(rpc, "confirmed");
  const sdk = new SymmetryCore({ connection: conn, network, priorityFee: 75_000 });
  const vault = getVault();

  console.log(`\n=== addFdryToVault (${isDryRun ? "DRY RUN" : "LIVE"}) ===`);
  console.log(`  vault:     ${vault}`);
  console.log(`  fdry mint: ${FDRY_MINT}`);
  console.log(`  pool:      ${pool}`);
  console.log(`  decimals:  ${FDRY_DECIMALS}`);

  // Sanity: check pool account exists and isn't system program
  const info = await conn.getAccountInfo(new (await import("@solana/web3.js")).PublicKey(pool));
  if (!info) throw new Error(`pool account ${pool} not found on-chain`);
  console.log(`  pool owner: ${info.owner.toBase58()}`);

  if (isDryRun) {
    console.log("\nDRY RUN complete — no tx submitted.");
    return;
  }

  const tx = await sdk.addOrEditTokenTx(
    { vault, manager: kp.publicKey.toBase58() },
    {
      token_mint: FDRY_MINT,
      active: true,
      min_oracles_thresh: 1,
      min_conf_bps: 50,
      conf_thresh_bps: 500,
      conf_multiplier: 1.0,
      oracles: [
        {
          oracle_type: "raydium_cpmm",
          account_lut_id: 0,
          account_lut_index: 0,
          account: pool,
          weight_bps: 10000,
          is_required: true,
          conf_thresh_bps: 500,
          volatility_thresh_bps: 1000,
          max_slippage_bps: 2000, // thin pool = high slippage tolerance
          min_liquidity: 25, // USD — if drained below this, oracle pauses
          staleness_thresh: 300,
          staleness_conf_rate_bps: 100,
          token_decimals: FDRY_DECIMALS,
          twap_seconds_ago: 0,
          twap_secondary_seconds_ago: 0,
          quote_token: "wsol" as any,
        },
      ],
    },
  );

  console.log("\nsubmitting addOrEditTokenTx...");
  const res = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: tx, wallet });
  console.log(`  ✓ fdry registered: ${JSON.stringify(res).slice(0, 200)}`);
  console.log("\nnext: run updateVaultWeights.ts to set target weights including FDRY.");
}

main().catch((e) => {
  console.error("\n[fatal]", e.message);
  process.exit(1);
});
