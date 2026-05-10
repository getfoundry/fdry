# REVERSIBILITY_AUDIT — FDRY Treasury Vault v1

C7 L6-6d | Dimension: Dominion — "Wise as serpents"
Question: If something goes wrong, can we unwind it?

## Per-action audit

### 1. Create vault on mainnet (Step 5)
- **Category:** REVERSIBLE_COSTLY
- **Reversible?** Partially. The vault account is permanent on-chain (one-way door in the strictest sense) but it can be functionally abandoned: TVL can go to 0 via redemption, creator fee can be rerouted, manager role can be rotated/removed.
- **Reversal path:** Redeem all tokens -> set creator fee beneficiary to burn/null -> rotate manager key. Vault pubkey persists forever but has no economic weight.
- **Blast radius:** Operator-only pre-seed. Gas cost (~0.01 SOL) and a zombie account on-chain.
- **Touches stakers?** No — no external stakers at Step 5.
- **Pre-check gate:** `--dry-run` in Step 4 validates config before commit.

### 2. Seed $10k SOL (Step 6)
- **Category:** REVERSIBLE_COSTLY
- **Reversible?** Yes, via `sellVaultTx` + `redeemTokensTx` at any time.
- **Reversal path:** Call redeem against operator's own LP balance -> convert vault tokens back to SOL. Loss = round-trip Jupiter slippage (est 50-150 bps on $10k = $50-$150) + rebalance tax.
- **Blast radius:** Operator wallet only. Bounded to slippage delta.
- **Touches stakers?** No — operator is sole staker until Step 10.
- **Pre-check gate:** `--dry-run --amount-usd=10000` in Step 6.

### 3. Push weights (daily bot)
- **Category:** REVERSIBLE
- **Reversible?** Yes — the next scheduled push overwrites the previous weight vector.
- **Reversal path:** Push corrected weights next cycle (<=24h). In emergency, manual override any time.
- **Blast radius:** One rebalance cycle of slippage. If weights push to a malicious/dead token, loss = that token's allocation x drawdown.
- **Touches stakers?** Yes, post-Step 10. Bounded by per-token weight cap in config.
- **Pre-check gate:** Signal pipeline validation + weight-sum-10000 invariant + universe whitelist.

### 4. Publish ledger to GitHub Pages (Step 8)
- **Category:** IRREVERSIBLE (data) / REVERSIBLE (feed)
- **Reversible?** Git history is append-only and public once pushed. Publishing can be stopped; already-published data cannot be un-seen.
- **Reversal path:** Stop updating, make repo private, force-push history rewrite (doesn't help — mirrors/Wayback exist).
- **Blast radius:** Reputational only. No financial leakage unless ledger contains private keys (does not — verified in SPEC).
- **Touches stakers?** No direct financial; yes reputational transparency commitment.
- **Pre-check gate:** Confirm `ledger/latest.json` and `deposits.jsonl` contain no secrets before `git add`.

### 5. Telegram announcement (Step 10, POST 1)
- **Category:** IRREVERSIBLE (social)
- **Reversible?** Message edit/delete possible but screenshots + forwards are permanent.
- **Reversal path:** Edit with correction, post public retraction. Reputational cost unbounded below zero.
- **Blast radius:** Reputational + legal (if claims are wrong). Attracts real stakers — so a false claim propagates to stakers.
- **Touches stakers?** Yes, this is what CREATES external stakers.
- **Pre-check gate (REQUIRED):** Step 5.5 on-chain verification MUST pass before POST 1 ships. Gate = Solscan page loads + Symmetry UI loads + screenshots attached.

### 6. Open external deposits
- **Category:** REVERSIBLE_COSTLY
- **Reversible?** Deposits can be paused via Symmetry config; existing stakers ALWAYS retain unilateral withdraw rights (protocol-enforced).
- **Reversal path:** Toggle `acceptingDeposits=false` in vault config. Stakers redeem on their own timeline.
- **Blast radius:** If deposits paused suddenly, reputational. Stakers' funds are never trapped.
- **Touches stakers?** Yes, bounded: they can always exit. Cannot be rug-pulled by config change.
- **Pre-check gate:** Weight cap + universe whitelist + manager key in hardware wallet.

## Flagged IRREVERSIBLE actions

1. **Telegram POST 1** — properly gated by Step 5.5 (on-chain verification). GATE MUST HOLD.
2. **GitHub Pages publication** — gated by secret-scan pre-commit. Acceptable: financial blast radius is zero.

## Summary table

| Action | Category | Gated? | Touches stakers? |
|---|---|---|---|
| Create vault | REVERSIBLE_COSTLY | Yes (dry-run) | No |
| Seed $10k | REVERSIBLE_COSTLY | Yes (dry-run) | No |
| Push weights | REVERSIBLE | Yes (invariants) | Bounded |
| Publish ledger | IRREVERSIBLE (data) | Yes (secret-scan) | No $ |
| Telegram POST 1 | IRREVERSIBLE (social) | Yes (Step 5.5) | CREATES them |
| Open deposits | REVERSIBLE_COSTLY | Yes (protocol withdraw) | Bounded exit |

No action has unbounded blast radius to stakers: redemption is always protocol-enforced.
