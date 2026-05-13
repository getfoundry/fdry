# fdry — docs

Design and implementation docs for the Foundry Voltr-backed Jupiter Prediction
follower on Solana.

## Start here

| Document | Purpose |
|---|---|
| [RANGER_VAULT_READY.md](./RANGER_VAULT_READY.md) | Vault auditor handoff package. |
| [SIGNAL_CONTRACT.md](./SIGNAL_CONTRACT.md) | L1 → L3 trigger contract. |
| [REVENUE_POLICY.md](./REVENUE_POLICY.md) | Fee + revenue routing. |
| [SEED_MECHANISM_DECISION.md](./SEED_MECHANISM_DECISION.md) | Vault seed mechanism decision. |
| [GIT_HYGIENE.md](./GIT_HYGIENE.md) | Gitignore + secrets policy. |

## Key facts

- **Strategy:** mirror upstream fade-the-rally NO-buys onto Jup Prediction.
- **Funding:** on-chain $FDRY vault (Voltr/Ranger), per-trade $FDRY → JupUSD via Trustful adaptor.
- **Cadence:** trigger-driven, not scheduled.
- **Settlement:** swap proceeds back to $FDRY on close.
- **Status:** pre-launch (paper). Custody and submitOrder.ts open before first live cycle.

## Machine-readable artifacts

- [oracles.json](./oracles.json) — Pyth feed IDs.
- [pool.json](./pool.json) — pool metadata.
- [slippage.json](./slippage.json) — deposit slippage table.
- [ranger-idl.json](./ranger-idl.json), [ranger-vault.json](./ranger-vault.json) — Voltr/Ranger references.
- [jupiter_routes_c5.json](./jupiter_routes_c5.json) — Jupiter route fixtures.
- [stfdry_tokenomics_model.json](./stfdry_tokenomics_model.json) — tokenomics model (retained for revenue-modeling reference).

## Archive

[_archive/symmetry-era/](./_archive/symmetry-era/) — legacy Symmetry V3
rotation-vault docs. Retained for audit history. Not load-bearing for current
operations.
