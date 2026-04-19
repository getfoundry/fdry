#!/usr/bin/env tsx
/**
 * trade.ts — execute a Jupiter swap via Symmetry's makeDirectSwapTx.
 *
 * This is the primitive your Python monitor calls to make a trade.
 * No weight rebalancing — just "swap X amount of A for B right now."
 *
 * Usage:
 *   tsx scripts/trade.ts --from SOL --to USDC --amount 0.1 --dry-run
 *   tsx scripts/trade.ts --from SOL --to <mint> --amount 1.0
 *
 * Prereqs:
 *   - VAULT_PUBKEY in env (docs/vault.json or ~/.fdry/env)
 *   - Both `from` and `to` tokens registered in vault via addToken.ts
 *   - Vault holds enough `from` token
 *
 * Ledger output:
 *   appends one JSONL to /Users/lekt9/Projects/fdry/ledger/trades.jsonl
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { SymmetryCore } from "@symmetry-hq/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Well-known mints
const SYMBOL_TO_MINT: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  POPCAT: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
  JTO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
};

const DECIMALS: Record<string, number> = {
  SOL: 9, USDC: 6, USDT: 6, WIF: 6, BONK: 5, POPCAT: 9, JTO: 9,
};

function resolveMint(sym_or_mint: string): string {
  if (sym_or_mint in SYMBOL_TO_MINT) return SYMBOL_TO_MINT[sym_or_mint];
  return sym_or_mint; // assume already a mint
}

function resolveDecimals(sym_or_mint: string): number {
  if (sym_or_mint in DECIMALS) return DECIMALS[sym_or_mint];
  return 9; // conservative default
}

function loadKeypair(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim() || process.env.HOT_WALLET_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY or HOT_WALLET_KEY env missing");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function makeWallet(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    signTransaction: async <T>(tx: T): Promise<T> => { (tx as any).sign([kp]); return tx; },
    signAllTransactions: async <T>(txs: T[]): Promise<T[]> => { txs.forEach((t: any) => t.sign([kp])); return txs; },
    payer: kp,
  };
}

function getVaultPubkey(): string {
  const envPubkey = process.env.VAULT_PUBKEY?.trim();
  if (envPubkey && envPubkey !== "") return envPubkey;
  const vaultJsonPath = path.resolve(__dirname, "..", "docs", "vault.json");
  if (fs.existsSync(vaultJsonPath)) {
    const j = JSON.parse(fs.readFileSync(vaultJsonPath, "utf-8"));
    return j.vault_pubkey || j.vault_account || j.vault;
  }
  throw new Error("No VAULT_PUBKEY in env and docs/vault.json missing");
}

async function jupiterQuote(inputMint: string, outputMint: string, amountRaw: string, slippageBps: number) {
  const url = new URL("https://lite-api.jup.ag/swap/v1/quote");
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amountRaw);
  url.searchParams.set("slippageBps", slippageBps.toString());
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`jupiter quote failed: ${r.status} ${await r.text()}`);
  return await r.json();
}

async function jupiterSwapInstructions(quoteResponse: any, userPublicKey: string) {
  const r = await fetch("https://lite-api.jup.ag/swap/v1/swap-instructions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 50_000,
    }),
  });
  if (!r.ok) throw new Error(`jupiter swap-instructions failed: ${r.status} ${await r.text()}`);
  return await r.json();
}

function ixFromJupiter(raw: any): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(raw.programId),
    keys: raw.accounts.map((a: any) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(raw.data, "base64"),
  });
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const getArg = (name: string) => {
    const i = args.findIndex(a => a === name);
    return i >= 0 && i < args.length - 1 ? args[i + 1] : undefined;
  };

  const fromArg = getArg("--from");
  const toArg = getArg("--to");
  const amountArg = getArg("--amount");
  const slippageArg = getArg("--slippage") || "100";

  if (!fromArg || !toArg || !amountArg) {
    console.error("usage: tsx scripts/trade.ts --from SOL --to USDC --amount 0.1 [--slippage 100] [--dry-run]");
    process.exit(1);
  }

  const fromMint = resolveMint(fromArg);
  const toMint = resolveMint(toArg);
  const fromDecimals = resolveDecimals(fromArg);
  const amountRaw = Math.floor(parseFloat(amountArg) * Math.pow(10, fromDecimals)).toString();
  const slippageBps = parseInt(slippageArg);

  const rpc = process.env.RPC_URL!;
  const network = (process.env.SYMMETRY_NETWORK || "mainnet") as "mainnet" | "devnet";
  const kp = loadKeypair();
  const wallet = makeWallet(kp);
  const conn = new Connection(rpc, "confirmed");
  const sdk = new SymmetryCore({ connection: conn, network, priorityFee: 50_000 });
  const vaultPubkey = getVaultPubkey();

  console.log(`\n=== trade (${isDryRun ? "DRY RUN" : "LIVE"}) ===`);
  console.log(`  vault:  ${vaultPubkey}`);
  console.log(`  from:   ${fromArg} (${fromMint})`);
  console.log(`  to:     ${toArg} (${toMint})`);
  console.log(`  amount: ${amountArg} ${fromArg} (${amountRaw} raw)`);
  console.log(`  slippage: ${slippageBps} bps`);

  // 1. Get Jupiter quote
  console.log("\n[1/3] Jupiter quote...");
  const quote = await jupiterQuote(fromMint, toMint, amountRaw, slippageBps);
  const amountToRaw = quote.outAmount;
  console.log(`  out: ${amountToRaw} (${toArg}) / price impact: ${quote.priceImpactPct}%`);

  // 2. Get Jupiter swap instructions (this is what we pass to makeDirectSwapTx)
  console.log("[2/3] Jupiter swap instructions...");
  // userPublicKey must be the vault's authority (creator/manager)
  const swapInstructionsResp = await jupiterSwapInstructions(quote, kp.publicKey.toBase58());
  const swapIx = ixFromJupiter(swapInstructionsResp.swapInstruction);
  console.log(`  instruction ready: ${swapIx.keys.length} accounts`);

  if (isDryRun) {
    console.log("\n=== DRY RUN — not submitting. ===");
    console.log("  would call sdk.makeDirectSwapTx(ctx, input, jupIx) with:");
    console.log(`  input.from_token_mint: ${fromMint}`);
    console.log(`  input.to_token_mint:   ${toMint}`);
    console.log(`  input.amount_from:     ${amountRaw}`);
    console.log(`  input.amount_to:       ${amountToRaw}`);
    return;
  }

  // 3. Submit via Symmetry
  console.log("[3/3] makeDirectSwapTx...");
  const tx = await sdk.makeDirectSwapTx(
    { vault: vaultPubkey, manager: kp.publicKey.toBase58() },
    {
      from_token_mint: fromMint,
      to_token_mint: toMint,
      amount_from: parseInt(amountRaw),
      amount_to: parseInt(amountToRaw),
    },
    swapIx
  );
  const res = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: tx, wallet });
  console.log(`  ✓ swap submitted`);

  // 4. Ledger
  const ledgerPath = path.resolve(__dirname, "..", "ledger", "trades.jsonl");
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, JSON.stringify({
    ts: new Date().toISOString(),
    kind: "direct_swap",
    from: fromArg, to: toArg,
    from_mint: fromMint, to_mint: toMint,
    amount_from_raw: amountRaw, amount_to_raw: amountToRaw,
    slippage_bps: slippageBps,
    price_impact_pct: quote.priceImpactPct,
    tx_sigs: res,
  }) + "\n");
  console.log(`  ✓ appended to ${ledgerPath}`);
}

main().catch(e => {
  console.error("\n[fatal]", e.message);
  process.exit(1);
});
