# FDRY Staker Guide

For holders who want a plain-English read on what the vault is, what it isn't, and how to verify everything.

## What this is

- A treasury vault on Solana, built on top of the Symmetry protocol.
- You deposit SOL or USDC, you get back stFDRY (an SPL share token).
- stFDRY is a pro-rata claim on the vault's net asset value (NAV), denominated in SOL.
- Strategy: daily rebalance across a liquid memecoin basket, equal-weight rotation.
- Not a yield product. Not a farm. Not a structured note. A transparent, on-chain treasury.

## What you are NOT being promised

Read this section twice.

- **No APY.** Nobody is quoting a rate. Anyone who does is lying.
- **No guaranteed return.** NAV can go down. NAV can go to zero.
- **No "FDRY is locked" narrative.** The vault holds SOL and basket assets, not FDRY. FDRY is not backing this token 1:1. Don't repeat that on Twitter.
- **No alpha.** We backtested a ranker. It didn't validate. We shipped equal-weight rotation instead — the boring honest version. You are getting beta to a memecoin basket, nothing more.
- **No promise of outperformance** vs. holding SOL, vs. holding the basket directly, vs. anything else.
- **No lockup-based "points" or retroactive airdrops** being secretly calculated. What you see is what you get.

## What you ARE getting

- **1:1 proportional NAV claim.** You own X% of stFDRY supply, you own X% of the vault, in SOL terms.
- **Public ledger.** Every deposit, withdrawal, rebalance, and fee accrual lives on Solana. Solscan + dashboard, both public.
- **Daily rebalance** across a liquid memecoin basket (composition published; changes are on-chain and timestamped).
- **Eventual Unbrowse revenue share.** When Unbrowse monetization ships (target: 2-4 weeks), a cut flows to the vault. This is the only "yield" component and it is not live yet.
- **FDRY holder perks** (holders of FDRY, separate from stFDRY):
  - Reduced withdrawal fee
  - Priority window during early deposit phases
  - Governance votes on strategy params, basket composition, fee changes

## How to deposit

**Not open yet.** First 14 days post-launch = founder capital only. This is deliberate — gives us time to watch rebalances execute, catch edge cases, and get real Solscan history before public money shows up.

After the 14-day window:

1. Go to **fdry.xyz/vault**
2. Connect your wallet (Phantom, Backpack, Solflare, etc.)
3. Pick your deposit asset: **SOL** or **USDC**
4. Approve and sign — the vault issues **stFDRY** to your wallet
5. stFDRY shows up as a standard SPL token. You can see it anywhere that indexes SPL tokens.

You will see the current NAV per share before you sign. Nothing is obscured.

## How to withdraw

- **No lockup.** Withdraw any time, any amount, 24/7.
- Burn your stFDRY, receive a **pro-rata slice of the basket** (you get each underlying token proportionally).
- Want one asset? Route the basket through **Jupiter** to SOL / USDC / whatever. The UI has a one-click path.
- **Withdrawal fee: 50 bps** (0.50%). The fee stays in the vault — it does NOT go to the operator. Remaining holders benefit slightly every time someone exits.
- Standard Solana network fees apply (tiny).

## What can go wrong

Honest list. No hand-waving.

- **Strategy loses money.** Most likely failure mode. An equal-weight memecoin basket in a down market bleeds. If the whole sector rolls over, NAV follows it down. You wear the drawdown. We don't have a stop-loss, we don't rotate to stables, we don't time the top.
- **Symmetry protocol exploit.** The vault is built on Symmetry. If Symmetry gets hacked at the protocol layer, funds can be at risk. This is outside our control. Symmetry is audited — not a guarantee, but worth knowing.
- **Jupiter routing fails / thin liquidity.** Rebalance day comes, a basket leg has no route or brutal slippage. We skip the trade or take the hit. Not catastrophic, but it can drag NAV.
- **Oracle failure / stale prices.** Rebalance uses on-chain price feeds. If a feed goes stale or wrong, a trade could execute at a bad mark. Guardrails exist, not bulletproof.
- **Operator (us) abandons the project.** Code is open-source. The CREATOR role on the vault is transferable. Worst case: basket stops rebalancing and you redeem against the frozen basket composition at fair NAV. You don't lose access to funds because we disappear.
- **Smart contract bug in our wrapper code.** Less surface area than a custom vault, but nonzero. Not audited yet — we'll note when that changes.
- **Regulatory surprise.** Crypto. You already know.

## Red flags — report any of these

If you see one of these, it means something is broken or somebody is lying. Call it out publicly.

- **Big NAV drop with no explanation.** Demand a post-mortem. Every rebalance has an on-chain tx. Every P&L move can be explained.
- **Operator (or anyone claiming to speak for FDRY) posting APY / yield / "guaranteed return" language.** It's not a yield product. Report the account.
- **Public ledger / dashboard going dark.** The vault pubkey is immutable. If fdry.xyz is down, Solscan still works. If both are quiet, something is wrong.
- **Unannounced changes to strategy, fee, or basket composition.** All three require governance or a public changelog entry.
- **stFDRY mint authority doing unexpected things.** Check it. Authority is documented below.
- **Unsolicited DMs** telling you to "migrate" stFDRY to a new contract. We will never DM you. Every migration would be announced on the main channel, signed, and on-chain.

## How to verify anything we say

Trust nobody. Verify everything.

- **Vault pubkey:** see `docs/vault.json` in this repo (populated after vault creation). That's the source of truth.
- **stFDRY mint address:** also in `docs/vault.json`.
- **Every transaction:** click through to **Solscan** from the dashboard, or paste the pubkey into Solscan yourself.
- **Live NAV chart:** **fdry.xyz/vault** — pulls directly from on-chain state.
- **Basket composition + weights:** dashboard shows current weights; history is reconstructable from on-chain rebalance txs.
- **Backtest data:** `/runs/backtest_c5.json` in this repo. You can see exactly what we tested, what the results were, and why we picked equal-weight over the ranker.
- **Code:** open-source. Read it. Fork it. Run the rebalance logic against historical data yourself.
- **Fees collected:** on-chain, visible per-tx. No off-chain accounting.

If a piece of information isn't verifiable on-chain or in this repo, it's not official.

## Not legal or financial advice

This is experimental software running experimental strategy on volatile assets. Nothing here is a recommendation. Nothing here is an offer. Talk to your own advisor if you need one.

**Don't deposit what you can't afford to lose. Probably don't deposit more than you can afford to watch bleed 50% for a quarter without losing sleep.**

That's the whole pitch. No hype, no promises, no APY. Just a transparent vault and a public ledger.
