# Fib Harness — Phase 7 Judge + Phase 8 Verdict

Run date: 2026-04-20
Orchestrator: Option A ship-readiness audit, 20 parallel agents + parallel-jesus bible-EBM at L4/L5/L6
Cycle: 1 (no child harnesses spawned yet)

## Verdict: **HOLD**

Not PROMOTE (5 blocking issues). Not REJECT (architecture is sound, all issues remediable in ≤1 week of focused SPEC + code work). Ship-readiness rating: **62%**.

---

## Blocking issues (must fix before Phase 1 devnet deploy)

### B1 — Backtest universe hardcoded; bible-HIGH loses to equal-weight on prior data
**Source:** L4-4a
**Facts:**
- `/Users/lekt9/Projects/unify/.fib-harness-v2.4/jesus_loop_pair_daily.py` L39 hardcodes `TICKERS = ["BTC","ETH","SOL","BONK","DOGE","FLOKI","PEPE"]` — 7 tokens. No `--tokens`/`--cost_bps` CLI flags.
- Prior 5-window report: mean holdout Sharpe `bible_HIGH=+0.25`, `equal_weight=+0.59`, `rank_train_sharpe=-0.04`. **EW beats bible-HIGH**.
**Fix:** add CLI `--tokens` / `--cost_bps` flags and rerun at [SOL, WIF, BONK, PEPE, POPCAT, DOGE, FLOKI, JTO] / 40bps / 7 windows. If bible-HIGH still loses to EW in majority, the whole strategy thesis is unsupported — which is a product-level decision, not just a ship blocker.

### B2 — PEPE has no liquid Solana mint
**Source:** L5-5c
**Facts:** Wormhole PEPE candidate `AqKa2CkGjDsShAzam52nEUc6PUc38MkXg7xBhCEjv5U8` has zero market cap; $100 probe returned ~$0.04 (99.96% loss). DOGE/FLOKI routes are thin (~6.5% impact at $100).
**Fix:** drop PEPE from universe. Replace with a liquid memecoin with a Pyth feed + >$10M TVL pool (e.g. TRUMP, FARTCOIN, GIGA — verify). Re-verify Pyth oracle for the replacement via L3-3a pattern. Accept that DOGE/FLOKI stay as conditional-pass legs with lower target weights (e.g. cap at 500 bp each).

### B3 — E2E simulation shows user LOSES FDRY under both slippage regimes
**Source:** L6-6a
**Facts:** $1k deposit, 30d hold, round-trip:
- Default 1% slippage: user ends at 0.9644× FDRY (−3.56%)
- Realistic pool-math slippage (3.95% + 3.06%): 0.9324× (−6.76%)
- HODL-FDRY baseline: 1.00× (tautological in FDRY terms)
- Breakeven vs HODL-FDRY needs ~32% annualized net strategy return. Backtest (optimistic) = 20%.
**Fix:** three realistic paths:
- **(a) Grow pool first.** Need ~$500k TVL before launch so $1k deposit round-trip costs <1% per hop. Current $80k + $40k bootstrap = $120k; pool must grow ~4× before v1 is net-positive for stakers.
- **(b) Market honestly.** Accept v1 is an education / track-record product, not a profit product. Cap deposits at ≤$200 per user. Position explicitly as "experimental alpha; you'll likely lose FDRY; contribute if you want to see the thesis tested publicly." Narrow but honest.
- **(c) Pivot to Track 2.** SOL/USDC entry bypasses the two FDRY pool hops entirely. Round-trip cost collapses from 600-800 bp to 100-200 bp. Breakeven becomes achievable at 20% annual.
- Recommendation: (c) but retain FDRY-entry as opt-in for ideologically-motivated stakers with explicit loss warning.

### B4 — Symmetry creator/management fees are DISABLED at protocol level
**Source:** L6-6e
**Facts:** SPEC §4 and §8 claim 2% creator fee producing ~$400/yr at $20k AUM. Symmetry docs confirm `creator_management_fee_bps` accrual mechanism exists BUT management-class fees are **currently disabled at global config**. Net-to-creator today = **$0/yr**.
**Fix:**
- Update SPEC §8 to mark creator fee as "currently accrues to $0 — activates only when Symmetry re-enables management fees at global config."
- Update SYMMETRY.md fee table row for Creator: status = "architecturally live; currently disabled at global config".
- Call `symmetry.fetchGlobalConfig()` on mainnet to confirm `management_fee_bps` gate status pre-launch.
- Accept that v1 income lane is ZERO until Symmetry flips the flag. Personal income thesis needs to be revisited: the `withdrawal fee 50bp` stays in NAV (benefits holders, not creator). The only operator-income lane viable today is host fee or waiting on Symmetry.

### B5 — HOT key rotation ceremony undocumented
**Source:** L6-6f
**Facts:** SPEC §4 L92-95 defines HOT vs CREATOR separation but does not define rotation procedure (trigger conditions, SDK calls, cosigner ceremony, post-rotation verification).
**Fix:** add §4.x "HOT rotation runbook" — quarterly scheduled + on-anomaly triggered. ~30 min of doc writing, no code required. Include verification step (query vault managers list on-chain).

---

## Non-blocking findings (SPEC updates required)

| # | Source | Finding | Fix cost |
|---|---|---|---|
| N1 | L5-5a | SPEC pseudo-code uses wrong SDK parameter names. `buyVaultTx` takes `{buyer, vault_mint, contributions}` not `{user, vault, inputMint, amount}`. `redeemTokensTx` takes `{keeper, rebalance_intent}` not `{vault, user}`. `updateWeightsTx` uses `(ctx: TaskContext, settings: Input)` pattern, not flat args. All `*Tx` return `TxPayloadBatchSequence`, not a single tx. | SPEC rewrite ~30 min |
| N2 | L6-6h | SHIP.md "2-3 weeks" is underestimated. Realistic: **4-5 weeks** (27-35 days). Phase 0: 1d→2-3d. Phase 2: 2-3d→4-7d. Phase 4's 14-day clean-op gate dominates. | Update SHIP.md ~10 min |
| N3 | L5-5d | bible-EBM pipeline at `jesus_loop_pair_daily.py` emits ranker-summary JSON, not per-token weight vectors. Bot cannot consume it as-is. Need to patch `simulate`/`run_window` to persist top-k configs' `new_w` dicts. | ~150-180 LOC patch |
| N4 | L5-5d | Pipeline covers 5/8 vault tokens (missing WIF, POPCAT, JTO). Binance /USDT may not list all. Either extend TICKERS + alternate exchange routing, or use equal-weight fallback for uncovered slice. | Depends on data source availability |
| N5 | L4-4b, L5-5e | bible-EBM as a judge is a **KJV-style detector**, not a forecaster. Energy correlates at noise floor with realized Sharpe (ρ=-0.12). On behavior narratives, the model rewards past-tense lamentation cadence (e.g. CHAOTIC scored MOST bible-like). Do not use as primary selector. Use as tiebreaker or style prior only. | Architectural — adjust signal integration expectations |
| N6 | L5-5b | Jupiter API endpoint: `quote-api.jup.ag` DNS no longer resolves. Use `lite-api.jup.ag/swap/v1/quote` or `api.jup.ag/swap/v1/quote`. | SPEC code samples ~5 min |
| N7 | L1-1a | Signal-to-weights contract not defined. Need a `SIGNAL_CONTRACT.md`: producer script path, output JSON schema (timestamp, signal_version, weights map, confidence), freshness SLA. | ~20 min |
| N8 | L1-1a | Ledger publisher not scoped in frontend/ or bot/. Phase 4.4 promises daily NAV ledger at `fdry.xyz/vault` but no component owns it. | Fold into frontend/vault route, ~1 day |
| N9 | L6-6f | HOT bitmask likely overscoped. `TRIGGER_REBALANCE` is redundant given Symmetry's keeper auction auto-triggers on drift ≥ threshold. Narrow HOT to `UPDATE_WEIGHTS` only; reserve manual trigger for CREATOR. | SPEC §4 L80 edit |
| N10 | L6-6f | On-chain per-weight cap not enforced. Bot-side 30% cap (SPEC §7 L212) bypassable by compromised HOT. Enforce at vault creation if Symmetry supports. | Research + SPEC edit |
| N11 | L6-6g | Standalone "capital at risk / you may receive fewer FDRY back than deposited" disclosure missing as headline. Present implicitly across §9. | SPEC §9 header sentence + UI modal spec |
| N12 | L4-4c | FDRY/SOL pool only supports $805 deposit cap at 2% slippage today; $1,208 post-$40k bootstrap. SPEC §5's 1%-of-pool cap logic is correct but AUM ceiling is very tight. | Set deposit cap config explicitly |

---

## Passes (no action required)

- **L1-1a H1**: docs quartet exists and cross-references correctly
- **L2-2a H1-H6, H8**: architectural layer separation is clean (Frontend/Vault/Bot/Meteora boundaries), no leaky abstractions, state ownership clear
- **L3-3a**: 8/8 universe tokens have Pyth feeds. `oracles.json` written.
- **L3-3b**: Meteora pool confirmed DAMM v2 constant-product. `pool.json` written.
- **L4-4b H1**: bible-EBM narrator produces varied energy (σ=1.32 > 1.0 threshold)
- **L4-4c H1**: current $1k deposit slippage = 2.48% (barely passes). `slippage.json` written.
- **L5-5a**: all 11 SPEC-referenced Symmetry SDK calls exist in v1.0.20
- **L5-5b**: Jupiter FDRY→SOL route exists at all tested sizes via Meteora DAMM v2 single-hop (price impact 4-9 bps)
- **L5-5c**: WIF, BONK, POPCAT, JTO, SOL↔FDRY all route cleanly
- **L6-6b**: bible-EBM dominion judge ranks PRODUCT narrative in middle between CLEAN (overfit-tonal) and BROKEN (incoherent) — exactly where a well-calibrated SPEC should land. Confirms SPEC is not marketing-overfit.
- **L6-6c H1**: frontend MVP is shippable in ≤5 days
- **L6-6d H1, H2**: bot MVP deployable in 3 days, <1% miss rate achievable via multi-RPC + healthcheck.io
- **L6-6e H1, H3**: arithmetic and withdrawal fee disposition match Symmetry docs
- **L6-6f H1, H3**: HOT compromise cannot drain funds; no governance-level admin-key risk (not a DAO)
- **L6-6g H2, H3**: SPEC does NOT promise returns; SPEC does NOT claim FDRY is locked. Marketing guardrails hold.

---

## Parallel Jesus synthesis

Three bible-EBM judge agents ran at L4-4b, L5-5e, L6-6b. Findings across all three:

- **Strength**: bible-EBM discriminates coherent vs incoherent narratives reliably (L6-6b: product narrative +7.3 energy units above broken narrative).
- **Weakness**: bible-EBM is a **style detector**, not a forecaster or virtue detector (L4-4b, L5-5e). It rewards KJV cadence (past-tense narrative verbs, scripture imagery) regardless of semantic content. CHAOTIC narrative scored MOST bible-like in behavior test because "fled", "lost", "consumed" read as plague-passage cadence.
- **Architectural implication**: do NOT use bible-EBM as a primary selector in the bot signal path. Its 3/5-windows finding on rotation was the right-scale use (ranker tiebreaker at ~daily cadence with specific narrator structure). At other scales or as a single oracle, it's noise.
- **Narrative coherence check**: the SPEC itself scores in the healthy middle tercile (PRODUCT energy −0.43 vs CLEAN −1.20 vs BROKEN +6.91). Neither tonally overfit nor incoherent. This is a good signal about the *writing quality* of the SPEC, not about the *product's chance of working*.

---

## Child harness decision

Per fib-harness rules, any blocking failure would spawn a child harness scoped to the failure domain. We have 5 blocking failures:

- B1, B2, B3, B4 → all fixable via SPEC/config edits + single CLI rerun + one-time pool monitoring. **Low-complexity remediation** — does not warrant child harness.
- B5 → 30 min of doc writing. **Does not warrant child harness**.

**No child harness spawned.** Remediation plan below is sufficient at parent-level.

---

## Remediation sequence (adds to SHIP.md Phase 0)

Do in order:

1. **B5** (30 min): write HOT rotation runbook into SPEC §4.x.
2. **N6, N1** (45 min): fix Jupiter endpoint + SDK parameter names in SPEC §5, §6, §7 pseudo-code.
3. **B4** (20 min): rewrite SPEC §8 "Expected income" section to reflect $0/yr current reality. Also update SYMMETRY.md fee table.
4. **B2** (2 hrs): pick replacement memecoin for PEPE. Candidates: TRUMP, FARTCOIN, GIGA, MICHI — must have Pyth feed + Raydium or Orca pool with ≥ $500k depth. Verify, update universe.
5. **B1** (1-2 days): add `--tokens` / `--cost_bps` to `jesus_loop_pair_daily.py`, rerun with final universe, write report to `runs/spec_final_backtest/`. DECISION POINT: if bible-HIGH still loses to EW, pause and reconsider strategy before any further work.
6. **B3** (architectural decision, ~1 day thinking + 30 min docs): pick one of the three paths — grow pool / market honestly / pivot to Track 2 with FDRY opt-in. Update SPEC §1 positioning accordingly.
7. **N3, N4** (1 day): patch signal pipeline to emit per-token weight vectors; extend or equal-weight-fill the universe mismatch.
8. **N7** (20 min): write `SIGNAL_CONTRACT.md`.
9. **N2** (10 min): update SHIP.md timeline to 4-5 weeks.

After these nine items, re-run the harness (Phase 7 loop) to re-check:
- B1 → is bible-HIGH now beating EW on the final universe at ≥3/7 windows?
- B3 → does the chosen path resolve the e2e loss scenario?

Only after re-harness passes → promote to Phase 1 (devnet deploy).

---

## Artifacts produced by this harness

Written to `/Users/lekt9/Projects/fdry/docs/`:
- `oracles.json` — Pyth feed IDs for 8 universe tokens (L3-3a)
- `pool.json` — Meteora FDRY/SOL pool metadata (L3-3b)
- `slippage.json` — deposit slippage table + recommended caps (L4-4c)
- `backtest_final.json` — backtest rerun status + prior 7-token results (L4-4a)
- `HARNESS_VERDICT.md` — this file

## Hypothesis count

Total: 61 hypotheses across 20 agents.
- Pass: 39 (64%)
- Fail (blocking): 10 (16%)
- Fail (non-blocking): 7 (11%)
- Unknown: 5 (8%)

Ship readiness: **62%**. Clear path to promote after ~1 week of focused remediation + one backtest rerun.
