# fdry

FDRY Quant Alpha Vault — a Symmetry-based on-chain rotation vault on Solana.
Accepts FDRY, trades a SOL-denominated memecoin basket, pays out FDRY on exit.

---

## 1. What This Is

`fdry` is the monorepo for a daily-rebalance, FDRY-entry quant rotation vault
deployed on [Symmetry V3](https://symmetry.fi) (Solana mainnet program
`BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate`). Users deposit FDRY through a
Jupiter+Symmetry 2-tx frontend wrapper; the vault holds a liquid SOL-based
basket of 6 memecoins; a Railway cron bot rewrites weights once per day from a
signal JSON produced by an offline bible-EBM ranker. There is no custom
on-chain contract in v1 — the vault is pure Symmetry config plus a frontend
swap, which is why this ships in weeks instead of months. It is a small
experimental alpha product, not a yield farm and not a profit-maximizing
product today (see caveats below).

## 2. Status

- **Version:** v1, **pre-launch**.
- **Fib-harness cycles run:** **4** (C1 through C4). Cycle 5 consistency pass
  and Cycle 6 integration pass have refined SPEC, BOT_SPEC, FRONTEND_SPEC,
  and the stFDRY seed mechanism.
- **Current ship-readiness:** last full verdict is **HOLD at 62%** from
  Cycle 1 (see [docs/HARNESS_VERDICT.md](./docs/HARNESS_VERDICT.md)). Later
  cycles burned down the 5 blocking items; remaining gate is Phase 0 of
  [docs/SHIP.md](./docs/SHIP.md) (Meteora bootstrap + oracle verify +
  final-universe backtest rerun).
- **Go / no-go:** blocked on one backtest rerun decision point (B1 in the
  verdict) and one positioning decision (B3 — grow pool / market honestly /
  pivot entry token).

## 3. Architecture

See [docs/CODE_ARCHITECTURE.md](./docs/CODE_ARCHITECTURE.md) for the full
target. TL;DR — **four layers, connected only by JSON contracts**:

- **L1 Signal** — offline bible-EBM ranker in
  `/Users/lekt9/Projects/unify/.fib-harness-v2.4/`, emits
  `runs/daily_signal/YYYY-MM-DD.json` per
  [docs/SIGNAL_CONTRACT.md](./docs/SIGNAL_CONTRACT.md).
- **L2 Vault** — Symmetry on-chain program. `createVaultTx` once;
  `updateWeightsTx` daily; `buyVaultTx` / `sellVaultTx` on user action.
- **L3 Bot** — [bot/](./bot) — Railway cron (`0 0 * * *` UTC) reads L1,
  validates, calls L2, writes L4. Fail-closed. See
  [docs/BOT_SPEC.md](./docs/BOT_SPEC.md).
- **L4 Ledger** — [ledger/](./ledger) — static JSON per day, published to
  GitHub Pages. Pure-static audit trail.
- **Frontend** — [frontend/](./frontend) — Vercel SPA. Reads L2 on-chain +
  L4 static JSON. Not in the signal-to-execution critical path. See
  [docs/FRONTEND_SPEC.md](./docs/FRONTEND_SPEC.md).

Shared Zod schemas live in [shared/](./shared) (`@fdry/shared`).

## 4. Setup

Requirements: Node 20 LTS, pnpm 9, Solana CLI (for key management only).

```bash
pnpm install
cp .env.example .env
```

Fill in secrets in `.env` (none of these belong in git — see
`docs/CODE_ARCHITECTURE.md` section 6 for the full list):

- `CREATOR_KEY` — base58 creator keypair; owns the vault (bootstrap only,
  keep OFFLINE after `createVault`)
- `HOT_WALLET_KEY` — base58 manager keypair (bot only, UPDATE_WEIGHTS
  authority)
- `SOLANA_RPC_URL` — paid Helius / Triton endpoint
- `VAULT_PUBKEY` — non-secret, filled in after `createVault.ts` runs
- `SYMMETRY_PROGRAM_ID` — mainnet program id (pre-filled)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — alerts
- `HEALTHCHECK_UUID` — healthchecks.io dead-man switch
- `SIGNAL_FILE_PATH`, `LEDGER_DIR` — filesystem paths

The `CREATOR_KEY` stays in 1Password, NEVER on Railway — only the
`HOT_WALLET_KEY` is provisioned to the Railway cron.

## 5. Run Locally

Devnet / development:

```bash
pnpm dev:bot          # bot against devnet RPC (bot/src/main.ts)
pnpm dev:frontend     # Vite dev server for the SPA
pnpm snapshot         # one-shot read of vault + pool state
pnpm create-vault     # bootstrap: create vault + register tokens (scripts/createVault.ts)
pnpm seed             # seed / stFDRY bootstrap
```

Mainnet / launch procedures: **follow [docs/SHIP.md](./docs/SHIP.md)
day-by-day.** Do not run mainnet ops freehand. Phase 0 (oracle coverage,
Meteora bootstrap, backtest rerun) is the gate; Phase 1 is devnet vault
deploy; Phases 2-5 are frontend, bot wiring, soft launch, public launch.

## 6. Deploy

One target per layer. See `docs/CODE_ARCHITECTURE.md` section 5 for the full
table.

- **Bot (L3)** — **Railway** cron service. [railway.toml](./railway.toml) →
  Nixpacks build, two cron services: `bot-daily-rebalance` (`0 0 * * *` UTC)
  and `ledger-snapshot` (`10 0 * * *` UTC). `restartPolicyType =
  "ON_FAILURE"`, `restartPolicyMaxRetries = 3`.
- **Frontend** — **Vercel**. Push to `main`, Vite build, edge CDN. Env via
  Vercel project settings.
- **Ledger (L4)** — **GitHub Pages**. Bot commits `ledger/YYYY-MM-DD.json`
  on each run; a GitHub Action rsyncs `ledger/` to the `gh-pages` branch of
  the public `fdry-ledger` repo. Bot only needs `contents:write`, not
  release rights.
- **Signal (L1)** — existing fib-harness VPS / local already running the
  nightly loop; emitter is the final step.
- **Vault (L2)** — already deployed by Symmetry; our vault is a one-shot
  `scripts/createVault.ts`.

## 7. Testing

```bash
pnpm test                                     # vitest unit + contract tests across all packages
pnpm --filter scripts exec tsx e2e-test.ts    # devnet deposit → rebalance → withdraw
```

CI (`.github/workflows/`, not yet wired — see SHIP Phase 0) will run three
checks:

1. `pnpm -r build` — schema compile gate on `shared/`.
2. Fixture validation — every `runs/daily_signal/*.json` and
   `ledger/*.json` parses under the Zod schemas in `shared/`.
3. Doc anchor — `SIGNAL_VERSION` constant matches between
   `docs/SIGNAL_CONTRACT.md` and `shared/src/signal.ts`.

## 8. Honest Caveats

**Read this before depositing anything.** The points below are not
marketing — they are what the harnesses actually found.

- **The offline backtest showed equal-weight beats bible-HIGH.** On the
  original 7-token universe at 40bps across 5 holdout windows, mean Sharpe
  was `equal_weight = +0.59`, `bible_HIGH = +0.25`. v1 therefore runs with
  an **equal-weight fallback baked in**; the bible-EBM signal is used as a
  **tiebreaker / style prior only**, not as a primary selector. If the
  final 6-token rerun (SHIP Phase 0.3) still shows bible-HIGH losing to EW,
  the strategy thesis gets re-evaluated before Phase 1. See
  [docs/HARNESS_VERDICT.md](./docs/HARNESS_VERDICT.md) items B1, N5.
- **The bible-EBM is a KJV-style detector, not a forecaster.** Energy
  correlates with realized Sharpe at the noise floor (ρ ≈ −0.12). Use at
  the ranker-tiebreaker scale it was trained for; do not over-read it.
- **End-to-end round-trip can be net-negative in FDRY terms at today's
  pool depth.** $1k deposit + 30d hold + withdraw at default slippage ends
  ~0.964× FDRY (−3.6%). Realistic pool math is worse (~−6.8%). Breakeven
  vs HODL-FDRY needs ~32% annualized net strategy return; the (optimistic)
  backtest shows ~20%. v1 is positioned as an **experimental alpha
  product and public track record**, not a profit product. Deposit caps
  are tight.
- **Creator fees currently accrue to $0.** Symmetry management fees are
  globally disabled at the protocol level. The 2% in SPEC section 8 is
  architecturally live but pays zero today; flips on only when Symmetry
  re-enables the global config gate.
- **Deposit caps are small at v1.** The FDRY/SOL Meteora pool supports
  ~$800–$1,200 per deposit at 2% slippage. v1 enforces a 1%-of-pool cap at
  the frontend. Pool growth is a precondition for scale.

## 9. Links

Primary references — read in this order if you are new to the repo:

- [docs/SPEC.md](./docs/SPEC.md) — full product spec, decision log, risks.
- [docs/SHIP.md](./docs/SHIP.md) — day-by-day ship checklist, 27–35 days.
- [docs/HARNESS_VERDICT.md](./docs/HARNESS_VERDICT.md) — Cycle 1 HOLD
  verdict, 5 blockers, 12 non-blocking findings, remediation sequence.
- [docs/SEED_MECHANISM_DECISION.md](./docs/SEED_MECHANISM_DECISION.md) —
  irreversible stFDRY seed decision (ALT: SOL-seed + FDRY-bonus stream).
- [docs/CODE_ARCHITECTURE.md](./docs/CODE_ARCHITECTURE.md) — four-layer
  architecture, contracts, deploy targets, secrets, CI drift detection.
- [docs/SIGNAL_CONTRACT.md](./docs/SIGNAL_CONTRACT.md) — L1 to L3 JSON
  contract.
- [docs/BOT_SPEC.md](./docs/BOT_SPEC.md) — bot detailed spec.
- [docs/FRONTEND_SPEC.md](./docs/FRONTEND_SPEC.md) — frontend detailed
  spec.
- [docs/SYMMETRY.md](./docs/SYMMETRY.md) — Symmetry protocol reference,
  SDK calls, fee table.
- [docs/README.md](./docs/README.md) — docs index.

Harness artifacts (JSON, machine-readable):

- [docs/oracles.json](./docs/oracles.json) — Pyth feed IDs for the 6-token
  universe [SOL, WIF, BONK, POPCAT, FLOKI, JTO].
- [docs/pool.json](./docs/pool.json) — FDRY/SOL Meteora pool metadata.
- [docs/slippage.json](./docs/slippage.json) — deposit slippage table +
  recommended caps.
- [docs/backtest_final.json](./docs/backtest_final.json) — backtest status
  + prior 7-token results.
- [runs/backtest_c5.json](./runs/backtest_c5.json) — Cycle 5 backtest run.