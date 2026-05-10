#!/usr/bin/env tsx
/**
 * adminAddAdaptor.ts — add a Voltr adaptor program to the slim-barbell vault.
 *
 * Each adaptor (lending, jupiter-spot, drift, kamino) must be added to
 * the vault once before strategies using it can be initialized.
 *
 * USAGE
 *   # Preview:
 *   ./scripts/with-secrets ./node_modules/.bin/tsx scripts/adminAddAdaptor.ts --adaptor=lending
 *   ./scripts/with-secrets ./node_modules/.bin/tsx scripts/adminAddAdaptor.ts --adaptor=spot
 *
 *   # Execute:
 *   ./scripts/with-secrets env DRY_RUN=0 EXECUTE=1 ./node_modules/.bin/tsx \
 *     scripts/adminAddAdaptor.ts --adaptor=lending
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
import { VoltrClient } from "@voltr/vault-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const EXECUTE = process.env.EXECUTE === "1";
const WOULD_EXECUTE = !DRY_RUN && EXECUTE;

// Voltr adaptor program IDs (from docs.ranger.finance + voltrxyz scripts)
const ADAPTORS = {
  lending: "aVoLTRCRt3NnnchvLYH6rMYehJHwM5m45RmLBZq7PGz",
  spot:    "EW35URAx3LiM13fFK3QxAXfGemHso9HWPixrv7YDY4AM",
  drift:   "EBN93eXs5fHGBABuajQqdsKRkCgaqtJa8vEFD6vKXiP",
  kamino:  "to6Eti9CsC5FGkAtqiPphvKD2hiQiLsS8zWiDBqBPKR",
} as const;
type AdaptorKey = keyof typeof ADAPTORS;

const SLIM_VAULT_JSON = path.resolve(__dirname, "..", "voltr", "slim-vault.json");
const OUT_ADAPTOR_JSON = path.resolve(__dirname, "..", "voltr", "adaptors-added.json");

function parseArgs(): { adaptor: AdaptorKey } {
  const argv = process.argv.slice(2);
  for (const a of argv) {
    const m = a.match(/^--adaptor=(\w+)$/);
    if (m && m[1] in ADAPTORS) return { adaptor: m[1] as AdaptorKey };
  }
  throw new Error(`Usage: --adaptor={${Object.keys(ADAPTORS).join("|")}}`);
}

function loadKp(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY env missing (source scripts/with-secrets)");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function loadVaultPubkey(): PublicKey {
  if (!fs.existsSync(SLIM_VAULT_JSON)) {
    throw new Error(`${SLIM_VAULT_JSON} missing — run createSlimVault.ts first`);
  }
  const data = JSON.parse(fs.readFileSync(SLIM_VAULT_JSON, "utf8")) as { vault: string };
  if (!data.vault) throw new Error(`slim-vault.json missing 'vault' field`);
  return new PublicKey(data.vault);
}

function loadAdaptorsRegistry(): { [adaptor: string]: { program: string; sig: string; addedAt: string } } {
  if (!fs.existsSync(OUT_ADAPTOR_JSON)) return {};
  try { return JSON.parse(fs.readFileSync(OUT_ADAPTOR_JSON, "utf8")); }
  catch { return {}; }
}

async function main() {
  const { adaptor } = parseArgs();
  const adaptorProgramId = new PublicKey(ADAPTORS[adaptor]);

  console.log(`# adminAddAdaptor --adaptor=${adaptor}`);
  console.log(`DRY_RUN=${DRY_RUN}  EXECUTE=${EXECUTE}  wouldExecute=${WOULD_EXECUTE}`);

  const existing = loadAdaptorsRegistry();
  if (existing[adaptor]?.sig) {
    console.log(`adaptor '${adaptor}' already recorded in ${OUT_ADAPTOR_JSON} (sig=${existing[adaptor].sig})`);
    console.log(`(set FORCE=1 to re-add)`);
    if (process.env.FORCE !== "1") process.exit(0);
  }

  const rpc = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpc, "confirmed");
  const payerKp = loadKp();
  const payer = payerKp.publicKey;
  const vault = loadVaultPubkey();
  console.log(`  rpc=${rpc}  payer=${payer.toBase58()}  vault=${vault.toBase58()}`);
  console.log(`  adaptorProgram=${adaptorProgramId.toBase58()}`);

  const client = new VoltrClient(conn);
  const ix = await client.createAddAdaptorIx({
    vault, payer, admin: payer, adaptorProgram: adaptorProgramId,
  });

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer, recentBlockhash: blockhash, instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  console.log(`\n-- simulating --`);
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  console.log(`  sim.err=${JSON.stringify(sim.value.err)}`);
  for (const l of sim.value.logs ?? []) console.log(`    ${l}`);
  if (sim.value.err && WOULD_EXECUTE) {
    throw new Error(`simulation failed, refusing to execute: ${JSON.stringify(sim.value.err)}`);
  }

  if (!WOULD_EXECUTE) {
    console.log(`\n[dry-run] no tx sent. Set DRY_RUN=0 EXECUTE=1 to add adaptor on-chain.`);
    return;
  }

  console.log(`\n[!!] signing + sending...`);
  tx.sign([payerKp]);
  const sig = await conn.sendTransaction(tx, { skipPreflight: false });
  console.log(`  sent: ${sig}`);
  const conf = await conn.confirmTransaction(sig, "confirmed");
  if (conf.value.err) throw new Error(`confirm err: ${JSON.stringify(conf.value.err)}`);
  console.log(`  confirmed ✓`);

  const reg = loadAdaptorsRegistry();
  reg[adaptor] = { program: adaptorProgramId.toBase58(), sig, addedAt: new Date().toISOString() };
  fs.writeFileSync(OUT_ADAPTOR_JSON, JSON.stringify(reg, null, 2));
  console.log(`  wrote ${OUT_ADAPTOR_JSON}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
