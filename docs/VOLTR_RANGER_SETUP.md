# Voltr/Ranger Vault Setup

## Setup Claim

P: FDRY's current public vault interface is built around an existing Voltr/Ranger vault on Solana.
E: The public client helper calls `@voltr/vault-sdk` builders for `createDepositVaultIx` and `createInstantWithdrawVaultIx`.
E: This makes the current public code a transaction-building layer rather than a full app, new on-chain program, or strategy operator.
L: The correct mental model is "user wallet signs a Voltr/Ranger vault transaction."

Polished paragraph:
FDRY's current public vault interface is built around an existing Voltr/Ranger vault on Solana. The public client helper calls `@voltr/vault-sdk` builders for `createDepositVaultIx` and `createInstantWithdrawVaultIx`. This makes the current public code a transaction-building layer rather than a full app, new on-chain program, or strategy operator. The correct mental model is "user wallet signs a Voltr/Ranger vault transaction."

## User Path

P: Users enter and exit the vault through wallet-signed transactions.
E: `buildDepositVaultIxs(...)` prepares deposit instructions, and `buildInstantWithdrawVaultIxs(...)` prepares instant-withdraw instructions.
E: The app compiles those instructions into a Solana transaction, the wallet signs, and the signed transaction is submitted to the network.
L: The user's wallet remains the approval point for every public vault action.

Polished paragraph:
Users enter and exit the vault through wallet-signed transactions. `buildDepositVaultIxs(...)` prepares deposit instructions, and `buildInstantWithdrawVaultIxs(...)` prepares instant-withdraw instructions. The app compiles those instructions into a Solana transaction, the wallet signs, and the signed transaction is submitted to the network. The user's wallet remains the approval point for every public vault action.

## Operator Path

P: Operator-side strategy actions are not implemented as current public code in this repo.
E: The public helper excludes rebalance execution, strategy trading, and NAV attestation.
E: That separation keeps public code focused on user-approved transactions while operator-side work is designed and verified elsewhere.
L: Public users should see deposit and withdrawal mechanics, not manager controls.

Polished paragraph:
Operator-side strategy actions are not implemented as current public code in this repo. The public helper excludes rebalance execution, strategy trading, and NAV attestation. That separation keeps public code focused on user-approved transactions while operator-side work is designed and verified elsewhere. Public users should see deposit and withdrawal mechanics, not manager controls.

## Legacy Directories

P: The root app, bot, router, script, and ledger directories are legacy until migrated.
E: `docs/CODE_STATUS.md` lists those directories separately from the active Voltr/Ranger helper.
E: This prevents old code from being mistaken for the current launch path while keeping the repository history available.
L: Update this setup doc when those directories are rewritten around the current vault.

Polished paragraph:
The root app, bot, router, script, and ledger directories are legacy until migrated. `docs/CODE_STATUS.md` lists those directories separately from the active Voltr/Ranger helper. This prevents old code from being mistaken for the current launch path while keeping the repository history available. Update this setup doc when those directories are rewritten around the current vault.

## Public Files

| File | Purpose |
|---|---|
| `examples/voltr-vault-interface/voltrUserClient.ts` | Build user deposit and instant-withdraw instructions |
| `examples/voltr-vault-interface/voltrUserClient.test.ts` | Test exact decimal amount parsing |
| `examples/voltr-vault-interface/README.md` | Usage guide |
| `examples/voltr-vault-interface/CONSOLIDATED_OVERVIEW.md` | Narrative overview and audit boundary |

## Verification

P: The public helper has a small test and a clean text scan for private operational references.
E: `cd examples/voltr-vault-interface && pnpm install && pnpm test` checks the helper's decimal parsing, and the public example folder has been scanned for private remotes, local host references, and operator credential names.
E: This verifies the package is clean to share, but it does not replace a live wallet-signed transaction test against the target vault.
L: Before production deposits, run a small wallet-signed deposit and withdraw proof.

Polished paragraph:
The public helper has a small test and a clean text scan for private operational references. `cd examples/voltr-vault-interface && pnpm install && pnpm test` checks the helper's decimal parsing, and the public example folder has been scanned for private remotes, local host references, and operator credential names. This verifies the package is clean to share, but it does not replace a live wallet-signed transaction test against the target vault. Before production deposits, run a small wallet-signed deposit and withdraw proof.
