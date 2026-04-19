# User Decision Memo — FDRY Vault, Post-Cycle-2

**To:** founder
**From:** Cycle 2 L6-6h (synthesis)
**Date:** 2026-04-20

## Headline

**Do not ship yet.** Cycle 2 closed the doc/config fixes, picked an architectural path (Track 2 pivot), and replaced PEPE — but the one number that validates the whole thesis, the final-universe backtest, was never actually run. Ship-readiness moved from 62% to ~75% on paper, but the strategy itself is still unverified.

## What changed in Cycle 2

- **B2 resolved**: PEPE swapped for FARTCOIN (Pyth feed + $7.59M TVL + 0.05% impact at $1k). Clean pick.
- **B3 path chosen**: pivot to **SOL/USDC entry (Track 2)** with FDRY-entry retained as opt-in under an explicit loss warning; FDRY-hold gated fee discount + fee-routed buyback creates the demand flywheel. Confidence 0.78.
- **B4, B5, N1, N2, N6 doc fixes**: creator fee zeroed in SPEC §8, HOT rotation runbook added §4.1, Symmetry SDK signatures corrected, Jupiter endpoint fixed, SHIP.md timeline honestly reset to 4–5 weeks.
- **Missing outputs**: `runs/spec_final_backtest/` is empty; `CYCLE2_READINESS.md` and `CONSISTENCY_CHECK.md` were never written. The L4-4a backtest agent refused to modify `jesus_loop_pair_daily.py` and handed it off.

## THE NUMBER

**Backtest rerun did not happen.** The only quantitative evidence we have is still Cycle-1 prior data on the *wrong* 7-token universe: bible-HIGH mean Sharpe = **0.25 vs equal-weight 0.59**, win rate **2/5 windows** (fails the ≥3/7 bar). On the data we actually have, the strategy thesis is **unsupported**.

Three honest paths:

1. **Run the backtest.** 1–2 days: add `--tokens`/`--cost_bps` CLI flags, rerun on [SOL,WIF,BONK,FARTCOIN,POPCAT,DOGE,FLOKI,JTO] at 40bps × 7 windows. If bible-HIGH beats EW in ≥3/7 → thesis confirmed, proceed.
2. **Drop bible-EBM as primary, ship equal-weight v1.** EW already beats bible-HIGH on prior data. Ship a passive 8-token memecoin vault on the Track 2 rails; use bible-EBM only as a tiebreaker (N5). Low risk, low novelty.
3. **Kill the product.** If you don't believe the strategy and won't run the test, don't deploy $40k of bootstrap LP into a vault that loses stakers money under realistic slippage (−3.56% to −6.76% on $1k/30d in the FDRY-entry path).

## Recommendation

**Path 1, then gate on the result.** The missing backtest is ~2 days of work and it is the single load-bearing unknown in the entire project. Running it is cheap; shipping without it is the expensive mistake. If bible-HIGH loses to EW again, fall back to Path 2 automatically — the Track 2 architecture from B3 works for either selector.

## What you must decide (pick one)

- **A.** Authorize a ~2-day engineering session to patch `jesus_loop_pair_daily.py` (CLI flags + weight-vector emission) and rerun with the final 8-token universe. Ship decision resumes after the number lands.
- **B.** Skip the backtest; ship Track 2 vault with equal-weight selector; bible-EBM used only as tiebreaker. Locks in ~20% AUM return ceiling with no strategy-alpha claim.
- **C.** Stop. Pool depth and strategy evidence are both too weak; revisit in 60 days after organic FDRY/SOL pool growth.

**Default if no reply in 48h:** A.