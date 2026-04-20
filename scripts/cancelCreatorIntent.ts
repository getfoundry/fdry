#!/usr/bin/env tsx
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { SymmetryCore } from "@symmetry-hq/sdk";

const REBALANCE_INTENT_SEED = Buffer.from("rebalance_intent");
const VAULTS_V3 = new PublicKey("BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate");

function loadKp(): Keypair {
  const raw = process.env.CREATOR_KEY!.trim();
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}
const mkWallet = (kp: Keypair) => ({
  publicKey: kp.publicKey,
  signTransaction: async <T>(t: T): Promise<T> => { (t as any).sign([kp]); return t; },
  signAllTransactions: async <T>(ts: T[]): Promise<T[]> => { ts.forEach((t: any) => t.sign([kp])); return ts; },
  payer: kp,
});

async function main() {
  const isDry = process.argv.includes("--dry-run");
  const kp = loadKp();
  const conn = new Connection(process.env.RPC_URL!, "confirmed");
  const sdk = new SymmetryCore({ connection: conn, network: "mainnet", priorityFee: 75_000 });
  const wallet = mkWallet(kp);
  const vaultPk = new PublicKey(process.env.VAULT_PUBKEY!);

  const [intentPda] = PublicKey.findProgramAddressSync(
    [REBALANCE_INTENT_SEED, vaultPk.toBuffer(), kp.publicKey.toBuffer()],
    VAULTS_V3,
  );
  console.log(`derived intent PDA for creator: ${intentPda.toBase58()}`);

  const info = await conn.getAccountInfo(intentPda);
  if (!info) {
    console.log("  → account does not exist; no intent to cancel");
    return;
  }
  console.log(`  account exists: ${info.data.length} bytes, owned by ${info.owner.toBase58()}`);

  if (isDry) { console.log("dry-run"); return; }

  try {
    const tx = await sdk.cancelRebalanceIntentTx({
      keeper: kp.publicKey.toBase58(),
      rebalance_intent: intentPda.toBase58(),
    });
    const r = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: tx, wallet });
    console.log(`✓ cancelled: ${JSON.stringify(r).slice(0, 240)}`);
  } catch (e) {
    console.log(`✗ cancel failed: ${((e as Error).message || "").slice(0, 400)}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
