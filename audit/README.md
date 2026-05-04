# fdry audit dossier

Two audit handoff docs cover the full smyrna_4h_profit_only deployment:

| doc | scope |
|---|---|
| **`CLIENT_SIDE_AUDIT.md`** (this repo) | wallet-signed deposit/withdraw flow, NAV display, disclosure, RPC trust |
| **`voltr-rotation/audit/SMYRNA_4H_LIVE_HANDOFF.md`** (sibling repo) | strategy + manager-side: signal pipeline, executor, Trustful adaptor, key custody, NAV attestation |

An auditor needs both. The client docs verify users can't be sandbagged
by the UI; the strategy docs verify the operator can't drain or
mis-attest. They cross-reference each other where the surfaces touch
(strategy mode, deploy cap, stale NAV, withdrawal policy).

## Verification order

1. Read `CLIENT_SIDE_AUDIT.md` first. It's the part real users touch.
2. Run the smoke tests in CLIENT_SIDE_AUDIT.md "Smoke test checklist".
3. Then read `SMYRNA_4H_LIVE_HANDOFF.md`. Verify the `--verify`
   no-lookahead audit passes and the 20 enumerated checks.
4. Walk the cross-linked items (deploy cap, stale NAV, withdrawal
   policy) — these must agree across both surfaces.

## Repo layout

```
fdry/                                      ← this repo
  frontend/        — wallet-signed user flow
  programs/        — fdry-jup-adaptor (Solana program, separate audit scope)
  scripts/         — vault deployment scripts (deployment record, not user flow)
  audit/CLIENT_SIDE_AUDIT.md ← scope of the client-side audit

voltr-rotation/                            ← sibling repo
  live_dashboard/backend/  — voltr_live (Python), voltr_fractal, signal emitter
  executor/                — TypeScript manager-side: provision, rebalance, attest
  notebooks/               — backtest_smyrna_4h.py (single source of truth)
  audit/SMYRNA_4H_LIVE_HANDOFF.md ← scope of the strategy-side audit
```
