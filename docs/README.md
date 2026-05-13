# fdry — docs

Design and implementation docs for the Foundry Voltr-backed Jupiter Prediction
follower on Solana.

## Start here

| Document | Purpose |
|---|---|
| [NORTHSTAR.md](./NORTHSTAR.md) | Invariants, hard rules, source-of-truth pinning. |
| [HANDOFF-2026-05-10.md](./HANDOFF-2026-05-10.md) | Current actionable backlog (M2 → M5). |
| [PAPER_TRADE_RUNBOOK.md](./PAPER_TRADE_RUNBOOK.md) | M2 operator checklist. |
| [PLAN_FOLLOW_IMABETTINGMAN.md](./PLAN_FOLLOW_IMABETTINGMAN.md) | Original architecture plan. |
| [RANGER_VAULT_READY.md](./RANGER_VAULT_READY.md) | Vault auditor handoff package. |

## Key facts

- **Strategy:** mirror imabettingman fade-the-rally NO-buys onto Jup Prediction.
- **Funding:** on-chain $FDRY vault (Voltr/Ranger), per-trade $FDRY → JupUSD via Trustful adaptor.
- **Cadence:** trigger-driven, not scheduled.
- **Settlement:** swap proceeds back to $FDRY on close.
- **Status:** pre-launch (paper). Custody and submitOrder.ts open before M3.

## Plan & phase docs

- [M5_NATIVE_JUP_STRATEGY.md](./M5_NATIVE_JUP_STRATEGY.md) — long-tail signer architecture.
- [PHASE2_HANDOFF.md](./PHASE2_HANDOFF.md) and [PHASE2_FORWARD_COLLECT_HANDOFF.md](./PHASE2_FORWARD_COLLECT_HANDOFF.md).
- [PLAN_PHASE1_BUILD.md](./PLAN_PHASE1_BUILD.md).
- [PLAN_LIVE_FDRY_TRADING.md](./PLAN_LIVE_FDRY_TRADING.md).
- [PLAN_VALIDATE_CREATE_ORDER_INTEGRATION.md](./PLAN_VALIDATE_CREATE_ORDER_INTEGRATION.md).
- [SEED_MECHANISM_DECISION.md](./SEED_MECHANISM_DECISION.md).
- [SIGNAL_PIPELINE_PATCH.md](./SIGNAL_PIPELINE_PATCH.md).

## Contracts & schemas

- [SIGNAL_CONTRACT.md](./SIGNAL_CONTRACT.md) — L1 → L3 trigger contract.
- [REVENUE_POLICY.md](./REVENUE_POLICY.md) — fee + revenue routing.
- [GIT_HYGIENE.md](./GIT_HYGIENE.md) — what's gitignored and why.

## Machine-readable artifacts

- [oracles.json](./oracles.json) — Pyth feed IDs.
- [pool.json](./pool.json) — pool metadata.
- [slippage.json](./slippage.json) — deposit slippage table.
- [ranger-idl.json](./ranger-idl.json), [ranger-vault.json](./ranger-vault.json) — Voltr/Ranger references.
- [jupiter_routes_c5.json](./jupiter_routes_c5.json) — Jupiter route fixtures.
- [backtest_final.json](./backtest_final.json) — backtest status snapshot.
- [stfdry_tokenomics_model.json](./stfdry_tokenomics_model.json) — legacy tokenomics model (retained for revenue-modeling reference).

## Recent handoffs

- [HANDOFF-2026-05-10.md](./HANDOFF-2026-05-10.md) — latest, the actionable one.
- [HANDOFF-2026-05-09.md](./HANDOFF-2026-05-09.md).
- [HANDOFF-NATIVE-ADAPTOR-UNBLOCK.md](./HANDOFF-NATIVE-ADAPTOR-UNBLOCK.md).
- [HANDOFF-PHASE1-ORCHESTRATION.md](./HANDOFF-PHASE1-ORCHESTRATION.md).

## Archive

[_archive/symmetry-era/](./_archive/symmetry-era/) — legacy Symmetry V3
rotation-vault docs (CYCLE_*, HARNESS_VERDICT, SPEC, SHIP_*, FRONTEND_SPEC,
etc.). Retained for audit history. Not load-bearing for current operations.
