#!/usr/bin/env tsx
/**
 * FDRY Quant Alpha — vault creation (v2, matches https://docs.symmetry.fi/guides/examples.md)
 *
 * 4 transactions:
 *   1. createVaultTx           → returns {mint, vault}
 *   2. addOrEditTokenTx × N    → add each token with oracle config
 *   3. updateWeightsTx         → set target weights (must sum to 10000)
 *   4. (optional) editFeesTx   → customize fees beyond defaults
 *
 * Usage:
 *   tsx scripts/createVault-v2.ts --dry-run
 *   tsx scripts/createVault-v2.ts --bare           # only step 1 (bare vault, add tokens later)
 *   tsx scripts/createVault-v2.ts                  # full create+tokens+weights
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { SymmetryCore } from "@symmetry-hq/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ---
const VAULT_NAME = "FDRY Quant Alpha";
const VAULT_SYMBOL = "fdryQA";
const START_PRICE = "1.0";
// Temporary placeholder metadata URI — any valid URL; replace with real arweave/github later
const METADATA_URI = "https://raw.githubusercontent.com/lekt9/fdry/main/docs/vault-metadata.json";

// 6-token universe with on-chain Pyth price account pubkeys (Pyth Push mainnet)
// These pubkeys are from Pyth's published mainnet price feeds.
// If any fail at addOrEditTokenTx time, look them up fresh at: https://pyth.network/developers/price-feeds
const UNIVERSE = [
  { sym: "SOL",    mint: "So11111111111111111111111111111111111111112", pyth: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE", decimals: 9,  weight_bps: 1670 },
  { sym: "WIF",    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", pyth: "6ABgrEZk8urs6kJ1JNdC1sspH5zKXRqxy8sg3ZG2cQps", decimals: 6,  weight_bps: 1666 },
  { sym: "BONK",   mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", pyth: "DBE3N8uNjhKPRHfANdwGvCZghWXyLPdqdSbEW2XFwBiX", decimals: 5,  weight_bps: 1666 },
  { sym: "POPCAT", mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", pyth: "H3GmCcyWx9EZQYUP2EaD2YbWGJPRSoBMg2XSxXPmsKvK", decimals: 9,  weight_bps: 1666 },
  { sym: "FLOKI",  mint: "9tzZzEHsKnwFL1A3DyFJwj36KnZj3gZ7g4srWp9YTEoh", pyth: "7obQTg43YCiZ3AS6jqGvyVJmjnqVXnV7UbZpW2nGZ2La", decimals: 6,  weight_bps: 1666 },
  { sym: "JTO",    mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", pyth: "D8UUgr8a3aR3yUeHLu7v8FWK7E8Y5sSU7qrYBXUJXBQ5", decimals: 9,  weight_bps: 1666 },
];

// --- Helpers ---
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

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isBare = args.includes("--bare");

  const rpc = process.env.RPC_URL!;
  const network = (process.env.SYMMETRY_NETWORK || "mainnet") as "mainnet" | "devnet";

  const kp = loadKeypair();
  const wallet = makeWallet(kp);
  const conn = new Connection(rpc, "confirmed");
  const sdk = new SymmetryCore({ connection: conn, network, priorityFee: 50_000 });

  // Sum weights check
  const totalBp = UNIVERSE.reduce((s, t) => s + t.weight_bps, 0);
  if (totalBp !== 10000) {
    throw new Error(`Weights sum to ${totalBp} bp, must equal 10000`);
  }

  console.log(`\n=== FDRY Quant Alpha — Vault Creation (${isDryRun ? "DRY RUN" : "LIVE"}) ===`);
  console.log(`Network:  ${network}`);
  console.log(`RPC:      ${rpc}`);
  console.log(`Creator:  ${kp.publicKey.toBase58()}`);
  console.log(`Name:     ${VAULT_NAME}`);
  console.log(`Symbol:   ${VAULT_SYMBOL}`);
  console.log(`Metadata: ${METADATA_URI}`);
  console.log(`Tokens:   ${UNIVERSE.length}, weights sum to ${totalBp} bp`);
  for (const t of UNIVERSE) {
    console.log(`  - ${t.sym.padEnd(7)} ${t.weight_bps}bp  mint=${t.mint}  pyth=${t.pyth}`);
  }
  console.log();

  if (isDryRun) {
    console.log("DRY RUN complete. No transactions sent.");
    return;
  }

  // --- Step 1: createVaultTx ---
  console.log("[1/4] Creating vault...");
  const createRes = await sdk.createVaultTx({
    creator: kp.publicKey.toBase58(),
    start_price: START_PRICE,
    name: VAULT_NAME,
    symbol: VAULT_SYMBOL,
    metadata_uri: METADATA_URI,
  });
  const vaultMint = (createRes as any).mint;
  const vaultAccount = (createRes as any).vault;
  console.log(`  vault mint:    ${vaultMint}`);
  console.log(`  vault account: ${vaultAccount}`);

  const sig1 = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: createRes, wallet });
  console.log(`  ✓ vault created, tx: ${JSON.stringify(sig1).slice(0, 200)}...`);

  // Persist pubkeys immediately (in case next steps fail)
  const vaultJson = {
    vault_pubkey: vaultAccount,
    vault_mint: vaultMint,
    network,
    created_ts: new Date().toISOString(),
    name: VAULT_NAME,
    symbol: VAULT_SYMBOL,
  };
  const vaultJsonPath = path.resolve(__dirname, "..", "docs", "vault.json");
  fs.writeFileSync(vaultJsonPath, JSON.stringify(vaultJson, null, 2));
  console.log(`  ✓ wrote ${vaultJsonPath}`);

  if (isBare) {
    console.log("\nBARE mode: stopping after vault creation. Run again without --bare to add tokens.");
    return;
  }

  // --- Step 2: addOrEditTokenTx for each token ---
  for (let i = 0; i < UNIVERSE.length; i++) {
    const t = UNIVERSE[i];
    console.log(`[2.${i + 1}/4] Adding ${t.sym}...`);
    try {
      const tokenTx = await sdk.addOrEditTokenTx(
        { vault: vaultAccount, manager: kp.publicKey.toBase58() },
        {
          token_mint: t.mint,
          active: true,
          min_oracles_thresh: 1,
          min_conf_bps: 10,
          conf_thresh_bps: 200,
          conf_multiplier: 1.0,
          oracles: [{
            oracle_type: "pyth",
            account_lut_id: 0,
            account_lut_index: 0,
            account: t.pyth,
            weight_bps: 10000,
            is_required: true,
            conf_thresh_bps: 200,
            volatility_thresh_bps: 200,
            max_slippage_bps: 1000,
            min_liquidity: 0,
            staleness_thresh: 120,
            staleness_conf_rate_bps: 50,
            token_decimals: t.decimals,
            twap_seconds_ago: 0,
            twap_secondary_seconds_ago: 0,
            quote_token: "usd",
          }],
        }
      );
      await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: tokenTx, wallet });
      console.log(`  ✓ ${t.sym} added`);
    } catch (e: any) {
      console.error(`  ✗ ${t.sym} failed: ${e.message}`);
      console.error(`    If oracle account is wrong, fix pyth: field in UNIVERSE and re-run.`);
      console.error(`    Vault still exists; this script is idempotent per-token.`);
      throw e;
    }
  }

  // --- Step 3: updateWeightsTx ---
  console.log(`[3/4] Setting target weights...`);
  const weightsTx = await sdk.updateWeightsTx(
    { vault: vaultAccount, manager: kp.publicKey.toBase58() },
    {
      token_weights: UNIVERSE.map(t => ({ mint: t.mint, weight_bps: t.weight_bps })),
    }
  );
  await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: weightsTx, wallet });
  console.log(`  ✓ weights set`);

  // --- Done ---
  console.log(`\n=== VAULT LIVE ===`);
  console.log(`  vault pubkey: ${vaultAccount}`);
  console.log(`  vault mint:   ${vaultMint}`);
  console.log(`  solscan:      https://solscan.io/account/${vaultAccount}`);
  console.log(`  symmetry UI:  https://app.symmetry.fi/vaults/${vaultAccount}`);
  console.log(`\nNext: add VAULT_PUBKEY=${vaultAccount} to ~/.fdry/env then run seed.ts`);
}

main().catch(e => {
  console.error("\n[fatal]", e.message);
  console.error(e.stack);
  process.exit(1);
});
