#!/usr/bin/env tsx
/**
 * addToken.ts — register a single token in the vault.
 *
 * Must be called once per token before trade.ts can use it as from/to.
 *
 * Usage:
 *   tsx scripts/addToken.ts --symbol SOL --mint So11... --pyth 7UVim... --decimals 9 [--dry-run]
 *
 * Pyth Pull Oracle account lookup: https://pyth.network/developers/price-feeds
 *   (get the on-chain "price account" pubkey, not the feed hash)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { SymmetryCore } from "@symmetry-hq/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  const getArg = (n: string) => {
    const i = args.findIndex(a => a === n);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const symbol = getArg("--symbol");
  const mint = getArg("--mint");
  const pyth = getArg("--pyth");
  const decimals = parseInt(getArg("--decimals") || "9");
  const quoteToken = getArg("--quote") || "usd";
  const weightBps = parseInt(getArg("--weight-bps") || "0");  // 0 = only registers, doesn't set target weight

  if (!symbol || !mint || !pyth) {
    console.error("usage: tsx scripts/addToken.ts --symbol SOL --mint <mint> --pyth <pyth_account> --decimals 9 [--weight-bps 1666] [--dry-run]");
    process.exit(1);
  }

  const rpc = process.env.RPC_URL!;
  const network = (process.env.SYMMETRY_NETWORK || "mainnet") as "mainnet" | "devnet";
  const kp = loadKeypair();
  const wallet = makeWallet(kp);
  const conn = new Connection(rpc, "confirmed");
  const sdk = new SymmetryCore({ connection: conn, network, priorityFee: 50_000 });
  const vault = getVault();

  console.log(`\n=== addToken ${symbol} (${isDryRun ? "DRY RUN" : "LIVE"}) ===`);
  console.log(`  vault:    ${vault}`);
  console.log(`  mint:     ${mint}`);
  console.log(`  pyth:     ${pyth}`);
  console.log(`  decimals: ${decimals}`);
  console.log(`  quote:    ${quoteToken}`);

  if (isDryRun) {
    console.log("\nDRY RUN complete.");
    return;
  }

  const tx = await sdk.addOrEditTokenTx(
    { vault, manager: kp.publicKey.toBase58() },
    {
      token_mint: mint,
      active: true,
      min_oracles_thresh: 1,
      min_conf_bps: 10,
      conf_thresh_bps: 200,
      conf_multiplier: 1.0,
      oracles: [{
        oracle_type: "pyth",
        account_lut_id: 0,
        account_lut_index: 0,
        account: pyth,
        weight_bps: 10000,
        is_required: true,
        conf_thresh_bps: 200,
        volatility_thresh_bps: 200,
        max_slippage_bps: 1000,
        min_liquidity: 0,
        staleness_thresh: 120,
        staleness_conf_rate_bps: 50,
        token_decimals: decimals,
        twap_seconds_ago: 0,
        twap_secondary_seconds_ago: 0,
        quote_token: quoteToken as any,
      }],
    }
  );
  const res = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: tx, wallet });
  console.log(`  ✓ ${symbol} registered: ${JSON.stringify(res).slice(0, 150)}...`);
}

main().catch(e => {
  console.error("\n[fatal]", e.message);
  process.exit(1);
});
