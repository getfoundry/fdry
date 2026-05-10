/**
 * updateRangerMaxCap — raise Voltr vault max_cap from 1M FDRY to 1B FDRY.
 *
 * Reads docs/ranger-vault.json for the vault pubkey.
 * DRY_RUN-default. Set DRY_RUN=0 EXECUTE=1 to sign.
 *
 * Encoding: VaultConfigField.MaxCap takes u64 LE bytes = 8 bytes.
 * 1B FDRY whole * 1e9 decimals = 1_000_000_000_000_000_000 base units.
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
} from "@solana/web3.js";
import { VoltrClient } from "@voltr/vault-sdk";
import { VaultConfigField } from "@voltr/vault-sdk";
import BN from "bn.js";
import bs58 from "bs58";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const EXECUTE = process.env.EXECUTE === "1";
const WOULD_EXECUTE = !DRY_RUN && EXECUTE;

// 1_000_000_000 FDRY whole, 9 decimals -> 1e18 base units
const NEW_MAX_CAP = new BN("1000000000000000000");
const NEW_MAX_CAP_WHOLE = "1000000000";

function loadCreator(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY env missing (source scripts/with-secrets)");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

async function main() {
  console.log(`# updateRangerMaxCap  DRY_RUN=${DRY_RUN} EXECUTE=${EXECUTE} wouldExecute=${WOULD_EXECUTE}`);
  console.log(`newMaxCap=${NEW_MAX_CAP_WHOLE} FDRY whole (${NEW_MAX_CAP.toString()} base)`);

  const recPath = path.resolve(__dirname, "..", "docs", "ranger-vault.json");
  const rec = JSON.parse(fs.readFileSync(recPath, "utf8"));
  const vault = new PublicKey(rec.vault);
  const vaultLpMint = new PublicKey(rec.lpMint_pda);
  const conn = new Connection(RPC, "confirmed");
  const creator = loadCreator();
  const client = new VoltrClient(conn);

  console.log(`vault=${vault.toBase58()}`);
  console.log(`admin=${creator.publicKey.toBase58()}`);

  // Read current maxCap for the record
  const vaultAccount = await client.fetchVaultAccount(vault);
  const oldMaxCap = vaultAccount.vaultConfiguration.maxCap.toString();
  console.log(`oldMaxCap (base units) = ${oldMaxCap}`);

  const data = NEW_MAX_CAP.toArrayLike(Buffer, "le", 8);
  console.log(`data (${data.length}B) = ${data.toString("hex")}`);

  const ix = await client.createUpdateVaultConfigIx(
    VaultConfigField.MaxCap,
    data,
    { vault, admin: creator.publicKey, vaultLpMint },
  );

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: creator.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  console.log("-- simulating --");
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  console.log(`sim.err=${JSON.stringify(sim.value.err)}`);
  (sim.value.logs ?? []).slice(-20).forEach((l) => console.log("  " + l));

  if (sim.value.err) {
    console.error("SIM FAILED — refusing to send.");
    process.exit(3);
  }
  if (!WOULD_EXECUTE) {
    console.log("\n[dry-run] Set DRY_RUN=0 EXECUTE=1 to raise max cap.");
    return;
  }

  console.log("\n[!!] signing + sending");
  tx.sign([creator]);
  const sig = await conn.sendTransaction(tx);
  console.log(`sent: ${sig}`);
  console.error("=== RECOVERY ===");
  console.error(JSON.stringify({ tx: sig, oldMaxCap, newMaxCap: NEW_MAX_CAP.toString(), at: new Date().toISOString() }, null, 2));

  const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (conf.value.err) {
    console.error("CONFIRM FAILED:", conf.value.err);
    process.exit(4);
  }
  console.log("confirmed ✓");

  const entry = { signature: sig, oldMaxCap, newMaxCap: NEW_MAX_CAP.toString(), at: new Date().toISOString() };
  rec.maxCapUpdates = [...(rec.maxCapUpdates ?? []), entry];
  fs.writeFileSync(recPath, JSON.stringify(rec, null, 2));
  console.log("updated docs/ranger-vault.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
