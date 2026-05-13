# B3 Path Decision — E2E User Loss Scenario

**Run date:** 2026-04-20
**Agent:** Cycle 2 L4 Agent 4c (Luminaries/Signals — architectural decision)
**Parent finding:** Cycle 1 HARNESS_VERDICT.md B3 — $1k FDRY deposit → 30d → withdraw produces −3.56% to −6.76% FDRY loss
**User constraint:** *"Don't need to be profitable for myself, just want FDRY to be used."*

---

## 1. Context recap

- **Pool depth today:** Meteora FDRY/SOL ≈ $80k + $40k bootstrap = **$120k TVL**
- **Breakeven vs HODL-FDRY:** ~32% annualized net strategy return required
- **Backtest optimistic return:** ~20% annualized
- **Creator income lane:** $0/yr (B4 — Symmetry management fees globally disabled)
- **Deposit cap at 2% slippage:** ~$805 today / ~$1,208 post-bootstrap
- **Round-trip cost today:** 356–676 bp on a $1k trade (two FDRY pool hops)

The core issue is not the strategy — it is the **two FDRY pool hops sandwiching the vault**. Fixing anything else still leaves the round-trip cost eating ~300–700 bp of the 1.53% monthly expected alpha.

---

## 2. Path comparison matrix

| Dimension | (a) Grow pool first | (b) Market honestly, $200 cap | (c) Pivot to Track 2 (SOL/USDC + FDRY fee discount) |
|---|---|---|---|
| **Time to launch** | 60–90 days (pool must reach $500k organically or via seed) | 7–10 days (harness remediation only) | 14–21 days (new deposit route, FDRY-hold gating, SPEC rewrite) |
| **Capital required from user** | HIGH — $100k+ LP seed or emission budget to 4× pool | LOW — existing $40k bootstrap sufficient | LOW — existing $40k bootstrap sufficient |
| **Max realistic v1 AUM** | $50k–$200k (post-launch, limited by per-user slippage cap at $500k pool ≈ $5k/user) | $10k–$40k (200 users × $200) | $500k–$2M (pool-unconstrained; cap is keeper/strategy capacity) |
| **Staker outcome @ 20% strategy return** | **+17–18%** net in FDRY terms (2% round-trip) | **+0.8–1.0%/month** marginal positive in FDRY terms; high variance; direct loss if strategy underperforms | **+17–19%** net in USDC terms (1–2% round-trip) |
| **Product-market risk** | **HIGH** — 60–90d "coming soon" decay; competitors ship; pool may not grow organically; requires capital commitment that may never pay off | **MEDIUM** — ships fast but narrow TAM; "experimental, you'll likely lose" framing limits viral spread; keeper gas may exceed strategy alpha at $20k AUM | **LOW** — fits standard Solana vault mental model (deposit stables, earn yield); FDRY becomes a utility perk with clear demand driver |
| **FDRY tokenomics impact** | **STRONGLY POSITIVE** — pool growth itself is buy pressure; FDRY-entry narrative preserved; but requires $100k+ of user capital to realize | **NEUTRAL-POSITIVE** — small FDRY buy flow per deposit; education product creates goodwill; no sell pressure | **MIXED→POSITIVE** — FDRY loses "required entry" narrative BUT gains fee-discount utility, buyback/burn from fee revenue, and optionality to reopen Track 1 once pool deepens organically |

---

## 3. Scoring against the stated constraint

The user's constraint — **"want FDRY to be used"** — is outcome-oriented, not ritual-oriented. It does not require FDRY to be the entry asset; it requires the vault product to succeed and to drive real FDRY demand.

| Path | "FDRY used" score | Reasoning |
|---|---|---|
| (a) | 6/10 conditional, 2/10 unconditional | *If* pool grows to $500k, FDRY is heavily used. *If* it doesn't, product never ships and FDRY is used less than today. All-or-nothing bet. |
| (b) | 3/10 | Technically FDRY is the entry, but at $10–40k total AUM with $200 caps, aggregate FDRY demand is trivial. The product "works" but barely moves the token. |
| (c) | 8/10 | Vault runs at real scale ($500k–$2M AUM). FDRY demand comes from: (i) fee discount holding requirement, (ii) buyback/burn routing of strategy fees, (iii) Track 1 reopens as pool deepens from success. Net FDRY volume moved ≫ (a) or (b) in the realistic case. |

---

## 4. Recommendation

### Pick: **Path (c) — Pivot to Track 2 as v1**, with Path (a) as a natural v2 consequence

Specifically: ship **SOL/USDC deposit** as the primary path, with **FDRY-hold-gated fee discount** as the utility hook, and **FDRY-entry retained as opt-in "ideological" mode** with explicit loss warning until pool depth passes $500k organically.

### Rationale

1. **It is the only path where the product actually works at real scale.** Paths (a) and (b) either delay indefinitely or ship a product that is operationally unviable (keeper gas ≥ alpha at $20k AUM). Path (c) ships a vault that can hold $500k–$2M with stakers winning at realistic strategy returns.

2. **It satisfies the user's explicit constraint better than (a) or (b).** A successful vault routing fees into FDRY buyback-and-burn creates more FDRY demand over 6 months than a tiny experimental $200-cap vault (path b) or a vault that never launches (path a risk case).

3. **It converts (c) into (a) over time without the capital risk.** Every fee dollar from the SOL/USDC vault can be routed to the FDRY/SOL pool as buyback LP. Organic pool growth happens *because* the product succeeded, not as a precondition. When the pool crosses $500k depth organically, Track 1 FDRY-entry reopens with no additional engineering.

4. **It preserves the FDRY-entry narrative as an opt-in expression of belief.** The harness B3 analysis explicitly recommended "(c) but retain FDRY-entry as opt-in for ideologically-motivated stakers with explicit loss warning." This honors the original vision without inflicting it on everyone.

5. **Reversibility:** if 4–6 weeks post-launch the SOL/USDC entry is ignored and the FDRY-entry opt-in is dominant, we learn the market prefers ritual over economics, and we can flip the default back.

### What this explicitly trades away

- **The "FDRY is the entry to alpha" positioning for v1.** This is a real narrative loss. Accepted because the alternative (shipping a product where stakers lose money) is a worse narrative loss.
- **~14–21 days vs (b)'s 7–10 days.** Accepted because (b)'s AUM ceiling ($10–40k) makes the product operationally non-viable.

---

## 5. Implementation sketch

### Scope delta vs current SPEC

**SPEC §1 (Product):** rewrite positioning to "Solana quant-alpha vault; FDRY holders get fee discount + future Track 1 entry rights."

**SPEC §5 (Deposit Flow):** replace single FDRY-entry flow with two-mode flow:
- **Mode A (default): SOL/USDC entry.** User deposits SOL or USDC. Jupiter route → vault basket tokens via Symmetry `buyVaultTx`. One hop, ~50–150 bp cost.
- **Mode B (opt-in): FDRY entry.** User deposits FDRY. Two-hop: FDRY → SOL (Meteora) → basket (Jupiter + Symmetry). Explicit modal: *"Capital at risk: depositing FDRY currently costs ~4–7% round-trip due to pool depth. You may receive fewer FDRY back than deposited. Continue?"* Hard block if round-trip cost > 8%.

**SPEC §6 (Withdrawal Flow):** mirror symmetry — user picks withdrawal asset (SOL/USDC/FDRY). FDRY path inherits same warning.

**SPEC §8 (Fees):** new fee hook:
- Base performance fee: X% on positive PnL (enforced at withdrawal via NAV delta).
- **FDRY-hold discount:** holding ≥ N FDRY in the connected wallet reduces performance fee by K% (verified at withdrawal time via on-chain balance read). Creates a non-custodial demand driver — user does NOT stake FDRY, they only need to hold it.
- Fee routing: Z% of collected fees → FDRY/SOL pool buyback-and-burn executed weekly via keeper.

**Frontend changes:**
- Deposit page: asset picker (SOL / USDC / FDRY-opt-in). Default SOL.
- FDRY-hold tier badge on wallet connect ("Tier 0 / Tier 1 — 10% fee discount / Tier 2 — 25% fee discount").
- Withdrawal page: asset picker symmetrical.
- `/vault` route: NAV ledger + weekly buyback dashboard (covers non-blocking N8).

**Bot/Keeper changes:**
- New weekly job: read accumulated fees, execute FDRY buyback via Jupiter, burn or LP-deposit.
- No changes to signal pipeline.

### Phase ordering (adds to SHIP.md Phase 0-1)

1. **Day 0–2:** SPEC §1/§5/§6/§8 rewrite. SYMMETRY.md fee table updated.
2. **Day 2–5:** frontend deposit/withdraw asset picker + FDRY-tier badge.
3. **Day 5–9:** buyback keeper job + NAV ledger route.
4. **Day 9–12:** e2e devnet test under all three entry modes.
5. **Day 12–14:** mainnet deploy with deposit caps ($1k SOL/USDC, $200 FDRY-opt-in).
6. **Day 14–28:** 14-day clean-operation gate (unchanged from SHIP.md Phase 4).

**Total:** 14–21 days engineering + 14 days clean-op observation = **28–35 days to full public launch**. Matches the 4–5 week realistic timeline from N2.

### Metrics to watch post-launch

- SOL/USDC entry AUM vs FDRY-opt-in AUM ratio. If FDRY-opt-in > 30% despite the warning, Track 1 intent is real and worth re-engineering for.
- Weekly FDRY buyback volume vs Meteora pool depth. When weekly buyback ≥ 1% of pool, pool growth accelerates and Track 1 economics improve passively.
- Pool depth crossing $500k → trigger for SPEC v2 to make FDRY-entry the default again.

---

## 6. Hypothesis block (JSON)

```json
{
  "agent": "C2-L4-4c",
  "dimension": "luminaries_signals",
  "question": "Which of (a) grow-pool / (b) honest-experimental-cap / (c) pivot-Track-2 resolves B3 best under the user constraint 'FDRY to be used, not personal profit'?",
  "hypothesis": "Path (c) pivot-to-Track-2 with FDRY-entry as opt-in and fee-discount-on-FDRY-hold maximizes FDRY usage over a 6-month horizon while minimizing product-market and capital risk. It converts naturally into Path (a) as the buyback flywheel deepens the FDRY/SOL pool without pre-launch capital commitment.",
  "verdict": "RECOMMEND_PATH_C",
  "confidence": 0.78,
  "path_scores": {
    "a_grow_pool": {
      "time_to_launch_days": [60, 90],
      "user_capital_required_usd": [100000, 250000],
      "max_v1_aum_usd": [50000, 200000],
      "staker_net_at_20pct_return": "+17-18% FDRY",
      "pmf_risk": "high",
      "fdry_usage_score_0_10": 4,
      "tokenomics_impact": "strongly_positive_conditional_on_pool_growth_happening"
    },
    "b_honest_200_cap": {
      "time_to_launch_days": [7, 10],
      "user_capital_required_usd": [40000, 40000],
      "max_v1_aum_usd": [10000, 40000],
      "staker_net_at_20pct_return": "+0.5-1.0%/month FDRY, high variance",
      "pmf_risk": "medium",
      "fdry_usage_score_0_10": 3,
      "tokenomics_impact": "neutral_positive_but_trivially_small"
    },
    "c_track_2_pivot": {
      "time_to_launch_days": [14, 21],
      "user_capital_required_usd": [40000, 40000],
      "max_v1_aum_usd": [500000, 2000000],
      "staker_net_at_20pct_return": "+17-19% USDC",
      "pmf_risk": "low",
      "fdry_usage_score_0_10": 8,
      "tokenomics_impact": "mixed_to_positive_fee_discount_plus_buyback_flywheel"
    }
  },
  "decision_key_factors": [
    "user_constraint_is_outcome_oriented_not_ritual_oriented",
    "path_a_indefinite_delay_risk",
    "path_b_operationally_unviable_at_20k_AUM",
    "path_c_converts_to_path_a_via_buyback_without_capital_precommit",
    "fdry_opt_in_retains_narrative_as_reversibility_option"
  ],
  "reversibility": "high — if SOL/USDC entry is ignored and FDRY-opt-in dominates, flip default back in SPEC v2",
  "follow_up_checks": [
    "confirm_jupiter_USDC_to_basket_routing_clean_at_100k_trade",
    "verify_symmetry_SDK_supports_multi_asset_buyVaultTx_contributions",
    "model_fdry_hold_tier_threshold_so_it_drives_demand_without_gating_out_small_users",
    "on-chain balance read pattern for hold-tier verification at withdrawal time"
  ]
}
```

---

## 7. Open questions for follow-on agents

- **Fee-discount tier calibration:** what FDRY-hold threshold is meaningful without gating out small users? (Probably tiers at $50 / $250 / $1000 FDRY value.)
- **Buyback routing:** direct burn vs LP-deposit vs marketing treasury — which maximizes pool depth growth vs price?
- **Keeper job security:** weekly buyback job needs a dedicated wallet separate from HOT and CREATOR (see B5 rotation runbook).
- **Track 1 reopen threshold:** $500k pool depth is the engineering threshold; what is the *marketing* threshold for reopening FDRY-entry as default?

---

**Decision status:** RECOMMENDED. Awaiting user confirmation before propagating changes into SPEC §1/§5/§6/§8 and SHIP.md Phase 0–1.
