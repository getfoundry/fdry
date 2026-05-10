/**
 * addRangerLpMetadata — attach Metaplex token metadata to the stFDRY LP mint.
 *
 * Reads docs/ranger-vault.json for the vault pubkey.
 * DRY_RUN-default. Set DRY_RUN=0 EXECUTE=1 to sign.
 *
 * Cost: one-shot ~0.006 SOL rent. Future updates to the linked JSON are free
 * (just re-deploy static file at the same URI).
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
import bs58 from "bs58";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const EXECUTE = process.env.EXECUTE === "1";
const WOULD_EXECUTE = !DRY_RUN && EXECUTE;

const NAME = "Staked FDRY";
const SYMBOL = "stFDRY";
const URI = "https://getfoundry.app/stfdry-metadata.json";

function loadCreator(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY env missing (source scripts/with-secrets)");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

async function main() {
  console.log(`# addRangerLpMetadata  DRY_RUN=${DRY_RUN} EXECUTE=${EXECUTE} wouldExecute=${WOULD_EXECUTE}`);
  console.log(`name="${NAME}" symbol="${SYMBOL}" uri=${URI}`);

  const rec = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "docs", "ranger-vault.json"), "utf8"));
  const vault = new PublicKey(rec.vault);
  const conn = new Connection(RPC, "confirmed");
  const creator = loadCreator();
  const client = new VoltrClient(conn);

  const metadataPda = client.findLpMetadataAccount(vault);
  console.log(`vault=${vault.toBase58()}`);
  console.log(`lp=${rec.lpMint_pda}`);
  console.log(`metadata PDA=${metadataPda.toBase58()}`);

  // Idempotency: exit clean if metadata already exists
  const existing = await conn.getAccountInfo(metadataPda);
  if (existing) {
    console.log(`metadata already exists at ${metadataPda.toBase58()} (size=${existing.data.length}). nothing to do.`);
    return;
  }

  const ix = await client.createCreateLpMetadataIx(
    { name: NAME, symbol: SYMBOL, uri: URI },
    { payer: creator.publicKey, admin: creator.publicKey, vault },
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
    console.log("\n[dry-run] Set DRY_RUN=0 EXECUTE=1 to attach metadata.");
    return;
  }

  console.log("\n[!!] signing + sending");
  tx.sign([creator]);
  const sig = await conn.sendTransaction(tx);
  console.log(`sent: ${sig}`);
  console.error("=== RECOVERY ===");
  console.error(JSON.stringify({ tx: sig, metadataPda: metadataPda.toBase58(), at: new Date().toISOString() }, null, 2));

  const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (conf.value.err) {
    console.error("CONFIRM FAILED:", conf.value.err);
    process.exit(4);
  }
  console.log("confirmed ✓");

  rec.lpMetadata = { pda: metadataPda.toBase58(), signature: sig, name: NAME, symbol: SYMBOL, uri: URI, at: new Date().toISOString() };
  fs.writeFileSync(path.resolve(__dirname, "..", "docs", "ranger-vault.json"), JSON.stringify(rec, null, 2));
  console.log("updated docs/ranger-vault.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
