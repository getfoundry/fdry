#!/usr/bin/env tsx
/**
 * createSlimVault.ts — create the USDC slim-barbell Voltr vault.
 *
 * Parallel to createRangerFdryVault.ts but with USDC as asset + cap
 * scaled for the initial $100-$1k live test.
 *
 * SAFETY
 *   DRY_RUN defaults to 1. Signs + sends ONLY when DRY_RUN=0 AND EXECUTE=1.
 *
 * IDEMPOTENCY
 *   If fdry/voltr/slim-vault.json exists with a `vault` field, prints + exits 0.
 *   FORCE=1 + I_KNOW_ORPHANING_PREVIOUS_VAULT=1 to re-create.
 *
 * USAGE
 *   # Preview (no tx):
 *   ./scripts/with-secrets tsx scripts/createSlimVault.ts
 *
 *   # Actually create:
 *   ./scripts/with-secrets --require-mainnet \
 *     env DRY_RUN=0 EXECUTE=1 tsx scripts/createSlimVault.ts
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { VoltrClient, SEEDS } from "@voltr/vault-sdk";
import {
  SLIM_VAULT_ASSET_MINT,
  SLIM_PROGRAM_ID,
  SLIM_VAULT_NAME,
  SLIM_VAULT_DESCRIPTION,
  SLIM_DEFAULT_VAULT_CONFIG,
  getAssetTokenProgram,
} from "./lib/slimConfig";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const EXECUTE = process.env.EXECUTE === "1";
const FORCE = process.env.FORCE === "1";
const WOULD_EXECUTE = !DRY_RUN && EXECUTE;

const OUT_PATH = path.resolve(__dirname, "..", "voltr", "slim-vault.json");

function loadKp(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY env missing (source scripts/with-secrets)");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function deriveLpMint(vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEEDS.VAULT_LP_MINT, vault.toBuffer()],
    SLIM_PROGRAM_ID,
  )[0];
}

function deriveAssetIdleAuth(vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEEDS.VAULT_ASSET_IDLE_AUTH, vault.toBuffer()],
    SLIM_PROGRAM_ID,
  )[0];
}

async function main() {
  console.log(`# createSlimVault`);
  console.log(`DRY_RUN=${DRY_RUN}  EXECUTE=${EXECUTE}  wouldExecute=${WOULD_EXECUTE}  FORCE=${FORCE}`);

  // Idempotency gate
  if (fs.existsSync(OUT_PATH)) {
    let existing: { vault?: string } | null = null;
    try {
      existing = JSON.parse(fs.readFileSync(OUT_PATH, "utf-8"));
    } catch { /* malformed file — fall through */ }
    if (existing?.vault) {
      if (!FORCE) {
        console.log(`slim-vault.json already exists with vault=${existing.vault}`);
        console.log(`(set FORCE=1 to re-create)`);
        process.exit(0);
      }
      if (process.env.I_KNOW_ORPHANING_PREVIOUS_VAULT !== "1") {
        throw new Error(`refusing to orphan vault ${existing.vault}; set I_KNOW_ORPHANING_PREVIOUS_VAULT=1 to proceed`);
      }
      console.error(`[FORCE] orphaning previous vault ${existing.vault}`);
    }
  }

  const rpc = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpc, "confirmed");
  const payerKp = loadKp();
  const payer = payerKp.publicKey;
  console.log(`rpc=${rpc}`);
  console.log(`payer/admin/manager=${payer.toBase58()}`);

  const vaultKp = Keypair.generate();
  const vault = vaultKp.publicKey;
  console.log(`NEW vault pubkey (ephemeral until execute): ${vault.toBase58()}`);

  const lpMintPda = deriveLpMint(vault);
  const assetIdleAuthPda = deriveAssetIdleAuth(vault);
  console.log(`derived lpMint PDA: ${lpMintPda.toBase58()}`);
  console.log(`derived assetIdleAuth PDA: ${assetIdleAuthPda.toBase58()}`);

  const assetTokenProgram = await getAssetTokenProgram(conn, SLIM_VAULT_ASSET_MINT);
  console.log(`asset=${SLIM_VAULT_ASSET_MINT.toBase58()} tokenProgram=${assetTokenProgram.toBase58()}`);

  const client = new VoltrClient(conn);

  const ix = await client.createInitializeVaultIx(
    {
      config: SLIM_DEFAULT_VAULT_CONFIG,
      name: SLIM_VAULT_NAME,
      description: SLIM_VAULT_DESCRIPTION,
    },
    {
      vault,
      vaultAssetMint: SLIM_VAULT_ASSET_MINT,
      admin: payer,
      manager: payer,
      payer,
    },
  );

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  console.log(`\n-- simulating --`);
  try {
    const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
    console.log(`sim.err=${JSON.stringify(sim.value.err)}`);
    for (const l of sim.value.logs ?? []) console.log(`  ${l}`);
    if (sim.value.err && WOULD_EXECUTE) {
      throw new Error(`simulation failed — refusing to execute: ${JSON.stringify(sim.value.err)}`);
    }
  } catch (e: unknown) {
    const msgText = e instanceof Error ? e.message : String(e);
    console.error(`simulate threw: ${msgText}`);
    if (WOULD_EXECUTE) throw e;
  }

  console.log(`\n===PLAN===`);
  console.log(JSON.stringify({
    vault: vault.toBase58(),
    lpMintPda: lpMintPda.toBase58(),
    assetIdleAuthPda: assetIdleAuthPda.toBase58(),
    asset: SLIM_VAULT_ASSET_MINT.toBase58(),
    assetTokenProgram: assetTokenProgram.toBase58(),
    admin: payer.toBase58(),
    manager: payer.toBase58(),
    name: SLIM_VAULT_NAME,
    description: SLIM_VAULT_DESCRIPTION,
    maxCapUsdc: Number(SLIM_DEFAULT_VAULT_CONFIG.maxCap.toString()) / 1e6,
    wouldExecute: WOULD_EXECUTE,
  }, null, 2));

  if (!WOULD_EXECUTE) {
    console.log(`\n[dry-run] no signing, no sending, no write to ${OUT_PATH}.`);
    console.log(`Set DRY_RUN=0 EXECUTE=1 to actually submit.`);
    return;
  }

  console.log(`\n[!!] DRY_RUN=0 EXECUTE=1 — signing with payer + vault keypair and sending.`);
  let sig: string;
  try {
    tx.sign([payerKp, vaultKp]);
    sig = await conn.sendTransaction(tx, { skipPreflight: false });
    console.log(`sent: ${sig}`);
    console.error("=== RECOVERY INFO (save this if script crashes) ===");
    console.error(JSON.stringify({ tx: sig, vault: vaultKp.publicKey.toBase58(), at: new Date().toISOString() }, null, 2));
    console.error("===");
    const conf = await conn.confirmTransaction(sig, "confirmed");
    console.log(`confirmed: ${JSON.stringify(conf.value)}`);
    if (conf.value.err) throw new Error(`confirm returned err: ${JSON.stringify(conf.value.err)}`);
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`\n[PARTIAL-FAILURE] createInitializeVault threw — vault keypair ${vault.toBase58()} may or may not be on-chain.`);
    console.error(`  Inspect with: solana account ${vault.toBase58()}`);
    console.error(`  error: ${errMsg}`);
    throw new Error(`PARTIAL-FAILURE initializing vault: ${errMsg}`);
  }

  const out = {
    vault: vault.toBase58(),
    lpMint_pda: lpMintPda.toBase58(),
    assetIdleAuth_pda: assetIdleAuthPda.toBase58(),
    asset: SLIM_VAULT_ASSET_MINT.toBase58(),
    assetTokenProgram: assetTokenProgram.toBase58(),
    admin: payer.toBase58(),
    manager: payer.toBase58(),
    signature: sig,
    createdAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
    console.log(`wrote ${OUT_PATH}`);
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`write to ${OUT_PATH} failed: ${errMsg}`);
    console.error(`(transaction succeeded — manually record the vault pubkey above)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
