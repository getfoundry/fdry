#!/usr/bin/env tsx
/** seedSimple.ts — minimal vault deposit */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { SymmetryCore } from "@symmetry-hq/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  const args = process.argv.slice(2);
  const amtUsd = parseFloat(args.find(a => a.startsWith("--amount-usd="))?.split("=")[1] || "10");
  const isDry = args.includes("--dry-run");

  const conn = new Connection(process.env.RPC_URL!, "confirmed");
  const sdk = new SymmetryCore({ connection: conn, network: "mainnet", priorityFee: 50_000 });
  const kp = loadKp();
  const wallet = makeWallet(kp);

  const vjson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "docs", "vault.json"), "utf8"));
  const vaultMint = vjson.vault_mint;
  const vaultAccount = vjson.vault_pubkey;

  // Pyth SOL/USD
  const r = await fetch("https://hermes.pyth.network/v2/updates/price/latest?ids[]=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d");
  const j = await r.json();
  const p = j.parsed[0].price;
  const solUsd = Number(p.price) * Math.pow(10, Number(p.expo));
  const lamports = Math.floor((amtUsd / solUsd) * 1e9);

  console.log(`vault account: ${vaultAccount}`);
  console.log(`vault mint:    ${vaultMint}`);
  console.log(`buyer:         ${kp.publicKey.toBase58()}`);
  console.log(`SOL/USD:       $${solUsd.toFixed(4)}`);
  console.log(`deposit:       $${amtUsd} = ${(lamports/1e9).toFixed(6)} SOL`);

  if (isDry) { console.log("\nDRY RUN"); return; }

  console.log("\n[1/2] buyVaultTx...");
  const buyTx = await sdk.buyVaultTx({
    buyer: kp.publicKey.toBase58(),
    vault_mint: vaultMint,
    contributions: [{ mint: "So11111111111111111111111111111111111111112", amount: lamports }],
    rebalance_slippage_bps: 100,
    per_trade_rebalance_slippage_bps: 100,
  });
  const r1 = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: buyTx, wallet });
  console.log(`  ✓ buy submitted`);

  console.log("[2/2] lockDepositsTx...");
  const lockTx = await sdk.lockDepositsTx({
    buyer: kp.publicKey.toBase58(),
    vault_mint: vaultMint,
  });
  const r2 = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: lockTx, wallet });
  console.log(`  ✓ lock submitted`);

  const lp = path.resolve(__dirname, "..", "ledger", "deposits.jsonl");
  fs.mkdirSync(path.dirname(lp), { recursive: true });
  fs.appendFileSync(lp, JSON.stringify({
    ts: new Date().toISOString(),
    kind: "seed",
    buyer: kp.publicKey.toBase58(),
    vault_account: vaultAccount,
    vault_mint: vaultMint,
    amount_sol: lamports / 1e9,
    amount_usd_target: amtUsd,
    pyth_sol_usd: solUsd,
    buy_sigs: r1,
    lock_sigs: r2,
  }) + "\n");
  console.log(`  ✓ logged to ${lp}`);
  console.log(`\nWait ~30-60s for keeper, then re-check vault state.`);
}
main().catch(e => { console.error("\n[fatal]", e.message); process.exit(1); });
