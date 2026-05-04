# RUNBOOK

## Current Scope

P: This runbook only covers the current public Voltr/Ranger client interface.
E: The active package is `examples/voltr-vault-interface`, and it builds user-signed deposit and instant-withdraw instructions.
E: The older bot, router, ledger, and script flows in this repo are legacy and should not be run as current operations.
L: Operational work should start by proving the public helper against the target vault.

Polished paragraph:
This runbook only covers the current public Voltr/Ranger client interface. The active package is `examples/voltr-vault-interface`, and it builds user-signed deposit and instant-withdraw instructions. The older bot, router, ledger, and script flows in this repo are legacy and should not be run as current operations. Operational work should start by proving the public helper against the target vault.

## Daily Operations

P: There are no active daily cron operations in the public repo.
E: The current public code does not include a live Voltr/Ranger manager bot, hosted rebalance job, or public NAV writer.
E: This prevents stale automation docs from implying that strategy operations are already wired here.
L: Daily operations begin only after the app and manager path are migrated and verified.

Polished paragraph:
There are no active daily cron operations in the public repo. The current public code does not include a live Voltr/Ranger manager bot, hosted rebalance job, or public NAV writer. This prevents stale automation docs from implying that strategy operations are already wired here. Daily operations begin only after the app and manager path are migrated and verified.

## Manual Verification

P: The next manual proof is a wallet-signed deposit and instant withdraw against the intended vault.
E: The helper can already build the required instruction arrays through `buildDepositVaultIxs(...)` and `buildInstantWithdrawVaultIxs(...)`.
E: A small live transaction proves the vault address, asset mint, LP mint, wallet adapter, and token account setup all agree.
L: Do not open public deposits until that proof is captured.

Polished paragraph:
The next manual proof is a wallet-signed deposit and instant withdraw against the intended vault. The helper can already build the required instruction arrays through `buildDepositVaultIxs(...)` and `buildInstantWithdrawVaultIxs(...)`. A small live transaction proves the vault address, asset mint, LP mint, wallet adapter, and token account setup all agree. Do not open public deposits until that proof is captured.

## Incident Response

P: Incidents should be handled at the wallet and vault transaction layer until the full app is migrated.
E: If a deposit or withdraw fails, capture the transaction signature if one exists, the wallet address, the vault address, the asset mint, the LP mint, and the exact UI or RPC error.
E: Those facts are enough to distinguish user rejection, token account setup, stale blockhash, insufficient balance, and program rejection.
L: Keep incident notes concrete so the next fix lands in the transaction builder or app integration.

Polished paragraph:
Incidents should be handled at the wallet and vault transaction layer until the full app is migrated. If a deposit or withdraw fails, capture the transaction signature if one exists, the wallet address, the vault address, the asset mint, the LP mint, and the exact UI or RPC error. Those facts are enough to distinguish user rejection, token account setup, stale blockhash, insufficient balance, and program rejection. Keep incident notes concrete so the next fix lands in the transaction builder or app integration.
