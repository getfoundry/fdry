# Voltr/Ranger Vault Setup

## Setup Claim

P: FDRY's current vault interface is built around an existing Voltr/Ranger vault on Solana.
E: The public client helper calls `@voltr/vault-sdk` builders for `createDepositVaultIx` and `createInstantWithdrawVaultIx`.
E: This makes the public repo a transaction-building layer rather than a new on-chain program or a strategy operator.
L: The correct mental model is "user wallet signs a Voltr/Ranger vault transaction."

Polished paragraph:
FDRY's current vault interface is built around an existing Voltr/Ranger vault on Solana. The public client helper calls `@voltr/vault-sdk` builders for `createDepositVaultIx` and `createInstantWithdrawVaultIx`. This makes the public repo a transaction-building layer rather than a new on-chain program or a strategy operator. The correct mental model is "user wallet signs a Voltr/Ranger vault transaction."

## User Path

P: Users enter and exit the vault through wallet-signed transactions.
E: `buildDepositVaultIxs(...)` prepares deposit instructions, and `buildInstantWithdrawVaultIxs(...)` prepares instant-withdraw instructions.
E: The app compiles those instructions into a Solana transaction, the wallet signs, and the signed transaction is submitted to the network.
L: The user's wallet remains the approval point for every public vault action.

Polished paragraph:
Users enter and exit the vault through wallet-signed transactions. `buildDepositVaultIxs(...)` prepares deposit instructions, and `buildInstantWithdrawVaultIxs(...)` prepares instant-withdraw instructions. The app compiles those instructions into a Solana transaction, the wallet signs, and the signed transaction is submitted to the network. The user's wallet remains the approval point for every public vault action.

## Operator Path

P: Operator-side strategy actions are separate from the public client.
E: Rebalance execution and NAV attestation require manager authority and are intentionally excluded from `examples/voltr-vault-interface`.
E: That separation keeps public code focused on user-approved transactions while private operational code handles strategy risk.
L: Public users should see deposit and withdrawal mechanics, not manager controls.

Polished paragraph:
Operator-side strategy actions are separate from the public client. Rebalance execution and NAV attestation require manager authority and are intentionally excluded from `examples/voltr-vault-interface`. That separation keeps public code focused on user-approved transactions while private operational code handles strategy risk. Public users should see deposit and withdrawal mechanics, not manager controls.

## Public Files

| File | Purpose |
|---|---|
| `examples/voltr-vault-interface/voltrUserClient.ts` | Build user deposit and instant-withdraw instructions |
| `examples/voltr-vault-interface/voltrUserClient.test.ts` | Test exact decimal amount parsing |
| `examples/voltr-vault-interface/README.md` | Usage guide |
| `examples/voltr-vault-interface/CONSOLIDATED_OVERVIEW.md` | Narrative overview and audit boundary |

## Verification

P: The public helper has a small test and a clean text scan for private operational references.
E: `npm run test -- voltrUserClient` passes in the frontend package, and the public example folder has been scanned for private remotes, local host references, and operator credential names.
E: This verifies the package is clean to share, but it does not replace a live wallet-signed transaction test against the target vault.
L: Before production deposits, run a small wallet-signed deposit and withdraw proof.

Polished paragraph:
The public helper has a small test and a clean text scan for private operational references. `npm run test -- voltrUserClient` passes in the frontend package, and the public example folder has been scanned for private remotes, local host references, and operator credential names. This verifies the package is clean to share, but it does not replace a live wallet-signed transaction test against the target vault. Before production deposits, run a small wallet-signed deposit and withdraw proof.
