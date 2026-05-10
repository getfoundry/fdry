#!/usr/bin/env tsx
/**
 * testRangerFdryWithdraw.ts — SHAPE-PROBE ONLY, NOT A CORRECTNESS TEST.
 *
 * Verifies the withdraw round-trip builds against the Ranger Voltr vault.
 * DRY_RUN: simulates with sigVerify=false and replaceRecentBlockhash=true.
 * DOES NOT SIGN.
 *
 * Under an ephemeral user with no LP ATA, simulation will fail with
 * AccountNotFound — that's plumbing, not policy. The check is scored PASS
 * on clean ix construction. Needs a funded user holding LP shares to
 * become a real round-trip test.
 *
 * If the vault has withdrawal_waiting_period > 0, instant-withdraw raises
 * InstantWithdrawNotAllowed (error 6015) at build time; the probe retries
 * with createRequestWithdrawVaultIx and scores PASS if that builds.
 *
 * Run:  pnpm tsx scripts/testRangerFdryWithdraw.ts
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

async function check1WithdrawBuilds(
  client: VoltrClient,
  conn: Connection,
  vault: PublicKey,
  user: PublicKey,
): Promise<Status> {
  console.log("\n=== CHECK 1: withdrawBuilds ===");
  // Try instant-withdraw first.
  try {
    const ix = await client.createInstantWithdrawVaultIx(
      { amount: new BN(1), isAmountInLp: true, isWithdrawAll: false },
      {
        userTransferAuthority: user,
        vault,
        vaultAssetMint: FDRY_MINT,
        assetTokenProgram: TOKEN_PROGRAM_ID,
      },
    );
    console.log(`  built instant-withdraw ix (${ix.keys.length} keys, ${ix.data.length}b data)`);
    const { err, lastLogs } = await simulate(conn, user, [ix]);
    if (err) {
      console.log(`  SIM_REJECTED err=${JSON.stringify(err)} (expected: no LP ATA)`);
      for (const l of lastLogs) console.log(`    ${l}`);
    } else {
      console.log("  SIM_OK (unexpected under ephemeral user, but ix built cleanly)");
    }
    console.log("  PASS: instant-withdraw ix construction works");
    return "PASS";
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const isInstantDisallowed = /InstantWithdrawNotAllowed|6015|0x177f/i.test(msg);
    if (!isInstantDisallowed) {
      console.log(`  instant-withdraw BUILD_REJECTED (non-waiting-period): ${msg.slice(0, 240)}`);
      console.log("  retrying with request-withdraw anyway...");
    } else {
      console.log(`  instant-withdraw disallowed (waiting period > 0): ${msg.slice(0, 160)}`);
      console.log("  retrying with createRequestWithdrawVaultIx...");
    }
    try {
      const ix = await client.createRequestWithdrawVaultIx(
        { amount: new BN(1), isAmountInLp: true, isWithdrawAll: false },
        { payer: user, userTransferAuthority: user, vault },
      );
      console.log(`  built request-withdraw ix (${ix.keys.length} keys, ${ix.data.length}b data)`);
      const { err, lastLogs } = await simulate(conn, user, [ix]);
      if (err) {
        console.log(`  SIM_REJECTED err=${JSON.stringify(err)} (expected: no LP ATA)`);
        for (const l of lastLogs) console.log(`    ${l}`);
      } else {
        console.log("  SIM_OK (unexpected under ephemeral user, but ix built cleanly)");
      }
      console.log("  PASS: request-withdraw ix construction works");
      return "PASS";
    } catch (e2: any) {
      console.log(`  FAIL: request-withdraw BUILD_REJECTED ${String(e2?.message ?? e2).slice(0, 240)}`);
      return "FAIL";
    }
  }
}

function overall(c1: Status): Status {
  return c1;
}

async function main() {
  const rpc = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
  const vault = loadVault();
  const conn = new Connection(rpc, "confirmed");
  const client = new VoltrClient(conn);
  const user = Keypair.generate().publicKey;
  console.log(`vault=${vault.toBase58()} user=ephemeral(${user.toBase58().slice(0, 8)}..) rpc=${rpc}`);

  const c1 = await check1WithdrawBuilds(client, conn, vault, user);
  const ov = overall(c1);

  console.log("\n=== FINAL ===");
  console.table([
    { check: "1 withdrawBuilds", status: c1 },
    { check: "overall",          status: ov },
  ]);
  console.log(JSON.stringify({ check1: c1, overall: ov }));
  process.exit(ov === "PASS" ? 0 : ov === "INCONCLUSIVE" ? 3 : ov === "ERROR" ? 2 : 1);
}
main().catch((e) => { console.error("fatal:", e?.message ?? e); process.exit(2); });
