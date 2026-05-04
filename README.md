# fdry

FDRY's current public contract interface is the Voltr/Ranger vault helper in `examples/voltr-vault-interface`. The repo still contains older app, bot, router, ledger, and script code, but those directories are not the active setup until they are rewritten around the Voltr/Ranger path.

## Current Truth

P: The current FDRY vault setup is the Voltr/Ranger client interface, not the older app and automation code still present in this repo.
E: The active share package is `examples/voltr-vault-interface`, which contains `voltrUserClient.ts`, `voltrUserClient.test.ts`, `README.md`, and `CONSOLIDATED_OVERVIEW.md`.
E: Those files build user-signed deposit and instant-withdraw transactions with `@voltr/vault-sdk`, while the older directories still reference a previous vault experiment and should not be treated as launch instructions.
L: Use the example package and `docs/VOLTR_RANGER_SETUP.md` as the source of truth.

Polished paragraph:
The current FDRY vault setup is the Voltr/Ranger client interface, not the older app and automation code still present in this repo. The active share package is `examples/voltr-vault-interface`, which contains `voltrUserClient.ts`, `voltrUserClient.test.ts`, `README.md`, and `CONSOLIDATED_OVERVIEW.md`. Those files build user-signed deposit and instant-withdraw transactions with `@voltr/vault-sdk`, while the older directories still reference a previous vault experiment and should not be treated as launch instructions. Use the example package and `docs/VOLTR_RANGER_SETUP.md` as the source of truth.

## Public User Path

P: The public user path is a wallet-approved transaction flow.
E: `buildDepositVaultIxs(...)` builds deposit instructions, and `buildInstantWithdrawVaultIxs(...)` builds instant-withdraw instructions for an existing Voltr/Ranger vault.
E: A client app compiles those instructions into a Solana transaction, the user's wallet signs it, and the signed bytes are submitted to the network.
L: The public repo shows how users enter and exit the vault without exposing operator controls.

Polished paragraph:
The public user path is a wallet-approved transaction flow. `buildDepositVaultIxs(...)` builds deposit instructions, and `buildInstantWithdrawVaultIxs(...)` builds instant-withdraw instructions for an existing Voltr/Ranger vault. A client app compiles those instructions into a Solana transaction, the user's wallet signs it, and the signed bytes are submitted to the network. The public repo shows how users enter and exit the vault without exposing operator controls.

## Code Status

P: The repository is not fully migrated to the current Voltr/Ranger setup.
E: The `frontend/`, `bot/`, `scripts/`, `routers/`, and `ledger/` directories are still legacy code from an earlier vault direction.
E: They remain in the repo for reference, but current docs must not point to them as production setup or launch procedure.
L: Until those directories are rewritten, the only current integration code is the public example package.

Polished paragraph:
The repository is not fully migrated to the current Voltr/Ranger setup. The `frontend/`, `bot/`, `scripts/`, `routers/`, and `ledger/` directories are still legacy code from an earlier vault direction. They remain in the repo for reference, but current docs must not point to them as production setup or launch procedure. Until those directories are rewritten, the only current integration code is the public example package.

## Start Here

| Document | Purpose |
|---|---|
| [docs/VOLTR_RANGER_SETUP.md](./docs/VOLTR_RANGER_SETUP.md) | Canonical Voltr/Ranger setup and boundary |
| [docs/CODE_STATUS.md](./docs/CODE_STATUS.md) | Current versus legacy code map |
| [examples/voltr-vault-interface/README.md](./examples/voltr-vault-interface/README.md) | Shareable client usage |
| [examples/voltr-vault-interface/CONSOLIDATED_OVERVIEW.md](./examples/voltr-vault-interface/CONSOLIDATED_OVERVIEW.md) | PEEL overview for mixed readers |
| [examples/voltr-vault-interface/voltrUserClient.ts](./examples/voltr-vault-interface/voltrUserClient.ts) | User-side transaction builder |

## Verify The Current Example

```bash
cd examples/voltr-vault-interface
pnpm install
pnpm test
```
