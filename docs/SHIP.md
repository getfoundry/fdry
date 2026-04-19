# Ship Checklist — FDRY Quant Alpha Vault

Day-by-day from commit to public launch. Tick each box as you complete it. Don't skip phase gates.

**Critical path: 27-35 days total (4-5 weeks) from commit to public launch.**

Per-phase budget:
- Phase 0 (Pre-flight): 2-3 days — Meteora bootstrap TWAP + oracle verification + backtest rerun
- Phase 1 (Devnet vault deploy): 3-5 days — includes Symmetry SDK first-touch learning curve
- Phase 2 (Frontend): 4-7 days — frontend + Jupiter+Symmetry 2-tx flow + withdraw fan-out
- Phase 3 (Bot wiring): 1-2 days — bible-EBM signal reuse keeps this fast
- Phase 4 (Mainnet soft launch): 1-2 weeks — calendar-dominated gate (clean operation window)
- Phase 5 (Public launch): day-of + ongoing

> Note: This reflects Cycle 2 remediation learnings. The original "2-3 week" estimate was over-optimistic — it underbudgeted Meteora bootstrap, the Symmetry SDK learning curve, and the Jupiter+Symmetry 2-tx frontend fan-out. Use 27-35 days as the planning baseline.

---

## Phase 0 — Pre-flight (2-3 days)

### 0.1 Oracle coverage verification (blocking for vault creation)

For each token in the universe, confirm Symmetry-supported oracle exists:

- [x] **SOL** — Pyth (`0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`)
- [x] **WIF** — Pyth
- [x] **BONK** — Pyth
- [x] **POPCAT** — Pyth
- [x] **FLOKI** — Pyth
- [x] **JTO** — Pyth

Universe is the 6-token basket [SOL, WIF, BONK, POPCAT, FLOKI, JTO]. PEPE removed (no liquid Solana mint); DOGE removed (thin Jupiter routes at vault sizes). See `docs/oracles.json` for Pyth feed IDs.

Verify via Pyth price feeds page and Raydium CLMM pool listing. Record the oracle pubkey for each in `docs/oracles.json`.

If any token has no supported oracle: drop it from the universe and pick an alternative of similar liquidity/category.

### 0.2 FDRY pool bootstrap (your $40k)

- [ ] Verify current FDRY/SOL pool on Meteora: pool address `2jC1LpGY1ZjL9UerTFDmTNM4kc2AhHydK4tqqqgbJdhh`
- [x] Confirm pool type: **DAMM v2 constant-product** (Meteora Dynamic AMM v2, not DLMM). Recorded in `docs/pool.json`.
- [ ] Split $40k: $20k FDRY side + $20k SOL side (rebalance first if needed)
- [ ] Add LP position; note position account pubkey (DAMM v2 LP is fungible, no concentrated bin range needed)
- [ ] Screenshot Dexscreener pool page immediately after to document new liquidity

### 0.3 Rerun backtest with final config

- [ ] Rerun `jesus_loop_pair_daily.py` with final 8-token universe
- [x] Rerun `jesus_loop_pair_daily.py` with final 6-token universe [SOL, WIF, BONK, POPCAT, FLOKI, JTO]
- [ ] Check 50bp withdrawal fee impact on cumulative returns
- [ ] Archive results to `runs/spec_final_backtest/`

**Gate:** do not proceed to Phase 1 until all of 0.1, 0.2, 0.3 are green.

---

## Phase 1 — Devnet vault deploy (3-5 days)

### 1.1 Environment

- [ ] `npm init && npm install @symmetry-hq/sdk @solana/web3.js @coral-xyz/anchor @jup-ag/api`
- [ ] Create `CREATOR_WALLET` on devnet (hardware / fresh keypair)
- [ ] Create `HOT_WALLET` on devnet (fresh keypair)
- [ ] Fund both with devnet SOL

### 1.2 Vault creation on devnet

- [ ] Use `sdk.createVaultTx` with creator = `CREATOR_WALLET`
- [ ] Add each universe token via `addOrEditTokenTx`
- [ ] Set initial equal weights via `updateWeightsTx` (1250 bp each)
- [ ] Assign `HOT_WALLET` as manager with `UPDATE_WEIGHTS + TRIGGER_REBALANCE` authority bitmask
- [ ] Configure fees: 2% creator, 50bp withdrawal, 0 else
- [ ] Record vault pubkey in `docs/vault.json`

### 1.3 End-to-end flow test on devnet

- [ ] Deposit 0.1 SOL via `buyVaultTx` from a test user wallet
- [ ] Wait for keeper to process (or trigger manually via `rebalanceVaultTx`)
- [ ] Confirm test user received vault_token
- [ ] Trigger weight update via `updateWeightsTx` from `HOT_WALLET`
- [ ] Wait for keeper rebalance
- [ ] Confirm vault composition shifted to new weights
- [ ] Withdraw via `sellVaultTx` + `redeemTokensTx`
- [ ] Confirm test user receives pro-rata basket

**Gate:** full deposit → rebalance → withdraw cycle on devnet before touching mainnet.

---

## Phase 2 — Frontend (4-7 days)

### 2.1 Minimal landing page

- [ ] Static page with wallet connect (Phantom / Solflare / Backpack)
- [ ] Deposit form: FDRY amount input, Jupiter quote preview, expected vault_token output
- [ ] Deposit cap warning if amount > 1% of pool liquidity
- [ ] Withdraw form: vault_token amount → expected FDRY output
- [ ] Vault stats: AUM, NAV/share, current weights, 24h return
- [ ] Clear copy: "stake FDRY, earn quant-strategy returns on liquid tokens"
- [ ] Risk disclosures visible above fold (see SPEC §9)

### 2.2 Client-side deposit flow

- [ ] Integrate Jupiter API for FDRY→SOL quote
- [ ] Build 2-tx sequence: Jupiter swap → Symmetry `buyVaultTx`
- [ ] Handle swap slippage edge cases (retry with higher slippage, fail clearly if > 5%)
- [ ] Poll for keeper confirmation; show "deposit processing" state

### 2.3 Client-side withdrawal flow

- [ ] `sellVaultTx` with `keep_tokens = all mints` (fast path)
- [ ] `redeemTokensTx` immediately after
- [ ] Consolidate all non-SOL → SOL via Jupiter loop
- [ ] Final SOL → FDRY swap
- [ ] Bundle step 3+4 into versioned tx if feasible (lookup tables)

### 2.4 Geofence (if applicable)

- [ ] IP-based check on landing page (non-binding but demonstrates good-faith)
- [ ] Terms-of-use click-through with jurisdiction exclusions

---

## Phase 3 — Bot wiring (1-2 days)

### 3.1 Signal integration

- [ ] Adapter: read latest bible-EBM output from existing pipeline
- [ ] Translate bible-rank output → target weights vector (sum to 10000 bp)
- [ ] Write tests comparing weights vector vs backtest output for identical input

### 3.2 Cron bot

- [ ] Daily cron at 00:00 UTC
- [ ] Read vault current weights via `sdk.fetchVault`
- [ ] Compute new target weights from signal
- [ ] Guard: sum == 10000 ✓, max weight ≤ 3000 bp ✓, signal fresh < 1h ✓
- [ ] Guard: skip if delta < 100 bp on every position (no unnecessary rebalance)
- [ ] Submit `updateWeightsTx` signed by `HOT_WALLET`
- [ ] Log to append-only file: timestamp, signal version, old weights, new weights, tx sig

### 3.3 Monitoring

- [ ] Webhook / Telegram alert on: tx failure, signal staleness, weight bounds violation
- [ ] Daily digest: total AUM, NAV change, rebalance outcome, fees accrued

---

## Phase 4 — Mainnet soft launch (1-2 weeks)

### 4.1 Mainnet deployment

- [ ] Repeat Phase 1 on mainnet with real `CREATOR_WALLET` and `HOT_WALLET`
- [ ] Fund `HOT_WALLET` with enough SOL for 6 months of tx fees (~0.5 SOL)
- [ ] Run bot in dry-run mode for 3 days, confirm it would have pushed sane weights
- [ ] Flip bot to live mode

### 4.2 Own-capital seed

- [ ] Deposit your own FDRY ($100-500 worth) via the landing page as the first real user
- [ ] Verify NAV accounting matches expected values
- [ ] Confirm keeper rebalances execute within minutes

### 4.3 Trusted users (3-5 people)

- [ ] Invite FDRY holders you trust to test deposit / withdraw flows
- [ ] Collect UX feedback; fix critical issues
- [ ] Confirm no surprise behavior under realistic usage

### 4.4 Ledger publication

- [ ] Set up public ledger at `fdry.xyz/vault` or similar
- [ ] Show: daily NAV, deposits, withdrawals, fees, weight history
- [ ] Auto-refresh from on-chain data

**Gate:** 2 weeks of clean operation with no incidents before public announce.

---

## Phase 5 — Public launch

### 5.1 Announce

- [ ] Post to FDRY community channels (X, Telegram, Discord)
- [ ] Make copy explicit: "stake FDRY, strategy trades in SOL, NAV in FDRY terms, no guaranteed returns, withdraw anytime"
- [ ] Publish SPEC.md and SHIP.md publicly (GitHub)

### 5.2 First 30 days

- [ ] Weekly: post weekly performance update with NAV chart + fees collected
- [ ] Monitor metrics from SPEC §11
- [ ] Respond to staker questions in community channels within 24h

### 5.3 Decision point at day 60

- [ ] Review metrics from SPEC §11
- [ ] If AUM > $50k + retention > 60% → start Option C upgrade planning
- [ ] If AUM < $5k + retention < 30% → evaluate Track 2 pivot (SOL/USDC entry + FDRY fee discount)
- [ ] Either way: keep publishing ledger and performance updates
