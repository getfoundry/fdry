# Cross-Doc Consistency Check — Cycle 2 L6 Agent 6e

**Run date:** 2026-04-20
**Agent:** Cycle 2 L6 Agent 6e (Dominion / Integration — cross-consistency across docs)
**Primitive:** hybrid
**Scope:** every file in `/Users/lekt9/Projects/fdry/docs/` after Cycle 2 L5 edits (5a SPEC, 5b SIGNAL_CONTRACT, 5c SHIP, 5d SYMMETRY) have landed.

---

## 1. Docs reviewed

| File | Role |
|---|---|
| `README.md` | Landing-page summary + key facts |
| `SPEC.md` | Full product spec (universe, fees, SDK flows) |
| `SHIP.md` | Phase-by-phase ship checklist + timeline |
| `SYMMETRY.md` | Symmetry protocol reference (SDK, roles, fees) |
| `SIGNAL_CONTRACT.md` | Signal JSON schema + producer contract |
| `BOT_SPEC.md` | Bot implementation spec |
| `HARNESS_VERDICT.md` | Cycle 1 verdict (reference; not supposed to be edited) |
| `B3_PATH_DECISION.md` | Cycle 2 L4-4c Track-2 pivot recommendation |
| `pepe_replacement.md` | Cycle 2 L3-3b FARTCOIN decision memo |
| `oracles.json` | Pyth feed IDs for the universe |
| `pool.json`, `slippage.json`, `backtest_final.json`, `symmetry_global_config.json`, `REMEDIATION_DAG.md`, `REMEDIATION_INVENTORY.json` | Supporting artifacts (spot-checked) |

---

## 2. Contradictions found

Ranked from most to least severe. Each item cites exact file + line / passage.

### HIGH severity

#### H-1. Universe composition is inconsistent across FOUR docs

The "8-token universe" has at least **three** different definitions in live docs after Cycle 2 edits:

| Doc | Location | Universe listed |
|---|---|---|
| `SPEC.md` | §2 Decision Log L28, §4 L77, §7 L235 | `[SOL, WIF, BONK, PEPE, POPCAT, DOGE, FLOKI, JTO]` |
| `SHIP.md` | §0.1 L25-L32, §0.3 L49 | `[SOL, WIF, BONK, PEPE, POPCAT, DOGE, FLOKI, JTO]` |
| `oracles.json` | `_meta.universe` L6 | `[SOL, WIF, BONK, FARTCOIN, POPCAT, DOGE, FLOKI, JTO]` |
| `pepe_replacement.md` | decision section | PEPE → FARTCOIN |
| `SIGNAL_CONTRACT.md` | §3 L48, §7 L148 | `[SOL, WIF, JTO, BONK, PYTH, JUP, ORCA, RAY]` (completely different set — 4 tokens not present anywhere else) |

Severity rationale: this is the product's traded universe. SPEC still names PEPE after the L3-3b decision explicitly replaced it with FARTCOIN. SIGNAL_CONTRACT ships a *third* universe (PYTH/JUP/ORCA/RAY) that appears in no other doc — it has no oracle entries in `oracles.json`, no backtest coverage, no mention in SHIP.md §0.1, and no replacement memo justifying it. Any attempt to deploy this vault will fail at Phase 0.1 (oracle verification for PYTH/JUP/ORCA/RAY is not on file) or Phase 3 (bot reads a signal whose universe does not match the vault's on-chain token list).

Recommendation:
1. Pick one canonical universe. Per the actual Cycle 2 L3-3b decision memo and `oracles.json`, that is `[SOL, WIF, BONK, FARTCOIN, POPCAT, DOGE, FLOKI, JTO]`.
2. Propagate to SPEC §2, §4, §7; SHIP.md §0.1; SIGNAL_CONTRACT.md §3 schema sample + §7 reference implementation `UNIVERSE` list.
3. If SIGNAL_CONTRACT's `[SOL, WIF, JTO, BONK, PYTH, JUP, ORCA, RAY]` was a deliberate late change by a different agent, a decision memo on par with `pepe_replacement.md` must be written, oracles.json updated, and SPEC/SHIP brought into line before anything else proceeds.

#### H-2. HOT wallet authority bitmask conflicts between SPEC and SHIP and SYMMETRY

`SPEC.md` §4 L80 and L97 were edited in Cycle 2 to restrict HOT to `UPDATE_WEIGHTS` only:

> `manager authority: UPDATE_WEIGHTS // TRIGGER_REBALANCE reserved for CREATOR break-glass`
> `HOT_WALLET — bot's signing key. Has UPDATE_WEIGHTS only (narrow bitmask; TRIGGER_REBALANCE is reserved for CREATOR break-glass).`

But:
- `SHIP.md` §1.2 L72 still says: `Assign HOT_WALLET as manager with UPDATE_WEIGHTS + TRIGGER_REBALANCE authority bitmask`
- `SYMMETRY.md` §Roles L71 still says: `Managers ... Our HOT_WALLET with UPDATE_WEIGHTS + TRIGGER_REBALANCE.`

Severity rationale: this is the deployment-time authority bitmask. If the operator follows SHIP.md they will provision a HOT key with `TRIGGER_REBALANCE` — exactly the scope HARNESS_VERDICT.md N9 flagged as overscoped and that SPEC was explicitly narrowed to avoid. This directly undoes the B5/N9 remediation.

Recommendation: update `SHIP.md` §1.2 L72 and `SYMMETRY.md` §Roles L71 to `UPDATE_WEIGHTS` only. Cross-reference SPEC §4.1 rotation runbook.

### MEDIUM severity

#### M-1. Fee status is the "$0 today" reality in SPEC + SYMMETRY + HARNESS_VERDICT but NOT in README

`SPEC.md` L92 and §8 L255-L264 both mark creator fee as `disabled — $0 today / activates if/when Symmetry enables`. `SYMMETRY.md` fee table L104-L111 has identical framing. `HARNESS_VERDICT.md` B4 and `B3_PATH_DECISION.md` §1 both cite `$0/yr` as baseline.

`README.md` L19 still says:

> **Fee:** 2% annual creator fee

and `README.md` L26:

> Generate meaningful fee income — $400/year expected at v1 AUM scale

Both lines imply a live 2% lane producing $400/yr. The actual $0/yr reality (with the $400/yr conditional on Symmetry enabling management-class fees) does not appear in README at all.

Severity rationale: README is the first doc any new reader opens. A mismatch between "2% annual creator fee" headline and the $0/yr reality documented elsewhere is a trust / honesty issue, not just a technical one. Lower than H-1/H-2 only because downstream docs are internally correct — a careful reader reaches the right answer.

Recommendation: update README §Key facts fee line to something like "Creator fee: 2% annual config; currently $0/yr while Symmetry management-class fees are disabled at protocol global config" and update the non-goal line on $400/yr to "conditional on Symmetry enabling fees". README must match SPEC §8 on the first pass.

#### M-2. Timeline: README says "2-3 weeks", SHIP.md and B3_PATH_DECISION say 4-5 weeks / 27-35 days

`SHIP.md` header L5 is explicit: `Critical path: 27-35 days total (4-5 weeks) from commit to public launch.` That explicitly notes in its own note-block (L15) the original 2-3 week estimate was over-optimistic.

`B3_PATH_DECISION.md` §5 L109: `28-35 days to full public launch. Matches the 4-5 week realistic timeline from N2.`

`SPEC.md` §10 L305: `Total to public: ~2-3 weeks.` (UNCHANGED — still the old estimate)

`README.md` does not give a headline timeline but points readers to SHIP.md, so it is indirectly OK.

Severity rationale: SPEC §10 still reads 2-3 weeks despite Cycle 2 L5-5a edits. A reader consulting only SPEC will under-estimate by ~2 weeks. Downstream (SHIP, B3) the corrected number is in place, so the product is internally recoverable.

Recommendation: update `SPEC.md` §10 L305 to `~4-5 weeks (27-35 days)` and keep the SHIP.md reference.

#### M-3. `rebalanceVaultTx` role: keeper-initiated or manager-triggered?

`SYMMETRY.md` §Operation map L63: `Trigger rebalance → rebalanceVaultTx (keeper-initiated)`.
`SHIP.md` §1.3 L79: `trigger manually via rebalanceVaultTx`.

Both can be true (keepers run it by default; manager may invoke manually during devnet testing), but this is undocumented. A reader who trusts SYMMETRY.md will be confused by SHIP.md's manual-trigger instruction.

Severity rationale: only surfaces in Phase 1 devnet testing. Recoverable by a quick SDK test. Docs should clarify that the manager bitmask includes the right to submit the intent; the keeper auction executes it.

Recommendation: add a one-liner in SYMMETRY.md Operation map clarifying that `rebalanceVaultTx` is *submittable* by any manager with `TRIGGER_REBALANCE` (CREATOR in our setup, per H-2 fix) but the intent is then *executed* by keepers.

### LOW severity

#### L-1. Jupiter endpoint URL appears in SPEC but not BOT_SPEC or SHIP

`SPEC.md` §5 L118 has the corrected Jupiter endpoint note (`https://lite-api.jup.ag/swap/v1` / `https://api.jup.ag/swap/v1`, legacy `quote-api.jup.ag/v6` dead). `BOT_SPEC.md` does not mention Jupiter explicitly (the bot does not use Jupiter — it only pushes weight intents, keepers route). `SHIP.md` §2.2 L106 says "Integrate Jupiter API" without endpoint. This is not a contradiction but a gap.

Severity rationale: implementer of frontend (Phase 2) must find the endpoint themselves. Low.

Recommendation: add endpoint reference to SHIP.md §2.2 with pointer to SPEC §5.

#### L-2. `buyVaultTx` SDK signature: SPEC is correct, BOT_SPEC is silent (but signal-only), SHIP is vague

`SPEC.md` §5 L141-L146 uses `{ buyer, vault_mint, contributions }` matching SDK (N1 fix landed). SHIP.md §1.3 L78 just says `Deposit 0.1 SOL via buyVaultTx`. Not a contradiction, but a reader going only by SHIP won't see the signature.

Recommendation: no action required — SHIP references SPEC implicitly. Flag only.

#### L-3. SPEC §5/§6/§7 SDK pseudo-code: cross-consistent after N1 fix — verified

- `updateWeightsTx`: SPEC §7 L226-L241 uses `(ctx: TaskContext, settings: UpdateWeightsInput)` pattern. SYMMETRY.md §Operation map line says `updateWeightsTx`. BOT_SPEC §7 L262 calls `buildAndSendUpdateWeights`, which is a wrapper — signature consistent.
- `buyVaultTx`: SPEC §5 uses `{ buyer, vault_mint, contributions }`. No other doc redefines it.
- `sellVaultTx` + `redeemTokensTx`: SPEC §6 uses `{ seller, vault_mint, withdraw_amount, keep_tokens }` then `{ keeper, rebalance_intent }`. SYMMETRY.md Operation map row is consistent.

No contradictions among §5/§6/§7 signatures after the Cycle 2 edit. PASS.

#### L-4. Signal freshness: SIGNAL_CONTRACT says `1h`, BOT_SPEC default is `7200` (2h)

`SIGNAL_CONTRACT.md` §4 L96: `now_utc - timestamp < 1 hour must hold.`
`BOT_SPEC.md` §4 table L97: `SIGNAL_MAX_AGE_SEC | 7200 | Default 2h.`

The SIGNAL_CONTRACT is an invariant the *signal owns*; the BOT_SPEC env var is a *bot-side tolerance*. These are not strictly contradictory (bot can tolerate looser than contract minimum), but a reader might conclude the signal is OK at 90 min when the contract says fail-close at 60 min.

Severity rationale: the signal pipeline writes fresh signals at 00:00 UTC; the bot runs at 00:05 UTC. Actual age at read is ~5 minutes. The mismatch never bites in practice but should be harmonized.

Recommendation: set BOT_SPEC default to 3600 (1h) to match SIGNAL_CONTRACT, or amend SIGNAL_CONTRACT §4 to say "bot may configure a looser window up to N". Prefer the former — fail-closed.

#### L-5. `signal.asOf` vs `signal.timestamp` naming inconsistency

`SIGNAL_CONTRACT.md` §3 schema uses the field name `timestamp`. `BOT_SPEC.md` §5.1 L120 uses `signal.asOf.getTime()` and the Dry-run checklist §8 L287 references `signal.json asOf`. Two different field names for the same value.

Severity rationale: zod parse in `BOT_SPEC.md` signal.ts would fail on the current schema. This is a concrete bug in the bot spec pending first implementation.

Recommendation: pick one name (prefer `timestamp`, matches SIGNAL_CONTRACT §3 canonical schema). Update BOT_SPEC §5.1 code snippet and §8 narrative. Alternative: update SIGNAL_CONTRACT to `asOf` — but that is a schema bump.

#### L-6. `confidence` type: SIGNAL_CONTRACT says float, BOT_SPEC says enum

`SIGNAL_CONTRACT.md` §3 L77: `confidence | float in [0.0, 1.0]`.
`BOT_SPEC.md` §5.6 L179: `the signal carries a confidence: 'high' | 'normal' | 'low' field (bible energy band). Treat 'low' as skip with alert-info.`

These are irreconcilable as written. The contract is `float`; the bot expects a string enum. The bot will fail zod-validation on every real signal.

Severity rationale: blocks Phase 3 bot cutover. Caught only at first integration test. Listed as low only because it surfaces before any capital moves — but this is a bot-implementation-time contradiction that must be resolved.

Recommendation: SIGNAL_CONTRACT is the authority doc (per BOT_SPEC L3 explicit statement: "Signal schema is authoritative in /docs/SIGNAL_CONTRACT.md — this doc consumes it, does not redefine it"). Fix BOT_SPEC §5.6 to treat `confidence < threshold` (default 0.3, matching SIGNAL_CONTRACT §5 L118) as skip-with-info. Remove the string-enum framing.

---

## 3. What is consistent (verified pass)

- **SDK package name** (`@symmetry-hq/sdk`): SPEC, SYMMETRY, SHIP, BOT_SPEC all agree.
- **Program ID** (`BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate`): README §Key facts L15 + SPEC §4 L71 + SYMMETRY §Quick Reference L9 all agree.
- **Meteora pool address** (`2jC1LpGY1ZjL9UerTFDmTNM4kc2AhHydK4tqqqgbJdhh`): SHIP.md §0.2 L40 matches pool.json record.
- **Deposit cap rule** (1% of pool liquidity, ~$805 today / $1208 post-bootstrap): SPEC §5 L124 + HARNESS_VERDICT N12 + B3_PATH_DECISION §1 L16 all consistent.
- **Withdrawal fee** (50 bp): SPEC §4 L86 + SPEC §8 table L257 + SYMMETRY fee table L109 + README absent (but not contradicted).
- **Host fee + deposit fee + management fee + performance fee** all `0 bp`: SPEC §4 L84-L88 + SYMMETRY fee table all agree; performance disabled at protocol level (consistent).
- **Keeper auction model**: SPEC + SYMMETRY + BOT_SPEC all describe the same "bot submits config intent, keepers execute rebalance intent for bounty" model.
- **SPEC §5/§6/§7 SDK signatures**: internally cross-consistent after N1 landed (see L-3 above).

---

## 4. Hypothesis block (JSON)

```json
{
  "agent": "C2-L6-6e",
  "dimension": "dominion_integration",
  "primitive": "hybrid",
  "scope": "cross-doc consistency across docs/ after Cycle 2 L5-5a/5b/5c/5d edits",
  "H1": {
    "claim": "zero high-severity contradictions remain after Cycle 2 edits",
    "result": "fail",
    "evidence": [
      "H-1: universe composition disagrees across SPEC ([PEPE]), oracles.json ([FARTCOIN]), SIGNAL_CONTRACT ([SOL, WIF, JTO, BONK, PYTH, JUP, ORCA, RAY]), and SHIP ([PEPE]). Three different universes live simultaneously.",
      "H-2: HOT authority bitmask — SPEC says UPDATE_WEIGHTS only, SHIP.md §1.2 L72 + SYMMETRY.md L71 still say UPDATE_WEIGHTS + TRIGGER_REBALANCE, directly undoing the N9/B5 remediation."
    ]
  },
  "H2": {
    "claim": "all docs agree on fee status ($0 today; 2% conditional on Symmetry enabling)",
    "result": "fail",
    "evidence": [
      "SPEC §4 L92 + SPEC §8 L255/L262/L264, SYMMETRY §Fees L100-L106, HARNESS_VERDICT B4, B3_PATH_DECISION §1 all say $0 today. PASS for this quartet.",
      "README.md L19 still reads 'Fee: 2% annual creator fee' and L26 still reads '$400/year expected at v1 AUM scale' with no $0-today qualifier. FAIL — README does not reflect the $0 reality."
    ]
  },
  "H3": {
    "claim": "all docs agree on universe composition",
    "result": "fail",
    "evidence": [
      "SPEC.md still names PEPE despite the L3-3b replacement memo (pepe_replacement.md) and oracles.json already specifying FARTCOIN.",
      "SIGNAL_CONTRACT.md specifies a completely different universe ([SOL, WIF, JTO, BONK, PYTH, JUP, ORCA, RAY]) with no oracle or decision-memo backing.",
      "SHIP.md §0.1 still lists PEPE/DOGE/FLOKI under the universe oracle checklist."
    ]
  },
  "severity_summary": {
    "high": 2,
    "medium": 3,
    "low": 6,
    "total_contradictions": 11
  },
  "recommended_next_actions_ordered": [
    "resolve H-1 — declare a single canonical universe; propagate to SPEC §2/§4/§7, SHIP §0.1/§0.3, SIGNAL_CONTRACT §3/§7. Update oracles.json if the canonical set drifts from current [SOL, WIF, BONK, FARTCOIN, POPCAT, DOGE, FLOKI, JTO].",
    "resolve H-2 — edit SHIP.md §1.2 L72 and SYMMETRY.md §Roles L71 to UPDATE_WEIGHTS only. Matches SPEC §4 + §4.1 rotation runbook.",
    "resolve M-1 — update README §Key facts fee line + non-goal L26 to reflect $0/yr today / 2% conditional.",
    "resolve M-2 — update SPEC §10 L305 timeline from 2-3 weeks to 4-5 weeks; keep SHIP header as canonical timeline doc.",
    "resolve L-5 / L-6 — reconcile BOT_SPEC with SIGNAL_CONTRACT (timestamp naming + confidence type). BOT_SPEC explicitly says SIGNAL_CONTRACT is authoritative, so BOT_SPEC moves.",
    "resolve L-4 — pick a single freshness window (prefer 1h to match fail-closed contract)."
  ]
}
```

---

## 5. One-sentence summary

Cycle 2 remediation successfully landed most SPEC/SYMMETRY/SHIP edits *but* left the universe composition incoherent across three documents (most visibly: SIGNAL_CONTRACT ships a universe that appears nowhere else) and left the HOT-wallet authority bitmask still overscoped in SHIP + SYMMETRY despite being narrowed in SPEC — both are high-severity and must be fixed before Phase 1 devnet deploy.
