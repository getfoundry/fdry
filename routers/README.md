# fdry / routers

Per-source revenue routers that convert off-chain revenue into on-chain vault
deposits (stFDRY). Every router is a self-contained script; each output line
lands in the same **`ledger/revenue.jsonl`** file, tagged by `source`.

## Concept

```
revenue source  ──►  router script  ──►  swap (optional)  ──►  vault deposit  ──►  ledger/revenue.jsonl
(unbrowse, …)      (routers/<name>.ts)   (Jupiter USDC->SOL)   (Symmetry buy+lock)    (append-only JSONL)
```

- **One file per revenue source.** `unbrowse.ts` handles Unbrowse revenue;
  future sources get their own file (`resend.ts`, `stripe.ts`, `partnerX.ts`).
- **Shared output.** All routers append to `ledger/revenue.jsonl`. Categories
  are tracked by the `source` field — the ledger snapshot reads the file and
  produces the *revenue by source* breakdown.
- **Category memo.** Each on-chain deposit is tagged with a human-readable
  memo like `unbrowse_revenue_2026_W16` so that tx history stays auditable
  even if the JSONL is lost.

## `ledger/revenue.jsonl` schema

One JSON object per line. Machine-readable — `jq -c`, `grep`-friendly,
append-only. Minimum required fields:

```json
{"ts":"2026-04-20T12:34:56.000Z","source":"unbrowse","amount_usd":500,"amount_sol":5.88,"tx_sig":"5xk…abc","memo":"unbrowse_revenue_2026_W16"}
```

Full field list written by `unbrowse.ts`:

| field              | type     | description                                            |
| ------------------ | -------- | ------------------------------------------------------ |
| `ts`               | ISO-8601 | Timestamp of ledger write.                             |
| `source`           | string   | Revenue source name (`unbrowse`, `resend`, …).         |
| `amount_usd`       | number   | USD notional routed in this call.                      |
| `amount_sol`       | number   | Equivalent SOL at Pyth spot.                           |
| `tx_sig`           | string   | Primary vault-buy signature (or `DRY_RUN`).            |
| `memo`             | string   | Category memo, e.g. `unbrowse_revenue_2026_W16`.       |
| `pyth_sol_usd`     | number   | SOL/USD spot used for conversion.                      |
| `buy_signatures`   | string[] | All Symmetry `buyVaultTx` signatures.                  |
| `lock_signatures`  | string[] | All Symmetry `lockDepositsTx` signatures.              |
| `swap_signature`   | string?  | Jupiter USDC->SOL swap sig (when `--from=usdc`).       |
| `dry_run`          | boolean  | `true` if produced under `--dry-run` (not appended).   |

The ledger snapshot tool reads this file and aggregates by `source` for the
"revenue by source" breakdown.

## Running a router

```bash
# dry-run (no network-sensitive SDK calls, just preview)
tsx routers/unbrowse.ts --amount-usd=500 --source=unbrowse --dry-run

# live, SOL already in creator wallet
tsx routers/unbrowse.ts --amount-usd=500 --source=unbrowse

# live, starting from USDC (swap via Jupiter first)
tsx routers/unbrowse.ts --amount-usd=500 --source=unbrowse --from=usdc

# explicit memo override
tsx routers/unbrowse.ts --amount-usd=500 --memo=unbrowse_revenue_2026_W16
```

Env required for live runs: `CREATOR_WALLET`, `RPC_URL` (default mainnet),
optional `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` for the success alert.

## Adding a new revenue source

1. Copy `unbrowse.ts` to `routers/<new-source>.ts`.
2. Change the default `source` in `parseArgs()` (or always pass `--source`).
3. Update the `buildDefaultMemo()` prefix if you want a distinct memo.
4. If the revenue arrives in a non-USDC stable or another token, extend
   `--from=` handling (the Jupiter swap helper is generic — swap in the mint).
5. If you want automated reads later, implement `readRevenueFromBillingApi()`
   for that source's API and call it when `--amount-usd` is not given.
6. Confirm `--dry-run` produces a record preview with the correct `source`
   and `memo` before running live.
7. That's it — the ledger snapshot will automatically pick up the new source
   via the `source` field.

## Design notes

- **Best-effort Telegram alerts.** Never block the route on alert delivery —
  `alertTelegram()` swallows errors. Missing creds = silent, by design.
- **Append-only.** Never rewrite `revenue.jsonl`; that would break history.
  If you need to correct a line, add a compensating entry with a distinct
  memo (e.g. `…_reversal`).
- **Pyth for pricing.** SOL/USD comes from Hermes, not from a swap quote.
  Keeps `amount_sol` comparable across routers regardless of swap routing.
