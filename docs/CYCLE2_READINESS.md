# Cycle 2 Ship Readiness — Re-Score

**Run date:** 2026-04-20
**Agent:** Cycle 2 L6 Agent 6g (Dominion/Integration)
**Cycle 1 baseline:** 62% (HARNESS_VERDICT.md)

---

## Verdict: **REJECT v1 bible-EBM ranking thesis — FORMALLY ADOPT B3 Path (c) / Track 2 as v1**

Ship-readiness after Cycle 2 remediation: **50%**.

Rationale:
1. Readiness dropped from 62% to 50% — B1 did not clear. The bible-EBM ranker was never rerun because `jesus_loop_pair_daily.py` was not parameterised this cycle, and on the only data we do have (prior 7-token, 5-window run) bible-HIGH mean Sharpe = +0.25 vs equal-weight +0.59. bible-HIGH wins only 2/5 windows vs EW (< 3/7 threshold). The signal does NOT support ranker-driven alpha over EW.
2. 50% < 70% floor AND B1 fundamentally fails per the decision rule ("If readiness < 70% OR B1/B3 fundamentally fails → REJECT v1 thesis, pivot to Track 2").
3. B3 has already, in this cycle, made the correct pivot recommendation: Path (c) — SOL/USDC entry as default, FDRY-entry as opt-in with explicit loss warning, FDRY-hold fee discount, weekly FDRY buyback from strategy fees (see `B3_PATH_DECISION.md`). This IS the Track 2 pivot. What's missing is formal ratification + propagation into SPEC §1/§5/§6/§8.
4. The verdict is NOT "stop the project" — it is "the v1 product is Track 2, not bible-EBM ranker over FDRY-entry." Meaning: ship the pivoted architecture, not the original thesis.

---

## Per-item status after Cycle 2

| Item | Cycle 1 status | Cycle 2 outcome | Remaining weight |
|------|----------------|-----------------|-----------------|
| **B1** Backtest rerun / bible-HIGH vs EW | BLOCKING-FAIL | **UNRESOLVED.** `backtest_final.json` reports `ran_backtest: false` because the agent had no code-change authority; CLI flags `--tokens`/`--cost_bps` still not landed in CLI (one `--tokens` add exists in the file but the rerun was not executed and results not archived to `runs/spec_final_backtest/`). On the prior 7-token data bible-HIGH remains below EW (+0.25 vs +0.59). H2 fails. | **1.00** |
| **B2** PEPE replacement | BLOCKING-FAIL | **RESOLVED.** `pepe_replacement.md`: FARTCOIN picked. Pyth feed `0x58cd29ef...3608`, Solana mint `9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump`, Raydium pool TVL $7.59M, Jupiter impact 0.046% at $1k. Note: SPEC §2/§4/§7 still hardcodes `PEPE` in universe; propagation is an N-level wiring follow-up. | **0.10** (propagation debt) |
| **B3** E2E user loss | BLOCKING-FAIL | **RESOLVED AT DECISION LEVEL.** `B3_PATH_DECISION.md` picks Path (c): SOL/USDC entry default + FDRY opt-in + FDRY-hold fee discount + weekly buyback flywheel. At 20% strategy return, staker net ≈ +17–19% USDC (vs Cycle 1 −3.56% to −6.76% FDRY). Architecturally dissolves the two-FDRY-hop tax. No L6-6a re-sim artifact was produced this cycle — the resolution is analytical, not freshly simulated. SPEC §1 positioning NOT YET rewritten. | **0.25** (resolved-but-not-propagated + no re-sim artifact) |
| **B4** Fees disabled | BLOCKING-FAIL | **PARTIAL FIX (expected).** SPEC §4 L92 and §8 L262 now explicitly mark creator fee "$0 today until Symmetry enables." SYMMETRY.md fee table row "Creator" = "architecturally live; currently disabled at protocol global config." Pre-launch `fetchGlobalConfig()` check implied via SYMMETRY.md note. Underlying Symmetry disable cannot be fixed by us. | **0.50** (per task: partial) |
| **B5** HOT runbook | BLOCKING-FAIL | **RESOLVED.** SPEC §4.1 "HOT rotation runbook" added (L99–L113): triggers, procedure (manager-remove → new keypair → manager-add → env update → on-chain verify), SLA 30min emergency / next-BD scheduled. | **0.00** |
| N1 SDK param names | non-blocking | **RESOLVED.** SPEC §5 `buyVaultTx({buyer, vault_mint, contributions})`, §7 `updateWeightsTx(ctx, settings)`, all return `TxPayloadBatchSequence`. | 0 |
| N2 SHIP timeline | non-blocking | **RESOLVED.** SHIP.md header now "27-35 days total (4-5 weeks)"; Phase 0=2-3d, Phase 1=3-5d, Phase 2=4-7d. (SPEC §10 still says "2-3 weeks" — minor residual inconsistency). | 0.2 |
| N3 per-token weight emission | non-blocking | **PARTIAL.** SIGNAL_CONTRACT.md defines producer path `jesus_loop_weights_emit.py` + schema + invariants, but the producer script itself is not yet written (marked "to be created"). `--tokens` CLI flag added to jesus_loop_pair_daily.py; full weight-vector emission code not landed. | 0.5 |
| N4 pipeline coverage 5/8 | non-blocking | **UNKNOWN.** No explicit data-source resolution memo this cycle. | 1.0 |
| N5 bible-EBM as style detector | non-blocking | **NOT RESOLVED.** No "tiebreaker/style prior" reframing visible in SPEC §7 — still treats bible-EBM as primary selector. Given B1, this is now moot (the ranker is being removed from critical path by Track 2 pivot), but the doc change is still outstanding. | 1.0 |
| N6 Jupiter endpoint | non-blocking | **RESOLVED.** SPEC §5 L118: `https://lite-api.jup.ag/swap/v1` (with `api.jup.ag/swap/v1` fallback). Old `quote-api.jup.ag/v6` removed. | 0 |
| N7 SIGNAL_CONTRACT.md | non-blocking | **RESOLVED.** New doc: schema, invariants, freshness SLA (1h), fail-closed behaviour, confidence computation, versioning policy. | 0 |
| N8 Ledger publisher ownership | non-blocking | **PARTIAL.** SHIP §4.4 has concrete tasks; B3_PATH_DECISION.md explicitly folds NAV ledger into frontend `/vault` route. No explicit "frontend owns X, bot owns Y" line in SPEC. | 0.5 |
| N9 HOT bitmask scope | non-blocking | **RESOLVED.** SPEC L80: `manager authority: UPDATE_WEIGHTS   // TRIGGER_REBALANCE reserved for CREATOR break-glass`; L97 makes same explicit for HOT_WALLET. | 0 |
| N10 on-chain per-weight cap | non-blocking | **NOT RESOLVED.** SPEC §7 L247 still has `Don't push if any single weight > 3000 bp` as bot-side only. No Symmetry on-chain cap research. | 1.0 |
| N11 Capital-at-risk disclosure | non-blocking | **RESOLVED.** SPEC §9 L268: bold headline "**Capital at risk. You may receive back fewer FDRY than you deposited. Strategy may lose money. No return is guaranteed. This vault is discretionary, not a passive yield product.**" | 0 |
| N12 Explicit deposit cap | non-blocking | **NOT RESOLVED.** SPEC §5 uses `poolLiq * 0.01` formula but no explicit `deposit_cap_usd` config value. | 1.0 |

---

## Readiness computation

```
blocking_remaining    = 1.00 (B1) + 0.10 (B2) + 0.25 (B3) + 0.50 (B4) + 0.00 (B5) = 1.85
nonblocking_remaining = 0.2 (N2) + 0.5 (N3) + 1.0 (N4) + 1.0 (N5) + 0.5 (N8) + 1.0 (N10) + 1.0 (N12) = 5.20

readiness = 1 - 1.85*0.20 - 5.20*0.03
          = 1 - 0.370 - 0.156
          = 0.474
```

**Ship readiness: 47%** (rounded) / **0.474** exact.

Cycle 1 baseline 62% → Cycle 2 **47%**. Regression.

---

## Why readiness went DOWN after remediation

It didn't, really. The Cycle 1 62% reflected "all blockers are cheap to fix in ≤1 week." Cycle 2 did a lot of the cheap fixes (B5, N1, N6, N7, N9, N11, and decision-level B2/B3), but also revealed the hard truth:

- **B1 is not cheap and not passing.** The bible-EBM ranker does not beat equal-weight on available data and was not rerun. This was the DECISION POINT in the Cycle 1 remediation sequence: "if bible-HIGH still loses to EW, pause and reconsider strategy before any further work." That pause is exactly where we are.
- **B3's pivot to Path (c) is the correct response to that pause** — but executing the pivot is new work not yet landed in SPEC.

The correct mental model is: Cycle 2 exposed that the original v1 thesis doesn't ship. The 47% score is the honest read of "how close is the ORIGINAL v1 to shipping" (not close). The project is **not** 47%-far from shipping ANY v1 — B3 Path (c) reframes what v1 is, and re-scoring against Track 2 as v1 would produce a higher readiness since half of B1's weight becomes irrelevant (Track 2 vault uses equal-weight baseline initially, with bible-EBM as optional tiebreaker only).

---

## Decision rule application

| Threshold | Hit? | Action |
|-----------|------|--------|
| ≥ 90% | No (47%) | — |
| 70–89% | No (47%) | — |
| < 70% | **Yes (47%)** | **REJECT v1 thesis** |
| B1 fundamentally fails | **Yes** | **REJECT v1 thesis** |
| B3 fundamentally fails | No — path chosen | — |

**Action: REJECT v1 bible-EBM thesis. Pivot to Track 2 (B3 Path c) as the new v1.** This is not failure; it is the thesis-test result we built the harness to produce.

---

## Cycle 3 scope (if pivoted)

If the user ratifies the Path-(c) pivot, Cycle 3 should re-score against the *Track 2 product spec*, not the original. Suggested Cycle 3 remediation set:

1. Rewrite SPEC §1 positioning → Track 2 (Solana quant-alpha vault with FDRY fee-discount utility).
2. Rewrite SPEC §5/§6 deposit/withdrawal to two-mode (SOL/USDC default, FDRY opt-in).
3. Add SPEC §8 FDRY-hold fee-discount logic + weekly buyback keeper job spec.
4. Propagate FARTCOIN-for-PEPE into SPEC universe (B2 wiring).
5. Write `jesus_loop_weights_emit.py` per SIGNAL_CONTRACT.md (N3 code).
6. Close N4, N5, N10, N12.
7. Run a fresh L6-6a e2e sim against the Track 2 deposit path at $1k/30d/20% strategy return to numerically confirm the analytical −3.56% → +17% flip.
8. Only then re-harness.

Estimated Cycle 3 duration: 2–3 working days doc + 1 day code + 1 day sim = ~5 working days.

Expected post-Cycle-3 readiness if all above lands: ~85–90% → PROMOTE to Phase 1 devnet.

---

## JSON hypothesis

```json
{
  "agent": "C2-L6-6g",
  "dimension": "dominion_integration",
  "cycle": 2,
  "baseline_readiness_pct": 62,
  "cycle2_readiness_pct": 47,
  "cycle2_readiness_exact": 0.474,
  "blocking_remaining_weighted": 1.85,
  "nonblocking_remaining_weighted": 5.20,
  "formula": "1 - blocking_remaining*0.20 - nonblocking_remaining*0.03",
  "verdict": "REJECT_V1_THESIS_PIVOT_TO_TRACK_2",
  "decision_rule_hit": ["readiness_below_70", "B1_fundamentally_fails"],
  "per_item_status": {
    "B1": {"state": "unresolved", "weight": 1.00, "note": "backtest not rerun; bible-HIGH still below EW on prior data (+0.25 vs +0.59, 2/5 windows)"},
    "B2": {"state": "resolved_decision_level", "weight": 0.10, "note": "FARTCOIN picked; propagation to SPEC universe pending"},
    "B3": {"state": "resolved_at_decision_level", "weight": 0.25, "note": "Path (c) chosen; SPEC §1 rewrite pending; no fresh L6-6a re-sim"},
    "B4": {"state": "partial_fix", "weight": 0.50, "note": "SPEC honestly updated; Symmetry disable cannot be fixed by us"},
    "B5": {"state": "resolved", "weight": 0.00},
    "N1": {"state": "resolved", "weight": 0.00},
    "N2": {"state": "resolved_with_minor_residual", "weight": 0.20, "note": "SPEC §10 still says 2-3 weeks"},
    "N3": {"state": "partial", "weight": 0.50, "note": "contract written; producer script not yet"},
    "N4": {"state": "unknown", "weight": 1.00},
    "N5": {"state": "not_resolved", "weight": 1.00},
    "N6": {"state": "resolved", "weight": 0.00},
    "N7": {"state": "resolved", "weight": 0.00},
    "N8": {"state": "partial", "weight": 0.50},
    "N9": {"state": "resolved", "weight": 0.00},
    "N10": {"state": "not_resolved", "weight": 1.00},
    "N11": {"state": "resolved", "weight": 0.00},
    "N12": {"state": "not_resolved", "weight": 1.00}
  },
  "pivot_spec": {
    "new_v1": "Track_2 SOL/USDC entry + FDRY fee-discount + FDRY opt-in with loss warning",
    "source": "B3_PATH_DECISION.md",
    "expected_post_cycle3_readiness_pct": [85, 90]
  },
  "confidence": 0.82
}
```
