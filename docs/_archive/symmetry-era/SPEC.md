# FDRY Quant Alpha Vault — Specification

Last updated: 2026-04-20
Status: Draft, pre-launch

## 1. Product

A Symmetry-based on-chain vault that accepts FDRY deposits, converts to SOL internally, runs a rotation strategy across a liquid memecoin basket, and pays out FDRY on withdrawal. User-facing entry/exit is FDRY; internal accounting and trading is SOL-based.

Name: **FDRY Quant Alpha**

Tagline: "Stake FDRY, earn quant-strategy returns on liquid tokens."

## 2. Decision Log

Decisions made during design, committed. Do not re-open without new data.

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Venue | Symmetry vault | Drift Vaults | Drift paused post $285M hack (Apr 1, 2026); Symmetry V3 mainnet is live, permissionless |
| Custody | On-chain vault | Off-chain / trust-based | Avoids unregistered securities cliff |
| Entry token | FDRY (via frontend wrapper) | SOL/USDC direct | Preserves FDRY tokenomics narrative |
| Wrapper pattern | Option A: frontend-only | Option C: custom Anchor | Zero contract code, zero audit cost, ship in 1-2 weeks, upgrade to C if adoption validates |
| FDRY inside vault? | No — internal is SOL | Hold FDRY directly | FDRY has no Pyth/Raydium oracle; Symmetry cannot price it for NAV |
| Trading base | SOL | FDRY | Liquid, oracle-priced, matches backtest cadence at ~40bps |
| Cadence | Daily rebalance | Hourly | Backtest edge only materialized at daily cadence with bible-EBM ranking |
| Fee model | 2% annual creator fee | 10% performance | Symmetry perf fees disabled at protocol level; creator fee lane is live |
| Universe | SOL + [WIF, BONK, POPCAT, FLOKI, JTO] | Wider | All have Pyth oracles (see `docs/oracles.json`). PEPE removed (no liquid Solana mint); DOGE removed (thin routes). Final 6-token universe. |
| Lockup period | None at vault level; 50bp withdrawal fee | 30-90d hard lockup | Soft retention only; bank-run risk low at v1 AUM scale |

## 3. Architecture — Option A

```
User wallet                     Frontend (your site)              On-chain
───────────                     ─────────────────                 ─────────

[10k FDRY]  ─── "Deposit" ────> 1. Jupiter quote: FDRY→SOL
                                2. Sign tx1: swap                 FDRY→SOL pool (Meteora)
                                                                         ↓
                                3. Receive SOL (transient)        User ATA now holds SOL
                                4. Sign tx2: buyVaultTx           Symmetry: lock SOL into vault
                                                                         ↓
                                                                  Keeper processes rebalance
                                                                         ↓
[vault_token] <──────────────── 5. User receives vault shares     Symmetry mints shares to user

... time passes, strategy trades SOL ↔ memecoins via keeper + Jupiter ...

[vault_token] ─── "Withdraw" ─> 1. Sign tx1: sellVaultTx(
                                     keep_tokens=[all mints])     Symmetry: burn shares,
                                                                  transfer underlying pro-rata
                                2. User now holds [SOL, WIF, ...]
                                3. Sign tx2+: Jupiter swaps       basket → SOL → FDRY
[FDRY] <──────────────────────                                    User ATA receives FDRY
```

v1.5 optimization: bundle all swap legs into one versioned tx with address lookup tables. Reduces signatures from O(n) to 1.

### Why FDRY cannot be held inside the vault

Symmetry prices all held assets via oracle aggregators: Pyth, Raydium CLMM, Raydium CPMM, or LST (SPL/Sanctum stake pool) oracles. FDRY has none of these. Meteora TWAP is not a supported source. Holding FDRY inside the vault would break NAV calculation. FDRY lives only at the deposit/withdrawal boundary via Jupiter swap.

### Why this does NOT lock FDRY

The vault holds SOL + memecoins, not FDRY. On deposit, user's FDRY is sold into the Meteora pool (market sell). On withdrawal, SOL is swapped back to FDRY (market buy). Over a full cycle, profitable strategy produces net buy pressure proportional to strategy return; unprofitable strategy produces net sell pressure. Chart becomes cyclical / volatile around organic price action.

Marketing must say "stake FDRY, earn quant returns" — NOT "FDRY is locked." The latter claim is false at the architectural level and will not survive inspection.

## 4. Symmetry Vault Configuration

Program ID: `BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate`
SDK: `@symmetry-hq/sdk`
Network: `mainnet`

```
name:                  "FDRY Quant Alpha"
underlying tokens:     [SOL, WIF, BONK, POPCAT, FLOKI, JTO]
initial weights:       [1670, 1666, 1666, 1666, 1666, 1666] bp (SOL=1670, rest=1666), sum = 10000 bp
managers:              [HOT_WALLET_PUBKEY]
manager authority:     UPDATE_WEIGHTS   // TRIGGER_REBALANCE reserved for CREATOR break-glass
rebalance threshold:   500 bp           // 5% drift triggers keeper auction
rebalance cooldown:    86400 seconds    // 1 day, matches backtest cadence
creator fee:           2.00% annual     // paid to CREATOR_WALLET
host fee:              0 bp
deposit fee:           0 bp
withdrawal fee:        50 bp            // soft retention
management fee:        0 bp             // use creator fee as operator income
performance fee:       0 bp             // disabled at protocol level
oracle preferences:    [Pyth primary, Raydium CLMM fallback]
```

> **Fee status (2026-04-20):** Currently accrues to $0 because Symmetry has management-class fees disabled at global config. Fee accrual activates if/when Symmetry enables.

### Wallet separation

- `CREATOR_WALLET` — cold-ish. Holds vault creator role. Receives 2% creator fee. Signs only `withdrawVaultFeesTx` and role transfers. Must be hardware / multisig / cold storage.
- `HOT_WALLET` — bot's signing key. Has `UPDATE_WEIGHTS` only (narrow bitmask; `TRIGGER_REBALANCE` is reserved for CREATOR break-glass). Used daily by bot. Acceptable to be warm. Loss = attacker can push weight updates (bounded damage: rebalance drift, keepers still require sane prices).

### 4.1 HOT rotation runbook

**Triggers:**
- Quarterly scheduled rotation.
- Immediate on any suspected key leak.
- Immediate on Jupiter/Symmetry anomaly that could indicate HOT abuse.

**Procedure:**
1. `CREATOR` signs a manager-remove for the old HOT pubkey via the Symmetry SDK.
2. Generate a new HOT keypair on an air-gapped box.
3. `CREATOR` signs manager-add for the new HOT pubkey with the same `UPDATE_WEIGHTS` (and only that) bitmask — the same narrow authority used in §4.
4. Bot env secret is updated; cron resumes at the next UTC-midnight tick.
5. Verification: query the vault account and confirm the `managers` list contains the new HOT pubkey and not the old one.

**SLA:** 30 minutes for emergency rotation; next-business-day for scheduled rotation.

## 5. Deposit Flow (Option A frontend)


> Jupiter endpoint: use `https://lite-api.jup.ag/swap/v1` (or `https://api.jup.ag/swap/v1` for higher rate limits). The legacy `quote-api.jup.ag/v6` DNS no longer resolves. Response shape is identical to v6.

```typescript
async function deposit(userWallet, fdryAmount) {
  // 1. Enforce deposit cap
  const poolLiq = await getMeteoraPoolLiquidity(FDRY_SOL_POOL);
  const maxDeposit = poolLiq * 0.01;
  if (fdryAmount > maxDeposit) throw new Error(`Over cap: max ${maxDeposit}`);

  // 2. Jupiter quote FDRY → SOL
  const quote = await jupiter.quote({
    inputMint: FDRY_MINT,
    outputMint: SOL_MINT,
    amount: fdryAmount,
    slippageBps: 200,
  });

  // 3. Build & sign swap tx
  const swapTx = await jupiter.swapTx(quote, userWallet);
  await userWallet.signAndSend(swapTx);

  // 4. After swap confirms, build Symmetry buyVaultTx for received SOL
  const solReceived = await getBalanceChange(userWallet, SOL_MINT);
  const buyBatch = await sdk.buyVaultTx({
    buyer: userWallet.publicKey,
    vault_mint: VAULT_MINT,
    contributions: [{ mint: SOL_MINT, amount: solReceived }],
  });
  await sdk.signAndSendTxPayloadBatchSequence(userWallet, buyBatch);

  // 5. Lock deposits — required after buyVaultTx so the keeper can pick up the intent
  const lockBatch = await sdk.lockDepositsTx({
    buyer: userWallet.publicKey,
    vault_mint: VAULT_MINT,
  });
  await sdk.signAndSendTxPayloadBatchSequence(userWallet, lockBatch);

  // 6. Symmetry keeper processes the deposit rebalance within minutes.
  //    User's vault_token balance reflects share claim once keeper executes.
}
```

Deposit cap rationale: at $80k pool liquidity + $40k bootstrap LP = ~$120k, 1% = $1.2k max deposit. Keeps FDRY→SOL slippage under ~2% for the user and avoids whipsawing the chart.

## 6. Withdrawal Flow

```typescript
async function withdraw(userWallet, vaultTokenAmount) {
  // 1. Sell vault tokens — keep_tokens fast path skips auction
  const vault = await sdk.fetchVault(VAULT_PUBKEY);
  const allMints = vault.tokens.map(t => t.mint);
  const sellBatch = await sdk.sellVaultTx({
    seller: userWallet.publicKey,
    vault_mint: VAULT_MINT,
    withdraw_amount: vaultTokenAmount,
    keep_tokens: allMints,
  });
  // Capture the rebalance_intent emitted by sellVaultTx — redeemTokensTx consumes it.
  const { rebalance_intent } = await sdk.signAndSendTxPayloadBatchSequence(userWallet, sellBatch);

  const redeemBatch = await sdk.redeemTokensTx({
    keeper: userWallet.publicKey,
    rebalance_intent,
  });
  await sdk.signAndSendTxPayloadBatchSequence(userWallet, redeemBatch);

  // 2. User now holds pro-rata basket. Consolidate all non-SOL → SOL.
  for (const mint of allMints) {
    if (mint === SOL_MINT) continue;
    const bal = await getBalance(userWallet, mint);
    if (bal === 0) continue;
    const q = await jupiter.quote({ inputMint: mint, outputMint: SOL_MINT, amount: bal });
    await userWallet.signAndSend(await jupiter.swapTx(q, userWallet));
  }

  // 3. Final SOL → FDRY
  const totalSol = await getBalance(userWallet, SOL_MINT);
  const finalQuote = await jupiter.quote({
    inputMint: SOL_MINT,
    outputMint: FDRY_MINT,
    amount: totalSol,
    slippageBps: 300,
  });
  await userWallet.signAndSend(await jupiter.swapTx(finalQuote, userWallet));
}
```

v1.5 UX: bundle step-2 swaps + step-3 final swap into one versioned tx using address lookup tables.

## 7. Bot / Signal Integration

Runs once daily post-close (UTC midnight), matching backtest cadence.

```
cron: 0 0 * * *
  1. Read latest bible-EBM signal output from existing pipeline
  2. Compute target weights for 6-token universe (EW default at 1670/1666/1666/1666/1666/1666 bp; bible-EBM bible-HIGH ranker used as tiebreaker only when signal confidence >= 0.5)
  3. If weights differ from current by > 100bp in any position:
       a. Build updateWeightsTx signed by HOT_WALLET (manager)
       b. Submit to mainnet
       c. Keeper auction picks up the intent and rebalances via Jupiter
  4. Log: signal version, old weights, new weights, txn sig, bounty paid
  5. Alert on failure (webhook / email / Telegram)
```

Key SDK call:

```typescript
import { SymmetryCore, TaskContext, UpdateWeightsInput } from "@symmetry-hq/sdk";

// updateWeightsTx uses the (ctx, settings) pattern.
const ctx: TaskContext = {
  payer: HOT_WALLET_KEYPAIR.publicKey,
  vault_mint: VAULT_MINT,
  manager: HOT_WALLET_KEYPAIR.publicKey,
};
const settings: UpdateWeightsInput = {
  weights: [SOL_BP, WIF_BP, BONK_BP, POPCAT_BP, FLOKI_BP, JTO_BP],
};

// All *Tx methods return a TxPayloadBatchSequence, not a single tx.
const batch = await sdk.updateWeightsTx(ctx, settings);
await sdk.signAndSendTxPayloadBatchSequence(HOT_WALLET_KEYPAIR, batch);
```

Safety guards in bot:

- Don't push if signal pipeline returned stale data (timestamp check)
- Don't push if weights don't sum to 10000 bp
- Don't push if any single weight > 3000 bp (30% per-position cap)
- Don't push more than once per `rebalance_cooldown` window
- Don't push if strategy signal is flagged as low-confidence (bible energy range outside normal)

## 8. Fees

| Fee | Rate | Paid by | Paid to | When |
|---|---|---|---|---|
| Creator fee | 2% annual (disabled — $0 today) | Vault NAV (continuous) | `CREATOR_WALLET` | `withdrawVaultFeesTx` |
| Protocol fee | Symmetry global config | Vault NAV | Symmetry treasury | Automatic |
| Withdrawal fee | 50 bp | Withdrawer | Vault (stays in NAV) | On withdrawal |
| Jupiter swap fees | ~5-20 bp | Swapper | Jupiter + LPs | Per swap |
| FDRY/SOL pool fees | ~30-100 bp | Swapper | Meteora LPs (incl. your $40k) | Per FDRY↔SOL hop |
| Keeper bounties | Small fixed | Vault NAV | Winning keeper | Per intent exec |

> **Fee status (2026-04-20):** Creator fee currently accrues to $0 because Symmetry has management-class fees disabled at global config. Fee accrual activates if/when Symmetry enables.

Expected annual income — **Today: $0 until Symmetry enables management fees. Projected $400/yr at $20k AUM IF/WHEN enabled** (2% × $20k). v1 purpose is mechanism validation, not fee revenue. Scale requires demonstrated track record over 60-90 days.

## 9. Risks & Honest Caveats

**Capital at risk. You may receive back fewer FDRY than you deposited. Strategy may lose money. No return is guaranteed. This vault is discretionary, not a passive yield product.**

### Technical
- Symmetry is BUSL-1.1 beta V3 mainnet software. Protocol risk exists.
- Jupiter route availability for memecoin basket fluctuates with liquidity events.
- Keeper auction delay means deposits aren't "active in strategy" until next keeper execution (typically minutes).
- FDRY/SOL pool is thin ($80k-$120k). External FDRY shocks transmit directly to user entry/exit slippage.
- Creator fee is disabled at Symmetry protocol level; operator income from this lane is $0 until enabled by Symmetry governance.

### Strategy
- Backtest: bible-HIGH beat HODL at 40bps in 3/5 daily windows on 2023 data. Suggestive, not definitive.
- Real Jupiter execution for small-medium memecoin swaps: ~30-50bp per hop. Backtest assumed 40bps total per rebalance — reality may be 40-80bps.
- Signal is off-chain. Bot downtime = vault sits at last-set weights (not catastrophic).

### Tokenomics
- FDRY is NOT locked by this architecture. Any such claim is false.
- Deposit → FDRY sell pressure. Withdrawal → FDRY buy pressure.
- Net chart effect over a cycle ≈ strategy PnL realized on exits. Small at v1 AUM (~$200-900/year net buy pressure on a $297k-cap token).
- If FDRY pumps organically, stakers' FDRY-denominated returns lag USD returns (deposit entered at low FDRY; withdraw at high FDRY = fewer FDRY back).

### Legal / operational
- Pooled investment vehicle with discretionary management. Regulatory stance depends on jurisdiction. Not legal advice.
- Geofence US persons unless separately advised.
- Publish daily ledger / NAV for transparency. Stakers must be able to verify NAV independently.

## 10. Ship Sequence

See `SHIP.md` for day-by-day checklist.

High-level:
- **Phase 0** (1 day): Oracle coverage verification; FDRY pool bootstrap with $40k LP
- **Phase 1** (2-3 days): Devnet vault deploy + SDK integration test
- **Phase 2** (2-3 days): Frontend landing + deposit/withdrawal flow
- **Phase 3** (1-2 days): Bot wiring to bible-EBM signal
- **Phase 4** (1-2 weeks): Soft launch — own FDRY + 3-5 trusted users
- **Phase 5** (ongoing): Public announce; accumulate track record

Total to public (external deposits): **~4-5 weeks** (27-35 days). See SHIP.md for honest per-phase budget; the original 2-3 week estimate underbudgeted Meteora bootstrap, Symmetry SDK learning curve, and the Jupiter+Symmetry 2-tx frontend fan-out.

## 11. Post-Launch Metrics

Track weekly. Public dashboard ideal.

- Total AUM (FDRY-denominated and USD-denominated)
- NAV per share (FDRY-denom and SOL-denom)
- Number of unique stakers
- Avg holding period / retention rate
- Cumulative strategy return vs SOL-HODL baseline
- Cumulative strategy return vs equal-weight-memecoin baseline
- Gross fees collected
- FDRY/SOL pool: depth, 24h volume, vault activity as % of volume

Decision points:
- AUM > $50k and retention > 60% at 60 days → upgrade to Option C (custom Anchor 1-tx wrapper)
- AUM < $5k and retention < 30% at 60 days → mechanism didn't land; consider Track 2 (SOL/USDC entry with FDRY fee discount)

## 12. Future Tracks (not v1)

**Track 2** — Trading vault with native SOL/USDC entry for broader capital pool. Ships only after v1 has 60-90 days of clean ledger. FDRY holders get fee discount via on-chain balance check.

**Track 3** — Performance-fee upgrade. Viable when Symmetry enables perf fees at protocol level, OR when AUM justifies forking drift-vaults for custom perf-fee logic (~$15-30k audit).

**Track 4** — Multi-strategy vaults. Long-short, event-triggered, volatility strategies as separate vaults. Depositors pick exposure.
