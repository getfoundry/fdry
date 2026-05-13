# SPEC.md Changelog

## 2026-04-20 — Cycle 2 L5 Agent 5a (Creatures/Behavior dimension)

Applied six corrections to `docs/SPEC.md` per Cycle 2 remediation directives. All
edits verified in-file; no line-drift conflicts observed. SPEC re-read in full
after edits to confirm internal consistency.

### FIX 1 — N1: SDK parameter names

- **§5 Deposit Flow** (`deposit()` pseudo-code, lines ~120-157):
  - `buyVaultTx` params are now `{ buyer, vault_mint, contributions: [{ mint, amount }] }`
    (was `{ user, vault, inputMint, amount }`).
  - Added mandatory `lockDepositsTx({ buyer, vault_mint })` step after `buyVaultTx`,
    with a comment noting the keeper picks up the intent only after lock.
- **§6 Withdrawal Flow** (`withdraw()` pseudo-code, lines ~162-203):
  - `sellVaultTx` params are now `{ seller, vault_mint, withdraw_amount, keep_tokens }`.
  - `redeemTokensTx` now takes `{ keeper, rebalance_intent }` where `rebalance_intent`
    is destructured from the `sellVaultTx` response.
- **§7 Bot / Signal Integration** (lines ~207-241):
  - `updateWeightsTx` documented as `(ctx: TaskContext, settings: UpdateWeightsInput)`
    pattern (was a single flat options object).
  - Explicit note added: all `*Tx` SDK methods return a `TxPayloadBatchSequence`;
    callers must execute via `sdk.signAndSendTxPayloadBatchSequence(signer, batch)`.
- All affected code blocks in §§5-7 were rewritten to use the batch-sequence
  submission pattern consistently.

### FIX 2 — B4: Fee reality

- **§4 Symmetry Vault Configuration** (line ~92): appended
  `> **Fee status (2026-04-20):** Currently accrues to $0 because Symmetry has
  management-class fees disabled at global config. Fee accrual activates if/when
  Symmetry enables.`
- **§8 Fees** (line ~255 and ~262):
  - Creator fee row now reads `2% annual (disabled — $0 today)`.
  - Same `Fee status (2026-04-20)` note appended under the table.
  - "Expected annual income" paragraph rewritten: **"Today: $0 until Symmetry
    enables management fees. Projected $400/yr at $20k AUM IF/WHEN enabled"**
    (was a flat $400/yr claim).
- **§9 Risks & Honest Caveats — Technical** (line ~275): added bullet:
  "Creator fee is disabled at Symmetry protocol level; operator income from this
  lane is $0 until enabled by Symmetry governance."

### FIX 3 — B5: HOT rotation runbook

- New subsection **§4.1 HOT rotation runbook** (lines 99-113):
  - **Triggers**: quarterly scheduled; immediate on suspected leak; immediate on
    Jupiter/Symmetry anomaly indicating HOT abuse.
  - **Procedure** (5 numbered steps): CREATOR signs manager-remove on old HOT;
    new keypair generated on air-gapped box; CREATOR signs manager-add for new
    HOT with same narrow `UPDATE_WEIGHTS` bitmask; bot env secret updated and
    cron resumes at next UTC-midnight tick; verification via vault-account query
    of `managers` list.
  - **SLA**: 30 minutes emergency, next-business-day scheduled.

### FIX 4 — N6: Jupiter endpoint

- Replaced all live references to `quote-api.jup.ag/v6` with
  `lite-api.jup.ag/swap/v1` (with `api.jup.ag/swap/v1` noted as the
  higher-rate-limit alternative).
- Kept one historical mention of `quote-api.jup.ag/v6` in §5 solely as a
  migration note explaining the legacy DNS no longer resolves; response shape
  confirmed identical.

### FIX 5 — N9: Narrow HOT bitmask

- **§4 vault config** (line 80): `manager authority` changed from
  `UPDATE_WEIGHTS, TRIGGER_REBALANCE` to `UPDATE_WEIGHTS` only, with inline
  comment `TRIGGER_REBALANCE reserved for CREATOR break-glass`.
- **§4 Wallet separation** (line 97): HOT_WALLET description updated to
  "Has `UPDATE_WEIGHTS` only (narrow bitmask; `TRIGGER_REBALANCE` is reserved
  for CREATOR break-glass)."
- §4.1 rotation runbook step 3 mirrors the same narrow authority so rotation
  does not silently re-broaden the bitmask.

### FIX 6 — N11: Risk disclaimer headline

- **§9 Risks & Honest Caveats** opening line (before "Technical" subsection,
  line 268) now reads, in bold:
  > **Capital at risk. You may receive back fewer FDRY than you deposited.
  > Strategy may lose money. No return is guaranteed. This vault is
  > discretionary, not a passive yield product.**

### Consistency verification

After applying all six fixes, `SPEC.md` was re-read end-to-end. Cross-references
checked:

- `TRIGGER_REBALANCE` appears only in two places (§4 config comment and §4.1
  wallet separation), both stating it is reserved for CREATOR — consistent.
- `signAndSendTxPayloadBatchSequence` appears in all five SDK-call sites
  (deposit, lock, sell, redeem, bot update) — consistent with the "all *Tx
  return a TxPayloadBatchSequence" statement in §7.
- Creator-fee `$0 today` language appears in §4, §8 table, §8 expected-income
  paragraph, and §9 Technical — four sites, all consistent.
- §4.1 runbook step 3 references the same `UPDATE_WEIGHTS` bitmask used in
  §4 line 80 and §4 wallet separation — consistent.
- Jupiter endpoint note at §5 line 118 is the only live endpoint reference and
  matches `lite-api.jup.ag/swap/v1`.

No contradictions found.
