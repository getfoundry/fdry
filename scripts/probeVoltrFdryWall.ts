/**
 * probeVoltrFdryWall — chain-level FDRY-only wall test.
 *
 * Builds a deposit tx against the live Voltr vault (asset=FDRY) but passes
 * USDC as the vault_asset_mint account arg. CREATOR's USDC ATA is created
 * idempotently so AccountNotFound cannot be the rejection reason.
 *
 * Expected: sim rejects with Anchor ConstraintRaw/ConstraintHasOne (~2006/3013/3014)
 * because vault.asset.mint == FDRY ≠ USDC.
 *
 * Simulation only — no signing, no sending.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
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
import bs58 from "bs58";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const FDRY = new PublicKey("2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL");

function loadCreator(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY env missing");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const creator = loadCreator();
  const rec = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "docs", "ranger-vault.json"), "utf8"));
  const vault = new PublicKey(rec.vault);
  const client = new VoltrClient(conn);

  console.log(`vault=${vault.toBase58()} (asset=FDRY)`);
  console.log(`attacker (CREATOR)=${creator.publicKey.toBase58()}`);
  console.log(`attack: pass USDC as vault_asset_mint instead of FDRY`);

  const usdcAta = getAssociatedTokenAddressSync(USDC, creator.publicKey, false, TOKEN_PROGRAM_ID);
  const createUsdcAta = createAssociatedTokenAccountIdempotentInstruction(
    creator.publicKey, usdcAta, creator.publicKey, USDC, TOKEN_PROGRAM_ID,
  );

  // Build deposit ix but pass USDC as vaultAssetMint — the lie
  const depositIx = await client.createDepositVaultIx(
    new BN("1"),
    {
      userTransferAuthority: creator.publicKey,
      vault,
      vaultAssetMint: USDC, // LIE: vault's real asset is FDRY
      assetTokenProgram: TOKEN_PROGRAM_ID,
    },
  );

  const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: creator.publicKey,
    recentBlockhash: blockhash,
    instructions: [cuIx, createUsdcAta, depositIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  console.log("-- simulating attack --");
  const sim = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  console.log("sim.err=", JSON.stringify(sim.value.err));
  (sim.value.logs ?? []).slice(-30).forEach((l) => console.log("  " + l));

  if (!sim.value.err) {
    console.error("\n[CRITICAL] FDRY-only wall is BROKEN — USDC deposit accepted against FDRY vault");
    process.exit(1);
  }

  const logs = (sim.value.logs ?? []).join("\n");
  const constraintMatch = logs.match(/(Constraint\w+|AnchorError|raw|has_one|seeds)/i);
  const codeMatch = logs.match(/Error (?:Code|Number): (\w+)/gi);

  console.log("\n=== WALL VERDICT ===");
  console.log("FDRY-only wall: HOLDS (USDC rejected)");
  console.log(`constraint evidence: ${constraintMatch?.[0] ?? "not found in logs (still rejected)"}`);
  console.log(`codes seen: ${codeMatch?.join(", ") ?? "none"}`);
  console.log(JSON.stringify({
    wall: "HOLDS",
    err: sim.value.err,
    constraint: constraintMatch?.[0] ?? null,
  }));
}

main().catch((e) => { console.error(e); process.exit(2); });
