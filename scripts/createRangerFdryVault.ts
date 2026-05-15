#!/usr/bin/env tsx
/**
 * createRangerFdryVault.ts — minimum-viable seed to initialize a Voltr/Ranger
 * vault for the FDRY staking product (stFDRY).
 *
 * Step-2 firmament (Jesus Loop Day 3):
 *   All fees 0, no profit-lock, 3-day withdrawal waiting period, FDRY as the asset mint,
 *   name/description fixed in lib/rangerConfig.ts. See docs/FDRY_ONLY_HANDOFF.md
 *   for the decision context — this script is the mechanical expression of that.
 *
 * SAFETY
 *   DRY_RUN defaults to ON. Script ONLY signs + sends when DRY_RUN=0 AND EXECUTE=1
 *   (same guard pattern as rebalanceToFdryOnly.ts L51-53).
 *   Dry-run path: build ix, build versioned tx, simulate via connection.simulateTransaction
 *   ({ sigVerify:false, replaceRecentBlockhash:true }), print plan + sim logs, exit.
 *
 * IDEMPOTENCY
 *   If /Users/lekt9/Projects/fdry/docs/ranger-vault.json already exists and has a
 *   `vault` field, the script prints it and exits 0. FORCE=1 overrides.
 *
 * DO NOT SIGN OR SEND without explicit DRY_RUN=0 EXECUTE=1.
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
  VAULT_ASSET_MINT,
  PROGRAM_ID,
  VAULT_NAME,
  VAULT_DESCRIPTION,
  DEFAULT_VAULT_CONFIG,
  getAssetTokenProgram,
} from "./lib/rangerConfig";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const EXECUTE = process.env.EXECUTE === "1";
const FORCE = process.env.FORCE === "1";
const WOULD_EXECUTE = !DRY_RUN && EXECUTE;

const OUT_PATH = path.resolve(__dirname, "..", "docs", "ranger-vault.json");

function loadKp(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY env missing (source scripts/with-secrets)");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function deriveLpMint(vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEEDS.VAULT_LP_MINT, vault.toBuffer()],
    PROGRAM_ID,
  )[0];
}

function deriveAssetIdleAuth(vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEEDS.VAULT_ASSET_IDLE_AUTH, vault.toBuffer()],
    PROGRAM_ID,
  )[0];
}

async function main() {
  console.log(`# createRangerFdryVault`);
  console.log(`DRY_RUN=${DRY_RUN}  EXECUTE=${EXECUTE}  wouldExecute=${WOULD_EXECUTE}  FORCE=${FORCE}`);

  // ---- Idempotency gate ----
  if (fs.existsSync(OUT_PATH)) {
    let existing: any = null;
    try {
      existing = JSON.parse(fs.readFileSync(OUT_PATH, "utf-8"));
    } catch {
      // malformed file — fall through
    }
    if (existing?.vault) {
      if (!FORCE) {
        console.log(`ranger-vault.json already exists with vault=${existing.vault}`);
        console.log(`(set FORCE=1 to re-create)`);
        process.exit(0);
      }
      // FORCE=1 + existing vault: require explicit orphan acknowledgement.
      if (process.env.I_KNOW_ORPHANING_PREVIOUS_VAULT !== "1") {
        throw new Error(`refusing to orphan vault ${existing.vault}; set I_KNOW_ORPHANING_PREVIOUS_VAULT=1 to proceed`);
      }
      console.error(`[FORCE] orphaning previous vault ${existing.vault} (I_KNOW_ORPHANING_PREVIOUS_VAULT=1 acknowledged)`);
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

  // Resolve FDRY token program at runtime (classic vs Token-2022).
  const assetTokenProgram = await getAssetTokenProgram(conn, VAULT_ASSET_MINT);
  console.log(`asset=${VAULT_ASSET_MINT.toBase58()} tokenProgram=${assetTokenProgram.toBase58()}`);

  const client = new VoltrClient(conn);

  // SDK signature (per client.d.ts L278): createInitializeVaultIx(vaultParams, accounts).
  // vaultParams = { config, name, description }. accounts.vault is a PublicKey
  // (the vault keypair signs the tx separately).
  const ix = await client.createInitializeVaultIx(
    {
      config: DEFAULT_VAULT_CONFIG,
      name: VAULT_NAME,
      description: VAULT_DESCRIPTION,
    },
    {
      vault,
      vaultAssetMint: VAULT_ASSET_MINT,
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

  // ---- Simulation (always) ----
  console.log(`\n-- simulating --`);
  try {
    const sim = await conn.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });
    console.log(`sim.err=${JSON.stringify(sim.value.err)}`);
    const logs = sim.value.logs ?? [];
    for (const l of logs) console.log(`  ${l}`);
    if (sim.value.err && WOULD_EXECUTE) {
      throw new Error(`simulation failed — refusing to execute: ${JSON.stringify(sim.value.err)}`);
    }
  } catch (e: any) {
    console.error(`simulate threw: ${e.message ?? String(e)}`);
    if (WOULD_EXECUTE) throw e;
  }

  console.log(`\n===PLAN===`);
  console.log(JSON.stringify({
    vault: vault.toBase58(),
    lpMintPda: lpMintPda.toBase58(),
    assetIdleAuthPda: assetIdleAuthPda.toBase58(),
    asset: VAULT_ASSET_MINT.toBase58(),
    assetTokenProgram: assetTokenProgram.toBase58(),
    admin: payer.toBase58(),
    manager: payer.toBase58(),
    name: VAULT_NAME,
    description: VAULT_DESCRIPTION,
    wouldExecute: WOULD_EXECUTE,
  }, null, 2));

  if (!WOULD_EXECUTE) {
    console.log(`\n[dry-run] no signing, no sending, no write to ${OUT_PATH}.`);
    console.log(`Set DRY_RUN=0 EXECUTE=1 to actually submit.`);
    return;
  }

  // ---- Execute path ----
  console.log(`\n[!!] DRY_RUN=0 EXECUTE=1 — signing with payer + vault keypair and sending.`);
  let sig: string;
  try {
    tx.sign([payerKp, vaultKp]);
    sig = await conn.sendTransaction(tx, { skipPreflight: false });
    console.log(`sent: ${sig}`);
    // Print recovery info BEFORE awaiting confirm — tx may land on-chain even if confirm throws.
    console.error("=== RECOVERY INFO (save this if script crashes) ===");
    console.error(JSON.stringify({ tx: sig, vault: vaultKp.publicKey.toBase58(), lpMintPda: lpMintPda.toBase58(), assetIdleAuthPda: assetIdleAuthPda.toBase58(), at: new Date().toISOString() }, null, 2));
    console.error("===");
    const conf = await conn.confirmTransaction(sig, "confirmed");
    console.log(`confirmed: ${JSON.stringify(conf.value)}`);
    if (conf.value.err) throw new Error(`confirm returned err: ${JSON.stringify(conf.value.err)}`);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error(`\n[PARTIAL-FAILURE] createInitializeVault threw — vault keypair ${vault.toBase58()} may or may not be on-chain.`);
    console.error(`  Inspect with: solana account ${vault.toBase58()}`);
    console.error(`  If account exists, manually write its pubkey to ${OUT_PATH} before re-running (or delete the keypair).`);
    console.error(`  error: ${msg}`);
    throw new Error(`PARTIAL-FAILURE initializing vault: ${msg}`);
  }

  // Confirm succeeded — vault is on-chain. JSON write failures here must NOT
  // fall into PARTIAL-FAILURE (which would imply the tx failed). Catch locally.
  const out = {
    vault: vault.toBase58(),
    lpMint_pda: lpMintPda.toBase58(),
    assetIdleAuth_pda: assetIdleAuthPda.toBase58(),
    asset: VAULT_ASSET_MINT.toBase58(),
    admin: payer.toBase58(),
    manager: payer.toBase58(),
    signature: sig,
    createdAt: new Date().toISOString(),
  };
  const outJson = JSON.stringify(out, null, 2);
  try {
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, outJson);
    console.log(`wrote ${OUT_PATH}`);
    // Duplicate the JSON contents to stderr so the recovery trail survives
    // even if the on-disk file got written corruptly.
    console.error("=== VAULT JSON (duplicate recovery trail) ===");
    console.error(outJson);
    console.error("===");
  } catch (writeErr: any) {
    console.error(`WARN: on-chain vault created but JSON write failed — save RECOVERY INFO above`);
    console.error(`  write error: ${writeErr?.message ?? String(writeErr)}`);
    console.error(`  intended contents:\n${outJson}`);
    // Do NOT rethrow; on-chain state is good. Exit 0.
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
