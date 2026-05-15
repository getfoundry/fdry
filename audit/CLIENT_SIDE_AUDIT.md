# fdry frontend — client-side audit handoff

Companion to `voltr-rotation/audit/SMYRNA_4H_LIVE_HANDOFF.md`. That doc
covers the strategy + manager-side. This one covers the wallet-signed
client surface that real users actually touch.

## Why this matters

The fdry frontend is the only path most users will use to deposit or
withdraw. If the manager-side is perfect but the client builds the wrong
transaction, signs against the wrong vault, or lies about NAV, users
lose money or get sandbagged. The audit must verify that the client is
non-custodial, deterministic, and truthful.

## Architecture

```
User wallet (Phantom/Solflare/Ledger/etc.)
  ↓ sign
DepositWidget.tsx
  └── voltrUserClient.ts → @voltr/vault-sdk
       └── createDepositVaultIx / createInstantWithdrawVaultIx
            ↓ broadcast
       Voltr program (vVoLTRjQmtFp...)
            ↓
       Vault account Bpr49sQXsxw...

Reads (RPC, no signing):
  useLiveTreasury    → vault.idle FDRY balance, NAV/share, FDRY/USD price
  useVaultInfo       → on-chain vault account (asset/lp/decimals/manager)
  StrategyLivePanel  → fetch voltr.getfoundry.app/api/naut/* (read-only)
  UnderdogEquityChart→ fetch /backtest_smyrna_4h.json (static asset)
```

## Vault facts (must be hardcoded, never user-input)

`frontend/src/lib/voltrConfig.ts` is the single source of truth:

| const | value |
|---|---|
| `VAULT_PUBKEY` | `Bpr49sQXsxwNXNMRWS2v3tTBGWu2QgZtdA83BX77xBX1` |
| `LP_MINT` | `G8e9i9RADPsxJtiCJsGC4tSx2kgCkGbEkdn7aajt2nqW` |
| `VAULT_ASSET_MINT` | `2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL` (FDRY) |
| `VOLTR_PROGRAM_ID` | `vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8` |
| `CREATOR_WALLET` | `8n7QzgDuEiQUxCXNb7VSiq3fenA2UjeMTUhoiPK7QGR8` |
| `FDRY_DECIMALS` | 9 |

**Audit invariant:** every component that builds a deposit/withdraw tx
imports from `voltrConfig.ts`. Grep `Bpr49sQXsxw|G8e9i9RADP|2ZiSPGn` to
catch any hardcoded base58 strings outside that file.

## What an auditor must verify

### Wallet security

1. **No private key ever leaves the client.** All signing is delegated to
   `useWallet().signTransaction` from `@solana/wallet-adapter-react`. The
   backend is never asked for a key. Grep `secretKey|privateKey|keypair`
   in `frontend/src/` — should only appear in test fixtures, not in any
   user-flow component.
2. **Only `@solana/wallet-adapter-wallets` adapters mounted.** See
   `frontend/src/main.tsx:wallets`. Phantom, Solflare, Ledger, Trust,
   Coinbase. No custom adapter that could exfiltrate.
3. **WalletProvider `autoConnect` semantics.** Set true; standard. Verify
   no auto-sign-on-load anywhere.
4. **No backend-initiated tx.** Search for `fetch.*POST` followed by
   anything that resembles a tx body. Should only be read-only API
   calls (`/api/naut/*`).

### Deposit flow correctness

5. **Tx builder uses the correct vault + LP mint + asset mint.**
   `voltrUserClient.ts:buildDepositVaultIxs` constructs:
   - `createAssociatedTokenAccountIdempotentInstruction` for asset ATA
     (idempotent, harmless if already exists).
   - `createAssociatedTokenAccountIdempotentInstruction` for LP ATA.
   - `ComputeBudgetProgram.setComputeUnitLimit` (default 400k CU).
   - `client.createDepositVaultIx(...)` — the actual deposit.
   Verify the `vaultAssetMint` and `lpMint` arguments come from
   `voltrConfig.ts`, not from any user-controlled prop.
6. **Amount parsing is precision-safe.** `decimalAmountToBaseUnits`
   rejects negative, non-numeric, and over-precision input BEFORE the
   tx is built. Read `voltrUserClient.test.ts` for the asserted edges.
7. **No silent override of the vault address.** `DepositWidget` accepts
   a `vaultPubkey` prop, used in `frontend/src/pages/vault.tsx` and
   `frontend/src/pages/Vaults.tsx`. The vault page passes the canonical
   address from `voltrConfig.ts` / `lib/vaults.ts`. There is no path
   where a query string or random RPC response can flip the vault.
8. **Token program detection.** FDRY is classic SPL Token; hardcoded as
   `ASSET_TOKEN_PROGRAM = TOKEN_PROGRAM_ID` in `DepositWidget.tsx`. For
   other-asset vaults, `getAssetTokenProgram` (used in
   `scripts/lib/rangerConfig.ts`) detects Token vs Token-2022. Verify
   no path where a Token-2022 mint gets routed to TOKEN_PROGRAM_ID.

### Withdrawal flow correctness

9. **Instant withdraw goes through the same SDK.**
   `buildInstantWithdrawVaultIxs` builds the parallel set of ixs.
   Withdrawal authority remains the user's wallet, not any operator.
10. **`withdrawal_waiting_period`**: config declares 259_200s (3d) in
    `scripts/lib/rangerConfig.ts:DEFAULT_VAULT_CONFIG`; live vault was updated
    on-chain to 259_200s via `updateRangerWaitingPeriod` tx
    `5XBDEpeJHjRRKmGv1zdBJ4fX5WcyHwQHenxEeAsKX7LYpA9aVWfxu538XBwDuRFzQHheGuh4Gv16MWqKxyHrh8Yv`.
    With this non-zero value, the instant path raises
    `InstantWithdrawNotAllowed (6015)` and the UI must use
    `createRequestWithdrawVaultIx` + a later claim ix; gate UX on the
    on-chain config readback, not on a hardcoded toggle.
11. **Burn-then-redeem atomicity.** The Voltr program handles burn and
    redeem in one tx. The client never holds an intermediate state.

### Display honesty

12. **Strategy mode is server-controlled, not hardcoded in the bundle.**
    `VaultStrategyPanel` reads `mode` from
    `voltr.getfoundry.app/api/naut/vault_link`. Default is `paper`. A
    fresh deploy with no API connectivity stays on `paper`. Verify the
    audit-time bundle doesn't ship a hardcoded `mode = "live"`.
13. **NAV displayed = on-chain truth.** `useLiveTreasury` reads vault
    asset balance + LP supply directly from RPC (no server). NAV/share
    = asset balance × FDRY/USD price ÷ LP supply. Pyth Hermes is the
    price oracle. If Pyth degrades, the UI shows a stale-data badge
    (verify in `useLiveTreasury.ts`).
14. **Backtest cards are clearly labeled "backtest" / "paper".** No card
    can show paper P&L as if it were real $. Walk
    `UnderdogEquityChart` and `StrategyLivePanel` — every $ value must
    be accompanied by a "paper" / "backtest" / "live" tag.
15. **No promise of returns.** Search the bundle for "APY", "yield",
    "guaranteed", "returns of". Should be zero hits in the deposit-flow
    components.

### Disclosure & risk-acknowledgement

16. **`DepositGate` blocks the widget on first visit.** Reads
    `localStorage:fdry:risk-ack:v1`. User must check the box before the
    widget renders. Verify the gate's text covers: NAV volatility, no
    yield promise, FDRY price churn, no operator backstop.
17. **`VaultExplainerCard` is the first read.** Three PEEL paragraphs:
    stFDRY mechanic, NAV volatility, FDRY price volatility.
18. **`VaultStrategyPanel` shows current mode + 30%/70% policy.** No UI
    state where the strategy can claim "live" while serving paper
    numbers (or vice versa).

### RPC trust

19. **RPC is publicnode by default.** `frontend/src/main.tsx:RPC =
    "https://solana-rpc.publicnode.com"`. A malicious RPC could lie
    about confirmations or return wrong account data, but cannot
    extract user funds (signing happens in the wallet, against the
    user's own RPC if they choose). Document RPC choice; consider
    Helius/Triton for production.
20. **No backend proxy for tx submission.** `useConnection().sendTransaction`
    sends through whatever RPC the wallet adapter uses. The fdry
    backend is not in the signing path.

### Tests + regression

21. **`pnpm test` clean.** `frontend/src/lib/voltrUserClient.test.ts`
    covers amount parsing edges.
22. **`pnpm typecheck` clean.** Strict TS; no `any` smuggled into a
    transaction-build path.
23. **Build is deterministic.** Same source → same bundle hash. Verify
    by building twice in clean checkouts.

### What NOT to do (red flags for the auditor)

- A signed tx body that contains an instruction not in
  `voltrUserClient`'s output. If the tx adds an extra `sendIx` to a
  non-Voltr program, the user could be tricked.
- Any path where backend response data ends up in a tx field
  (vault pubkey, mint, recipient).
- A "skip the gate" query string param.
- Any logging of the user's full pubkey to a 3rd-party (PostHog,
  Sentry, GA, etc.). pubkey is identifying.
- Any code path where `connection.sendRawTransaction(serialized)` is
  called by the backend.

## Files an auditor must read

In rough order of value-moving impact:

1. `frontend/src/lib/voltrUserClient.ts` — the tx builder
2. `frontend/src/lib/voltrConfig.ts` — single source of vault addresses
3. `frontend/src/components/DepositWidget.tsx` — user-flow component
4. `frontend/src/components/DepositGate.tsx` — risk acknowledgement
5. `frontend/src/main.tsx` — wallet adapter setup, RPC, providers
6. `frontend/src/pages/vault.tsx` — page composition
7. `frontend/src/hooks/useLiveTreasury.ts` — NAV calculation
8. `frontend/src/hooks/useVaultInfo.ts` — chain reads
9. `frontend/src/components/VaultStrategyPanel.tsx` — strategy mode UI
10. `frontend/src/components/VaultExplainerCard.tsx` — disclosure copy
11. `frontend/src/components/StrategyLivePanel.tsx` — live perf panel
12. `frontend/src/components/UnderdogEquityChart.tsx` — equity chart
13. `frontend/src/lib/voltrUserClient.test.ts` — unit tests

## Cross-linked items in the strategy audit

These items in `voltr-rotation/audit/SMYRNA_4H_LIVE_HANDOFF.md` directly
affect what the client displays:

- Item 4 (LiveTrader is a stub): the client cannot currently trade
  vault funds because the Python LiveTrader raises NotImplementedError.
  `VaultStrategyPanel` reflects this with `mode: paper`.
- Item 9 (Deploy cap): the 30% number shown in the UI must match
  `VOLTR_DEPLOY_PCT_OF_VAULT` on the VM and `DEPLOY_PCT_OF_VAULT` in
  `executor/src/provision.ts`. All three must agree before live.
- Item 13 (Stale NAV): when manager attests less often than NAV moves,
  the UI's NAV/share display lags the strategy's realized performance.
  Document this UX gap for users who expect mark-to-market.
- Item 14 (Withdrawal during open position): if the operator decides
  to freeze instant_withdraw while holding, the UI must show that
  policy prominently. Currently `VaultExplainerCard` says "you can
  withdraw at any time." If the policy changes, this copy must change.

## Smoke test checklist (auditor reproducible)

Before sign-off, an auditor should run:

```bash
cd frontend
pnpm install
pnpm test
pnpm typecheck
pnpm build
# Verify bundle hash matches what's deployed on getfoundry.app

# Manual: connect a fresh wallet on devnet (set RPC to devnet RPC)
# 1. Visit /vault — confirm DepositGate fires
# 2. Acknowledge risk → see DepositWidget
# 3. Build a deposit tx, do NOT broadcast — inspect ix list:
#    - createATAIdempotent for asset mint
#    - createATAIdempotent for LP mint
#    - setComputeUnitLimit
#    - Voltr deposit ix (verify program ID matches voltrConfig.VOLTR_PROGRAM_ID)
# 4. Confirm no extra ixs (no transfers, no other-program calls)
# 5. Build a withdraw tx — same inspection
```

## What I'd add later (not blocker)

- A "your share of vault" calculator that simulates deposit at current
  NAV (already partially in DepositWidget; verify accuracy).
- A "history" tab showing the user's past deposits/withdrawals via
  Solscan API.
- 2FA-style "type the vault pubkey to confirm" on first deposit.
- Integration test with @solana-developers/helpers fake wallet to
  exercise the full sign+broadcast path on devnet in CI.

---

# Kalshi rail — additions (Day-6 of Kalshi mirror loop)

> The Kalshi rail (via DFlow CLP) layers on top of the Jup rail and inherits every invariant above (vault facts, deposit/withdraw flow correctness, wallet security, display honesty, RPC trust). Additions below are the surface unique to Kalshi.

## Domain allowlist (DFlow APIs)

Both DFlow clients hard-allowlist hostnames at construction. Anything outside the list throws `DflowDomainNotAllowed` *before* any HTTP byte moves.

- `voltr/src/follower/dflowMetadataClient.ts` — constant `DFLOW_ALLOWED_HOSTS`.
- `voltr/src/follower/dflowQuoteClient.ts` — equivalent locally-declared allowlist.
- Today's allowlist (dev surfaces, mainnet-beta data):
  - `dev-prediction-markets-api.dflow.net`
  - `dev-quote-api.dflow.net`
- Prod hostnames added post-Builder-Codes registration in the kalshi-deploy-loop.
- Auditor check: grep both modules for `fetch(`; every call resolves to a URL whose host is asserted against `DFLOW_ALLOWED_HOSTS` first.

## On-chain audit-witness program ID

- Crate: `programs/fdry-kalshi-adaptor/` — `lib.rs::declare_id!`.
- Today's value: `11111111111111111111111111111111` (PLACEHOLDER — system program). Refused at TS boot gate while placeholder.
- Real program ID generated by `cargo build-sbf` in the kalshi-deploy-loop, rotated through the M5 procedure.

## 169-byte wire format pinning (Seam 5)

The TS validator client and Rust adaptor agree byte-for-byte on the `validate_kalshi_order` payload.

- TS: `voltr/src/follower/kalshiValidatorClient.ts` — `pack()` and `rustStyleUnpack()` use the same offset constants; output length always 169 bytes.
- Rust: `programs/fdry-kalshi-adaptor/src/constants.rs` — `KALSHI_VALIDATOR_PAYLOAD_LEN: usize = 169`.
- Layout:

```
byte 0:        discriminator (consumed by process_instruction dispatch)
bytes 1..33:   marketId UTF-8, right-padded with 0x00 to 32 bytes
bytes 33..65:  yesMint  (32 bytes)
bytes 65..97:  noMint   (32 bytes)
bytes 97..129: inputMint  (32 bytes)
bytes 129..161:outputMint (32 bytes)
bytes 161..169:amount as little-endian u64
```

- Drift-guards (the lights on this seam):
  - `kalshiValidatorClient.driftGuard.test.ts` — `pack() → rustStyleUnpack()` round-trip on random inputs (A6).
  - `kalshiNativeSigner.driftGuard.test.ts` — reads canonical pubkeys table in `docs/research/dflow-cli-program.md`, asserts every PINNED row appears verbatim in signer module (A5).

## Boot gate — the four named refusals (A4)

Before iteration 0 in `live` or `test` mode for the Kalshi venue, four named refusals must clear. Any one trips a distinct error code.

- `voltr/src/follower/boot.ts` — function `kalshiGate(env)`.
- Codes:
  - `boot.kalshi.env_unset` — any of `DFLOW_API_KEY` / `DFLOW_KYC_VERIFIED_PUBKEY` / `DFLOW_KALSHI_VALIDATOR_PROGRAM_ID` unset.
  - `boot.kalshi.kyc_drift` — `DFLOW_KYC_VERIFIED_PUBKEY !== manager.publicKey`.
  - `boot.kalshi.placeholder_program_id` — `DFLOW_CLP_PROGRAM_ID === "11111111111111111111111111111111"`.
  - `boot.kalshi.placeholder_discriminator` — `DFLOW_ORDER_DISCRIMINATOR` is the all-zero array.
- Test: `boot.kalshiGate.test.ts` — 8 tests (4 named rows + paper-mode bypass + venue-disabled bypass + happy-path + sub-row for first-missing-wins).

## Drift comparator — actual terminals only (Seam 7)

- `voltr/src/follower/kalshiCloseAndUnwind.ts`.
- Formula: `drift = abs(actualClaimedMicroUsd − fdryReturnedMicro)`.
- Gate: `MAX_DRIFT_MICRO_USD = 10_000n` ($0.01).
- `expectedPayoutMicroUsd` is carried through to the result + ledger for display only — never an input to the gate.
- Regression test: `kalshiCloseAndUnwind.test.ts::Seam-7: losing trade does NOT trip drift`.

## Append-only ledger venue tag (Seam 8)

- `voltr/src/follower/paperLedger.ts` — Zod field `venue: z.enum(["jup", "kalshi"]).default("jup")`.
- Backward-compat: legacy ndjson rows missing the field parse as `"jup"`.
- All Kalshi callers pass `venue: "kalshi"` explicitly.
- Auditor grep: `grep '"venue":"kalshi"' ~/.fdry/paper-trades.ndjson`.

## Manager-wallet exposure window

Between LEG-1 (deposit_swap completes, USDC lands in manager EOA) and LEG-2 (DFlow `/order` submits, USDC leaves toward DFlow CLP), the manager EOA holds vault-sourced USDC for ~5 seconds. Phase-1 hard cap `PHASE1_HARD_CAP_USDC_MICRO = 100_000_000n` ($100) ceilings worst-case exposure. Kill-switch (`killSwitchSurface.ts`) halts new iterations within one tick.

## Tests + regression (Kalshi rail)

Auditor count check:

```bash
ls voltr/src/follower/kalshi*.test.ts | wc -l
ls voltr/src/follower/dflow*.test.ts | wc -l
```

Minimum surface at Day-6 close (all green):

- `dflowMetadataClient.test.ts`, `dflowQuoteClient.test.ts`
- `kalshiMarketResolver.test.ts` + `kalshiMarketResolver.snapshotIntegrity.test.ts` (spoof #7 ≥2-layer)
- `kalshiNativeSigner.test.ts` + `kalshiNativeSigner.driftGuard.test.ts` (A5)
- `kalshiValidatorClient.test.ts` + `kalshiValidatorClient.driftGuard.test.ts` (A6, 169B round-trip)
- `kalshiSwapAndOrder.test.ts` (A14 Seam-6 leg-2 wrap verified)
- `kalshiCloseAndUnwind.test.ts` (Seam-7 regression verified)
- `boot.kalshiGate.test.ts`
- `kalshi.e2e.test.ts` (Day-6)

Additional scenarios/composition/spoof/edge files are queued for the auditor-handoff loop — tracked in `docs/HANDOFF-KALSHI-WIRING-MIRROR.md`.

## Red flags for the auditor (Kalshi-specific)

- A pure-CPI Kalshi adaptor that wraps DFlow tx in Anchor CPI. Q1 wall is named-impossible.
- A vault PDA passed as `userPublicKey` to DFlow `/order`. Q2 wall: Proof KYC binds to one EOA.
- A drift comparison against `expectedPayoutMicroUsd`. Reverted Edge #5 bug.
- Any synthesized or hardcoded slug→ticker mapping table in `kalshiMarketResolver.ts`. Substrate principle: structural transform only.
- Any boot path that allows `live` while a PLACEHOLDER constant is unrotated.
