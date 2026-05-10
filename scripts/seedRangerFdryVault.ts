/**
 * seedRangerFdryVault — first deposit into the Ranger/Voltr FDRY vault.
 *
 * Reads docs/ranger-vault.json (written by createRangerFdryVault.ts).
 * Deposits SEED_AMOUNT FDRY (default 100) from CREATOR's FDRY ATA into the vault's
 * idle ATA, minting stFDRY (LP) to CREATOR's LP ATA.
 *
 * DRY_RUN-default. DRY_RUN=0 EXECUTE=1 to sign.
 *
 * Env:
 *   SEED_AMOUNT  whole-FDRY units (integer); default "100"
 *   DRY_RUN      "1" default; "0" to allow execute
 *   EXECUTE      "1" required alongside DRY_RUN=0 to sign
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { VoltrClient } from "@voltr/vault-sdk";
import { BN } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { VAULT_ASSET_MINT, getAssetTokenProgram } from "./lib/rangerConfig";

const RPC_URL = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const EXECUTE = process.env.EXECUTE === "1";
const WOULD_EXECUTE = !DRY_RUN && EXECUTE;
const SEED_WHOLE = BigInt(process.env.SEED_AMOUNT ?? "100");
const FDRY_DECIMALS = 9n;
const SEED_BASE_UNITS = SEED_WHOLE * 10n ** FDRY_DECIMALS;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadCreator(): Keypair {
  const raw = process.env.CREATOR_KEY;
  if (!raw) throw new Error("CREATOR_KEY env not set (run via ./with-secrets)");
  if (raw.trim().startsWith("[")) {
    const arr = JSON.parse(raw);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  return Keypair.fromSecretKey(bs58.decode(raw.trim()));
}

async function main() {
  console.log("# seedRangerFdryVault");
  console.log(
    `DRY_RUN=${DRY_RUN}  EXECUTE=${EXECUTE}  wouldExecute=${WOULD_EXECUTE}  seed=${SEED_WHOLE} FDRY (${SEED_BASE_UNITS} base units)`,
  );

  const vaultJsonPath = path.join(__dirname, "..", "docs", "ranger-vault.json");
  if (!fs.existsSync(vaultJsonPath)) {
    throw new Error(`${vaultJsonPath} not found — run createRangerFdryVault.ts first`);
  }
  const rec = JSON.parse(fs.readFileSync(vaultJsonPath, "utf8"));
  const vault = new PublicKey(rec.vault);
  console.log(`vault=${vault.toBase58()}`);

  const conn = new Connection(RPC_URL, "confirmed");
  const creator = loadCreator();
  console.log(`creator=${creator.publicKey.toBase58()}`);

  const assetTokenProgram = await getAssetTokenProgram(conn, VAULT_ASSET_MINT);
  const client = new VoltrClient(conn);

  const depositIx = await client.createDepositVaultIx(
    new BN(SEED_BASE_UNITS.toString()),
    {
      userTransferAuthority: creator.publicKey,
      vault,
      vaultAssetMint: VAULT_ASSET_MINT,
      assetTokenProgram,
    },
  );

  const lpMintPk = new PublicKey(rec.lpMint_pda);
  const userLpAta = getAssociatedTokenAddressSync(lpMintPk, creator.publicKey, false, TOKEN_PROGRAM_ID);
  const createLpAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    creator.publicKey, userLpAta, creator.publicKey, lpMintPk, TOKEN_PROGRAM_ID,
  );

  const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: creator.publicKey,
    recentBlockhash: blockhash,
    instructions: [cuIx, createLpAtaIx, depositIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  console.log("-- simulating --");
  const sim = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  console.log("sim.err=", sim.value.err);
  (sim.value.logs ?? []).slice(-40).forEach((l) => console.log("  " + l));

  if (sim.value.err) {
    console.error("\nSIM FAILED — refusing to send.");
    process.exit(3);
  }

  if (!WOULD_EXECUTE) {
    console.log("\n[dry-run] no signing. Set DRY_RUN=0 EXECUTE=1 to seed.");
    return;
  }

  console.log("\n[!!] signing + sending");
  tx.sign([creator]);
  const sig = await conn.sendTransaction(tx, { skipPreflight: false });
  console.log(`sent: ${sig}`);

  console.error("=== RECOVERY INFO ===");
  console.error(JSON.stringify({
    tx: sig,
    vault: vault.toBase58(),
    lpMintPda: rec.lpMint_pda,
    seedBaseUnits: SEED_BASE_UNITS.toString(),
    at: new Date().toISOString(),
  }, null, 2));
  console.error("===");

  const conf = await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (conf.value.err) {
    console.error("CONFIRM FAILED:", conf.value.err);
    process.exit(4);
  }
  console.log("confirmed ✓");

  // userLpAta computed earlier
  try {
    const info = await conn.getTokenAccountBalance(userLpAta);
    console.log(`CREATOR stFDRY (LP) balance: ${info.value.uiAmountString}`);
  } catch (e) {
    console.log(`LP ATA not yet visible: ${(e as Error).message}`);
  }

  rec.seeds = rec.seeds ?? [];
  rec.seeds.push({
    signature: sig,
    amount_whole: SEED_WHOLE.toString(),
    amount_base: SEED_BASE_UNITS.toString(),
    at: new Date().toISOString(),
  });
  fs.writeFileSync(vaultJsonPath, JSON.stringify(rec, null, 2));
  console.log(`updated ${vaultJsonPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
