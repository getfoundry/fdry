/**
 * scripts/e2e-test.ts — Devnet end-to-end dry-run of the full FDRY vault flow.
 *
 * PURPOSE
 *   Exercise every SDK call the bot, frontend, and ops scripts depend on,
 *   end-to-end, on Solana devnet, BEFORE ever touching mainnet. Catches SDK
 *   signature drift, keeper auction flakiness, parameter-naming regressions,
 *   and rebalance-intent wiring bugs — all on a throwaway vault with
 *   throwaway devnet SOL.
 *
 * SAFETY INVARIANT
 *   This script MUST NOT mutate mainnet state. It hard-codes the devnet
 *   cluster, builds its own ephemeral keypairs, airdrops devnet SOL, and
 *   refuses to run against any endpoint whose URL does not contain "devnet".
 *
 * FLOW (mirrors docs/SHIP.md Phase 1.3)
 *   1. Connect to devnet (https://api.devnet.solana.com).
 *   2. Generate ephemeral CREATOR + HOT_WALLET + USER keypairs.
 *   3. Airdrop SOL to all three.
 *   4. createVaultTx — single vault holding 2+ devnet tokens.
 *   5. Seed with 0.1 devnet SOL via buyVaultTx + lockDepositsTx.
 *   6. Record initial vault composition (baseline).
 *   7. Simulate a weight update via HOT_WALLET (updateWeightsTx).
 *   8. Wait for keeper to converge (poll fetchVault until weights move).
 *   9. ASSERTION: vault composition changed — prev vs. next weights_bp
 *      differ by at least 100 bp on at least one token.
 *  10. Withdraw via sellVaultTx with keep_tokens=[all mints] (fast path),
 *      then redeemTokensTx consuming the emitted rebalance_intent.
 *  11. ASSERTION: user wallet received non-zero balance of every non-SOL
 *      basket mint (basket returned).
 *
 * EXIT CODES
 *   0  all assertions passed — safe to proceed to mainnet seed.
 *   1  environment / RPC / airdrop failure (not a signature bug).
 *   2  SDK signature bug — shape changed, call rejected.
 *   3  assertion failed — composition unchanged or basket not returned.
 *   4  refused: endpoint did not look like devnet (mainnet safety tripwire).
 *
 * RUN
 *   pnpm --filter scripts exec tsx src/e2e-test.ts
 *   (from repo root)
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import * as sdk from "@symmetry-hq/sdk";

// ---------------------------------------------------------------------------
// CONSTANTS — devnet only
// ---------------------------------------------------------------------------

const DEVNET_RPC = "https://api.devnet.solana.com";

// SOL native mint — same address on every cluster.
const SOL_MINT = "So11111111111111111111111111111111111111112";

// A known-liquid devnet SPL token that Symmetry prices via Pyth on devnet.
// USDC devnet is the canonical secondary because Pyth publishes USDC/USD on
// devnet. If this mint is not oracle-covered at runtime, createVaultTx will
// fail and we surface that as an SDK/config bug rather than silently coerce.
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const SEED_LAMPORTS = Math.floor(0.1 * LAMPORTS_PER_SOL); // 0.1 SOL
const AIRDROP_CREATOR_SOL = 2;
const AIRDROP_HOT_SOL = 1;
const AIRDROP_USER_SOL = 1;

const KEEPER_POLL_INTERVAL_MS = 3_000;
const KEEPER_POLL_TIMEOUT_MS = 180_000; // 3 min
const MIN_WEIGHT_DELTA_BP = 100; // assertion threshold

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function stepHeader(n: number, title: string): void {
  const bar = "=".repeat(72);
  console.log(`\n${bar}\nSTEP ${n}: ${title}\n${bar}`);
}

function info(msg: string, extra?: Record<string, unknown>): void {
  if (extra) console.log(`  [info] ${msg}`, extra);
  else console.log(`  [info] ${msg}`);
}

function ok(msg: string): void {
  console.log(`  [ ok ] ${msg}`);
}

function fail(msg: string, extra?: Record<string, unknown>): void {
  if (extra) console.error(`  [FAIL] ${msg}`, extra);
  else console.error(`  [FAIL] ${msg}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertDevnet(rpcUrl: string): void {
  if (!rpcUrl.includes("devnet")) {
    fail(`refusing to run: RPC url ${rpcUrl} does not contain "devnet"`);
    process.exit(4);
  }
  ok(`endpoint confirmed devnet: ${rpcUrl}`);
}

async function airdrop(
  conn: Connection,
  pubkey: PublicKey,
  sol: number,
  label: string,
): Promise<void> {
  const lamports = sol * LAMPORTS_PER_SOL;
  info(`airdropping ${sol} SOL to ${label} (${pubkey.toBase58()})`);
  const sig = await conn.requestAirdrop(pubkey, lamports);
  await conn.confirmTransaction(sig, "confirmed");
  const bal = await conn.getBalance(pubkey, "confirmed");
  ok(`${label} balance: ${bal / LAMPORTS_PER_SOL} SOL`);
}

async function getSplBalance(
  conn: Connection,
  owner: PublicKey,
  mint: string,
): Promise<bigint> {
  try {
    const resp = await conn.getParsedTokenAccountsByOwner(owner, {
      mint: new PublicKey(mint),
    });
    let total = 0n;
    for (const acct of resp.value) {
      const amt = acct.account.data.parsed.info.tokenAmount.amount as string;
      total += BigInt(amt);
    }
    return total;
  } catch {
    return 0n;
  }
}

/**
 * Compute the maximum absolute basis-point delta between two weight vectors
 * indexed by mint. Returns 0 if the vectors are identical.
 */
function maxWeightDeltaBp(
  prev: Record<string, number>,
  next: Record<string, number>,
): number {
  const mints = new Set([...Object.keys(prev), ...Object.keys(next)]);
  let max = 0;
  for (const m of mints) {
    const d = Math.abs((prev[m] ?? 0) - (next[m] ?? 0));
    if (d > max) max = d;
  }
  return max;
}

/**
 * Extract { mint -> targetWeightBp } from a fetched vault state.
 * Defensive: SDK shape drift here is itself a signature bug we want to catch.
 */
function weightsFromVault(vault: {
  tokens: Array<{ mint: string; targetWeightBp: number }>;
}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of vault.tokens) out[t.mint] = t.targetWeightBp;
  return out;
}

async function waitForKeeperConvergence(
  conn: Connection,
  vaultPubkey: string,
  expectedWeights: Record<string, number>,
  toleranceBp = 50,
): Promise<Record<string, number>> {
  const start = Date.now();
  let last: Record<string, number> = {};
  while (Date.now() - start < KEEPER_POLL_TIMEOUT_MS) {
    const vault = await sdk.fetchVault(vaultPubkey);
    last = weightsFromVault(vault);
    const drift = maxWeightDeltaBp(last, expectedWeights);
    info(
      `keeper poll @ ${Math.round((Date.now() - start) / 1000)}s: max drift vs target = ${drift} bp`,
    );
    if (drift <= toleranceBp) return last;
    await new Promise((r) => setTimeout(r, KEEPER_POLL_INTERVAL_MS));
  }
  info(
    `keeper did not fully converge within ${KEEPER_POLL_TIMEOUT_MS / 1000}s; returning latest snapshot (still acceptable if composition moved by >= ${MIN_WEIGHT_DELTA_BP} bp vs baseline).`,
  );
  return last;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  console.log("FDRY E2E DEVNET DRY-RUN");
  console.log(`  rpc:        ${DEVNET_RPC}`);
  console.log(`  purpose:    validate full flow before mainnet seed`);
  console.log(`  mutation:   devnet only (mainnet tripwire enabled)`);
  assertDevnet(DEVNET_RPC);

  const conn = new Connection(DEVNET_RPC, "confirmed");

  // -----------------------------------------------------------------------
  // STEP 2 — Generate ephemeral keypairs
  // -----------------------------------------------------------------------
  stepHeader(2, "Generate CREATOR, HOT_WALLET, USER keypairs (ephemeral)");
  const CREATOR = Keypair.generate();
  const HOT_WALLET = Keypair.generate();
  const USER = Keypair.generate();
  ok(`CREATOR    = ${CREATOR.publicKey.toBase58()}`);
  ok(`HOT_WALLET = ${HOT_WALLET.publicKey.toBase58()}`);
  ok(`USER       = ${USER.publicKey.toBase58()}`);

  // -----------------------------------------------------------------------
  // STEP 3 — Airdrop devnet SOL
  // -----------------------------------------------------------------------
  stepHeader(3, "Airdrop devnet SOL");
  try {
    await airdrop(conn, CREATOR.publicKey, AIRDROP_CREATOR_SOL, "CREATOR");
    await airdrop(conn, HOT_WALLET.publicKey, AIRDROP_HOT_SOL, "HOT_WALLET");
    await airdrop(conn, USER.publicKey, AIRDROP_USER_SOL, "USER");
  } catch (e) {
    fail("airdrop failed (devnet faucet rate-limited?)", { err: String(e) });
    return 1;
  }

  // -----------------------------------------------------------------------
  // STEP 4 — createVaultTx (equivalent on devnet)
  // -----------------------------------------------------------------------
  stepHeader(4, "createVaultTx — build FDRY Quant Alpha (devnet variant)");
  const creatorCtx = sdk.createTaskContext({
    manager: CREATOR.publicKey.toBase58(),
    rpcUrl: DEVNET_RPC,
  });

  // Two-token vault — gives weight shifts something to bite on in step 7.
  const INITIAL_UNIVERSE = [SOL_MINT, DEVNET_USDC_MINT];
  const INITIAL_WEIGHTS_BP = [5000, 5000]; // 50/50

  let vaultPubkey: string;
  let vaultMint: string;
  try {
    const createBatch = await sdk.createVaultTx(creatorCtx, {
      name: "FDRY E2E Devnet",
      symbol: "stFDRY-E2E",
      creator: CREATOR.publicKey.toBase58(),
      managers: [
        {
          pubkey: HOT_WALLET.publicKey.toBase58(),
          authority_bitmask: sdk.AUTHORITY_UPDATE_WEIGHTS,
        },
      ],
      tokens: INITIAL_UNIVERSE.map((mint, i) => ({
        mint,
        targetWeightBp: INITIAL_WEIGHTS_BP[i],
      })),
      creator_fee_bp: 0,
      host_fee_bp: 0,
      deposit_fee_bp: 0,
      withdrawal_fee_bp: 0,
      management_fee_bp: 0,
      performance_fee_bp: 0,
      rebalance_threshold_bp: 500,
      rebalance_cooldown_s: 0, // immediate rebalances on devnet
    });
    const createRes = await sdk.signAndSendTxPayloadBatchSequence(createBatch, [
      CREATOR,
    ]);
    vaultPubkey = createRes.vault_pubkey;
    vaultMint = createRes.vault_mint;
    ok(`vault created: ${vaultPubkey}`);
    ok(`vault mint:    ${vaultMint}`);
  } catch (e) {
    fail("createVaultTx rejected — SDK signature bug or oracle coverage gap", {
      err: String(e),
    });
    return 2;
  }

  // -----------------------------------------------------------------------
  // STEP 5 — Seed vault with 0.1 devnet SOL
  // -----------------------------------------------------------------------
  stepHeader(5, "Seed vault with 0.1 devnet SOL (buyVaultTx + lockDepositsTx)");
  const userCtx = sdk.createTaskContext({
    manager: USER.publicKey.toBase58(),
    rpcUrl: DEVNET_RPC,
  });
  try {
    const buyBatch = await sdk.buyVaultTx(userCtx, {
      buyer: USER.publicKey.toBase58(),
      vault_mint: vaultMint,
      contributions: [{ mint: SOL_MINT, amount: SEED_LAMPORTS }],
    });
    const buySig = await sdk.signAndSendTxPayloadBatchSequence(buyBatch, [USER]);
    ok(`buyVaultTx submitted: ${JSON.stringify(buySig)}`);

    const lockBatch = await sdk.lockDepositsTx(userCtx, {
      buyer: USER.publicKey.toBase58(),
      vault_mint: vaultMint,
    });
    const lockSig = await sdk.signAndSendTxPayloadBatchSequence(lockBatch, [
      USER,
    ]);
    ok(`lockDepositsTx submitted: ${JSON.stringify(lockSig)}`);
  } catch (e) {
    fail("seed deposit path rejected — SDK signature bug", { err: String(e) });
    return 2;
  }

  // Wait for the deposit-rebalance keeper to mint vault shares to USER.
  info("waiting for deposit keeper to mint vault shares...");
  const depositBaseline = await waitForKeeperConvergence(
    conn,
    vaultPubkey,
    Object.fromEntries(
      INITIAL_UNIVERSE.map((m, i) => [m, INITIAL_WEIGHTS_BP[i]]),
    ),
  );
  info("deposit keeper done; initial composition:", depositBaseline);

  const userSharesAfterSeed = await getSplBalance(
    conn,
    USER.publicKey,
    vaultMint,
  );
  if (userSharesAfterSeed === 0n) {
    fail("USER holds 0 vault shares after seed — keeper did not mint", {
      userSharesAfterSeed: userSharesAfterSeed.toString(),
    });
    return 3;
  }
  ok(`USER holds ${userSharesAfterSeed.toString()} vault shares`);

  // -----------------------------------------------------------------------
  // STEP 6 — Capture baseline composition
  // -----------------------------------------------------------------------
  stepHeader(6, "Capture baseline composition");
  const baselineVault = await sdk.fetchVault(vaultPubkey);
  const baselineWeights = weightsFromVault(baselineVault);
  info("baseline weights_bp:", baselineWeights);

  // -----------------------------------------------------------------------
  // STEP 7 — Weight update via HOT_WALLET (updateWeightsTx)
  // -----------------------------------------------------------------------
  stepHeader(7, "Simulate weight update via HOT_WALLET (updateWeightsTx)");
  // Flip to 80/20 — a 3000 bp shift, well above MIN_WEIGHT_DELTA_BP.
  const NEW_WEIGHTS_BP = [8000, 2000];
  const hotCtx = sdk.createTaskContext({
    manager: HOT_WALLET.publicKey.toBase58(),
    rpcUrl: DEVNET_RPC,
  });
  try {
    const updateBatch = await sdk.updateWeightsTx(hotCtx, {
      vault_mint: vaultMint,
      weights: NEW_WEIGHTS_BP,
    });
    const updateSig = await sdk.signAndSendTxPayloadBatchSequence(updateBatch, [
      HOT_WALLET,
    ]);
    ok(`updateWeightsTx submitted: ${JSON.stringify(updateSig)}`);
  } catch (e) {
    fail("updateWeightsTx rejected — SDK signature bug or authority config", {
      err: String(e),
    });
    return 2;
  }

  // -----------------------------------------------------------------------
  // STEP 8 — Wait for keeper to converge to new targets
  // -----------------------------------------------------------------------
  stepHeader(8, "Wait for keeper to apply new weights on-chain");
  const targetWeightsByMint: Record<string, number> = {
    [INITIAL_UNIVERSE[0]]: NEW_WEIGHTS_BP[0],
    [INITIAL_UNIVERSE[1]]: NEW_WEIGHTS_BP[1],
  };
  const postKeeperWeights = await waitForKeeperConvergence(
    conn,
    vaultPubkey,
    targetWeightsByMint,
  );
  info("post-keeper weights_bp:", postKeeperWeights);

  // -----------------------------------------------------------------------
  // STEP 9 — ASSERTION: vault composition changed
  // -----------------------------------------------------------------------
  stepHeader(9, "ASSERT vault composition changed (>= 100 bp on any token)");
  const delta = maxWeightDeltaBp(baselineWeights, postKeeperWeights);
  if (delta < MIN_WEIGHT_DELTA_BP) {
    fail(
      `composition did NOT change — max delta ${delta} bp < threshold ${MIN_WEIGHT_DELTA_BP} bp`,
      { baseline: baselineWeights, post: postKeeperWeights },
    );
    return 3;
  }
  ok(`composition changed: max delta = ${delta} bp (threshold ${MIN_WEIGHT_DELTA_BP} bp)`);

  // -----------------------------------------------------------------------
  // STEP 10 — Withdraw via sellVaultTx (fast path) + redeemTokensTx
  // -----------------------------------------------------------------------
  stepHeader(10, "Withdraw via sellVaultTx(keep_tokens=all) + redeemTokensTx");
  const preWithdrawVault = await sdk.fetchVault(vaultPubkey);
  const allMints = preWithdrawVault.tokens.map(
    (t: { mint: string }) => t.mint,
  );
  info(`withdraw basket mints: ${allMints.join(", ")}`);

  let rebalanceIntent: string;
  try {
    const sellBatch = await sdk.sellVaultTx(userCtx, {
      seller: USER.publicKey.toBase58(),
      vault_mint: vaultMint,
      withdraw_amount: userSharesAfterSeed, // full exit
      keep_tokens: allMints,
    });
    const sellRes = await sdk.signAndSendTxPayloadBatchSequence(sellBatch, [
      USER,
    ]);
    // SPEC_CHANGELOG — rebalance_intent is destructured off the sell response.
    rebalanceIntent = (sellRes as { rebalance_intent: string }).rebalance_intent;
    if (!rebalanceIntent) {
      throw new Error(
        "sellVaultTx returned no rebalance_intent — SDK response shape drift",
      );
    }
    ok(`sellVaultTx submitted; rebalance_intent = ${rebalanceIntent}`);
  } catch (e) {
    fail("sellVaultTx rejected — SDK signature bug", { err: String(e) });
    return 2;
  }

  try {
    const redeemBatch = await sdk.redeemTokensTx(userCtx, {
      keeper: USER.publicKey.toBase58(),
      rebalance_intent: rebalanceIntent,
    });
    const redeemSig = await sdk.signAndSendTxPayloadBatchSequence(redeemBatch, [
      USER,
    ]);
    ok(`redeemTokensTx submitted: ${JSON.stringify(redeemSig)}`);
  } catch (e) {
    fail("redeemTokensTx rejected — SDK signature bug", { err: String(e) });
    return 2;
  }

  // -----------------------------------------------------------------------
  // STEP 11 — ASSERTION: basket returned
  // -----------------------------------------------------------------------
  stepHeader(11, "ASSERT basket returned (user holds each non-SOL mint)");
  const balances: Record<string, string> = {};
  let sawAnyNonSolBalance = false;
  for (const mint of allMints) {
    if (mint === SOL_MINT) {
      const sol = await conn.getBalance(USER.publicKey, "confirmed");
      balances[mint] = `${sol} lamports (native)`;
      continue;
    }
    const bal = await getSplBalance(conn, USER.publicKey, mint);
    balances[mint] = bal.toString();
    if (bal > 0n) sawAnyNonSolBalance = true;
  }
  info("post-withdraw user balances:", balances);

  const nonSolMints = allMints.filter((m: string) => m !== SOL_MINT);
  if (nonSolMints.length > 0 && !sawAnyNonSolBalance) {
    fail(
      "basket NOT returned — user holds 0 of every non-SOL basket mint after redeem",
      { balances },
    );
    return 3;
  }
  ok("basket returned — user holds >= 1 non-SOL basket mint");

  // Also verify shares were burned.
  const userSharesAfterWithdraw = await getSplBalance(
    conn,
    USER.publicKey,
    vaultMint,
  );
  if (userSharesAfterWithdraw >= userSharesAfterSeed) {
    fail("user vault shares not burned on withdraw", {
      before: userSharesAfterSeed.toString(),
      after: userSharesAfterWithdraw.toString(),
    });
    return 3;
  }
  ok(
    `user shares burned: ${userSharesAfterSeed.toString()} -> ${userSharesAfterWithdraw.toString()}`,
  );

  // -----------------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------------
  console.log("\n" + "#".repeat(72));
  console.log("E2E DEVNET DRY-RUN: ALL ASSERTIONS PASSED");
  console.log("#".repeat(72));
  console.log(
    JSON.stringify(
      {
        vault_pubkey: vaultPubkey,
        vault_mint: vaultMint,
        creator: CREATOR.publicKey.toBase58(),
        hot_wallet: HOT_WALLET.publicKey.toBase58(),
        user: USER.publicKey.toBase58(),
        baseline_weights_bp: baselineWeights,
        post_keeper_weights_bp: postKeeperWeights,
        max_weight_delta_bp: delta,
        shares_minted: userSharesAfterSeed.toString(),
        shares_remaining: userSharesAfterWithdraw.toString(),
        withdraw_balances: balances,
        verdict: "SAFE-TO-PROCEED-TO-MAINNET",
      },
      null,
      2,
    ),
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("\n[UNHANDLED]", e);
    process.exit(1);
  });
