# FDRY Vault V1 — Ship Plan (2026-04-20)

Decision committed: **Treasury-first Symmetry vault** with transparent public ledger. Unbrowse revenue routes in over 2-4 weeks as monetization ships. No yield promise. Own capital seeds; external deposits gated on public ledger accumulating.

---

## 1. Architecture (the shortest defensible thing)

```
            ┌──────────────────────────────────────┐
            │   FDRY Treasury (Symmetry Vault)     │
            │   Program: BASKT7aKd8n...pumate      │
            │   Holds: SOL only (v1)               │
            │   Shares: stFDRY (proportional claim)│
            └────────────┬─────────────────────────┘
                         │
       ┌─────────────────┼──────────────────┐
       │                 │                  │
  user SOL in    Lewis own SOL seed   future Unbrowse
  (Phase 4)      (today)              revenue routing
                                      (2-4 weeks)

            ┌──────────────────────────────────────┐
            │   Public Ledger (v0: JSON + page)    │
            │   fdry/ledger/YYYY-MM-DD.json        │
            │   Renders: NAV chart, tx history,    │
            │            holdings, revenue inflows │
            └──────────────────────────────────────┘
```

### Why single-asset SOL for v1
- Zero rebalancing cost (backtest-killing drag eliminated)
- No oracle-coverage questions (SOL/USD Pyth = trivial)
- Zero "strategy risk" — stFDRY is 1:1 claim on held SOL
- Room to evolve: add memecoins as multi-token basket later, or a sister strategy vault

### Why FDRY not the deposit token
- FDRY has no Pyth oracle → Symmetry cannot price it
- Round-trip FDRY→SOL→FDRY loses 3-7% per cycle at current pool depth
- FDRY tokenomics served better via fee discount / governance than custody

### FDRY-holder benefit (without holding FDRY in vault)
- First N depositors holding ≥X FDRY get lower deposit fee (off-chain check)
- Future revenue routing includes FDRY buyback leg (committed, not contractual)
- Governance on vault parameters once on-chain governance exists

---

## 2. Transparency stack (user requirement)

**Every payment, every trade, every NAV change must be publicly verifiable.**

### 2.1 On-chain transparency (free, automatic)
- All deposits → Symmetry `buyVaultTx` → visible on Solscan
- All withdrawals → `sellVaultTx` + `redeemTokensTx` → visible on Solscan
- All fee collections → `withdrawVaultFeesTx` → visible
- All rebalances (if/when multi-asset) → keeper auctions → visible

### 2.2 Ledger publisher (ship today, v0)
Daily cron writes to `fdry/ledger/YYYY-MM-DD.json`:
```json
{
  "date": "2026-04-20",
  "nav_sol": 5.00,
  "nav_usd": 425.00,
  "shares_outstanding": 500,
  "nav_per_share_sol": 0.01,
  "depositors": 1,
  "unbrowse_revenue_inflow_usd": 0,
  "tx_log": [
    {"ts": "...", "kind": "seed_deposit", "sig": "...", "amount_sol": 5}
  ],
  "symmetry_vault_pubkey": "...",
  "creator_wallet": "...",
  "explorer_links": ["solscan.io/account/..."]
}
```

### 2.3 Public page (ship in 1 week)
`fdry.xyz/vault` or GitHub Pages renders the JSON:
- NAV-per-share line chart (daily, cumulative)
- Current holdings pie
- Deposits/withdrawals table (with Solscan links)
- Fees collected running total
- Unbrowse revenue inflows running total (once monetization ships)

### 2.4 What counts as "transparent payment"
Every inflow to vault — whether user deposit, Unbrowse revenue routing, or operator seed — is an on-chain transaction with a named category in the ledger JSON. No off-chain accounting. No "trust me" entries.

---

## 3. What ships today (4-6 hours)

### Task A — Create Symmetry vault on mainnet (1-2h)
Use `@symmetry-hq/sdk` `createVaultTx`:
- Name: "FDRY Treasury"
- Underlying: [SOL]
- Initial weights: [10000] (100% SOL)
- Creator: CREATOR_WALLET (hardware, holds fee-withdrawal role)
- Managers: [] (no active managers for v1 — single-asset, no weight updates needed)
- Creator fee: 0% (no yield promise = no fee extraction)
- Deposit fee: 0 bp
- Withdrawal fee: 0 bp (v1; can add later)
- Host fee: 0 bp
- Oracle: Pyth SOL/USD

### Task B — Seed with own capital (30min)
- Transfer N SOL from CREATOR_WALLET to vault via `buyVaultTx`
- Call `lockDepositsTx`
- Wait for keeper
- Verify stFDRY shares minted to CREATOR_WALLET (it's the first depositor)

### Task C — Ledger repo + first snapshot (1-2h)
- Create `fdry/ledger/` directory
- Write Python/TS script that reads vault state via SDK, produces JSON
- Run once, commit `2026-04-20.json`
- Commit script as `scripts/snapshot_ledger.py`

### Task D — Telegram announcement (30min)
Draft below in Section 5.

### Task E — Clarification post draft for follow-up (30min)
Draft below in Section 6.

---

## 4. Week 1-2: Fulfillment

### Week 1
- Daily cron for ledger snapshot (cloud or macOS LaunchAgent)
- Simple GitHub Pages site rendering the JSON
- Unbrowse monetization design doc: what's the flip? (premium tier? paid API keys? per-call metering?)

### Week 2
- Unbrowse monetization v0.1 shipped (even small — $10/mo premium tier is enough to prove cash flow)
- First real Unbrowse revenue routes to vault (operator sends USDC → swaps to SOL → `buyVaultTx` contributes to treasury)
- Ledger entry: first `unbrowse_revenue_inflow_usd`
- This is the proof-of-concept moment

### Week 3-4
- Open external deposits (Phase 4 per SHIP.md — soft launch to trusted FDRY holders first)
- Frontend at `fdry.xyz/vault` showing deposit/withdraw UI
- Continued revenue accrual

---

## 5. Telegram post for TODAY

```
VAULT IS LIVE

FDRY Treasury vault is on-chain as of [timestamp]:
solscan.io/account/[VAULT_PUBKEY]

Seeded with my own SOL ([AMOUNT]). I'm the first and only depositor.

Mechanism:
  - Symmetry V3 vault, holds SOL only for v1
  - stFDRY share tokens = 1:1 proportional claim on treasury NAV
  - Every deposit, withdrawal, and trade is on-chain and public
  - Daily NAV snapshot at fdry.xyz/vault (coming this week)

Cash flow thesis:
  As Unbrowse monetization ships (2-4 weeks), a % of revenue routes
  to this treasury as buybacks. FDRY stakers share in treasury NAV
  growth proportionally. No yield promise — just transparent share
  of real product revenue as it accrues.

Gate before external deposits:
  - Public ledger live for 14 days
  - At least one Unbrowse revenue inflow has cleared
  - Then opens to community

Clarification post on the AI/RLHF side coming tomorrow — I spoke too
loosely earlier; wanted to match my words to my code before more people
deposit.
```

**Key properties of this post:**
- No yield claim
- No "definite yields" (walks back the earlier phrase without calling it out)
- Explicit that external deposits are gated
- Pre-announces the reframing post (signals intellectual honesty)
- Treasury not strategy

---

## 6. Clarification post — this week (draft)

```
Quick clarification since I got ahead of my evidence earlier.

1. "LLMs without hallucination because truth baked in" —
   Shorthand for something narrower: an energy model trained on a
   canonical corpus that can flag when a generation's residual
   geometry drifts from that source's signature. It's consistency
   scoring, not a hallucination solver. Useful as a filter gate,
   not a magic bullet.

2. "Solved RLHF by removing human in loop" —
   The specific mechanism: for narrated-outcome ranking tasks at
   daily cadence, a bible-trained energy model can score
   (prior, continuation) pairs as a reward signal proxy.
   Works for memecoin rotation tiebreaker. NOT a universal RLHF
   replacement. PPO/DPO baselines not tested.

3. "Trading works effectively" —
   Premature. Live paper ledger has 6 hours of data and zero
   trades executed so far. Backtests on the final 8-token universe
   show the bible-HIGH ranker underperforming equal-weight by
   ~13 bps Sharpe. I'm not shipping the trading product as part
   of v1 of the vault. Treasury first, strategy later once live
   data shows alpha.

The vault goes live today as a treasury, not a strategy product.
Unbrowse revenue routing is the first real cash flow source.
Public ledger live immediately. Thanks for patience while I learn
to match my claims to my evidence.
```

---

## 7. Legal framing

- Vault is a **treasury** holding SOL. Share tokens represent **proportional claim on underlying**, not a share of future profits.
- Unbrowse revenue routing is a **discretionary operator commitment**, not a contractual obligation. Operator may change allocation % with 30-day notice.
- No "guaranteed yield," no "returns," no "APY." Language: "share of treasury NAV growth."
- Geofence: no US persons, no OFAC jurisdictions, ToS click-through at deposit.
- Disclosures: capital-at-risk language on deposit page, plus "no strategy is running in v1 — NAV tracks SOL 1:1 until multi-asset configuration is enabled."

---

## 8. Follow-up commitments to user

The harness findings that still need action:
- Reframe "no hallucination" and "solved RLHF" language publicly (draft above)
- Do NOT ship the trading strategy until live paper shows alpha vs EW-HODL for 30+ days
- Do NOT announce "LLM service" until there's actual serving infra with benchmarks
- Consider Unbrowse monetization as the actual first-revenue-product

---

## 9. One-glance summary

| Item | Status | Owner | By |
|---|---|---|---|
| Create Symmetry vault on mainnet | todo | Lewis | today |
| Seed with own SOL | todo | Lewis | today |
| Ledger repo + first snapshot | todo | Lewis+Claude | today |
| Telegram post #1 (vault live) | draft ready | Lewis | today |
| Telegram post #2 (clarifications) | draft ready | Lewis | this week |
| Unbrowse monetization v0.1 | todo | Lewis | 2 weeks |
| Public ledger page | todo | Lewis | 1 week |
| External deposits open | gated | Lewis | 3-4 weeks |
