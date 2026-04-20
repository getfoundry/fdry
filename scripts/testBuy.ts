#!/usr/bin/env tsx
/** Probe buy: smallest possible buy (~0.01 SOL) from creator to see if 6075 still fires. */
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { SymmetryCore } from "@symmetry-hq/sdk";
import * as fs from "fs"; import * as path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  const conn = new Connection(process.env.RPC_URL!, "confirmed");
  const sdk = new SymmetryCore({ connection: conn, network: "mainnet", priorityFee: 75_000 });
  const kp = loadKp();
  const wallet = mkWallet(kp);
  const vjson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "docs", "vault.json"), "utf-8"));
  const vaultMint = vjson.vault_mint;

  console.log("attempting 0.01 SOL buy…");
  const buyTx = await sdk.buyVaultTx({
    buyer: kp.publicKey.toBase58(),
    vault_mint: vaultMint,
    contributions: [{ mint: "So11111111111111111111111111111111111111112", amount: 10_000_000 }],
    rebalance_slippage_bps: 150,
    per_trade_rebalance_slippage_bps: 150,
  });
  try {
    const r = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: buyTx, wallet });
    console.log("✓ buy submitted:", JSON.stringify(r).slice(0, 240));
    console.log("\nnow calling lockDepositsTx…");
    const lockTx = await sdk.lockDepositsTx({ buyer: kp.publicKey.toBase58(), vault_mint: vaultMint });
    const r2 = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: lockTx, wallet });
    console.log("✓ lock submitted:", JSON.stringify(r2).slice(0, 240));
  } catch (e) {
    console.log(`✗ ${(e as Error).message?.slice(0, 400)}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
