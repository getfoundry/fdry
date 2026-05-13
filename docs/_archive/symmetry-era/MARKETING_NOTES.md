# fdry — depositor narrative + pitch (Lane E artifact)

> Generated 2026-04-20 from the validated v0.4.1 walk-forward.
> See `ledger/performance.html` for the live chart.
> See `runs/daily_signal/{date}.json` for today's emit.

---

## The headline (one line)

**Sharpe +1.212, max drawdown -9.98%, 97-day walk-forward, k-fold-gated SOL text-drift signal, daily rebalance on Solana via Symmetry V3 vault.**

## The 3-sentence pitch

> *fdry* is a daily-rebalanced Solana memecoin rotation vault. Our edge:
> a frozen-bible residual stacker that reads SOL-mention text from a 314k
> tweet corpus through a k-fold-validated text-drift lens — accepted on
> 3 of 5 walk-forward folds with median gain +0.27%. We size the SOL
> bet against a 0.5% daily-vol target so the drawdown stays under 10%
> while the Sharpe stays over 1.2.

## Target depositor archetypes

1. **Solana-native LP** holding FDRY for narrative reasons. Wants
   directional alpha while keeping FDRY exposure. Rotation vault gives
   them this without exiting their FDRY position.
2. **DeFi quant fund / DAO treasury** allocating a small sleeve to
   experimental signal-driven products. Cares about Sharpe + transparent
   methodology. Our k-fold + tier-discipline + frozen-bible Tier 0
   anchor speaks their language.
3. **Crypto-native angel / KOL** who wants to publicly point at a
   model-driven product as "proof Solana DeFi has alpha." Cares about
   the chart being legible.

## What to lead with (in order)

1. **The chart** — `performance.html` shows 6 variants × 4 quarters
   with the shipped variant highlighted at rank 1. This is the
   "candle on the candlestick" of the prior session.
2. **The discipline** — tier-separated Tier 0/1/2, k-fold-gated lens
   acceptance, walk-forward refit (v0.4.1 = TARGET_DAILY_VOL refit
   from 0.01 → 0.005 because lower vol-target won 3 of 4 quarters).
3. **The retracted hypotheses** — *show what was killed*, not just
   what was kept. Three independent rejections of the strong
   bible-as-cross-domain-scorer thesis. Three rejections of universe
   expansion. The system's *refusals* are the credibility, not the
   acceptances.

## What NOT to lead with

- AUM (currently ~$0 for outside depositors)
- Live track record (1 day)
- "Bible-anchored" branding without the quant context (sounds like
  decoration; risks losing technical readers)

## What this product is NOT (be honest)

- Not a high-frequency strategy
- Not a high-leverage strategy
- Not a yield farm
- Not a market-neutral strategy (long-only via Symmetry)
- Not a strategy with a long live track record (just shipped)
- Not a guaranteed performer in regimes outside the May-Sep 2024 backtest window
- Not a substitute for diversification — small sleeve only

## Distribution channels (where to put the chart)

| Channel | Asset | Time | Cost |
|---|---|---|---|
| GitHub Pages | `performance.html` static deploy | 30min | free |
| X/Twitter | screenshot + 3-sentence pitch | 5min | free |
| Solana DeFi DAO Discords | one-paragraph summary + chart link | 1hr | free |
| Personal network | DM the chart URL to 5 funds | 1hr | free |
| Paragraph / Mirror | longer-form post linking the chart | 2hr | free |

**Order of operations**: deploy chart publicly first (Lane H). Then
post screenshot to X linked to the public URL. Then DM/Discord. Don't
post the chart screenshot without the URL — depositors need to be
able to verify by clicking through.

## What you DO NOT promise

- A target return (anything > current Sharpe is a lie)
- Capacity (you don't know yet)
- That past performance predicts future (k-fold is the closest honest claim)
- That you'll add more tokens / leverage / venues if AUM grows
  (Matt 4 refusals stand)


## Capacity (Luke 12:48 — to whom much is given)

The strategy rebalances daily across SOL + 5 memecoins (WIF, BONK,
POPCAT, FLOKI, JTO). Daily turnover ≈ 32% of AUM. Slippage estimate
on the thinner memes (POPCAT, FLOKI, JTO):

| AUM | Daily turnover | Estimated slippage drag | Verdict |
|---|---|---|---|
| < $100k | < $32k | < 1% | safe |
| $100k–$1M | $32k–$320k | 1–5% | manageable |
| $1M–$10M | $320k–$3.2M | 5–15% | breaks the edge |
| > $10M | > $3.2M | catastrophic | impossible under current architecture |

**Initial deposit cap: $500k AUM**. This is not a marketing softener;
it's the honest boundary at which the validated edge survives. Lift
the cap only when (a) Elisha brings a second validated signal token,
or (b) lower-cost intra-basket swaps come to Symmetry, or (c) a
non-memecoin SOL-correlated leg (already refused) becomes viable
under stricter cost-counting than 2026-04-20's analysis.

This cap is part of the product. State it in every depositor pitch.

## What you DO promise

- Daily emit at 00:05 UTC, fail-closed (confidence=0 on any pipeline error)
- Public chart updated daily as live data fills in
- Public retracted-hypothesis log (AGENTS.md is the audit trail)
- v0.4.1 params frozen for at least 30 days from refit date
  (next admissible review: 2026-05-20)

## Done is better than perfect

The chart already exists. The pitch is above. Two distribution moves
this week (deploy + tweet) are the entire next step. Nothing in the
strategy needs to change for this to attract first depositors.
