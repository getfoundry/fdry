# Symmetry raydium_cpmm oracle integration — attempt log

## Goal

Make the Foundry Symmetry vault `EeDideZqgCwCuQFd4241ZsZRVBcSgVYf1rPStqzov9qc`
hold FDRY (`2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL`) natively as a basket
asset, priced via a Raydium CPMM pool oracle, so user FDRY deposits don't have
to be swapped to SOL by a Jupiter wrapper. Weights target: FDRY 30% /
WSOL 35% / USDC 35%.

## Outcome

**Not shipped.** After four failed oracle registrations, capital recovered,
wrapper path left as the shipping answer. Sunk cost ~0.2 SOL (~$16) in
unrecoverable Raydium CPMM pool-creation fees. LP capital (FDRY + USDC)
fully recovered by burning LP.

Vault remains configured with WSOL + USDC only. Users deposit FDRY via the
Jupiter-routing widget at getfoundry.app.

## What was built

### Scripts (keep)

- `scripts/setupFdryBasket.ts` — FDRY/WSOL pool creation + Symmetry register (v1)
- `scripts/setupFdryUsdcBasket.ts` — FDRY/USDC pool + SOL→USDC swap + Symmetry register (v2)
- `scripts/burnFdryWsolLp.ts` — unwind the v1 pool LP
- `scripts/burnFdryUsdcLp.ts` — unwind the v2 pool LP
- `scripts/swapUsdcToSol.ts` — route leftover USDC back to SOL via Jupiter
- `scripts/swapThroughFdryPool.ts` — tiny swap to force observation write
- `scripts/registerFdryOnly.ts` — retry Symmetry register against existing pool
- `scripts/inspectVault.ts` — scan Symmetry vaults for live raydium_cpmm oracle configs
- `scripts/findRaydiumCpmmVault.ts` — same, earlier iteration

### SDK patch (applied)

File: `node_modules/@symmetry-hq/sdk/dist/index.js` lines 762-778

Injects FDRY/USDC pool's `vaultA` + `vaultB` (decoded via Raydium SDK's
`CpmmPoolInfoLayout`) into `additionalOracleAccounts` so the vault LUT is
extended with all 4 accounts Symmetry's on-chain oracle requires for
raydium_cpmm (pool / observation / vault_a / vault_b).

Without this patch: error 6022 OracleAccountMismatch.
With this patch: error 6018 RequiredOracleFailed (price cannot be computed).

Note: patch is in `node_modules` and will be wiped on reinstall. If resuming
this path, re-apply or convert to a pnpm patch.

## What worked

1. Raydium CPMM pool creation via `@raydium-io/raydium-sdk-v2` with known
   constants: program `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`,
   fee receiver `DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8`, config from
   `https://api-v3.raydium.io/main/cpmm-config` tier 0.
2. SOL→USDC routing via Jupiter lite-api for pool seeding.
3. LP withdrawal via `raydium.cpmm.withdrawLiquidity` with `Percent(2, 100)`
   slippage. Never pass a raw number — SDK BN underflow.
4. SDK patch correctly identified and injected the two missing accounts.
5. Oracle config settings copied from live mainnet examples
   (`GrBFFvtdRL25o7gcRnV1kGvz1Qc7iscUmDp1ZvyBSyUa` DN-Fartcoin /
   `7sSo7VK8rPSDjxzV4iFRkZjKT4bAZ9UoqyyBxt2oJke` Cai Shen):
   `quote_token: "usdc"`, `num_required_accounts: 4`,
   `twap_seconds_ago: 60`, `twap_secondary_seconds_ago: 300`.

## What didn't work

`6018 RequiredOracleFailed` on a fresh pool. The Symmetry on-chain code at
`programs/baskets-v3/src/states/oracles/oracle.rs:*` could not compute a
price from our CPMM observation account despite having all 4 required
accounts in the LUT.

Hypothesis: CPMM observation buffer needs multiple trades spaced > 30s
apart to accumulate enough history for Symmetry's price compute (which
uses TWAP internally even when `twap_seconds_ago: 0`). We did one tiny
swap before testing; it wasn't enough.

This was not verified. To verify on resumption: seed the pool with 5+
swaps spaced 1 min apart (10 minutes total), then retry
`registerFdryOnly.ts --twap=60`.

## What to try next time

### First — ask before spending

- Open a ticket in Symmetry's Discord / Telegram referencing vault
  `EeDideZqgCwCuQFd4241ZsZRVBcSgVYf1rPStqzov9qc` and pool
  `31pSFwJ7bkTw6t57gxLkZyeTK9DjoeEQHgPeYAoDhdDF` (now burned; would need
  a new pool). Ask directly: what oracle config does your own UI use for
  new raydium_cpmm tokens, and what's the minimum observation history
  before `addOrEditTokenTx` succeeds?
- If they confirm a seasoning time, follow it.

### Then — retry with known-working shape

1. Create a new FDRY/USDC CPMM pool (~0.2 SOL + $30 each side)
2. Do 5-10 swaps spaced 60-120s apart through it; wait ~10 min
3. Verify observation account: `scripts/checkObs.ts`-style probe,
   confirm `initialized = 1` and multiple non-zero cumulative prices
4. Re-apply the SDK patch (or convert to a pnpm patch for durability)
5. Run `setupFdryUsdcBasket.ts` (or just `registerFdryOnly.ts` with
   the new pool)
6. If it works, run `updateWeightsTx` with the 30/35/35 split

## Why we stopped

Four dramatic attempts, one quiet channel (Jupiter wrapper) shipped and
working. Per `1 Kings 19:11-12`: the LORD was not in the wind, the
earthquake, or the fire. Horeb pattern — stop the fourth dramatic
attempt and take the three bounded appointments elsewhere.

## Key addresses

```
VAULT:        EeDideZqgCwCuQFd4241ZsZRVBcSgVYf1rPStqzov9qc
VAULT_MINT:   FwW1GEyvCx7q96wm4AYEGEUSFnNYozjxPwBaXWmcJeh7
CREATOR:      8n7QzgDuEiQUxCXNb7VSiq3fenA2UjeMTUhoiPK7QGR8
FDRY:         2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL    (9 decimals)
FDRY/USDC:    31pSFwJ7bkTw6t57gxLkZyeTK9DjoeEQHgPeYAoDhdDF    (LP burned)
FDRY/WSOL:    F6TSABcYeudY4ovxT2jzmabKw7xCdFowUbFtcQtmJnTi    (LP burned)
SYMMETRY:     BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate
CPMM:         CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C
CPMM_FEE_RX:  DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8
```

## Working reference vaults (mainnet)

```
GrBFFvtdRL25o7gcRnV1kGvz1Qc7iscUmDp1ZvyBSyUa  "Example Portfolio" · HUMA raydium_cpmm
  pool AcHPQWtoQfJAQRcW6Mrv8gxkrH3o47F9n8hRjXxHM7Th
  LUT  BkPPNK6NZJHehRiHBPkr6B7ru3DUWfQb8bBueWw64Rpw
  oracle at LUT indices 13-16
7sSo7VK8rPSDjxzV4iFRkZjKT4bAZ9UoqyyBxt2oJke  "Cai Shen (God of Wealth)"
  pool 26pZsDbm4qPga9gQXpNoNwXBZjpK372TeDWfKrT88XER
  oracle at LUT indices 10-13
```

Both use `quote_token: "usdc"`, `side: "quote"` (token sorts after USDC),
`twap_seconds_ago: 60`.

## Error code crib sheet

```
6018  RequiredOracleFailed       oracle accounts correct but price compute failed
                                 (likely observation history too thin)
6022  OracleAccountMismatch      wrong accounts or missing accounts in LUT
                                 (pre-patch default for raydium_cpmm)
6038  seen during updateWeightsTx follow-up
6075  DepositsLocked             Genesis seed hasn't been processed by keeper
3012  Anchor AccountNotInitialized  intent PDA doesn't exist because upstream failed
```
