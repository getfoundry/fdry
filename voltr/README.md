# @fdry/voltr — v0 rotation bot

Manager cron that reads a v6b daily signal and rebalances a Voltr vault
(long-only, Jupiter spot + Save lending). v0 $100 ceiling.

See `~/Projects/voltr-rotation/SHIP_PLAN.md` §Stage 3 for scope.

## Layout

```
voltr/
├── src/
│   ├── main.ts         # cron entrypoint — the 13-step flow
│   ├── signal.ts       # reads v6b JSON, folds shorts → CASH for v0
│   ├── guards.ts       # shape + sanity + cooldown pre-flight
│   ├── alerts.ts       # telegram + healthcheck (copy of bot/alerts.ts)
│   ├── vault.ts        # Voltr SDK wrapper: fetch state, build ixs, send
│   └── rotate.ts       # target weights → withdraw/deposit plan
├── strategies.json     # (gitignored) output of the admin ceremony
├── package.json
└── tsconfig.json
```

`strategies.json` shape:

```json
{
  "vault": "<pubkey>",
  "vaultAssetMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "assetTokenProgram": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "strategies": [
    {"token":"CASH","pubkey":"<save-usdc-strategy>","adaptor":"save-lending","adaptorProgram":"<...>","tokenMint":"EPjFWdd5Au...","decimals":6},
    {"token":"SOL","pubkey":"<jup-sol-strategy>","adaptor":"jupiter-spot","adaptorProgram":"<...>","tokenMint":"So111...","decimals":9},
    …one per token in the universe
  ]
}
```

## Env

| var | purpose |
|---|---|
| `MANAGER_KEY` | JSON-encoded secret key (array of bytes) for the Manager keypair |
| `RPC_URL` | Solana RPC endpoint |
| `SIGNAL_DIR` | Where to find v6b signal JSONs (default `~/Projects/ebllm/signals_out_v6b`) |
| `STRATEGY_REGISTRY_PATH` | Path to `strategies.json` (default `./strategies.json`) |
| `V0_NAV_CEILING_USDC` | Hard ceiling; refuse to rotate if NAV exceeds this (default 100) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Alerts (optional) |
| `HEALTHCHECK_UUID` | Healthchecks.io dead-man-switch (optional) |
| `SOLANA_CLUSTER` | "mainnet-beta" / "devnet" — for explorer links |

## Commands

```bash
# From fdry root:
pnpm -C voltr install
pnpm -C voltr typecheck
pnpm -C voltr run dry     # dry-run with whatever env is set
pnpm -C voltr run start   # actual rotation
```

## Flow (main.ts)

1. Load env + strategy registry
2. Read latest v6b signal — fail-closed on stale/missing
3. Fold short weights → CASH (v0 long-only policy)
4. Open Voltr client; fetch vault state
5. Compute current weights_bp from allocations
6. Cooldown check (24h)
7. Guards (shape, sum, caps, hot-wallet SOL, NAV ceiling, max delta)
8. Plan rotation (withdraws first, then deposits)
9. Build SDK instructions
10. Send batched versioned txs
11. Append ledger, write state file, alert

Dry-run mode (`--dry-run` or `DRY_RUN=1`) short-circuits before any SDK
call — prints intent + plan, touches no chain.

## Known TODOs before first devnet run

- `buildDepositIx` / `buildWithdrawIx` in `vault.ts` need Jupiter adaptor
  `additionalArgs` / `remainingAccounts` shape from actual Voltr SDK
  docs. Will throw until implemented.
- Admin ceremony script (not in this workspace) must output `strategies.json`.
- Priority fees / Jito bundle sending is v0.1+; `sendBatch` currently
  uses plain `connection.sendTransaction`.
