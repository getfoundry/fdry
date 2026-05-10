#!/usr/bin/env tsx
/**
 * managerInitSaveStrategy.ts — initialize the Save USDC strategy on the
 * slim-barbell vault.
 *
 * Ported from voltrxyz/lend-scripts/src/scripts/manager-init-strategies.ts
 * (initSolendStrategy function).
 *
 * Derives the strategy PDA from [SEEDS.STRATEGY, counterPartyTa] under
 * the Voltr Lending Adaptor program. Sets up:
 *   - vault's cUSDC ATA (collateral) under strategyAuth
 *   - vault's USDC ATA (asset) under strategyAuth
 *   - Solend obligation account (createWithSeed)
 *   - Init strategy receipt via createInitializeStrategyIx
 *
 * USAGE
 *   ./scripts/with-secrets ./node_modules/.bin/tsx scripts/managerInitSaveStrategy.ts
 *   ./scripts/with-secrets env DRY_RUN=0 EXECUTE=1 ./node_modules/.bin/tsx \
 *     scripts/managerInitSaveStrategy.ts
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { VoltrClient, SEEDS } from "@voltr/vault-sdk";
// @coral-xyz/anchor's createWithSeedSync is used to derive the Solend
// obligation account per voltrxyz/lend-scripts reference.
import { createWithSeedSync } from "@coral-xyz/anchor/dist/cjs/utils/pubkey.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const EXECUTE = process.env.EXECUTE === "1";
const WOULD_EXECUTE = !DRY_RUN && EXECUTE;

// Voltr Lending Adaptor program (mainnet)
const LENDING_ADAPTOR_PROGRAM_ID = new PublicKey(
  "aVoLTRCRt3NnnchvLYH6rMYehJHwM5m45RmLBZq7PGz",
);

// Save (Solend) USDC main-market reserve accounts
// (from voltrxyz/lend-scripts/src/constants/solend.ts MAIN_MARKET.USDC)
const SOLEND = {
  PROGRAM_ID: new PublicKey("So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo"),
  LENDING_MARKET: new PublicKey("4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY"),
  USDC: {
    COUNTERPARTY_TA: new PublicKey("8SheGtsopRUDzdiD6v6BR9a6bqZ9QwywYQY99Fp5meNf"),
    RESERVE: new PublicKey("BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw"),
    COLLATERAL_MINT: new PublicKey("993dVFL2uXWYeoXuEBFXR4BijeXdTv4s6BzsCjJZuwqk"),
    PYTH_ORACLE: new PublicKey("Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX"),
    SWITCHBOARD_ORACLE: new PublicKey("BjUgj6YCnFBZ49wF54ddBVA9qu8TeqkFtkbqmZcee8uW"),
  },
};

const SLIM_VAULT_JSON = path.resolve(__dirname, "..", "voltr", "slim-vault.json");
const STRATEGIES_OUT = path.resolve(__dirname, "..", "voltr", "strategies.json");

function loadKp(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY env missing");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function deriveAta(owner: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function createAtaIdempotentIx(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  // Associated Token Program "create idempotent" = instruction index 1
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

async function main() {
  console.log(`# managerInitSaveStrategy`);
  console.log(`DRY_RUN=${DRY_RUN}  EXECUTE=${EXECUTE}  wouldExecute=${WOULD_EXECUTE}`);

  if (!fs.existsSync(SLIM_VAULT_JSON)) {
    throw new Error(`${SLIM_VAULT_JSON} missing — run createSlimVault.ts first`);
  }
  const vaultInfo = JSON.parse(fs.readFileSync(SLIM_VAULT_JSON, "utf8")) as {
    vault: string; asset: string; assetTokenProgram: string;
  };
  const vault = new PublicKey(vaultInfo.vault);
  const vaultAssetMint = new PublicKey(vaultInfo.asset);
  const vaultAssetTokenProgram = new PublicKey(vaultInfo.assetTokenProgram);
  console.log(`  vault=${vault.toBase58()}`);

  const rpc = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpc, "confirmed");
  const payerKp = loadKp();
  const payer = payerKp.publicKey;
  const client = new VoltrClient(conn);

  // 1. Derive strategy PDA = [SEEDS.STRATEGY, counterPartyTa] under lending adaptor
  const [strategy] = PublicKey.findProgramAddressSync(
    [SEEDS.STRATEGY, SOLEND.USDC.COUNTERPARTY_TA.toBuffer()],
    LENDING_ADAPTOR_PROGRAM_ID,
  );
  console.log(`  strategy PDA=${strategy.toBase58()}`);

  // 2. Find vaultStrategyAuth + derive obligation (Solend pattern)
  const { vaultStrategyAuth } = client.findVaultStrategyAddresses(vault, strategy);
  const obligation = createWithSeedSync(
    vaultStrategyAuth,
    SOLEND.LENDING_MARKET.toBase58().slice(0, 32),
    SOLEND.PROGRAM_ID,
  );
  console.log(`  vaultStrategyAuth=${vaultStrategyAuth.toBase58()}`);
  console.log(`  obligation=${obligation.toBase58()}`);

  // 3. Build ATA setup + init strategy ixs
  const ixs: TransactionInstruction[] = [];
  const vaultCollateralAta = deriveAta(vaultStrategyAuth, SOLEND.USDC.COLLATERAL_MINT);
  const vaultAssetAta = deriveAta(vaultStrategyAuth, vaultAssetMint, vaultAssetTokenProgram);

  ixs.push(createAtaIdempotentIx(payer, vaultCollateralAta, vaultStrategyAuth, SOLEND.USDC.COLLATERAL_MINT));
  ixs.push(createAtaIdempotentIx(payer, vaultAssetAta, vaultStrategyAuth, vaultAssetMint, vaultAssetTokenProgram));

  const initStrategyIx = await client.createInitializeStrategyIx(
    {},
    {
      payer, vault, manager: payer, strategy,
      adaptorProgram: LENDING_ADAPTOR_PROGRAM_ID,
      remainingAccounts: [
        { pubkey: SOLEND.PROGRAM_ID,    isSigner: false, isWritable: false },
        { pubkey: obligation,           isSigner: false, isWritable: true  },
        { pubkey: SOLEND.LENDING_MARKET,isSigner: false, isWritable: true  },
        { pubkey: SYSVAR_CLOCK_PUBKEY,  isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY,   isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID,     isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    },
  );
  ixs.push(initStrategyIx);

  // Simulate
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer, recentBlockhash: blockhash, instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  console.log(`\n-- simulating --`);
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  console.log(`  sim.err=${JSON.stringify(sim.value.err)}`);
  for (const l of sim.value.logs ?? []) console.log(`    ${l}`);
  if (sim.value.err && WOULD_EXECUTE) {
    throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}`);
  }

  console.log(`\n===PLAN===`);
  console.log(JSON.stringify({
    vault: vault.toBase58(),
    strategy: strategy.toBase58(),
    vaultStrategyAuth: vaultStrategyAuth.toBase58(),
    obligation: obligation.toBase58(),
    vaultCollateralAta: vaultCollateralAta.toBase58(),
    vaultAssetAta: vaultAssetAta.toBase58(),
    wouldExecute: WOULD_EXECUTE,
  }, null, 2));

  if (!WOULD_EXECUTE) {
    console.log(`\n[dry-run] no tx sent.`);
    return;
  }

  tx.sign([payerKp]);
  const sig = await conn.sendTransaction(tx, { skipPreflight: false });
  console.log(`  sent: ${sig}`);
  const conf = await conn.confirmTransaction(sig, "confirmed");
  if (conf.value.err) throw new Error(`confirm err: ${JSON.stringify(conf.value.err)}`);
  console.log(`  confirmed ✓`);

  // Write to strategies.json (merge with existing if present)
  let registry: { strategies?: Array<{ token: string; pubkey: string }> } = {};
  if (fs.existsSync(STRATEGIES_OUT)) {
    try { registry = JSON.parse(fs.readFileSync(STRATEGIES_OUT, "utf8")); } catch { /* ignore */ }
  }
  console.log(`  strategy ${strategy.toBase58()} initialized. Paste into strategies.json under 'CASH' entry 'pubkey'.`);
  console.log(`  Also record: obligation=${obligation.toBase58()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
