# fdry

Foundry vault — a Voltr-backed Jupiter Prediction follower on Solana.

Mirrors fade-the-rally signals from an upstream Polymarket harness onto
Jupiter Prediction markets, funded from an on-chain $FDRY vault via the
Trustful adaptor.

---

## Project compass

- **`docs/RANGER_VAULT_READY.md`** — vault auditor handoff package.
- **`docs/SIGNAL_CONTRACT.md`** — L1 → L3 trigger contract.
- **`docs/REVENUE_POLICY.md`** — fee + revenue routing.
- **`bash scripts/drift-sweep.sh`** — one-command verification that docs still match code + data. Run weekly or after any operational change.

---

## 1. What this is

`fdry` is the monorepo for a Solana-mainnet on-chain vault that mirrors a
fade-the-rally strategy onto Jupiter Prediction markets. Funds sit in a
Voltr/Ranger vault denominated in $FDRY; per-trade, the Trustful adaptor
swaps $FDRY → JupUSD, the follower submits a NO order against a Jup
Prediction market, and on settlement the proceeds swap back to $FDRY.

## 2. Status

- **Version:** v2 follower, **pre-launch (paper)**.
- **Shipped:** bridge (Polymarket detector → ndjson trigger stream),
  resolver wiring (`jupMarketResolver` + 5-min TTL snapshot), follower
  orchestrator (`runFollower`), paper-ledger writer, launchd plists, drift
  sweep, 223 passing tests.
- **NOT shipped:** real signing. No live tx submitted. Plists not yet loaded.
  Custody decision open.
- **Next action:** load 3 launchd plists Friday; Sun EOD GO/NO-GO per Phase D
  gates (≥10 triggers, ≥30% Jup coverage, ≥75% NO-hit, zero unhandled).

## 3. Architecture

Four layers connected only by JSON contracts and ndjson streams:

- **L1 Signal** — upstream detector emits a triggers ndjson (one trigger
  per line) per [docs/SIGNAL_CONTRACT.md](./docs/SIGNAL_CONTRACT.md).
- **L2 Vault** — Voltr/Ranger on-chain vault; manager keypair signs trades.
  Trustful adaptor handles $FDRY ↔ JupUSD swaps.
- **L3 Follower** — [voltr/src/follower/](./voltr/src/follower) — reads L1,
  validates, calls Jup Prediction API, submits via manager keypair, writes
  L4.
- **L4 Ledger** — paper-trades.ndjson + paper-results.ndjson append-only,
  with optional GitHub Pages publish.
- **Frontend** — [frontend/](./frontend) — Vite SPA. Reads L2 on-chain +
  L4 static JSON. Not in the signal-to-execution critical path.

Shared Zod schemas live in [shared/](./shared) (`@fdry/shared`).

## 4. Setup

Requirements: Node 20 LTS, pnpm 9, Solana CLI (for key management only).

```bash
pnpm install
cp .env.example .env
```

Fill in secrets in `.env` (none of these belong in git):

- `CREATOR_KEY` — base58 creator keypair; owns the vault (bootstrap only,
  keep OFFLINE after vault creation)
- `HOT_WALLET_KEY` — base58 keeper keypair
- `MANAGER_KEYPAIR_PATH` — path to follower manager keypair JSON
- `SOLANA_RPC_URL` — paid Helius / Triton endpoint
- `FDRY_VAULT_PUBKEY` — non-secret, filled in after vault creation
- `JUP_PREDICTION_API_KEY` — Jup Prediction BETA API key
- `FDRY_FOLLOWER_MODE` — `paper` | `test` | `live`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — alerts
- `HEALTHCHECK_UUID` — healthchecks.io dead-man switch
- `SIGNAL_FILE_PATH`, `LEDGER_DIR` — filesystem paths

`CREATOR_KEY` stays in 1Password, NEVER on Railway — only the
follower manager keypair is provisioned to cron hosts.

## 5. Run locally

```bash
pnpm voltr:dev          # follower against current env (default: paper mode)
pnpm dev:frontend       # Vite dev server for the SPA
```

Mainnet / launch procedures are operator-only and not described in this
public README. Do not run mainnet ops freehand.

## 6. Deploy

- **Follower (L3)** — local macOS launchd today (3 plists). Future: Railway
  cron once paper-trade gates pass.
- **Frontend** — **Cloudflare Pages**. Vite build → CF deploy. Do not use
  Vercel.
- **Ledger (L4)** — append-only ndjson + optional GitHub Pages publish.
- **Signal (L1)** — upstream detector on local macOS; bridges to a triggers
  ndjson.
- **Vault (L2)** — already deployed via Voltr/Ranger. Manager keypair lives
  outside the repo.

## 7. Testing

```bash
pnpm test                                     # vitest unit + contract tests across all packages
bash scripts/drift-sweep.sh                   # one-command doc/code drift verification
```

## 8. Honest caveats

- **No live signing yet.** Paper-trade weekend is the next gate. The
  strategy is mirrored — not invented — so the edge is whatever the upstream
  detector's edge is, minus Jup Prediction's price tracking error vs the
  source venue.
- **~5s JupUSD exposure window.** Between `deposit_swap` confirmation and
  `create_order` submission, JupUSD sits in the manager wallet. The
  kill-switch (emergency `withdraw_swap`) is load-bearing for audit scope.
- **M5 native-adaptor path partially dead.** Jup Prediction `create_order`
  requires a Jup-controlled co-signer at slot 2; PDA-as-signer also rejected
  by Jup's pre-return `simulateTransaction`. Surviving candidates: Voltr
  manager-as-vault-PDA pattern, or deterministically-derived manager.json.
- **Deposit caps small at v2.** Follow per-trade caps in
  `voltr/src/follower/guards.ts` — ≤1% NAV enforced.

## 9. Links

Primary references for code review and auditors:

- [docs/RANGER_VAULT_READY.md](./docs/RANGER_VAULT_READY.md) — auditor handoff.
- [docs/SIGNAL_CONTRACT.md](./docs/SIGNAL_CONTRACT.md) — L1 → L3 JSON contract.
- [docs/REVENUE_POLICY.md](./docs/REVENUE_POLICY.md) — fee + revenue routing.
- [docs/SEED_MECHANISM_DECISION.md](./docs/SEED_MECHANISM_DECISION.md) — vault seed mechanism.
- [docs/GIT_HYGIENE.md](./docs/GIT_HYGIENE.md) — gitignore + secrets policy.
- [docs/_archive/symmetry-era/](./docs/_archive/symmetry-era/) — legacy
  Symmetry V3 rotation-vault docs, archived for audit history only.

Harness artifacts (JSON, machine-readable):

- [docs/oracles.json](./docs/oracles.json) — Pyth feed IDs.
- [docs/pool.json](./docs/pool.json) — pool metadata.
- [docs/slippage.json](./docs/slippage.json) — deposit slippage table.
- [docs/ranger-idl.json](./docs/ranger-idl.json), [docs/ranger-vault.json](./docs/ranger-vault.json) — Voltr/Ranger references.
- [docs/jupiter_routes_c5.json](./docs/jupiter_routes_c5.json) — Jupiter route fixtures.
- [docs/stfdry_tokenomics_model.json](./docs/stfdry_tokenomics_model.json) — tokenomics model.
