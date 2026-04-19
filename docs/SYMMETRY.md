# Symmetry Protocol — Reference

Mirror of key Symmetry docs we need. Source of truth: https://docs.symmetry.fi

## Quick Reference

| Item | Value |
|------|-------|
| Program ID | `BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate` |
| SDK package | `@symmetry-hq/sdk` |
| Networks | `mainnet`, `devnet` |
| Chain | Solana |
| License | BUSL-1.1 |
| Max tokens per vault | 100 |
| Max managers per vault | 10 |
| Max oracles per token | 4 |
| Default priority fee | 25,000 micro-lamports |
| Default compute units | 1,000,000 |
| Status | V3 mainnet beta (live Apr 17, 2026) |

## Oracle sources supported

- Pyth
- Raydium CLMM
- Raydium CPMM
- LST (SPL stake pool / Sanctum stake pool)

FDRY is not priced by any of these. FDRY cannot be a held asset inside a Symmetry vault.

## SDK install

```bash
npm install @symmetry-hq/sdk @solana/web3.js @coral-xyz/anchor
```

## SDK bootstrap

```typescript
import { Connection } from "@solana/web3.js";
import { SymmetryCore } from "@symmetry-hq/sdk";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const sdk = new SymmetryCore({
  connection,
  network: "mainnet",
  priorityFee: 50_000,
});

const vaults = await sdk.fetchAllVaults();
let vault = await sdk.fetchVault("<VAULT_PUBKEY>");
vault = await sdk.loadVaultPrice(vault);
```

## Operation → SDK call map

| Operation | SDK call |
|---|---|
| Create vault | `createVaultTx` |
| Add/edit underlying token | `addOrEditTokenTx` |
| Set target weights | `updateWeightsTx` |
| Deposit | `buyVaultTx` → `lockDepositsTx` (keeper auction) |
| Fast-path withdraw (skip auction) | `sellVaultTx` with `keep_tokens=[all mints]` → `redeemTokensTx` |
| Trigger rebalance | `rebalanceVaultTx` (keeper-initiated) |
| Claim accumulated fees | `withdrawVaultFeesTx` |
| Read live vault state | `fetchVault` → `loadVaultPrice` |

## Roles

- **Creator** — creates vault, receives creator fees, can transfer the role. Our `CREATOR_WALLET`.
- **Host** — platform that hosts UI, receives host fees (immutable after creation). We set host = 0 bp (no separate host).
- **Managers** (up to 10) — control vault settings per authority bitmask, receive manager fees split by weight. Our `HOT_WALLET` with `UPDATE_WEIGHTS + TRIGGER_REBALANCE`.
- **Keepers** — off-chain agents that execute intents, process rebalances, update prices, earn bounties. We rely on the permissionless keeper network; we don't need to run our own.
- **Users** — deposit tokens to receive vault tokens; burn vault tokens to withdraw underlying.
- **Symmetry Protocol** — collects global-config protocol fees.

## Architecture (Symmetry-side)

```
┌────────────────────────────────────────────────┐
│              Vault (on-chain PDA)              │
│  ┌──────────────────────────────────────────┐  │
│  │ Token Holdings (SPL + Token22, up to 100)│  │
│  │ Target Weights (bp, sum = 10000)         │  │
│  │ Oracle Aggregators (per token, max 4)    │  │
│  │ Fee Settings (4 tiers × 4 categories)    │  │
│  │ Vault Token Mint (share token)           │  │
│  └──────────────────────────────────────────┘  │
└────────────────────┬───────────────────────────┘
                     │
       ┌─────────────┼─────────────┐
       │             │             │
  ┌────┴────┐   ┌────┴────┐   ┌────┴────┐
  │ Intents │   │Rebalance│   │ Keepers │
  │ (config │   │ Intents │   │ (off-   │
  │ changes)│   │(dep/wd/ │   │ chain)  │
  │         │   │ rebal)  │   │         │
  └─────────┘   └─────────┘   └─────────┘
```

## Fees — what's live

IMPORTANT: Symmetry's global config currently disables all management-class fees. Setting non-zero creator/management/performance fees in vault configuration has no effect until Symmetry governance enables them. Verify via `sdk.fetchGlobalConfig()` before relying on any fee lane.

| Fee category | Status | Notes |
|---|---|---|
| Creator | architecturally live; currently disabled at protocol global config (management-class fees disabled as of 2026-04-20) | our intended 2% annual operator income lane — gated by `management_fee_bps` global flag |
| Host | live | set to 0 bp |
| Deposit | live | set to 0 bp |
| Withdrawal | live | our 50 bp soft-retention fee |
| Management | disabled at protocol level (same as creator — both gated by `management_fee_bps` global flag) | set to 0 bp (creator fee covers operator) |
| Performance | **disabled at protocol level** | cannot use 10% profit share via Symmetry today |

## Intents

Two types:
- **Configuration intents** — change weights, add/remove tokens, etc. Pushed by managers per their authority bitmask.
- **Rebalancing intents** — deposits, withdrawals, and rebalance triggers. Executed by permissionless keepers for bounties.

Our bot uses configuration intents via `updateWeightsTx` to push new target weights daily. Keepers then auto-rebalance toward those weights.

## Documentation references

- Introduction: https://docs.symmetry.fi/
- Quickstart: https://docs.symmetry.fi/quickstart
- Protocol Overview: https://docs.symmetry.fi/concepts/overview
- Vaults: https://docs.symmetry.fi/concepts/vaults
- Intents: https://docs.symmetry.fi/concepts/intents
- Rebalancing: https://docs.symmetry.fi/concepts/rebalancing
- Fees & Oracles: https://docs.symmetry.fi/concepts/fees-and-oracles
- Global Config: https://docs.symmetry.fi/concepts/global-config
- Keeper Infrastructure: https://docs.symmetry.fi/guides/keeper
- Integration Examples: https://docs.symmetry.fi/guides/examples
- SDK Reference: https://docs.symmetry.fi/sdk/reference
