#!/usr/bin/env tsx
/**
 * setupFdryUsdcBasket.ts
 *
 * 1. (optional) swap SOL → USDC via Jupiter so we have USDC to pair
 * 2. create a Raydium CPMM pool for FDRY/USDC (~$30 each side)
 * 3. register FDRY in the Symmetry vault with raydium_cpmm oracle
 *    (using settings copied from working mainnet examples:
 *     quote_token=usdc, side=<auto>, twap_seconds_ago=60, num_required_accounts=4)
 * 4. updateWeights to include FDRY at target weight
 *
 * Usage:
 *   tsx scripts/setupFdryUsdcBasket.ts [--dry-run]
 *     [--fdry-raw <amount>]   default: 92_000 * 1e9
 *     [--usdc-raw <amount>]   default: 30 * 1e6
 *     [--sol-to-swap <lamports>]  default: 0 (skip swap if wallet has enough USDC)
 *     [--fdry-weight-bps 3000] [--sol-weight-bps 3500] [--usdc-weight-bps 3500]
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import BN from "bn.js";
import { Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { SymmetryCore } from "@symmetry-hq/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FDRY_MINT = new PublicKey("2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const FDRY_DECIMALS = 9;
const USDC_DECIMALS = 6;
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const CPMM_PROGRAM = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
const CPMM_FEE_RECEIVER = new PublicKey("DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8");
const CPMM_CONFIG_API = "https://api-v3.raydium.io/main/cpmm-config";
const JUP_BASE = "https://lite-api.jup.ag/swap/v1";

function loadKp(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY env missing");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function makeSymmetryWallet(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    signTransaction: async <T>(tx: T): Promise<T> => { (tx as any).sign([kp]); return tx; },
    signAllTransactions: async <T>(txs: T[]): Promise<T[]> => { txs.forEach((t: any) => t.sign([kp])); return txs; },
    payer: kp,
  };
}

function getVault(): string {
  const env = process.env.VAULT_PUBKEY?.trim();
  if (env) return env;
  const p = path.resolve(__dirname, "..", "docs", "vault.json");
  return JSON.parse(fs.readFileSync(p, "utf-8")).vault_pubkey;
}

function getArg(args: string[], name: string): string | undefined {
  const i = args.findIndex((a) => a === name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function jupSwapSolToUsdc(conn: Connection, kp: Keypair, lamports: number): Promise<string> {
  const quoteUrl = new URL(`${JUP_BASE}/quote`);
  quoteUrl.searchParams.set("inputMint", WSOL_MINT.toBase58());
  quoteUrl.searchParams.set("outputMint", USDC_MINT.toBase58());
  quoteUrl.searchParams.set("amount", String(lamports));
  quoteUrl.searchParams.set("slippageBps", "100");
  quoteUrl.searchParams.set("restrictIntermediateTokens", "true");
  const quoteRes = await fetch(quoteUrl.toString());
  if (!quoteRes.ok) throw new Error(`jup quote ${quoteRes.status}`);
  const quote = await quoteRes.json();
  console.log(`  quote: ${lamports / LAMPORTS_PER_SOL} SOL → ${Number(quote.outAmount) / 1e6} USDC  (impact ${quote.priceImpactPct}%)`);

  const swapRes = await fetch(`${JUP_BASE}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: kp.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 75_000,
    }),
  });
  if (!swapRes.ok) {
    const body = await swapRes.text().catch(() => "");
    throw new Error(`jup swap ${swapRes.status}: ${body.slice(0, 300)}`);
  }
  const { swapTransaction } = await swapRes.json();
  const rawTx = Buffer.from(swapTransaction, "base64");
  const tx = VersionedTransaction.deserialize(new Uint8Array(rawTx));
  tx.sign([kp]);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  const fdryRaw = new BN(getArg(args, "--fdry-raw") ?? "92000000000000"); // 92,000 FDRY
  const usdcRaw = new BN(getArg(args, "--usdc-raw") ?? "30000000"); // 30 USDC
  const solToSwapLamports = parseInt(getArg(args, "--sol-to-swap") ?? "0");

  const fdryW = parseInt(getArg(args, "--fdry-weight-bps") ?? "3000");
  const solW = parseInt(getArg(args, "--sol-weight-bps") ?? "3500");
  const usdcW = parseInt(getArg(args, "--usdc-weight-bps") ?? "3500");
  if (fdryW + solW + usdcW !== 10000) {
    throw new Error(`weights must sum to 10000, got ${fdryW + solW + usdcW}`);
  }

  const rpc = process.env.RPC_URL!;
  const kp = loadKp();
  const conn = new Connection(rpc, "confirmed");
  const vault = getVault();

  console.log(`\n=== setupFdryUsdcBasket (${isDryRun ? "DRY RUN" : "LIVE"}) ===`);
  console.log(`  vault:   ${vault}`);
  console.log(`  wallet:  ${kp.publicKey.toBase58()}`);
  console.log(`  fdry:    ${Number(fdryRaw.toString()) / 1e9} FDRY`);
  console.log(`  usdc:    ${Number(usdcRaw.toString()) / 1e6} USDC`);
  console.log(`  weights: fdry ${fdryW}bps · sol ${solW}bps · usdc ${usdcW}bps`);

  // Balances
  const solBal = await conn.getBalance(kp.publicKey);
  const parsed = await conn.getParsedTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_PROGRAM_ID });
  let fdryBal = new BN(0), usdcBal = new BN(0);
  for (const { account } of parsed.value) {
    const info = (account.data as any).parsed.info;
    if (info.mint === FDRY_MINT.toBase58()) fdryBal = new BN(info.tokenAmount.amount);
    if (info.mint === USDC_MINT.toBase58()) usdcBal = new BN(info.tokenAmount.amount);
  }
  console.log(`  balances: ${(solBal / LAMPORTS_PER_SOL).toFixed(4)} SOL · ${fdryBal.toString()} raw FDRY · ${Number(usdcBal.toString()) / 1e6} USDC`);

  if (fdryBal.lt(fdryRaw)) throw new Error(`FDRY balance too low: need ${fdryRaw} have ${fdryBal}`);

  // Auto-swap SOL→USDC if needed
  let neededSwapSol = solToSwapLamports;
  if (usdcBal.lt(usdcRaw) && !neededSwapSol) {
    // estimate: usdc_missing × 1.01 / sol_price — use Jupiter's own quote
    const deficit = usdcRaw.sub(usdcBal).toNumber();
    const q = await fetch(`${JUP_BASE}/quote?inputMint=${WSOL_MINT.toBase58()}&outputMint=${USDC_MINT.toBase58()}&amount=1000000000&slippageBps=100`);
    const qj = await q.json();
    const usdcPerSol = Number(qj.outAmount) / 1e6; // USDC per 1 SOL
    neededSwapSol = Math.ceil((deficit / 1e6 / usdcPerSol) * LAMPORTS_PER_SOL * 1.02); // 2% buffer
    console.log(`  need ${deficit / 1e6} USDC → will swap ${neededSwapSol / LAMPORTS_PER_SOL} SOL`);
  }

  const solReservedForFees = 300_000_000; // 0.3 SOL: ~0.15 pool create + gas
  if (solBal < neededSwapSol + solReservedForFees) {
    throw new Error(`SOL too low: have ${solBal / LAMPORTS_PER_SOL}, need ~${(neededSwapSol + solReservedForFees) / LAMPORTS_PER_SOL}`);
  }

  // Raydium config
  console.log(`\n[1/4] fetching Raydium CPMM config…`);
  const cfg = await (await fetch(CPMM_CONFIG_API)).json();
  const feeCfg = cfg.data[0];
  console.log(`  tradeFee=${feeCfg.tradeFeeRate} id=${feeCfg.id}`);

  if (isDryRun) {
    console.log("\nDRY RUN — stopping before live submit.");
    return;
  }

  // Step A: swap SOL→USDC if needed
  if (neededSwapSol > 0) {
    console.log(`\n[2a/4] swapping ${neededSwapSol / LAMPORTS_PER_SOL} SOL → USDC via Jupiter…`);
    const swapSig = await jupSwapSolToUsdc(conn, kp, neededSwapSol);
    console.log(`  ✓ swap confirmed: https://solscan.io/tx/${swapSig}`);
    // re-read USDC balance
    const reparsed = await conn.getParsedTokenAccountsByOwner(kp.publicKey, { programId: TOKEN_PROGRAM_ID });
    for (const { account } of reparsed.value) {
      const info = (account.data as any).parsed.info;
      if (info.mint === USDC_MINT.toBase58()) usdcBal = new BN(info.tokenAmount.amount);
    }
    console.log(`  new usdc balance: ${Number(usdcBal.toString()) / 1e6} USDC`);
    if (usdcBal.lt(usdcRaw)) throw new Error(`USDC still insufficient after swap`);
  }

  // Step B: create Raydium CPMM pool (sort mints)
  const fdryIsBase = FDRY_MINT.toBuffer().compare(USDC_MINT.toBuffer()) < 0;
  const mintA = fdryIsBase ? {
    address: FDRY_MINT.toBase58(), decimals: FDRY_DECIMALS, programId: TOKEN_PROGRAM_ID.toBase58(),
  } : {
    address: USDC_MINT.toBase58(), decimals: USDC_DECIMALS, programId: TOKEN_PROGRAM_ID.toBase58(),
  };
  const mintB = fdryIsBase ? {
    address: USDC_MINT.toBase58(), decimals: USDC_DECIMALS, programId: TOKEN_PROGRAM_ID.toBase58(),
  } : {
    address: FDRY_MINT.toBase58(), decimals: FDRY_DECIMALS, programId: TOKEN_PROGRAM_ID.toBase58(),
  };
  const amtA = fdryIsBase ? fdryRaw : usdcRaw;
  const amtB = fdryIsBase ? usdcRaw : fdryRaw;

  console.log(`\n[2b/4] creating Raydium CPMM pool FDRY/USDC (fdry=${fdryIsBase ? "A/base" : "B/quote"})…`);
  const raydium = await Raydium.load({
    connection: conn, owner: kp, cluster: "mainnet",
    disableFeatureCheck: true, blockhashCommitment: "confirmed",
  });
  const createRes = await raydium.cpmm.createPool({
    programId: CPMM_PROGRAM,
    poolFeeAccount: CPMM_FEE_RECEIVER,
    mintA, mintB,
    mintAAmount: amtA, mintBAmount: amtB,
    startTime: new BN(0),
    feeConfig: feeCfg,
    associatedOnly: true,
    ownerInfo: { useSOLBalance: true },
    txVersion: TxVersion.V0,
    computeBudgetConfig: { units: 600_000, microLamports: 75_000 },
  });
  const poolAddr = createRes.extInfo.address.poolId.toBase58();
  const { txId: poolSig } = await createRes.execute({ sendAndConfirm: true });
  console.log(`  ✓ pool ${poolAddr}: https://solscan.io/tx/${poolSig}`);

  const poolDoc = {
    pool_id: poolAddr,
    mint_a: createRes.extInfo.address.mintA?.address ?? mintA.address,
    mint_b: createRes.extInfo.address.mintB?.address ?? mintB.address,
    vault_a: createRes.extInfo.address.vaultA.toBase58(),
    vault_b: createRes.extInfo.address.vaultB.toBase58(),
    observation_id: createRes.extInfo.address.observationId.toBase58(),
    lp_mint: createRes.extInfo.address.lpMint.toBase58(),
    fdry_side: fdryIsBase ? "base" : "quote",
    create_tx: poolSig,
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.resolve(__dirname, "..", "docs", "fdry-usdc-pool.json"), JSON.stringify(poolDoc, null, 2) + "\n");

  // Step C: register FDRY oracle in Symmetry
  console.log(`\n[3/4] registering FDRY in Symmetry vault (with raydium_cpmm oracle)…`);
  await new Promise((r) => setTimeout(r, 5_000)); // let pool observation settle

  const sdk = new SymmetryCore({ connection: conn, network: "mainnet", priorityFee: 75_000 });
  const wallet = makeSymmetryWallet(kp);

  // Settings mirror the working mainnet examples (HUMA, HZNnmh*pump)
  const addTokenTx = await sdk.addOrEditTokenTx(
    { vault, manager: kp.publicKey.toBase58() },
    {
      token_mint: FDRY_MINT.toBase58(),
      active: true,
      min_oracles_thresh: 1,
      min_conf_bps: 50,
      conf_thresh_bps: 500,
      conf_multiplier: 1.0,
      oracles: [
        {
          oracle_type: "raydium_cpmm",
          account_lut_id: 0,
          account_lut_index: 10, // vault LUT already has WSOL(8) + USDC(9) Pyth oracles; raydium_cpmm needs 4 accounts → 10,11,12,13
          account: poolAddr,
          weight_bps: 10000,
          is_required: true,
          conf_thresh_bps: 500,
          volatility_thresh_bps: 10000,
          max_slippage_bps: 300,
          min_liquidity: 25,
          staleness_thresh: 60,
          staleness_conf_rate_bps: 100,
          token_decimals: FDRY_DECIMALS,
          twap_seconds_ago: 60,
          twap_secondary_seconds_ago: 300,
          quote_token: "usdc" as any,
        },
      ],
    },
  );
  const addRes = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: addTokenTx, wallet });
  console.log(`  ✓ FDRY registered: ${JSON.stringify(addRes).slice(0, 200)}`);

  // Step D: update weights
  console.log(`\n[4/4] updating vault weights…`);
  const updateTx = await sdk.updateWeightsTx(
    { vault, manager: kp.publicKey.toBase58() },
    {
      token_weights: [
        { mint: FDRY_MINT.toBase58(), weight_bps: fdryW },
        { mint: WSOL_MINT.toBase58(), weight_bps: solW },
        { mint: USDC_MINT.toBase58(), weight_bps: usdcW },
      ],
    },
  );
  const wRes = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: updateTx, wallet });
  console.log(`  ✓ weights updated: ${JSON.stringify(wRes).slice(0, 200)}`);

  console.log(`\n✓ done.`);
  console.log(`  pool:  https://solscan.io/account/${poolAddr}`);
  console.log(`  vault: https://solscan.io/account/${vault}`);
  console.log(`\nVault now holds FDRY as a basket asset. Users depositing FDRY no longer need the Jupiter wrapper.`);
}

main().catch((e) => {
  console.error("\n[fatal]", e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
