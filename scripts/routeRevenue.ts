/**
 * routeRevenue.ts — buyback loop: USDC revenue -> FDRY -> stFDRY (vault deposit).
 *
 * Phase 1 (own tx): Jupiter swap USDC -> FDRY into CREATOR's FDRY ATA.
 * Phase 2 (own tx): Voltr depositVaultIx of freshly-arrived FDRY + SPL memo
 *   "source_revenue_YYYY_W##" identifying the revenue source. Mints stFDRY to
 *   CREATOR's LP ATA. Appends receipt to docs/ranger-vault.json .revenueRoutings[].
 *
 * DRY_RUN-default. DRY_RUN=0 EXECUTE=1 to sign.
 *
 * Env:
 *   USDC_AMOUNT  base units (6 decimals); required; exit 2 if missing.
 *   SOURCE_TAG   memo text; defaults to "source_revenue_" + ISO-week tag.
 *   SLIPPAGE_BPS defaults "100" (1%).
 *   DRY_RUN      "1" default; "0" to allow execute.
 *   EXECUTE      "1" required alongside DRY_RUN=0 to sign.
 *   RPC_URL      defaults mainnet-beta.
 *   CREATOR_KEY  via ./with-secrets.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { VoltrClient } from "@voltr/vault-sdk";
import { BN } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { VAULT_ASSET_MINT, getAssetTokenProgram } from "./lib/rangerConfig";

const RPC_URL = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const EXECUTE = process.env.EXECUTE === "1";
const WOULD_EXECUTE = !DRY_RUN && EXECUTE;
const SLIPPAGE_BPS = process.env.SLIPPAGE_BPS ?? "100";

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const FDRY_MINT = VAULT_ASSET_MINT; // "2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL"
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const JUP_QUOTE_URL = "https://quote-api.jup.ag/v6/quote";
const JUP_SWAP_URL = "https://quote-api.jup.ag/v6/swap";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isoWeekTag(d = new Date()): string {
  // ISO-8601 week number, year-aware.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((+date - +yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}_W${String(week).padStart(2, "0")}`;
}

function loadCreator(): Keypair {
  const raw = process.env.CREATOR_KEY;
  if (!raw) throw new Error("CREATOR_KEY env not set (run via ./with-secrets)");
  if (raw.trim().startsWith("[")) {
    const arr = JSON.parse(raw);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  return Keypair.fromSecretKey(bs58.decode(raw.trim()));
}

type JupQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: unknown[];
  [k: string]: unknown;
};

async function fetchJupQuote(amount: string): Promise<JupQuote> {
  const url =
    `${JUP_QUOTE_URL}?inputMint=${USDC_MINT.toBase58()}` +
    `&outputMint=${FDRY_MINT.toBase58()}` +
    `&amount=${amount}` +
    `&slippageBps=${SLIPPAGE_BPS}` +
    `&onlyDirectRoutes=false&asLegacyTransaction=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`jup quote http ${res.status}: ${await res.text()}`);
  return (await res.json()) as JupQuote;
}

async function fetchJupSwapTx(quote: JupQuote, user: PublicKey): Promise<VersionedTransaction> {
  const body = {
    quoteResponse: quote,
    userPublicKey: user.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto",
  };
  const res = await fetch(JUP_SWAP_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`jup swap http ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { swapTransaction: string };
  const buf = Buffer.from(j.swapTransaction, "base64");
  return VersionedTransaction.deserialize(buf);
}

function memoIx(payer: PublicKey, text: string): TransactionInstruction {
  return new TransactionInstruction({
    keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(text, "utf8"),
  });
}

async function main() {
  console.log("# routeRevenue");
  const usdcAmountRaw = process.env.USDC_AMOUNT;
  if (!usdcAmountRaw) {
    console.error("USDC_AMOUNT env required (base units, 6 decimals).");
    process.exit(2);
  }
  const usdcAmount = BigInt(usdcAmountRaw);
  const sourceTag = process.env.SOURCE_TAG ?? `source_revenue_${isoWeekTag()}`;

  console.log(
    `DRY_RUN=${DRY_RUN}  EXECUTE=${EXECUTE}  wouldExecute=${WOULD_EXECUTE}` +
      `  usdcIn=${usdcAmount} (base6)  slippageBps=${SLIPPAGE_BPS}  memo="${sourceTag}"`,
  );

  const vaultJsonPath = path.join(__dirname, "..", "docs", "ranger-vault.json");
  if (!fs.existsSync(vaultJsonPath)) {
    throw new Error(`${vaultJsonPath} not found — run createRangerFdryVault.ts first`);
  }
  const rec = JSON.parse(fs.readFileSync(vaultJsonPath, "utf8"));
  const vault = new PublicKey(rec.vault);
  console.log(`vault=${vault.toBase58()}`);

  const conn = new Connection(RPC_URL, "confirmed");
  const creator = loadCreator();
  console.log(`creator=${creator.publicKey.toBase58()}`);

  // ------- Phase 1: Jupiter quote -------
  console.log("\n== Phase 1: Jupiter USDC -> FDRY ==");
  const quote = await fetchJupQuote(usdcAmount.toString());
  const expectedOut = BigInt(quote.outAmount);
  const minOut = BigInt(quote.otherAmountThreshold);
  console.log(
    `quote: in=${quote.inAmount} USDC(base6) -> out=${quote.outAmount} FDRY(base9)` +
      `  minOut=${minOut}  priceImpactPct=${quote.priceImpactPct}  hops=${quote.routePlan.length}`,
  );
  const fdryHuman = Number(expectedOut) / 1e9;
  const usdcHuman = Number(usdcAmount) / 1e6;
  console.log(`~ ${usdcHuman} USDC -> ~ ${fdryHuman.toFixed(6)} FDRY (implied px ${(usdcHuman / fdryHuman).toFixed(6)} USDC/FDRY)`);

  let swapSig: string | null = null;
  if (!DRY_RUN) {
    if (!WOULD_EXECUTE) {
      console.log("[refuse] DRY_RUN=0 without EXECUTE=1 is ambiguous. aborting.");
      process.exit(5);
    }
    console.log("\n[!!] Phase 1 signing + sending swap");
    const swapTx = await fetchJupSwapTx(quote, creator.publicKey);
    swapTx.sign([creator]);
    const sig = await conn.sendTransaction(swapTx, { skipPreflight: false });
    console.log(`swap sent: ${sig}`);
    console.error("=== RECOVERY INFO (phase1) ===");
    console.error(JSON.stringify({
      phase: 1, tx: sig, usdcIn: usdcAmount.toString(),
      expectedFdryOut: expectedOut.toString(), minFdryOut: minOut.toString(),
      at: new Date().toISOString(),
    }, null, 2));
    console.error("===");
    const { blockhash: bh1, lastValidBlockHeight: lv1 } =
      await conn.getLatestBlockhash("confirmed");
    const conf = await conn.confirmTransaction(
      { signature: sig, blockhash: bh1, lastValidBlockHeight: lv1 },
      "confirmed",
    );
    if (conf.value.err) {
      console.error("PHASE1 CONFIRM FAILED:", conf.value.err);
      process.exit(4);
    }
    swapSig = sig;
    console.log("phase1 confirmed ✓");
  } else {
    console.log("[dry-run] skipping Jupiter swap tx build/sim. Quote reported above.");
  }

  // ------- Phase 2: Voltr deposit -------
  console.log("\n== Phase 2: Voltr deposit ==");
  // Amount to deposit = whatever Jupiter actually delivered. In DRY_RUN we pretend
  // we got quote.outAmount. In EXECUTE we re-read the ATA balance to pick up the
  // actual received amount (which can differ by slippage).
  const creatorFdryAta = getAssociatedTokenAddressSync(FDRY_MINT, creator.publicKey, false, TOKEN_PROGRAM_ID);

  let depositBaseUnits: bigint;
  if (DRY_RUN) {
    depositBaseUnits = expectedOut;
    console.log(`[dry-run] assuming ${depositBaseUnits} FDRY base units arrived (= quote.outAmount)`);
  } else {
    const bal = await conn.getTokenAccountBalance(creatorFdryAta);
    depositBaseUnits = BigInt(bal.value.amount);
    console.log(`post-swap CREATOR FDRY balance: ${bal.value.uiAmountString} (${depositBaseUnits} base)`);
    if (depositBaseUnits < minOut) {
      console.error(`received ${depositBaseUnits} < minOut ${minOut} — aborting deposit.`);
      process.exit(6);
    }
  }

  const assetTokenProgram = await getAssetTokenProgram(conn, FDRY_MINT);
  const client = new VoltrClient(conn);

  const depositIx = await client.createDepositVaultIx(
    new BN(depositBaseUnits.toString()),
    {
      userTransferAuthority: creator.publicKey,
      vault,
      vaultAssetMint: FDRY_MINT,
      assetTokenProgram,
    },
  );

  const lpMintPk = new PublicKey(rec.lpMint_pda);
  const userLpAta = getAssociatedTokenAddressSync(lpMintPk, creator.publicKey, false, TOKEN_PROGRAM_ID);
  const createLpAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    creator.publicKey, userLpAta, creator.publicKey, lpMintPk, TOKEN_PROGRAM_ID,
  );

  const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const memo = memoIx(creator.publicKey, sourceTag);

  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: creator.publicKey,
    recentBlockhash: blockhash,
    instructions: [cuIx, createLpAtaIx, depositIx, memo],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  console.log("-- phase2 simulating --");
  const sim = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  console.log("sim.err=", sim.value.err);
  (sim.value.logs ?? []).slice(-40).forEach((l) => console.log("  " + l));

  if (sim.value.err) {
    console.error("\nPHASE2 SIM FAILED — refusing to send.");
    if (DRY_RUN) {
      console.error("(this can be expected in DRY_RUN if CREATOR's FDRY ATA has insufficient balance for the pretended deposit)");
    }
    if (!DRY_RUN) process.exit(3);
    return;
  }

  if (!WOULD_EXECUTE) {
    console.log("\n[dry-run] no signing on phase2. Set DRY_RUN=0 EXECUTE=1 to route.");
    return;
  }

  console.log("\n[!!] phase2 signing + sending");
  tx.sign([creator]);
  const sig2 = await conn.sendTransaction(tx, { skipPreflight: false });
  console.log(`deposit sent: ${sig2}`);

  console.error("=== RECOVERY INFO (phase2) ===");
  console.error(JSON.stringify({
    phase: 2, tx: sig2, swapTx: swapSig,
    usdcIn: usdcAmount.toString(),
    fdryDeposited: depositBaseUnits.toString(),
    memo: sourceTag,
    at: new Date().toISOString(),
  }, null, 2));
  console.error("===");

  const conf = await conn.confirmTransaction(
    { signature: sig2, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (conf.value.err) {
    console.error("PHASE2 CONFIRM FAILED:", conf.value.err);
    process.exit(4);
  }
  console.log("phase2 confirmed ✓");

  let sharesMinted: string | null = null;
  try {
    const info = await conn.getTokenAccountBalance(userLpAta);
    console.log(`CREATOR stFDRY (LP) balance: ${info.value.uiAmountString}`);
    sharesMinted = info.value.amount;
  } catch (e) {
    console.log(`LP ATA not yet visible: ${(e as Error).message}`);
  }

  rec.revenueRoutings = rec.revenueRoutings ?? [];
  rec.revenueRoutings.push({
    swap_tx: swapSig,
    deposit_tx: sig2,
    usdc_in: usdcAmount.toString(),
    fdry_out: depositBaseUnits.toString(),
    shares_minted: sharesMinted,
    memo: sourceTag,
    at: new Date().toISOString(),
  });
  fs.writeFileSync(vaultJsonPath, JSON.stringify(rec, null, 2));
  console.log(`updated ${vaultJsonPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
