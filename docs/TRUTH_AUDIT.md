# TRUTH_AUDIT.md — Staker-Facing Honesty Audit

**Author:** C7 L1 (Light dimension)
**Date:** 2026-04-20
**Ethic:** truth over comfort, protect the flock.

Compared every staker-facing claim in `README.md`, `SHIP_NOW.md`, `RUNBOOK.md`, and `docs/*` against current code state (FINAL_READINESS §2 — ships as EW, confidence 0.3; FINAL_READINESS §4 "EW fallback means shipped product != pitched 'quant alpha'"; HARNESS_VERDICT B1 — bible-HIGH loses to EW) and known ground truth (treasury holds SOL; routers not built; FDRY not locked).

A researcher who reads the repo top-down for 60 seconds finds the contradictions below before they touch a deposit button.

---

## HIGH severity (fix before any staker sees the page)

### H1. "FDRY Quant Alpha Vault" naming across README.md §title, SPEC.md §1, docs/README.md §title
- **Claim:** product is a "quant alpha" vault.
- **Reality:** FINAL_READINESS §2 + §4 — "Vault ships as EW rebalancer (honest posture)", confidence 0.3 triggers EW override, bible-HIGH mean Sharpe −0.05 vs EW +0.27.
- **Replacement:** "FDRY Treasury — EW-baseline Solana vault with public ledger." Move "quant alpha" to a roadmap item contingent on live evidence flipping confidence ≥ 0.5.
- **Severity:** HIGH. The word "alpha" is a falsifiable claim the backtest already falsified.

### H2. README.md §1 L10: "daily-rebalance, FDRY-entry quant rotation vault"
- **Claim:** FDRY-entry, quant rotation.
- **Reality:** SHIP_NOW.md §Step 6 seeds $10k of **SOL** from CREATOR_WALLET. VAULT_V1_SHIP_PLAN §1 "Holds: SOL only (v1)". No FDRY-entry wrapper is live. No rotation — it is single-asset SOL.
- **Replacement:** "single-asset SOL treasury vault; FDRY is not deposited, held, or locked by this product."
- **Severity:** HIGH.

### H3. README.md §1 L17 / SPEC §1: "Accepts FDRY… pays out FDRY on exit"
- **Claim:** deposit/withdraw in FDRY.
- **Reality:** No deposit UI ships today (frontend scaffolding only). Only operator seed path exists. Round-trip cost per HARNESS_VERDICT B3 is −3.56% to −6.76%.
- **Replacement:** "v1 accepts SOL only. FDRY round-trip entry is disabled pending pool depth >$500k." Or delete the claim.
- **Severity:** HIGH.

### H4. docs/README.md §"Key facts" L18: "Cadence: Daily rebalance, driven by bible-EBM signal"
- **Claim:** bible-EBM driven.
- **Reality:** `runs/daily_signal/latest.json` ships with `ranker=equal_weight`; bot overrides to EW because confidence 0.3 < 0.5 gate; universe is single-asset SOL so there is nothing to rebalance.
- **Replacement:** "v1 is static 100% SOL. No rebalancing. Multi-asset rotation with EW baseline is a roadmap item; bible-EBM is a style prior/tiebreaker, not a forecaster."
- **Severity:** HIGH.

### H5. SPEC.md §1 tagline: "Stake FDRY, earn quant-strategy returns on liquid tokens."
- **Claim:** stake FDRY, earn quant returns.
- **Reality:** (a) no staking — Symmetry `buyVaultTx` is a deposit, not a stake with lockup; (b) no FDRY is deposited in v1; (c) "quant returns" contradicts FINAL_READINESS §3 (strategy score 50%, EW fallback).
- **Replacement:** "Deposit SOL into a public treasury; share NAV pro-rata via stFDRY. No yield promise."
- **Severity:** HIGH. Every word in the tagline is currently false.

### H6. VAULT_V1_SHIP_PLAN §5 POST draft: "a % of revenue routes to this treasury as buybacks"
- **Claim:** Unbrowse revenue routes into the vault.
- **Reality:** No router code exists in `scripts/` or `bot/`. USER_DECISION_MEMO + SHIP_ORDER_C3 confirm Unbrowse monetization is "2-4 weeks out". No on-chain route from any product into this vault exists today.
- **Replacement:** "A revenue-routing mechanism is designed but NOT built. Zero inflows from any product as of ship date. See ledger — if the revenue line is $0, that is because it is actually $0."
- **Severity:** HIGH. Shipping POST 1 with this phrasing before the router exists is the "shares profits from all our products" overclaim the task brief names.

### H7. TELEGRAM_DRAFTS POST 1 L15: "the basket is 7 tokens with a daily rebalance"
- **Claim:** 7-token daily-rebalance basket at launch.
- **Reality:** FINAL_READINESS §1 — createVault and oracles use 6 tokens `[SOL,WIF,BONK,POPCAT,FLOKI,JTO]`; AND VAULT_V1_SHIP_PLAN §1 says v1 is single-asset SOL. The Telegram draft contradicts both internal specs.
- **Replacement:** reconcile first. If shipping single-SOL treasury (VAULT_V1_SHIP_PLAN path), rewrite POST 1: "holdings: SOL only at v1. multi-asset rotation is a roadmap item once ledger has 14 days of clean history." If shipping 6-token rotation (scripts/createVault.ts path), fix the "7 tokens" number.
- **Severity:** HIGH. Post 1 is the first thing 1000s of people read.

---

## MEDIUM severity

### M1. README.md §8 L161: "Creator fees currently accrue to $0"
- Honest today. Keep. Flag: ensure the same language appears in SPEC.md §4 fee table (it does, at L92).
- **Severity:** LOW (already correctly disclosed — cite as the template for other fixes).

### M2. README.md §2 L24: "Fib-harness cycles run: 4 (C1 through C4)"
- **Reality:** FINAL_READINESS is a C6 artifact; SHIP_ORDER_C3 is C3; C7 L1 (this audit) is running now. Actual cycles run = 7.
- **Replacement:** "Fib-harness cycles run: 7 (C1 through C7)." Or drop the count.
- **Severity:** MED.

### M3. README.md §2 L28: "Current ship-readiness: last full verdict is HOLD at 62% from Cycle 1"
- **Reality:** FINAL_READINESS.md verdict = PROMOTE (conditional) at 82.75%, with the single remaining blocker being strategy-vs-pitch gap. README cites a verdict that is three cycles stale and worse than current truth — but the replacement is not "we got better," it's "readiness rose, but the remaining blocker is exactly the alpha claim, which stayed falsified."
- **Replacement:** "Ship-readiness 82.75% (Cycle 6). Single remaining blocker is product-positioning: vault ships as equal-weight baseline, not the originally-pitched 'quant alpha'. Strategy calibration awaits live evidence."
- **Severity:** MED.

### M4. SHIP_NOW.md §Step 8 "Publish ledger to GitHub Pages"
- Implies the public ledger is live-on-ship. Reality — ledger/ directory contains a first snapshot but no GitHub Pages DNS is wired. Followers who click the link in POST 1 may hit 404.
- **Replacement:** add an explicit pre-check: "Before POST 1, verify `https://lekt9.github.io/fdry/ledger/` returns 200 and renders today's JSON."
- **Severity:** MED.

### M5. RUNBOOK.md §Monthly L18: "Review Unbrowse monetization progress"
- Presumes Unbrowse monetization exists as a thing to "review." Nothing has been shipped.
- **Replacement:** "Until Unbrowse monetization ships, this line is aspirational. Replace with 'Note whether any product revenue routed this month — default is $0.'"
- **Severity:** MED.

### M6. docs/README.md §"Non-goals" L25: "Lock FDRY — this architecture cycles FDRY, does not lock it"
- Honest and correct. Keep. Promote this sentence to the front of README.md §8.
- **Severity:** LOW (use as template).

### M7. SPEC.md §3 L67: "Marketing must say 'stake FDRY, earn quant returns' — NOT 'FDRY is locked.'"
- Internal instruction is partially right (the "not locked" half) but authorizes the "stake FDRY, earn quant returns" line which H5 just invalidated.
- **Replacement:** "Marketing must NOT say 'FDRY is locked' AND must NOT say 'earn quant returns'. v1 is a SOL treasury with public ledger. Strategy claims are roadmap, not present tense."
- **Severity:** MED.

---

## LOW severity (cosmetic / internal-docs)

### L1. README.md §3 L41-L54 — four-layer architecture
- Implies L3 Bot + L4 Ledger + Frontend all exist as deployed services. Only `ledger/snapshot.ts` + scaffolding are present. Bot is a dry-runnable `bot/src/main.ts` but not deployed to Railway in SHIP_NOW (Step 9 is marked "skip if launching treasury-only today").
- **Replacement:** tag components with current status: "(scaffolded, not deployed)" / "(live)" / "(design only)".
- **Severity:** LOW (internal consistency, not a direct staker harm).

### L2. CYCLE2_READINESS / CONSISTENCY_CHECK referenced by README §9
- Per USER_DECISION_MEMO: "CYCLE2_READINESS.md and CONSISTENCY_CHECK.md were never written." CONSISTENCY_CHECK does exist (we read it). CYCLE2_READINESS does not appear in the `ls` listing.
- **Replacement:** if CYCLE2_READINESS is missing, remove the reference or write the file.
- **Severity:** LOW.

### L3. RUNBOOK.md §Weekly "Rotate HOT_WALLET key (if desired)"
- Weekly rotation is over-scoped vs SPEC §4.1 "quarterly + on-suspicion". Minor internal drift.
- **Severity:** LOW.

---

## The "60-second researcher" failure modes

A skeptic scanning the repo finds the following in under a minute:

1. **README.md says "FDRY-entry quant rotation vault" but SHIP_NOW.md Step 6 seeds SOL and VAULT_V1_SHIP_PLAN.md says "Holds: SOL only (v1)".** (H2/H3)
2. **README.md §8 L143 discloses "equal-weight beats bible-HIGH" but the repo title and docs/README.md §title call it "Quant Alpha Vault".** (H1)
3. **TELEGRAM_DRAFTS POST 1 says "7 tokens daily rebalance" while the vault code registers 6 tokens and the ship plan says single-SOL.** (H7)
4. **VAULT_V1_SHIP_PLAN POST 1 and POST 3 promise Unbrowse revenue routing — no router exists in the codebase.** (H6)
5. **SPEC §1 tagline "Stake FDRY, earn quant returns"** — neither half is true under v1 code. (H5)

Any one of these lands on CT in a quote-tweet as "they named it Quant Alpha but ship an equal-weight single-SOL holding vault."

---

## Recommended fix order

1. Pick one v1 scope — single-SOL treasury (VAULT_V1_SHIP_PLAN) OR 6-token EW rotation (scripts/createVault.ts). Both cannot be "shipping today." Ratify in one decision memo, propagate to all five public-facing files (README, SHIP_NOW, RUNBOOK, docs/README, TELEGRAM_DRAFTS).
2. Delete the word "alpha" from every title and tagline until live evidence flips strategy calibration ≥ 0.5. Replace with "treasury" or "baseline vault."
3. Gate all "shares product revenue" language behind the router actually existing. Until then: "revenue-routing is a roadmap item. Current inflow from any product: $0."
4. Fix H5 (SPEC tagline) and H7 (POST 1) before the Telegram send. Both are the last thing stakers see before depositing.
5. Reconcile universe (6 vs 7 vs 8 tokens) everywhere — already flagged in CONSISTENCY_CHECK H-1 but not applied to the drafts.

---

## JSON return block

```json
{
  "H1_every_claim_supported_by_code": "fail",
  "H2_no_researcher_falsifiable_claim_remains": "fail",
  "H3_audit_doc_with_specific_fixes": "pass",
  "high_severity_count": 7,
  "med_severity_count": 7,
  "low_severity_count": 3,
  "single_most_damaging_overclaim": "H1 — product is titled 'Quant Alpha Vault' while the code ships as equal-weight / single-SOL. The name falsifies itself.",
  "must_fix_before_post1": ["H1","H2","H3","H5","H6","H7"]
}
```

— end audit —
