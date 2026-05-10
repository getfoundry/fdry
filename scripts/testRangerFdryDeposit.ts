#!/usr/bin/env tsx
/**
 * testRangerFdryDeposit.ts — SHAPE-PROBE ONLY, NOT A CORRECTNESS TEST.
 *
 * Verifies chain-level FDRY-only enforcement on the Ranger Voltr vault via a
 * deposit-ix build + simulate probe. DRY_RUN: simulates with sigVerify=false
 * and replaceRecentBlockhash=true. DOES NOT SIGN.
 *
 * Under an ephemeral buyer with no ATAs, every CHECK fails with
 * AccountNotFound before policy is evaluated, so CHECK 2's INCONCLUSIVE
 * branch is the dominant outcome in this mode. Needs a funded buyer
 * with FDRY + USDC ATAs to become a real test of the mint-mismatch
 * enforcement. Until then, this confirms only that the SDK shape
 * hasn't drifted and the ix builds cleanly.
 *
 * Run:  pnpm tsx scripts/testRangerFdryDeposit.ts
 *
 * env: RPC_URL (default mainnet public), FDRY_VAULT_PUBKEY (override if
 *      ~/Projects/fdry/docs/ranger-vault.json is absent).
 */
import * as fs from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { VoltrClient } from "@voltr/vault-sdk";

const FDRY_MINT = new PublicKey("2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const VAULT_JSON = "~/Projects/fdry/docs/ranger-vault.json";

type Status = "PASS" | "FAIL" | "INCONCLUSIVE" | "ERROR";

function loadVault(): PublicKey {
  const env = process.env.FDRY_VAULT_PUBKEY?.trim();
  if (env) return new PublicKey(env);
  if (!fs.existsSync(VAULT_JSON)) {
    console.error(`ERROR: ${VAULT_JSON} not found and FDRY_VAULT_PUBKEY not set`);
    process.exit(2);
  }
  const j = JSON.parse(fs.readFileSync(VAULT_JSON, "utf8"));
  const pk = j.vault ?? j.vaultPubkey ?? j.pubkey ?? j.address;
  if (!pk) {
    console.error(`ERROR: ${VAULT_JSON} missing vault/pubkey field`);
    process.exit(2);
  }
  return new PublicKey(pk);
}

async function simulate(
  conn: Connection,
  payer: PublicKey,
  ixs: any[],
): Promise<{ err: unknown; lastLogs: string[] }> {
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  const sim = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  return { err: sim.value.err, lastLogs: (sim.value.logs || []).slice(-15) };
}

function mintConstraintEvidence(logs: string[], err: unknown): boolean {
  const s = JSON.stringify(err) + "\n" + logs.join("\n");
  return /ConstraintTokenMint|ConstraintRaw|constraint was violated|0x7d[0-9]/i.test(s);
}

async function check1FdryDepositBuilds(
  client: VoltrClient,
  conn: Connection,
  vault: PublicKey,
  buyer: PublicKey,
): Promise<Status> {
  console.log("\n=== CHECK 1: fdryDepositBuilds ===");
  try {
    const ix = await client.createDepositVaultIx(new BN(1), {
      userTransferAuthority: buyer,
      vault,
      vaultAssetMint: FDRY_MINT,
      assetTokenProgram: TOKEN_PROGRAM_ID,
    });
    console.log(`  built FDRY deposit ix (${ix.keys.length} keys, ${ix.data.length}b data)`);
    const { err, lastLogs } = await simulate(conn, buyer, [ix]);
    if (err) {
      console.log(`  SIM_REJECTED err=${JSON.stringify(err)} (expected under ephemeral buyer)`);
      for (const l of lastLogs) console.log(`    ${l}`);
    } else {
      console.log("  SIM_OK (unexpected under ephemeral buyer, but ix built cleanly)");
    }
    console.log("  PASS: ix construction works");
    return "PASS";
  } catch (e: any) {
    console.log(`  FAIL: BUILD_REJECTED ${String(e?.message ?? e).slice(0, 240)}`);
    return "FAIL";
  }
}

async function check2UsdcDepositRejected(
  client: VoltrClient,
  conn: Connection,
  vault: PublicKey,
  buyer: PublicKey,
): Promise<Status> {
  console.log("\n=== CHECK 2: usdcDepositRejected (wrong mint into FDRY vault) ===");
  let ix: any;
  try {
    ix = await client.createDepositVaultIx(new BN(1), {
      userTransferAuthority: buyer,
      vault,
      vaultAssetMint: USDC_MINT, // wrong mint — FDRY vault expects FDRY
      assetTokenProgram: TOKEN_PROGRAM_ID,
    });
  } catch (e: any) {
    console.log(`  PASS: BUILD_REJECTED ${String(e?.message ?? e).slice(0, 240)}`);
    return "PASS";
  }
  const { err, lastLogs } = await simulate(conn, buyer, [ix]);
  if (!err) {
    console.log("  FAIL: USDC-into-FDRY-vault SIM_OK — policy hole");
    return "FAIL";
  }
  console.log(`  SIM_REJECTED err=${JSON.stringify(err)}`);
  for (const l of lastLogs) console.log(`    ${l}`);
  if (mintConstraintEvidence(lastLogs, err)) {
    console.log("  PASS: SIM_REJECTED with mint-constraint evidence");
    return "PASS";
  }
  console.log("  INCONCLUSIVE: rejection indistinguishable from plumbing (ephemeral buyer)");
  return "INCONCLUSIVE";
}

function overall(c1: Status, c2: Status): Status {
  if (c1 === "ERROR" || c2 === "ERROR") return "ERROR";
  if (c1 === "FAIL" || c2 === "FAIL") return "FAIL";
  if (c2 === "INCONCLUSIVE") return "INCONCLUSIVE";
  return "PASS";
}

async function main() {
  const rpc = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
  const vault = loadVault();
  const conn = new Connection(rpc, "confirmed");
  const client = new VoltrClient(conn);
  const buyer = Keypair.generate().publicKey;
  console.log(`vault=${vault.toBase58()} buyer=ephemeral(${buyer.toBase58().slice(0, 8)}..) rpc=${rpc}`);

  const c1 = await check1FdryDepositBuilds(client, conn, vault, buyer);
  const c2 = await check2UsdcDepositRejected(client, conn, vault, buyer);
  const ov = overall(c1, c2);

  console.log("\n=== FINAL ===");
  console.table([
    { check: "1 fdryDepositBuilds",     status: c1 },
    { check: "2 usdcDepositRejected",   status: c2 },
    { check: "overall",                 status: ov },
  ]);
  console.log(JSON.stringify({ check1: c1, check2: c2, overall: ov }));
  process.exit(ov === "PASS" ? 0 : ov === "INCONCLUSIVE" ? 3 : ov === "ERROR" ? 2 : 1);
}
main().catch((e) => { console.error("fatal:", e?.message ?? e); process.exit(2); });
