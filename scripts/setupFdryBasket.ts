#!/usr/bin/env tsx
/**
 * setupFdryBasket.ts
 *
 * 1. Create a Raydium CPMM v2 pool for FDRY/WSOL (~$30 each side), just enough
 *    liquidity for Symmetry's raydium_cpmm oracle to read a price from.
 * 2. Register FDRY in the Symmetry vault with that pool as its oracle.
 * 3. Update vault target weights to include FDRY.
 *
 * Writes docs/fdry-pool.json on success so later runs can re-use the pool.
 *
 * Usage:
 *   tsx scripts/setupFdryBasket.ts [--dry-run]
 *     [--fdry-raw <amount>]   default: 92_000 * 1e9
 *     [--sol-raw <lamports>]  default: 0.36 * 1e9
 *     [--fdry-weight-bps 3000] [--sol-weight-bps 3500] [--usdc-weight-bps 3500]
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import BN from "bn.js";
import { Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { SymmetryCore } from "@symmetry-hq/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FDRY_MINT = new PublicKey("2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FDRY_DECIMALS = 9;
const WSOL_DECIMALS = 9;
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const CPMM_CONFIG_API = "https://api-v3.raydium.io/main/cpmm-config";

function loadKeypair(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY env missing");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function makeSymmetryWallet(kp: Keypair) {
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

function getArg(args: string[], name: string): string | undefined {
  const i = args.findIndex((a) => a === name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  const fdryRaw = new BN(getArg(args, "--fdry-raw") ?? "92000000000000"); // 92,000 * 1e9
  const solRaw = new BN(getArg(args, "--sol-raw") ?? "360000000"); // 0.36 SOL

  const fdryWeight = parseInt(getArg(args, "--fdry-weight-bps") ?? "3000");
  const solWeight = parseInt(getArg(args, "--sol-weight-bps") ?? "3500");
  const usdcWeight = parseInt(getArg(args, "--usdc-weight-bps") ?? "3500");
  if (fdryWeight + solWeight + usdcWeight !== 10000) {
    throw new Error(`weights must sum to 10000 bps, got ${fdryWeight + solWeight + usdcWeight}`);
  }

  const rpc = process.env.RPC_URL!;
  const network = (process.env.SYMMETRY_NETWORK || "mainnet") as "mainnet" | "devnet";
  const kp = loadKeypair();
  const conn = new Connection(rpc, "confirmed");
  const vault = getVault();

  console.log(`\n=== setupFdryBasket (${isDryRun ? "DRY RUN" : "LIVE"}) ===`);
  console.log(`  vault:    ${vault}`);
  console.log(`  wallet:   ${kp.publicKey.toBase58()}`);
  console.log(`  fdry:     ${fdryRaw.toString()} raw  (${Number(fdryRaw.toString()) / 1e9} FDRY)`);
  console.log(`  sol:      ${solRaw.toString()} raw  (${Number(solRaw.toString()) / 1e9} SOL)`);
  console.log(`  weights:  fdry ${fdryWeight}bps · sol ${solWeight}bps · usdc ${usdcWeight}bps`);

  // --- Pre-flight: check balances
  const solBal = await conn.getBalance(kp.publicKey);
  if (solBal < solRaw.toNumber() + 50_000_000) {
    throw new Error(`wallet has ${solBal / 1e9} SOL, needs at least ${(solRaw.toNumber() + 50_000_000) / 1e9} SOL (pool seed + pool creation fee + gas)`);
  }
  const parsed = await conn.getParsedTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_PROGRAM_ID });
  let fdryBal = new BN(0);
  for (const { account } of parsed.value) {
    const info = (account.data as any).parsed.info;
    if (info.mint === FDRY_MINT.toBase58()) fdryBal = new BN(info.tokenAmount.amount);
  }
  if (fdryBal.lt(fdryRaw)) {
    throw new Error(`wallet FDRY balance ${fdryBal.toString()} < needed ${fdryRaw.toString()}`);
  }
  console.log(`  balances: ${solBal / 1e9} SOL · ${fdryBal.toString()} raw FDRY ✓`);

  // --- Fetch Raydium CPMM config
  console.log(`\n[1/3] fetching Raydium CPMM config...`);
  const cfgRes = await fetch(CPMM_CONFIG_API);
  if (!cfgRes.ok) throw new Error(`raydium api ${cfgRes.status}`);
  const cfgJson = await cfgRes.json() as { success: boolean; data: any[] };
  if (!cfgJson.success || !cfgJson.data?.length) throw new Error("raydium config empty");
  // Pick the lowest-fee config (typically tier 0 = 0.25%)
  const feeCfg = cfgJson.data[0];
  console.log(`  config: tradeFee=${feeCfg.tradeFeeRate} protocolFee=${feeCfg.protocolFeeRate} id=${feeCfg.id}`);

  if (isDryRun) {
    console.log("\nDRY RUN — stopping before submit.");
    return;
  }

  // --- Load Raydium SDK
  console.log(`\n[2/3] creating Raydium CPMM pool (FDRY/WSOL)...`);
  const raydium = await Raydium.load({
    connection: conn,
    owner: kp,
    cluster: "mainnet",
    disableFeatureCheck: true,
    blockhashCommitment: "confirmed",
  });

  const createRes = await raydium.cpmm.createPool({
    programId: new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
    poolFeeAccount: new PublicKey("DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8"), // Raydium CPMM mainnet pool-create fee receiver
    mintA: {
      address: FDRY_MINT.toBase58(),
      decimals: FDRY_DECIMALS,
      programId: TOKEN_PROGRAM_ID.toBase58(),
    },
    mintB: {
      address: WSOL_MINT.toBase58(),
      decimals: WSOL_DECIMALS,
      programId: TOKEN_PROGRAM_ID.toBase58(),
    },
    mintAAmount: fdryRaw,
    mintBAmount: solRaw,
    startTime: new BN(0),
    feeConfig: feeCfg,
    associatedOnly: true,
    ownerInfo: { useSOLBalance: true },
    txVersion: TxVersion.V0,
    computeBudgetConfig: { units: 600_000, microLamports: 75_000 },
  });

  const { execute, extInfo } = createRes;
  const poolAddr = extInfo.address.poolId.toBase58();
  console.log(`  pool id: ${poolAddr}`);
  console.log(`  vault A: ${extInfo.address.vaultA.toBase58()}`);
  console.log(`  vault B: ${extInfo.address.vaultB.toBase58()}`);
  console.log(`  observation: ${extInfo.address.observationId.toBase58()}`);

  const { txId } = await execute({ sendAndConfirm: true });
  console.log(`  ✓ pool created: https://solscan.io/tx/${txId}`);

  // Persist the pool info
  const poolDoc = {
    pool_id: poolAddr,
    vault_a: extInfo.address.vaultA.toBase58(),
    vault_b: extInfo.address.vaultB.toBase58(),
    observation_id: extInfo.address.observationId.toBase58(),
    lp_mint: extInfo.address.lpMint.toBase58(),
    mint_a: FDRY_MINT.toBase58(),
    mint_b: WSOL_MINT.toBase58(),
    fdry_seed_raw: fdryRaw.toString(),
    sol_seed_raw: solRaw.toString(),
    create_tx: txId,
    created_at: new Date().toISOString(),
  };
  const poolPath = path.resolve(__dirname, "..", "docs", "fdry-pool.json");
  fs.writeFileSync(poolPath, JSON.stringify(poolDoc, null, 2) + "\n");
  console.log(`  → wrote ${poolPath}`);

  // --- Wait a few seconds for the pool to be indexed / observation to settle
  console.log(`\n[3/3] registering FDRY in Symmetry vault...`);
  await new Promise((r) => setTimeout(r, 3_000));

  const sdk = new SymmetryCore({ connection: conn, network, priorityFee: 75_000 });
  const wallet = makeSymmetryWallet(kp);

  const addTokenTx = await sdk.addOrEditTokenTx(
    { vault, manager: kp.publicKey.toBase58() },
    {
      token_mint: FDRY_MINT.toBase58(),
      active: true,
      min_oracles_thresh: 1,
      min_conf_bps: 100,
      conf_thresh_bps: 1000,
      conf_multiplier: 1.0,
      oracles: [
        {
          oracle_type: "raydium_cpmm",
          account_lut_id: 0,
          account_lut_index: 0,
          account: poolAddr,
          weight_bps: 10000,
          is_required: true,
          conf_thresh_bps: 1000,
          volatility_thresh_bps: 2000,
          max_slippage_bps: 3000,
          min_liquidity: 25,
          staleness_thresh: 600,
          staleness_conf_rate_bps: 200,
          token_decimals: FDRY_DECIMALS,
          twap_seconds_ago: 0,
          twap_secondary_seconds_ago: 0,
          quote_token: "wsol" as any,
        },
      ],
    },
  );
  console.log(`  submitting addOrEditTokenTx...`);
  const addRes = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: addTokenTx, wallet });
  console.log(`  ✓ FDRY registered: ${JSON.stringify(addRes).slice(0, 180)}`);

  // --- Update weights
  console.log(`\n[3b/3] updating target weights...`);
  const updateWeightsTx = await sdk.updateWeightsTx(
    { vault, manager: kp.publicKey.toBase58() },
    {
      token_weights: [
        { token_mint: FDRY_MINT.toBase58(), weight_bps: fdryWeight },
        { token_mint: WSOL_MINT.toBase58(), weight_bps: solWeight },
        { token_mint: USDC_MINT, weight_bps: usdcWeight },
      ] as any,
    } as any,
  );
  const wRes = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: updateWeightsTx, wallet });
  console.log(`  ✓ weights updated: ${JSON.stringify(wRes).slice(0, 180)}`);

  console.log(`\n✓ done.`);
  console.log(`  Raydium pool:  https://solscan.io/account/${poolAddr}`);
  console.log(`  Vault:         https://solscan.io/account/${vault}`);
  console.log(`\nThe vault now holds FDRY natively as a basket asset.`);
  console.log(`Users who deposit FDRY no longer need the Jupiter swap wrapper.`);
}

main().catch((e) => {
  console.error("\n[fatal]", e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
