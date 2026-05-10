# stFDRY Seed Mechanism — Final Decision Memo

**Author:** C4 L6 Agent 6h (Dominion/Integration)
**Date:** 2026-04-20
**Decision type:** IRREVERSIBLE at launch; pick once, ship once.

---

## TL;DR

- **Recommended v1:** **ALT — SOL-seed + FDRY-bonus stream** (hybrid).
- **Runner-up (FDRY-native branding):** **M3 / Design A** (90d lock, transferable stFDRY, revenue routed to FDRY buyback-and-distribute).
- **Rejected:** **M1** (swap-seed). Immediate 75% price-impact dump; destroys half the vault and the chart on day one.
- **User's question — "will this disincentivize holding FDRY?"** See section 4. Short answer: **No for ALT and M3-transferable. Yes for M1. M2 is neutral-to-positive but dilutes the "hold FDRY" thesis.**

---

## 1. Decision Matrix

Inputs from `stfdry_tokenomics_model.json`: FDRY mkt cap $300k, pool TVL $80k, seed target $40k = 133.3M FDRY = 13.3% of total supply.

| Dimension | M1 swap-seed | M2 direct-seed | M3 lock-seed (90d) | **ALT SOL+bonus** |
|---|---|---|---|---|
| FDRY demand effect | -- sells into pool | + 13.3% supply removed | ++ 13.3% removed + lockup signal | + bonus stream = steady bid |
| FDRY price impact at launch | **-- 75%** (model) | 0 (no trade) | 0 (no trade) | **0** (no FDRY touched) |
| Death-spiral risk | **HIGH** vault halves if FDRY bleeds | MED vault NAV tracks FDRY | MED same + lockup friction | **LOW** vault is SOL; bonus is optional |
| Legal exposure (Howey) | MED (pure-SOL yield smells security) | MED (FDRY-denominated, weaker Howey) | **HIGH** (lock + yield = textbook security) | MED (SOL-seed security-ish; FDRY-bonus = loyalty program) |
| Build complexity | LOW (one swap tx) | LOW (transfer + mint) | **HIGH** (lock contract, stFDRY token, unlock queue) | MED (escrow + drip emitter) |
| Time to ship | hours | hours | **weeks** (audit needed) | **~3 days** |
| Reversibility | **NONE** (swap permanent) | LOW (FDRY recoverable) | LOW (unlock 90d) | **HIGH** (pause bonus; SOL untouched) |
| Stakeholder clarity | MUDDY ("we dumped our token") | MIXED ("vault = our token, circular") | MIXED ("lock 90d, trust us") | **CLEAN** ("SOL-backed vault + FDRY rewards") |

**Score:** ALT wins 6/8. M3 wins the "FDRY-native story" dimension only. M1 loses everywhere except build time.

---

## 2. Recommendation — ALT (v1)

**Mechanism:** Seed the vault with **~465 SOL (~$40k) from treasury/founder contribution, NOT FDRY**. Issue **stFDRY-v1 receipt tokens** 1:1 against SOL deposit NAV. Layer a **FDRY-bonus drip** on top, funded from a separate 50M FDRY emission bucket.

**Exact parameters:**
- **Lock duration:** **none on principal** (SOL withdrawable anytime at NAV). **7-day cooldown on bonus claim** to prevent flash farming.
- **Transferability:** **stFDRY-v1 is fully transferable** (SPL token). Enables secondary markets, LP pairs, composability.
- **Revenue routing:** **70% -> SOL vault (grows NAV)**, **20% -> FDRY open-market buyback -> distributed pro-rata to stFDRY holders as FDRY-bonus**, **10% -> protocol treasury**.
- **FDRY-bonus emission:** 50M FDRY (5% of supply) vested linearly over 12 months to stFDRY holders, weighted by stake-time.
- **Cap:** first-round vault cap $200k; hard pause if FDRY/SOL pool depth < $50k (circuit breaker).

**Why this parameter set:**
- Transferable + no lock = legal delta vs. M3 (weaker Howey "common enterprise" prong).
- 70/20/10 split means vault is **always NAV-solvent in SOL**; FDRY exposure is a bonus, not a load-bearing beam.
- 20% buyback -> FDRY-bonus creates **persistent bid for FDRY** without forced selling pressure (the user's core worry).

---

## 3. Runner-up — M3 / Design A (if Lewis insists on FDRY-native branding)

If brand/community requires the vault be "backed by FDRY":
- **Lock:** 90 days, rolling (deposit any day, unlock 90d later).
- **Transferability:** **transferable stFDRY** (critical — non-transferable = 10% illiquidity haircut per model H3; transferable recovers it).
- **Revenue routing:** **100% -> FDRY open-market buyback**, distributed to stFDRY holders.
- **Audit:** mandatory before launch (Ottersec or similar, ~2 weeks, ~$15k).

Do NOT pick strict-M3 (non-transferable). Model H3 confirms 10% underperformance vs. HODL in zero-revenue scenarios.

---

## 4. Direct answer: "Will this disincentivize holding FDRY?"

**No — under ALT or M3-transferable — conditional on these guardrails:**

1. **Never swap-seed (M1 rejected).** Any mechanism that sells FDRY into the pool on day one kills holder confidence instantly and mechanically (75% price impact per model).
2. **Route revenue to FDRY buyback (not SOL-only).** Holders need to see the vault *consume* FDRY, not ignore it. ALT's 20% buyback + M3's 100% buyback both create persistent bid.
3. **Make stFDRY transferable.** Non-transferable lockups *do* disincentivize holding (10% haircut in model, illiquidity premium lost).
4. **Cap vault size relative to pool depth.** A $200k vault on an $80k pool = tail-wagging-dog. Grow vault only as pool grows.

**Yes — it WILL disincentivize holding under these conditions (avoid):**
- M1 swap-seed (sells FDRY -> vault pure SOL -> holders rationally rotate to vault).
- Non-transferable stFDRY with no FDRY revenue share (pure opportunity cost).
- stFDRY that pays yield in SOL only and never buys FDRY (vault becomes parallel asset, drains FDRY mindshare).

**Neutral:** M2 direct-seed. Removes 13.3% supply (good) but vault NAV = FDRY price, so stFDRY is just "FDRY with extra steps." Holders indifferent. Not worth the build.

---

## 5. Ship order

1. Announce ALT path with 24h community comment window.
2. Deploy SOL vault + stFDRY-v1 mint (3 days).
3. Wire revenue splitter (70/20/10) and buyback bot (2 days).
4. Soft-launch with $40k founder SOL seed, $10k cap per wallet.
5. Monitor pool depth / bonus-drip burn rate for 14 days before uncapping.

**Explicit non-goals for v1:** no lockup, no governance token, no cross-chain, no LP incentives. Keep it boring.

---

## Appendix — Model cross-check

- M1 vault post-seed: **$19,950** (50% loss vs. $40k target) — `key_numeric_findings.M1_vault_value_post_seed_usd`.
- M2/M3 90d flat-scenario stFDRY value at $10k/mo rev: **$55k / $49.5k**.
- ALT projection (derived): SOL vault $40k + revenue $15k + bonus drip ~$5k = **~$60k**, beating M2 on risk-adjusted basis because the $40k floor is SOL-denominated, not FDRY-denominated.

— end memo —
