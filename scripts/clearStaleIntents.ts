#!/usr/bin/env tsx
/**
 * clearStaleIntents.ts — iterate all rebalance intents touching our vault and
 * cancel them via the keeper path (we are the keeper: creator wallet).
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { SymmetryCore } from "@symmetry-hq/sdk";

function loadKp(): Keypair {
  const raw = process.env.CREATOR_KEY!.trim();
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}
const makeWallet = (kp: Keypair) => ({
  publicKey: kp.publicKey,
  signTransaction: async <T>(t: T): Promise<T> => { (t as any).sign([kp]); return t; },
  signAllTransactions: async <T>(ts: T[]): Promise<T[]> => { ts.forEach((t: any) => t.sign([kp])); return ts; },
  payer: kp,
});

async function main() {
  const isDry = process.argv.includes("--dry-run");
  const vaultPk = process.env.VAULT_PUBKEY!;
  const kp = loadKp();
  const conn = new Connection(process.env.RPC_URL!, "confirmed");
  const sdk = new SymmetryCore({ connection: conn, network: "mainnet", priorityFee: 75_000 });
  const wallet = makeWallet(kp);
  const intents: any[] = await (sdk as any).fetchAllRebalanceIntents();
  console.log(`fetched ${intents?.length ?? 0} intents`);
  if (!intents?.length) return;

  for (let i = 0; i < intents.length; i++) {
    const it = intents[i];
    const keys = Object.keys(it || {});
    const pk = (it?.ownAddress?.toBase58?.() ?? it?.publicKey?.toBase58?.() ?? it?.pubkey?.toString?.() ?? "").toString();
    const typ = it?.formatted?.rebalance_type ?? it?.rebalanceType ?? "?";
    const status = it?.formatted?.status ?? it?.status ?? "?";
    console.log(`\n[${i}] pubkey=${pk || "(unresolved)"}  type=${typ}  status=${status}`);
    if (!pk) {
      console.log(`     raw keys: ${keys.join(", ")}`);
      console.log(`     raw preview: ${JSON.stringify(it, (_k, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 400)}`);
      continue;
    }
    if (isDry) { console.log("     dry-run"); continue; }
    try {
      const tx = await sdk.cancelRebalanceIntentTx({ keeper: kp.publicKey.toBase58(), rebalance_intent: pk });
      const r = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: tx, wallet });
      console.log(`     ✓ cancelled: ${JSON.stringify(r).slice(0, 160)}`);
    } catch (e) {
      console.log(`     ✗ ${((e as Error).message || "").slice(0, 220)}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
