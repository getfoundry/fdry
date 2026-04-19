# CODE_ARCHITECTURE — FDRY Production Four-Layer Target

Status: v0.1 target architecture (Firmament).
Companion to: `SPEC.md`, `SIGNAL_CONTRACT.md`, `BOT_SPEC.md`, `FRONTEND_SPEC.md`, `SYMMETRY.md`.

The production system is **four layers connected only by machine-readable contracts**.
No cross-layer imports, no shared runtime — each layer is independently deployable and
independently testable. The contracts are the API.

---

## 0. Layer map

```
LAYER 1: Signal    /Users/lekt9/Projects/unify/.fib-harness-v2.4/
                   emits → runs/daily_signal/YYYY-MM-DD.json
                                  |
                                  v  (JSON, SIGNAL_CONTRACT.md)
LAYER 3: Bot       /Users/lekt9/Projects/fdry/bot/
                   reads L1, calls L2, writes L4
                                  |
                  ┌───────────────┴───────────────┐
                  v                               v
LAYER 2: Vault    Symmetry on-chain           LAYER 4: Ledger
                  program BASKT7a...pumate     /Users/lekt9/Projects/fdry/ledger/YYYY-MM-DD.json
                  (createVault, buyVault,      (daily NAV, tx history, fees, revenue)
                   sellVault, updateWeights,
                   withdrawFees)
```

Frontend (`/Users/lekt9/Projects/fdry/frontend/`) reads L2 directly and reads L4 for display.
It does not sit in the signal→execution critical path.

---

## 1. Directory layout — `/Users/lekt9/Projects/fdry/`

```
fdry/
├── docs/                    # specs & contracts (this file, SIGNAL_CONTRACT, BOT_SPEC, ...)
├── shared/                  # LAYER-SPANNING TYPES ONLY. No runtime logic.
│   ├── package.json         # name: "@fdry/shared", "type": "module"
│   ├── tsconfig.json
│   └── src/
│       ├── signal.ts        # zod Signal schema (source of truth; mirrors SIGNAL_CONTRACT.md)
│       ├── ledger.ts        # zod Ledger entry schema (NAV, tx, fees, inflows)
│       ├── vault.ts         # re-exported Symmetry SDK types (VaultState, TokenRow)
│       └── index.ts         # barrel
├── bot/                     # LAYER 3 — Railway cron worker
│   ├── package.json         # depends on "@fdry/shared": "workspace:*"
│   ├── tsconfig.json
│   ├── railway.toml
│   ├── Dockerfile
│   ├── src/
│   │   ├── index.ts         # entrypoint — one rebalance pass, exit
│   │   ├── signal.ts        # fetch L1 JSON, validate via shared/signal schema
│   │   ├── symmetry.ts      # L2 wrapper: fetchVault, updateWeightsTx, sendAndConfirm
│   │   ├── ledger.ts        # L4 writer: appends today's entry, commits to ledger repo
│   │   ├── guards.ts        # pure guard fns
│   │   └── alerts.ts        # Telegram + healthchecks.io
│   └── test/
├── frontend/                # Vercel SPA — reads L2 on-chain state + L4 ledger JSON
│   ├── package.json
│   ├── vite.config.ts
│   └── src/                 # see FRONTEND_SPEC.md
├── ledger/                  # LAYER 4 — static JSON artifacts (GitHub Pages)
│   ├── index.json           # manifest: list of available dates
│   ├── YYYY-MM-DD.json      # per-day entry (one per rebalance)
│   └── schema.json          # JSON Schema of ledger entries
├── runs/                    # consumed FROM LAYER 1 (read-only for L3)
│   └── daily_signal/
│       └── YYYY-MM-DD.json  # populated by fib-harness emitter
└── scripts/                 # one-shot ops scripts (deploy vault, withdraw fees)
    ├── create-vault.ts
    └── withdraw-fees.ts
```

`fdry/` is a **pnpm workspace**. `shared`, `bot`, and `frontend` are the three packages.
Scripts use the workspace too so they can import `@fdry/shared`.

---

## 2. Package manager, language, module system

| Choice | Value | Rationale |
|---|---|---|
| Package manager | **pnpm** (workspaces) | Matches FRONTEND_SPEC; strict hoisting catches phantom deps; workspace protocol for `@fdry/shared`. |
| Runtime | **Node.js 20 LTS** | Long support, native `fetch`, native ESM, stable through 2026. |
| Language | **TypeScript, strict** | Shared types are load-bearing across layers; compiler is the first guard. |
| Module system | **ES modules** (`"type": "module"`) | All packages. No CommonJS anywhere in the repo. |
| Target / moduleResolution | ES2022 / `bundler` | Per BOT_SPEC and FRONTEND_SPEC. |
| Test runner | **vitest** | Shared across all packages. |
| Lint / format | **eslint + prettier**, root config | One style across the repo. |

`pnpm-workspace.yaml`:
```yaml
packages: ["shared", "bot", "frontend"]
```

---

## 3. The four layer contracts

### LAYER 1 — Signal  (producer: unify/.fib-harness-v2.4)

- **Producer path**: `/Users/lekt9/Projects/unify/.fib-harness-v2.4/jesus_loop_weights_emit.py`
- **Output path**: `/Users/lekt9/Projects/fdry/runs/daily_signal/YYYY-MM-DD.json`
- **Contract**: `SIGNAL_CONTRACT.md` (authoritative). Machine schema: `shared/src/signal.ts` (zod).
- **Required fields**: `timestamp` (ISO-8601 UTC), `signal_version`, `universe` (8 symbols),
  `weights_bp` (sum exactly 10000), `confidence` (0–1), `ranker`, `metadata`.
- **Atomic write**: `.tmp` then `os.replace`. Fail-closed on any invariant violation.
- **Freshness SLA**: bot rejects if `now - timestamp > 1h`.

### LAYER 2 — Vault  (on-chain Symmetry program)

- **Program ID**: `BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate`
- **SDK**: `@symmetry-hq/sdk`
- **Contract (operations the bot and scripts call)**:
  - `createVaultTx`       — one-time, `scripts/create-vault.ts`
  - `buyVaultTx`          — frontend deposit path
  - `sellVaultTx`         — frontend withdraw path
  - `updateWeightsTx`     — bot daily call (manager authority)
  - `withdrawVaultFeesTx` — manual ops (`scripts/withdraw-fees.ts`)
- **Read contract**: `fetchVault` → `loadVaultPrice` returns `VaultState` used by bot guards
  and frontend NAV display. Tokens array order is the canonical universe ordering.
- **Authority model**: manager keypair = `HOT_WALLET_SECRET`, holds only
  `UPDATE_WEIGHTS + TRIGGER_REBALANCE`. Creator keypair (cold) holds fee claim + transfer.

### LAYER 3 — Bot  (fdry/bot/)

- **Trigger**: Railway cron `5 0 * * *` (00:05 UTC daily), one-shot container.
- **Read**: Layer 1 JSON (newest file in `runs/daily_signal/`), Layer 2 on-chain state
  (`fetchVault`).
- **Write**: Layer 2 `updateWeightsTx`; Layer 4 ledger entry.
- **Exit codes**: `0` success/no-op · `1` guard tripped · `2` infra error.
- **Guard order**: freshness → weights → position cap → confidence → cooldown → delta.
- **Side effects**: Telegram alert, healthchecks.io ping, ledger commit.

### LAYER 4 — Ledger  (fdry/ledger/YYYY-MM-DD.json)

- **Path**: `/Users/lekt9/Projects/fdry/ledger/YYYY-MM-DD.json`
- **Schema** (`shared/src/ledger.ts`, zod; JSON Schema mirror at `ledger/schema.json`):

```json
{
  "date": "2026-04-20",
  "timestamp": "2026-04-20T00:05:42Z",
  "vault_pubkey": "7xK...",
  "nav_sol": 1234.567,
  "nav_per_share_sol": 1.02345,
  "aum_usd": 198765.43,
  "weights_bp": { "SOL": 1800, "WIF": 1500, "JTO": 1250, "BONK": 1250,
                  "PYTH": 1100, "JUP": 1100, "ORCA": 1000, "RAY": 1000 },
  "rebalance": {
    "happened": true,
    "tx_sig": "5Gk...",
    "prev_weights_bp": { "SOL": 1700, "WIF": 1500, "...": "..." },
    "max_delta_bp": 200,
    "priority_fee_microlamports": 50000,
    "bounty_lamports": 0
  },
  "fees": {
    "creator_fee_accrued_sol": 0.123,
    "creator_fee_claimed_sol_today": 0.0,
    "withdrawal_fee_accrued_sol": 0.045
  },
  "inflows": {
    "deposits_sol": 12.5,
    "withdrawals_sol": 3.2,
    "net_flow_sol": 9.3
  },
  "signal_ref": {
    "path": "runs/daily_signal/2026-04-20.json",
    "signal_version": "v0.1",
    "confidence": 0.72
  }
}
```

- **Invariants**: `nav_per_share_sol > 0`, `sum(weights_bp) == 10000`, one file per UTC day,
  monotonically non-decreasing `date`.
- **Manifest**: `ledger/index.json` lists all dates in reverse chronological order for the
  frontend to discover. Bot appends to this manifest atomically.
- **Publication**: committed to git on every bot run, pushed to `gh-pages` branch of the
  public `fdry-ledger` repo → served as GitHub Pages static JSON (no backend, auditable).

---

## 4. Shared types library — `shared/`

- Package name: `@fdry/shared`.
- **Zero runtime deps** except `zod` (validation).
- **Exports only** schemas and inferred types. No side-effectful code.
- **Consumed by**: `bot` (full use), `frontend` (ledger + vault types for display),
  `scripts/*`. The Python Layer 1 does not import this — Layer 1 generates JSON against
  `SIGNAL_CONTRACT.md`, and `shared/src/signal.ts` is the machine-checkable mirror.
- **Contract drift is caught twice**: (a) bot validation against zod schema at read time,
  (b) CI contract test that parses every historical signal + ledger file under the zod
  schemas on every PR.

---

## 5. Deploy targets (one target per layer)

| Layer | Target | Trigger | Artifact |
|---|---|---|---|
| L1 Signal | **Existing fib-harness host** (local/VPS already running the nightly loop) | Nightly cron already configured; adds the emitter as the final step. | JSON file in `runs/daily_signal/`. |
| L2 Vault | **Solana mainnet** (already deployed by Symmetry) | Our vault is `createVaultTx` once from `scripts/create-vault.ts` (local run). | On-chain vault account. |
| L3 Bot | **Railway** cron service | `railway.toml` → `[[cron]] schedule = "5 0 * * *"`. One-shot container, `restartPolicyType = "NEVER"`. | Docker image from `bot/Dockerfile`. |
| Frontend | **Vercel** | Git push to `main` of `frontend/` subtree → Vercel build (Vite) → edge CDN. | Static SPA. |
| L4 Ledger | **GitHub Pages** | Bot commits on each run; GH Actions publishes `ledger/` tree to `gh-pages` branch. Served at `https://fdry.github.io/fdry-ledger/`. | Static JSON files, immutable once published. |

The L4 ledger is published by a GitHub Action (not by the bot pushing directly) so the
bot only needs `git push` permission to `main`, not release permissions. Action watches
`ledger/**` and rsyncs to `gh-pages`.

---

## 6. Secrets — what is needed and where it lives

| Secret | Used by | Storage |
|---|---|---|
| `HOT_WALLET_SECRET` (manager keypair, base58) | L3 bot | **Railway project secret**. Never in git, never logged. Rotated by re-running `scripts/create-manager.ts`. |
| `CREATOR_WALLET_SECRET` (cold, fee claim authority) | `scripts/withdraw-fees.ts` (manual) | **1Password** (offline). Loaded into env only for the manual ops run. Never on Railway. |
| `SOLANA_RPC_URL` (paid Helius/Triton) | L3 bot, frontend (public read-only key), scripts | Railway secret (bot); Vercel env `VITE_RPC_URL` (frontend, rate-limited public key). Two separate keys — never share the bot's key with the frontend. |
| `VAULT_PUBKEY`, `VAULT_MINT` | bot, frontend, scripts | Non-secret. Railway env + Vercel env + committed to `shared/src/constants.ts`. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | L3 bot alerts | Railway secret. |
| `HEALTHCHECKS_URL` | L3 bot dead-man-switch | Railway secret. |
| `GITHUB_TOKEN` (for ledger push) | L3 bot ledger writer | Railway secret — fine-grained PAT scoped only to `fdry-ledger` repo, contents:write. |
| `JUPITER_API_KEY` (if using paid tier) | Frontend | Vercel env `VITE_JUP_KEY`. |
| `CF_GEOFENCE_KEY` | Frontend | Vercel env `VITE_CF_GEOFENCE_KEY`. |

Never in git: anything in the left column marked secret. `.env.example` files in `bot/`
and `frontend/` document every variable with a placeholder. `.gitignore` ignores `.env`,
`*.key`, `wallet*.json`.

---

## 7. Contract-drift detection (CI)

Three checks, all in the root GitHub Actions workflow:

1. **Schema build**: `pnpm -r build`. If `shared/` fails to compile, fail the PR.
2. **Fixture validation**: every JSON in `runs/daily_signal/` and `ledger/` parses under
   the zod schemas in `shared/`. Catches drift between Python producer and TS consumer.
3. **Doc anchor**: `SIGNAL_CONTRACT.md` and `shared/src/signal.ts` both declare a
   `SIGNAL_VERSION` constant; CI greps them and asserts equality.

---

## 8. What this architecture guarantees

- **Independent failure domains**: L1 stopping does not brick L3; L3 fails-closed and
  L4 shows a gap. L4 is pure-static, so it cannot go down from L3 crashing.
- **Auditability**: every L3 decision is explained by the L1 JSON it read and the L4
  JSON it wrote. Both are public, timestamped, content-addressed via git history.
- **Upgrade path**: a future Option-C Anchor wrapper replaces L2 without touching L1,
  L3, or L4 contracts — only `bot/src/symmetry.ts` changes.
