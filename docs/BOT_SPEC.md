# BOT_SPEC — FDRY Quant Alpha Vault Rebalance Bot

Concrete implementation spec for the daily rebalance bot. Signal schema is authoritative in [`/docs/SIGNAL_CONTRACT.md`](./SIGNAL_CONTRACT.md) — this doc consumes it, does not redefine it.

Status: pre-implementation spec. Build against this, dry-run 7 days, then flip mainnet.

---

## 1. Directory layout

Repo root (new): `/Users/lekt9/Projects/fdry/bot/`

```
bot/
├── package.json          # node >= 20, type: module
├── tsconfig.json         # target ES2022, moduleResolution bundler, strict
├── .env.example          # all env vars documented; real .env is gitignored
├── .gitignore
├── Dockerfile            # node:20-slim, COPY src, npm ci --omit=dev
├── railway.toml          # cron + healthcheck wiring
├── src/
│   ├── index.ts          # entrypoint; parses env, runs one rebalance pass, exits
│   ├── symmetry.ts       # SymmetryCore wrapper: fetchVault, buildUpdateWeightsTx, signAndSend
│   ├── signal.ts         # loads + validates signal JSON (zod schema from SIGNAL_CONTRACT)
│   ├── guards.ts         # pure functions: freshness, weight invariants, position cap, cooldown
│   ├── alerts.ts         # Telegram webhook + healthchecks.io ping (success/fail/start)
│   └── types.ts          # shared TS types re-exported from signal + symmetry
└── test/
    ├── guards.test.ts    # unit tests for every guard (vitest)
    └── signal.test.ts    # golden-file parse tests for SIGNAL_CONTRACT samples
```

Single-binary deploy. No DB — state lives on-chain (Symmetry vault) and in the signal pipeline's output file. Idempotency comes from the `signal.asOf` timestamp + on-chain current weights.

---

## 2. Dependencies

`package.json` runtime deps (pinned majors, floated patch):

| Package | Version | Purpose |
|---|---|---|
| `@symmetry-hq/sdk` | `^latest` at build time | Vault SDK: `updateWeightsTx`, `fetchVault`, `loadVaultPrice`, `signAndSendTxPayloadBatchSequence` |
| `@solana/web3.js` | `^1.95` | `Connection`, `Keypair`, `PublicKey`, `sendAndConfirmTransaction` |
| `zod` | `^3.23` | Runtime validation of signal JSON against SIGNAL_CONTRACT schema |
| `pino` | `^9` | Structured JSON logs (stdout → Railway log drain) |
| `dotenv` | `^16` | Local dev only; Railway injects env directly |
| `undici` | `^6` | Telegram + healthchecks.io HTTP (native fetch works too; undici gives timeouts) |

Dev deps: `typescript`, `tsx`, `vitest`, `@types/node`, `eslint`, `prettier`.

Explicitly NOT included: any DB client, any HTTP server, any scheduler library. Railway cron is the scheduler; the process exits after one rebalance attempt.

---

## 3. Cron setup (Railway)

Railway cron jobs run the service command on a schedule; the container runs to completion and exits. `railway.toml`:

```toml
[build]
builder = "NIXPACKS"
buildCommand = "npm ci && npm run build"

[deploy]
startCommand = "node dist/index.js"
restartPolicyType = "NEVER"   # cron runs are one-shot; do not restart on exit(0)

[[cron]]
# 00:05 UTC daily — 5 minutes after signal pipeline finishes its 00:00 close.
schedule = "5 0 * * *"
command = "node dist/index.js"
```

Rationale for `5 0 * * *` (not `0 0 * * *` as in SPEC):
- Signal pipeline writes `signal.json` at 00:00 UTC. A 5-minute buffer avoids a race where the bot reads the prior day's file.
- The freshness guard (§5) is the real defence; the cron offset is just hygiene.

Exit codes:
- `0` — rebalanced successfully OR no-op (deltas below threshold). Healthcheck pings success.
- `1` — guard tripped (stale signal, bad weights, cap exceeded). Alerts fire. Healthcheck pings fail.
- `2` — infrastructure error (RPC timeout, SDK throw). Alerts fire. Healthcheck pings fail.

---

## 4. Environment variables

All required unless marked optional. `.env.example` documents each.

| Var | Example | Purpose |
|---|---|---|
| `SOLANA_RPC_URL` | `https://...helius-rpc.com/?api-key=...` | Mainnet RPC. Use a paid provider; public RPC will rate-limit. |
| `VAULT_PUBKEY` | `7xK...` | Target Symmetry vault pubkey. |
| `VAULT_MINT` | `9aB...` | Vault's LP mint (derived from vault; stored explicitly to avoid re-derivation). |
| `HOT_WALLET_SECRET` | base58 string | Manager keypair. Funded with ~0.5 SOL for tx fees + bounties. Read from Railway secret, never logged. |
| `SIGNAL_PATH` | `s3://fdry-signals/latest.json` or `https://...` | URL or S3 path to latest signal JSON. |
| `SIGNAL_MAX_AGE_SEC` | `7200` | Guard: reject signal older than this. Default 2h. |
| `REBALANCE_THRESHOLD_BP` | `100` | Skip update if max weight delta < this. Default 100 bp (1%). |
| `MAX_POSITION_BP` | `3000` | Guard: reject signal with any weight > this. Default 3000 (30%). |
| `REBALANCE_COOLDOWN_SEC` | `82800` | Guard: min seconds between rebalances. Default 23h. |
| `TELEGRAM_BOT_TOKEN` | `123:ABC...` | For alerts. |
| `TELEGRAM_CHAT_ID` | `-100...` | Destination chat. |
| `HEALTHCHECKS_URL` | `https://hc-ping.com/<uuid>` | Dead-man-switch ping URL. |
| `DRY_RUN` | `true` / `false` | If true, build tx but never send. Logs the tx as base64 for inspection. |
| `PRIORITY_FEE_MICROLAMPORTS` | `50000` | Passed to `SymmetryCore({ priorityFee })`. |
| `LOG_LEVEL` | `info` | pino level. |

---

## 5. Guard implementations

All guards are pure functions in `src/guards.ts`, take `(signal, vault, now)`, return `{ ok: true } | { ok: false, reason: string, severity: 'skip' | 'abort' }`.

`skip` = exit 0, no alert (normal no-op).
`abort` = exit 1, alert fires.

### 5.1 Freshness check
```ts
export function checkFreshness(signal: Signal, nowMs: number, maxAgeSec: number) {
  const ageSec = (nowMs - signal.asOf.getTime()) / 1000;
  if (ageSec < 0)            return { ok: false, severity: 'abort', reason: `signal asOf is in the future by ${-ageSec}s` };
  if (ageSec > maxAgeSec)    return { ok: false, severity: 'abort', reason: `signal stale: ${ageSec}s > ${maxAgeSec}s` };
  return { ok: true };
}
```
Abort (not skip) because a stale signal at rebalance time means the upstream pipeline is broken — humans need to see it.

### 5.2 Weight invariants
```ts
export function checkWeights(signal: Signal, expectedTokens: PublicKey[]) {
  const w = signal.weightsBp;
  if (w.length !== expectedTokens.length)
    return { ok: false, severity: 'abort', reason: `weight count ${w.length} != universe ${expectedTokens.length}` };
  if (w.some((x) => !Number.isInteger(x) || x < 0 || x > 10000))
    return { ok: false, severity: 'abort', reason: `weight out of [0, 10000] bp` };
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum !== 10000)
    return { ok: false, severity: 'abort', reason: `weights sum to ${sum}, expected 10000` };
  return { ok: true };
}
```
The 8-token universe order must match the vault's on-chain token list order (`vault.tokens[i].mint`). Assert mint equality before using indices.

### 5.3 Single-position cap
```ts
export function checkPositionCap(signal: Signal, maxBp: number) {
  const over = signal.weightsBp.findIndex((bp) => bp > maxBp);
  if (over >= 0)
    return { ok: false, severity: 'abort', reason: `position ${over} at ${signal.weightsBp[over]}bp exceeds cap ${maxBp}bp` };
  return { ok: true };
}
```
Default `MAX_POSITION_BP=3000` matches SPEC §7. Tunable via env for future relaxation.

### 5.4 Cooldown
```ts
export function checkCooldown(vault: VaultState, nowMs: number, cooldownSec: number) {
  const lastMs = Number(vault.lastWeightsUpdateTs) * 1000;
  const sinceSec = (nowMs - lastMs) / 1000;
  if (sinceSec < cooldownSec)
    return { ok: false, severity: 'skip', reason: `cooldown: ${sinceSec}s < ${cooldownSec}s` };
  return { ok: true };
}
```
`skip` severity — this is normal and expected if a manual intervention happened in the last 23h.

### 5.5 Delta threshold (no-op check)
```ts
export function checkDelta(signal: Signal, vault: VaultState, thresholdBp: number) {
  const current = vault.tokens.map((t) => t.targetWeightBp);
  const maxDelta = Math.max(...signal.weightsBp.map((w, i) => Math.abs(w - current[i])));
  if (maxDelta < thresholdBp)
    return { ok: false, severity: 'skip', reason: `max delta ${maxDelta}bp < threshold ${thresholdBp}bp` };
  return { ok: true };
}
```

### 5.6 Confidence flag (from signal)
Per SIGNAL_CONTRACT, the signal carries a `confidence: 'high' | 'normal' | 'low'` field (bible energy band). Treat `low` as `skip` with alert-info (not abort) — we want to notice it but not wake anyone up.

Guard order in `index.ts`: freshness → weights → position cap → confidence → cooldown → delta. Fail-fast on first non-ok.

---

## 6. Alerting

Two channels, both fire-and-forget with 5s timeout (alerts never block tx submission, and tx failures never depend on alert success).

### 6.1 Telegram
```ts
async function tg(level: 'info' | 'warn' | 'error', text: string) {
  const emoji = { info: 'i', warn: '!', error: 'x' }[level];
  const msg = `[${emoji}] FDRY bot: ${text}`;
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'MarkdownV2' }),
    signal: AbortSignal.timeout(5000),
  }).catch((e) => logger.warn({ err: e }, 'telegram alert failed'));
}
```
Sent on: abort (error), low-confidence (warn), successful rebalance with delta summary (info), daily heartbeat (info, only if DRY_RUN).

### 6.2 Healthchecks.io (dead-man-switch)
```
https://hc-ping.com/<uuid>         → success
https://hc-ping.com/<uuid>/fail    → failure
https://hc-ping.com/<uuid>/start   → started (optional, lets HC measure duration)
```
Configured on healthchecks.io with schedule `5 0 * * *` and grace period 15m. If the bot doesn't ping within the window, HC alerts via its own channel (email + Telegram backup). This catches the case where the bot itself crashed before it could alert.

Ordering in main loop:
1. Start → `/start`
2. On guard-skip (no-op) → success ping, no Telegram
3. On successful tx → success ping + Telegram info
4. On abort/error → `/fail` ping + Telegram error, then `process.exit(1)` or `(2)`

---

## 7. Main loop pseudocode

`src/index.ts`, ~50 lines. Strict happy-path readable top-to-bottom.

```ts
import pino from 'pino';
import { loadSignal } from './signal.js';
import { loadVault, buildAndSendUpdateWeights } from './symmetry.js';
import * as g from './guards.js';
import { hc, tg } from './alerts.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

async function main() {
  await hc('start');
  const now = Date.now();

  const signal = await loadSignal(process.env.SIGNAL_PATH!);     // fetch + zod-validate
  const vault  = await loadVault(process.env.VAULT_PUBKEY!);     // fetchVault + loadVaultPrice

  for (const [name, check] of [
    ['freshness',   () => g.checkFreshness(signal, now, +process.env.SIGNAL_MAX_AGE_SEC!)],
    ['weights',     () => g.checkWeights(signal, vault.tokens.map(t => t.mint))],
    ['positionCap', () => g.checkPositionCap(signal, +process.env.MAX_POSITION_BP!)],
    ['confidence',  () => g.checkConfidence(signal)],
    ['cooldown',    () => g.checkCooldown(vault, now, +process.env.REBALANCE_COOLDOWN_SEC!)],
    ['delta',       () => g.checkDelta(signal, vault, +process.env.REBALANCE_THRESHOLD_BP!)],
  ] as const) {
    const r = check();
    if (!r.ok) {
      log.info({ guard: name, reason: r.reason, severity: r.severity }, 'guard stopped run');
      if (r.severity === 'abort') { await tg('error', `${name}: ${r.reason}`); await hc('fail'); process.exit(1); }
      await hc('success'); process.exit(0);                      // skip is a clean no-op
    }
  }

  if (process.env.DRY_RUN === 'true') {
    log.info({ weights: signal.weightsBp }, 'DRY_RUN: would rebalance');
    await tg('info', `dry-run rebalance ok, weights=${signal.weightsBp.join(',')}`);
    await hc('success'); return;
  }

  const { txSig, bountyLamports } = await buildAndSendUpdateWeights(vault, signal.weightsBp);
  log.info({ txSig, bountyLamports, weights: signal.weightsBp }, 'rebalanced');
  await tg('info', `rebalanced [tx](https://solscan.io/tx/${txSig}) weights=\`${signal.weightsBp.join(',')}\``);
  await hc('success');
}

main().catch(async (err) => {
  log.error({ err }, 'unhandled');
  await tg('error', `crash: ${err?.message ?? err}`).catch(() => {});
  await hc('fail').catch(() => {});
  process.exit(2);
});
```

---

## 8. 7-day dry-run protocol (before mainnet flip)

Goal: prove the bot is safe to hold the manager key on mainnet before it is. The signal pipeline has already been validated in backtest; this protocol validates the execution harness.

**Days 1–3 — devnet, DRY_RUN=true**
- Deploy bot to Railway with `DRY_RUN=true` and a devnet vault (from Phase 1 of SHIP.md).
- Cron fires at 00:05 UTC daily.
- Verify in Railway logs each morning: signal parsed, all guards evaluated, pseudo-tx built with correct weights, Telegram info msg received, healthchecks.io shows green.
- Day 2: intentionally corrupt `signal.json` (sum ≠ 10000). Verify abort, Telegram error, HC fail ping, exit code 1.
- Day 3: intentionally stale the signal (backdate asOf by 4h). Verify freshness abort.

**Days 4–5 — devnet, DRY_RUN=false (live devnet submission)**
- Flip `DRY_RUN=false`. Bot now actually submits `updateWeightsTx` on devnet.
- Verify the on-chain weights match signal output the next morning.
- Verify keeper auction picked up the intent within the expected window.
- Day 5: trigger a signal with weights identical to on-chain (delta < 100bp). Verify `skip` severity, exit 0, success ping, no Telegram.

**Days 6–7 — mainnet, DRY_RUN=true, real signals, real vault-read**
- Point `VAULT_PUBKEY` at the real mainnet vault (Phase 4 soft-launch vault with own-capital seed).
- Keep `DRY_RUN=true` — bot reads mainnet state and produces logs showing what it would do, but submits nothing.
- Compare logged "would-be" weights against what the signal pipeline produced. Must match exactly.
- Verify priority fee is reasonable at each run (logged).

**Flip criteria (all must hold):**
- Zero unexpected aborts in 7 days.
- All intentional failure injections caught.
- Telegram + healthchecks.io both delivered every signal.
- Devnet on-chain weights matched signal exactly on days 4–5.
- Mainnet dry-run "would-be" weights matched signal exactly on days 6–7.
- Manager wallet still has > 0.3 SOL (fee budget sanity).

If all green → flip `DRY_RUN=false` on mainnet Monday 00:00 UTC (never flip on a Friday). Watch the first live run manually.

---

## 9. Out of scope (v1)

- Multi-vault support (one bot, one vault).
- Intraday rebalancing (cadence matches backtest: daily).
- Fee claiming automation (`withdrawVaultFeesTx` run manually for now).
- Circuit breaker on PnL drawdown (add in v2 once we have live PnL data).
- Keeper fallback (if keeper auction doesn't fill, bot does NOT force-rebalance; it alerts and waits for the next cron).
