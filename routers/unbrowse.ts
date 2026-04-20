#!/usr/bin/env tsx
/**
 * routers/unbrowse.ts
 *
 * Revenue router for Unbrowse. **Reference implementation** — future per-product
 * routers should copy this file with one or two substitutions (source label,
 * any source-specific pricing oracle). Policy lives in docs/REVENUE_POLICY.md,
 * mechanism lives here.
 *
 * Converts product revenue (USD-denominated) into vault deposits (SOL ->
 * stFDRY via Symmetry), and appends a machine-readable record to
 * ledger/revenue.jsonl.
 *
 * Pipeline:
 *   1. Read revenue amount:
 *        Option A (today): CLI (--amount-usd=500 --source=unbrowse)
 *        Option B (later): Resend/Stripe/billing API (stubbed below)
 *   2. Pyth SOL/USD spot -> compute equivalent SOL
 *   3. (Optional) Swap USDC -> SOL via Jupiter if starting currency is USDC
 *   4. sdk.buyVaultTx({ ..., memo: `unbrowse_revenue_YYYY_W##` })
 *   5. sdk.lockDepositsTx(...)
 *   6. Append JSONL line to ledger/revenue.jsonl
 *   7. Fire Telegram alert on success
 *
 * Usage:
 *   tsx routers/unbrowse.ts --amount-usd=500 --source=unbrowse
 *   tsx routers/unbrowse.ts --amount-usd=500 --dry-run
 *   tsx routers/unbrowse.ts --amount-usd=500 --from=usdc    # swap first
 *   tsx routers/unbrowse.ts --amount-usd=500 --memo=unbrowse_revenue_2026_W16
 *
 * Env:
 *   CREATOR_WALLET            — base58 secret key | JSON array | path to keypair
 *   RPC_URL                   — default https://api.mainnet-beta.solana.com
 *   PYTH_HERMES_URL           — default https://hermes.pyth.network
 *   JUPITER_API_URL           — default https://quote-api.jup.ag/v6
 *   SYMMETRY_NETWORK          — "mainnet" | "devnet" (default mainnet)
 *   TELEGRAM_BOT_TOKEN,
 *   TELEGRAM_CHAT_ID          — for the success alert (silent if absent)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
} from "@solana/web3.js";
import { SymmetryCore } from "@symmetry-hq/sdk";
import bs58 from "bs58";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// Pyth SOL/USD feed id (mirrors docs/oracles.json "SOL".pyth_id)
const PYTH_SOL_USD_FEED_ID =
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

const __dirname_esm = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname_esm, "..");
const VAULT_JSON_PATH = path.join(REPO_ROOT, "docs", "vault.json");
const REVENUE_LEDGER_PATH = path.join(REPO_ROOT, "ledger", "revenue.jsonl");

const MAX_TX_RETRIES = 5;
const BASE_BACKOFF_MS = 500;

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface Args {
  amountUsd: number;
  source: string;
  memo: string;
  from: "sol" | "usdc";
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let amountUsd = NaN;
  let source = "unbrowse";
  let memo = "";
  let from: "sol" | "usdc" = "sol";
  let dryRun = false;

  for (const a of args) {
    if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--amount-usd=")) {
      amountUsd = Number(a.split("=")[1]);
    } else if (a.startsWith("--source=")) {
      source = a.split("=")[1] ?? "unbrowse";
    } else if (a.startsWith("--memo=")) {
      memo = a.split("=")[1] ?? "";
    } else if (a.startsWith("--from=")) {
      const v = a.split("=")[1]?.toLowerCase();
      if (v !== "sol" && v !== "usdc") {
        throw new Error(`--from must be 'sol' or 'usdc' (got: ${v})`);
      }
      from = v;
    } else if (a === "-h" || a === "--help") {
      console.log(
        "Usage: tsx routers/unbrowse.ts --amount-usd=N [--source=unbrowse]\n" +
          "                               [--memo=tag] [--from=sol|usdc]\n" +
          "                               [--dry-run]"
      );
      process.exit(0);
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }

  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("--amount-usd=<positive number> is required");
  }
  if (!memo) memo = buildDefaultMemo(source);
  return { amountUsd, source, memo, from, dryRun };
}

/**
 * Builds a default category memo like `unbrowse_revenue_2026_W16`.
 * ISO week; robust enough for weekly buckets.
 */
function buildDefaultMemo(source: string): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const w = isoWeek(now);
  return `${source}_revenue_${y}_W${String(w).padStart(2, "0")}`;
}

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ---------------------------------------------------------------------------
// Option B stub — real billing-API readers go here
// ---------------------------------------------------------------------------

/**
 * Placeholder for reading revenue from Resend/Stripe/etc. Not wired yet;
 * today we consume --amount-usd from the CLI.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function readRevenueFromBillingApi(_source: string): Promise<number> {
  throw new Error(
    "billing-api revenue reader not implemented yet — pass --amount-usd explicitly"
  );
}

// ---------------------------------------------------------------------------
// Retry + sleep
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < MAX_TX_RETRIES; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const wait = BASE_BACKOFF_MS * 2 ** i + Math.floor(Math.random() * 250);
      console.warn(
        `[retry:${label}] attempt ${i + 1}/${MAX_TX_RETRIES} failed: ${
          (e as Error).message
        }. sleeping ${wait}ms`
      );
      await sleep(wait);
    }
  }
  throw new Error(
    `[retry:${label}] exhausted ${MAX_TX_RETRIES} attempts: ${
      (lastErr as Error)?.message
    }`
  );
}

// ---------------------------------------------------------------------------
// Keypair loading — accepts path | JSON array | base58 string
// ---------------------------------------------------------------------------

function loadCreatorKeypair(): Keypair {
  const raw = process.env.CREATOR_WALLET;
  if (!raw) {
    throw new Error(
      "CREATOR_WALLET env not set. Provide path to keypair JSON, JSON array, or base58 secret key."
    );
  }
  if (fs.existsSync(raw)) {
    return parseKeypairString(fs.readFileSync(raw, "utf8").trim());
  }
  return parseKeypairString(raw);
}

function parseKeypairString(s: string): Keypair {
  const t = s.trim();
  if (t.startsWith("[")) {
    const arr = JSON.parse(t);
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw new Error("keypair JSON array must be length 64");
    }
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  return Keypair.fromSecretKey(bs58.decode(t));
}

function loadVaultPubkey(): PublicKey {
  if (!fs.existsSync(VAULT_JSON_PATH)) {
    throw new Error(
      `${VAULT_JSON_PATH} not found. Run scripts/createVault.ts first.`
    );
  }
  const j = JSON.parse(fs.readFileSync(VAULT_JSON_PATH, "utf8"));
  const key = j.VAULT_PUBKEY ?? j.vault_pubkey ?? j.vaultMint ?? j.vault_mint;
  if (!key) throw new Error("vault.json missing VAULT_PUBKEY");
  return new PublicKey(key);
}

// ---------------------------------------------------------------------------
// Pyth SOL/USD
// ---------------------------------------------------------------------------

async function fetchPythSolUsd(): Promise<number> {
  const base = process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network";
  const url = `${base}/v2/updates/price/latest?ids[]=${PYTH_SOL_USD_FEED_ID}`;
  return retry("pyth", async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`pyth http ${res.status}`);
    const body = (await res.json()) as any;
    const parsed = body?.parsed?.[0]?.price;
    if (!parsed?.price || parsed.expo === undefined) {
      throw new Error("pyth response missing price/expo");
    }
    const price = Number(parsed.price) * Math.pow(10, Number(parsed.expo));
    if (!Number.isFinite(price) || price <= 0) throw new Error("pyth non-positive");
    return price;
  });
}

// ---------------------------------------------------------------------------
// Jupiter USDC -> SOL swap (only used when --from=usdc)
// ---------------------------------------------------------------------------

/**
 * Fetches a Jupiter swap transaction (USDC -> SOL), signs with the creator
 * keypair, and sends it. Amount is in native USDC units (6 decimals).
 */
async function swapUsdcToSol(
  connection: Connection,
  wallet: Keypair,
  amountUsdcNative: bigint,
  dryRun: boolean
): Promise<{ signature: string; estSolOut: number }> {
  const jupBase = process.env.JUPITER_API_URL ?? "https://quote-api.jup.ag/v6";

  const quoteUrl =
    `${jupBase}/quote?inputMint=${USDC_MINT.toBase58()}` +
    `&outputMint=${SOL_MINT.toBase58()}` +
    `&amount=${amountUsdcNative.toString()}` +
    `&slippageBps=50`;

  const quote = await retry("jup-quote", async () => {
    const r = await fetch(quoteUrl);
    if (!r.ok) throw new Error(`jup quote http ${r.status}`);
    return (await r.json()) as any;
  });

  const estSolOut = Number(quote.outAmount ?? 0) / LAMPORTS_PER_SOL;

  if (dryRun) {
    return { signature: "DRY_RUN_SWAP_SIG", estSolOut };
  }

  const swapRes = await retry("jup-swap-build", async () => {
    const r = await fetch(`${jupBase}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
    });
    if (!r.ok) throw new Error(`jup swap http ${r.status}`);
    return (await r.json()) as { swapTransaction: string };
  });

  const txBuf = Buffer.from(swapRes.swapTransaction, "base64");
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([wallet]);

  const signature = await retry("jup-send", async () => {
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  });

  return { signature, estSolOut };
}

// ---------------------------------------------------------------------------
// Ledger append — schema MUST match ledger/revenue.jsonl contract
// ---------------------------------------------------------------------------

export interface RevenueRecord {
  ts: string;               // ISO-8601
  source: string;           // e.g. "unbrowse"
  amount_usd: number;       // USD notional routed
  amount_sol: number;       // SOL deposited
  tx_sig: string;           // primary vault buy tx signature
  memo: string;             // category memo, e.g. "unbrowse_revenue_2026_W16"
  pyth_sol_usd: number;
  buy_signatures: string[];
  lock_signatures: string[];
  swap_signature?: string;  // present when --from=usdc
  dry_run: boolean;
}

function appendRevenue(rec: RevenueRecord): void {
  fs.mkdirSync(path.dirname(REVENUE_LEDGER_PATH), { recursive: true });
  fs.appendFileSync(REVENUE_LEDGER_PATH, JSON.stringify(rec) + "\n", "utf8");
  console.log(`[ledger] appended: ${REVENUE_LEDGER_PATH}`);
}

// ---------------------------------------------------------------------------
// Telegram alert (best-effort)
// ---------------------------------------------------------------------------

async function alertTelegram(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.warn(`[telegram] non-OK ${res.status}: ${await res.text()}`);
    }
  } catch (e) {
    console.warn(`[telegram] failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Batch sig flattening helper (Symmetry SDK returns mixed shapes)
// ---------------------------------------------------------------------------

function flattenSigs(result: unknown): string[] {
  if (!result) return [];
  if (typeof result === "string") return [result];
  if (Array.isArray(result)) return result.flatMap(flattenSigs);
  if (typeof result === "object") {
    const r: any = result;
    if (typeof r.signature === "string") return [r.signature];
    if (Array.isArray(r.signatures)) return r.signatures.flatMap(flattenSigs);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { amountUsd, source, memo, from, dryRun } = parseArgs();

  const rpcUrl = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const network = (process.env.SYMMETRY_NETWORK ?? "mainnet") as
    | "mainnet"
    | "devnet";

  console.log("========================================");
  console.log("fdry router — unbrowse revenue -> vault");
  console.log("========================================");
  console.log(`network    : ${network}`);
  console.log(`rpc        : ${rpcUrl}`);
  console.log(`source     : ${source}`);
  console.log(`amount_usd : $${amountUsd.toLocaleString()}`);
  console.log(`from       : ${from.toUpperCase()}`);
  console.log(`memo       : ${memo}`);
  console.log(`dry-run    : ${dryRun}`);

  // In dry-run we still want to exercise pyth + jup quote so operators can
  // preview the resulting record. Creator/vault loading is deferred so a
  // fully-stub environment can run --dry-run without CREATOR_WALLET.
  let creator: Keypair | null = null;
  let vaultMint: PublicKey | null = null;
  try {
    creator = loadCreatorKeypair();
    vaultMint = loadVaultPubkey();
    console.log(`creator    : ${creator.publicKey.toBase58()}`);
    console.log(`vault_mint : ${vaultMint.toBase58()}`);
  } catch (e) {
    if (!dryRun) throw e;
    console.log(`creator/vault not loaded (dry-run): ${(e as Error).message}`);
  }

  const connection = new Connection(rpcUrl, "confirmed");

  // 1. Pyth
  let solUsd = 0;
  let amountSol = 0;
  let lamports = 0n;
  try {
    solUsd = await fetchPythSolUsd();
    amountSol = amountUsd / solUsd;
    lamports = BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL));
    console.log(`pyth SOL/USD : $${solUsd.toFixed(4)}`);
    console.log(`amount_sol   : ${amountSol.toFixed(6)} (${lamports} lamports)`);
  } catch (e) {
    if (!dryRun) throw e;
    console.warn(`[pyth] dry-run: using stub price 0 — ${(e as Error).message}`);
  }

  // 2. Optional USDC -> SOL swap
  let swapSig: string | undefined;
  if (from === "usdc") {
    const usdcNative = BigInt(Math.floor(amountUsd * 1_000_000));
    console.log("----------------------------------------");
    console.log(`[swap] USDC -> SOL via Jupiter (${usdcNative} native USDC)`);
    if (dryRun && !creator) {
      swapSig = "DRY_RUN_SWAP_SIG";
      console.log(`       (dry-run, no creator) swap sig: ${swapSig}`);
    } else if (creator) {
      try {
        const { signature, estSolOut } = await swapUsdcToSol(
          connection,
          creator,
          usdcNative,
          dryRun
        );
        swapSig = signature;
        console.log(`       estimated SOL out: ${estSolOut.toFixed(6)}`);
        console.log(`       swap sig: ${swapSig}`);
      } catch (e) {
        if (!dryRun) throw e;
        console.warn(`[jup] dry-run swap quote failed: ${(e as Error).message}`);
        swapSig = "DRY_RUN_SWAP_SIG";
      }
    }
  }

  if (dryRun) {
    console.log("----------------------------------------");
    console.log("DRY RUN — no vault transactions will be sent.");
    console.log("----------------------------------------");
    console.log("would call:");
    console.log(`  1. sdk.buyVaultTx({`);
    console.log(`       buyer: ${creator?.publicKey.toBase58() ?? "<CREATOR_WALLET>"},`);
    console.log(`       vault_mint: ${vaultMint?.toBase58() ?? "<VAULT_PUBKEY>"},`);
    console.log(`       contributions: [{ mint: ${SOL_MINT.toBase58()}, amount: ${lamports} }],`);
    console.log(`       memo: "${memo}",`);
    console.log(`     })`);
    console.log(`  2. sdk.signAndSendTxPayloadBatchSequence(creator, buyBatch)`);
    console.log(`  3. sdk.lockDepositsTx({ buyer, vault_mint })`);
    console.log(`  4. sdk.signAndSendTxPayloadBatchSequence(creator, lockBatch)`);
    console.log(`  5. append record to ${REVENUE_LEDGER_PATH}`);
    console.log(`  6. Telegram alert`);

    const rec: RevenueRecord = {
      ts: new Date().toISOString(),
      source,
      amount_usd: amountUsd,
      amount_sol: Number(amountSol.toFixed(6)),
      tx_sig: "DRY_RUN",
      memo,
      pyth_sol_usd: solUsd,
      buy_signatures: [],
      lock_signatures: [],
      swap_signature: swapSig,
      dry_run: true,
    };
    console.log("dry-run record preview:");
    console.log(JSON.stringify(rec));
    console.log("Dry run complete.");
    return;
  }

  // ---- Live (requires creator + vault) ----
  if (!creator || !vaultMint) {
    throw new Error("creator or vault_mint missing — cannot execute live");
  }

  const sdk = new SymmetryCore({
    connection,
    network,
    priorityFee: 50_000,
  } as any);

  console.log("----------------------------------------");
  console.log("[1/3] building buyVaultTx...");
  const buyBatch = await retry("buyVaultTx", () =>
    (sdk as any).buyVaultTx({
      buyer: creator!.publicKey,
      vault_mint: vaultMint!,
      contributions: [{ mint: SOL_MINT, amount: lamports }],
      memo,
    })
  );

  console.log("[2/3] signing + sending buy batch...");
  const buyRes = await retry("send-buy", () =>
    (sdk as any).signAndSendTxPayloadBatchSequence(creator!, buyBatch)
  );
  const buySigs = flattenSigs(buyRes);
  console.log(`      buy signatures: ${buySigs.join(", ") || "(sdk-managed)"}`);

  console.log("[3/3] lockDepositsTx...");
  const lockBatch = await retry("lockDepositsTx", () =>
    (sdk as any).lockDepositsTx({
      buyer: creator!.publicKey,
      vault_mint: vaultMint!,
    })
  );
  const lockRes = await retry("send-lock", () =>
    (sdk as any).signAndSendTxPayloadBatchSequence(creator!, lockBatch)
  );
  const lockSigs = flattenSigs(lockRes);
  console.log(`      lock signatures: ${lockSigs.join(", ") || "(sdk-managed)"}`);

  const primarySig = buySigs[0] ?? "(sdk-managed)";

  const rec: RevenueRecord = {
    ts: new Date().toISOString(),
    source,
    amount_usd: amountUsd,
    amount_sol: Number(amountSol.toFixed(6)),
    tx_sig: primarySig,
    memo,
    pyth_sol_usd: solUsd,
    buy_signatures: buySigs,
    lock_signatures: lockSigs,
    swap_signature: swapSig,
    dry_run: false,
  };
  appendRevenue(rec);

  const msg =
    `<b>fdry router — ${source}</b>\n` +
    `routed <code>$${amountUsd.toLocaleString()}</code> ` +
    `(<code>${amountSol.toFixed(4)} SOL</code>)\n` +
    `memo: <code>${memo}</code>\n` +
    `tx: <code>${primarySig.slice(0, 8)}…${primarySig.slice(-8)}</code>`;
  await alertTelegram(msg);

  console.log("========================================");
  console.log("ROUTE COMPLETE");
  console.log("========================================");
  // Keep the billing-api stub reachable so tree-shakers don't drop it.
  void readRevenueFromBillingApi;
}

main().catch((e) => {
  console.error("FATAL:", e?.stack ?? e);
  process.exit(1);
});
