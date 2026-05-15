/**
 * updateRangerWaitingPeriod — set the Voltr/Ranger FDRY vault's
 * withdrawal_waiting_period on-chain.
 *
 * Reads docs/ranger-vault.json for the vault pubkey. Pulls the target value
 * from scripts/lib/rangerConfig.ts:DEFAULT_VAULT_CONFIG.withdrawalWaitingPeriod
 * (single source of truth) — never hardcode the seconds here.
 *
 * Safety:
 *   DRY_RUN-default. Set DRY_RUN=0 EXECUTE=1 to sign.
 *   Additionally requires UI_READY=1 — confirms the frontend has the
 *   request/claim flow shipped. Pushing this without that flag bricks the
 *   Withdraw button for any current depositor, because the live UI only
 *   knows the instant path.
 *
 * Encoding: VaultConfigField.WithdrawalWaitingPeriod is u64 seconds, LE 8 bytes.
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
import { VoltrClient, VaultConfigField } from "@voltr/vault-sdk";
import BN from "bn.js";
import bs58 from "bs58";
import { DEFAULT_VAULT_CONFIG } from "./lib/rangerConfig";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const EXECUTE = process.env.EXECUTE === "1";
const UI_READY = process.env.UI_READY === "1";
const WOULD_EXECUTE = !DRY_RUN && EXECUTE;

const NEW_WAITING_PERIOD: BN = DEFAULT_VAULT_CONFIG.withdrawalWaitingPeriod;
const NEW_WAITING_PERIOD_SEC = NEW_WAITING_PERIOD.toNumber();
const NEW_WAITING_PERIOD_DAYS = (NEW_WAITING_PERIOD_SEC / 86_400).toFixed(2);

function loadCreator(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY env missing (source scripts/with-secrets)");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

async function main() {
  console.log(`# updateRangerWaitingPeriod  DRY_RUN=${DRY_RUN} EXECUTE=${EXECUTE} UI_READY=${UI_READY} wouldExecute=${WOULD_EXECUTE}`);
  console.log(`newWaitingPeriod = ${NEW_WAITING_PERIOD_SEC}s (${NEW_WAITING_PERIOD_DAYS}d)`);

  const recPath = path.resolve(__dirname, "..", "docs", "ranger-vault.json");
  const rec = JSON.parse(fs.readFileSync(recPath, "utf8"));
  const vault = new PublicKey(rec.vault);
  const vaultLpMint = new PublicKey(rec.lpMint_pda);
  const conn = new Connection(RPC, "confirmed");
  const creator = loadCreator();
  const client = new VoltrClient(conn);

  console.log(`vault=${vault.toBase58()}`);
  console.log(`admin=${creator.publicKey.toBase58()}`);

  const vaultAccount = await client.fetchVaultAccount(vault);
  const oldSec = vaultAccount.vaultConfiguration.withdrawalWaitingPeriod.toNumber();
  console.log(`oldWaitingPeriod = ${oldSec}s (${(oldSec / 86_400).toFixed(2)}d)`);

  if (oldSec === NEW_WAITING_PERIOD_SEC) {
    console.log("On-chain value already matches config. Nothing to do.");
    return;
  }

  const data = NEW_WAITING_PERIOD.toArrayLike(Buffer, "le", 8);
  console.log(`data (${data.length}B) = ${data.toString("hex")}`);

  const ix = await client.createUpdateVaultConfigIx(
    VaultConfigField.WithdrawalWaitingPeriod,
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
    console.log("\n[dry-run] Set DRY_RUN=0 EXECUTE=1 UI_READY=1 to push.");
    return;
  }
  if (!UI_READY) {
    console.error("\nREFUSING TO PUSH: UI_READY=1 not set.");
    console.error("This change disables instant-withdraw at the program level.");
    console.error("Confirm the frontend request/claim flow is deployed first,");
    console.error("then re-run with UI_READY=1 to opt in.");
    process.exit(2);
  }

  console.log("\n[!!] signing + sending");
  tx.sign([creator]);
  const sig = await conn.sendTransaction(tx);
  console.log(`sent: ${sig}`);
  console.error("=== RECOVERY ===");
  console.error(JSON.stringify({
    tx: sig,
    oldWaitingPeriod: oldSec,
    newWaitingPeriod: NEW_WAITING_PERIOD_SEC,
    at: new Date().toISOString(),
  }, null, 2));

  const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (conf.value.err) {
    console.error("CONFIRM FAILED:", conf.value.err);
    process.exit(4);
  }
  console.log("confirmed ✓");

  const entry = {
    signature: sig,
    oldWaitingPeriod: oldSec,
    newWaitingPeriod: NEW_WAITING_PERIOD_SEC,
    at: new Date().toISOString(),
  };
  rec.waitingPeriodUpdates = [...(rec.waitingPeriodUpdates ?? []), entry];
  fs.writeFileSync(recPath, JSON.stringify(rec, null, 2));
  console.log("updated docs/ranger-vault.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
