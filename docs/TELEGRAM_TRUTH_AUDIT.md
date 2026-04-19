# TELEGRAM_TRUTH_AUDIT (C7 L4-4c)

Audit of `docs/TELEGRAM_DRAFTS.md` vs actual repo state as of 2026-04-20.

## Repo state snapshot (ground truth)
- `docs/vault.json` → `vault_pubkey: 11111111111111111111111111111111`, `network: devnet`, `created_ts: placeholder` → **vault NOT yet created on mainnet**.
- `ledger/latest.json` → `nav_sol: 0`, `nav_usd: 0`, `depositors: 0`, holdings empty, placeholder pubkey → **seed NOT yet run**.
- No git repo at project root (`Is directory a git repo: No`) → **GitHub Pages NOT yet deployed**; `https://lekt9.github.io/fdry/ledger/` resolves to nothing today.
- `scripts/seed.ts`, `scripts/createVault.ts` exist but have not been executed on mainnet.

## POST 1 — claim classification
| Claim | Type | Verifiable? |
|---|---|---|
| "vault is live on symmetry" | FACT | Only after `createVault.ts` mainnet run — NOT TRUE NOW. |
| "seeded with roughly $10k of sol" | FACT | Only after `seed.ts` runs — NOT TRUE NOW. |
| "no external deposits yet … won't be for 14 days" | COMMITMENT | Operator promise. Fine. |
| "basket is 7 tokens" | FACT-MISALIGNED | `createVault.ts` universe is **6 tokens** (SOL, WIF, BONK, POPCAT, FLOKI, JTO). **MISMATCH — reword to "6 tokens" or update universe.** |
| "daily rebalance" | FACT | Matches bot cron in SHIP.md §3.2. |
| "bible-HIGH ranker … confidence-gated tiebreaker" | FACT | Matches `docs/SIGNAL_CONTRACT.md` + `bot/src/signal.ts`. |
| "public ledger: lekt9.github.io/fdry/ledger/" | FACT | Depends on SHIP_NOW step 8 (git push + Pages). Conditional. |
| "solscan: [SYMMETRY_VAULT_PUBKEY_HERE]" | FACT | Placeholder — must be filled post-createVault. |

**H1 verdict:** POST 1 FACT claims WILL be true at posting time **only if** SHIP_NOW steps 3-8 have completed AND the "7 tokens" claim is corrected to "6 tokens". Current draft has one hard factual error (basket size).

## POST 2 — AI/RLHF clarification accuracy
- "ranker is consistency-gated through an energy model" → consistent with bible-EBM references in `docs/SIGNAL_PIPELINE_PATCH.md`, `HARNESS_VERDICT.md`, `CONSISTENCY_CHECK.md`. FACT.
- "falls back to EW when gate doesn't fire" → matches SPEC/BOT_SPEC fail-closed posture. FACT.
- "removed human labeling from the narrated-outcome ranker task specifically" → no direct code artefact in this repo (producer lives in `/Users/lekt9/Projects/unify/.fib-harness-v2.4/`, per SIGNAL_CONTRACT.md §1). Unverifiable from fdry repo alone but the claim is narrowly scoped and self-limiting ("one task … does not generalize"). Properly hedged.
- "bible-HIGH beats EW on confidence-gated subset … underperforms or matches on ungated tail" → matches `runs/spec_final_backtest/result.json` structure. FACT.

**H2 verdict:** POST 2 accurately describes current AI/RLHF work, with appropriate retractions and scope-narrowing. No misclassifications.

## POST 3 and POST 4 — forward-looking framing
- POST 3: header tags it "ship in 2-3 weeks, when first Unbrowse payment clears" → trigger-gated. Body reads in past tense ("just hit the vault") but only sends AFTER the event — correct pattern.
- POST 4: header tags it "ship in 3-4 weeks, the day the M3 lock contract finishes audit" → trigger-gated. Body says "m3 lock program is live" — again only sent post-event.
- Both posts include non-promise hedges: "cap exists because I'd rather grow slow", "buyback is not a promise of price, it is a mechanism".

**H3 verdict:** POST 3 and POST 4 are properly marked as forward-looking via explicit trigger conditions in headers. Body copy is event-conditional and hedged. No premature FACT claims.

## Required fixes before POST 1 sends
1. Change "7 tokens" → "6 tokens" (or expand universe in `createVault.ts`).
2. Run SHIP_NOW steps 3-8 (createVault, seed, snapshot, git push, Pages enable).
3. Replace `[SYMMETRY_VAULT_PUBKEY_HERE]` with real pubkey from `docs/vault.json`.
4. Verify `https://lekt9.github.io/fdry/ledger/` returns 200 before sending.

## JSON result
```json
{
  "H1": "CONDITIONAL-PASS: true if SHIP_NOW steps 3-8 complete AND '7 tokens' is corrected to '6 tokens'; one hard factual error (basket size) present in current draft",
  "H2": "PASS: POST 2 accurately describes current AI/RLHF state with properly narrowed claims",
  "H3": "PASS: POST 3 and POST 4 are trigger-gated in headers and hedged in body"
}
```
