# FDRY Voltr/Ranger Vault Integration Overview

This document consolidates the shareable client interface, the private manager boundary, and the audit story for the FDRY Voltr/Ranger vault work. It is written for a mixed reader: someone technical enough to inspect code, but not already deep in the vault implementation.

## Short Version

P: The public FDRY repo should only expose the user-signed vault interface, not the manager trading system.
E: The shareable folder contains `voltrUserClient.ts`, `voltrUserClient.test.ts`, and this documentation; it does not contain private signer names, manager API tokens, or private executor code.
E: This matters because user deposits and withdrawals are normal wallet transactions, while rebalancing and NAV attestation are privileged manager actions that can affect vault accounting.
L: Keeping those surfaces separate gives auditors and users a clear line between public usage and private operations.

Polished paragraph:
The public FDRY repo should only expose the user-signed vault interface, not the manager trading system. The shareable folder contains `voltrUserClient.ts`, `voltrUserClient.test.ts`, and this documentation; it does not contain private signer names, manager API tokens, or private executor code. This matters because user deposits and withdrawals are normal wallet transactions, while rebalancing and NAV attestation are privileged manager actions that can affect vault accounting. Keeping those surfaces separate gives auditors and users a clear line between public usage and private operations.

## What The Client Layer Does

P: The client layer builds the transactions a user needs to deposit into or withdraw from the Voltr/Ranger vault.
E: `buildDepositVaultIxs(...)` creates the asset token account, LP token account, compute-budget instruction, and Voltr `createDepositVaultIx`; `buildInstantWithdrawVaultIxs(...)` creates the asset token account, compute-budget instruction, and Voltr `createInstantWithdrawVaultIx`.
E: The app can compile those instructions into a Solana transaction, ask the connected wallet to sign, and then submit the signed transaction to the network.
L: In plain terms, the client prepares the form, but the user wallet gives final approval.

Polished paragraph:
The client layer builds the transactions a user needs to deposit into or withdraw from the Voltr/Ranger vault. `buildDepositVaultIxs(...)` creates the asset token account, LP token account, compute-budget instruction, and Voltr `createDepositVaultIx`; `buildInstantWithdrawVaultIxs(...)` creates the asset token account, compute-budget instruction, and Voltr `createInstantWithdrawVaultIx`. The app can compile those instructions into a Solana transaction, ask the connected wallet to sign, and then submit the signed transaction to the network. In plain terms, the client prepares the form, but the user wallet gives final approval.

## What The Client Layer Does Not Do

P: The client layer does not control vault strategy funds or perform manager-only actions.
E: The copied interface only imports `@voltr/vault-sdk`, `@solana/web3.js`, `@solana/spl-token`, and `@coral-xyz/anchor`; it has no manager signer, hot-wallet signer, rebalance endpoint, or NAV attestation call.
E: That design prevents a public website from accidentally exposing the permissions needed to move strategy capital or update the vault's reported strategy value.
L: The shareable repo can show users how to enter and exit the vault without revealing the machinery that operates the strategy.

Polished paragraph:
The client layer does not control vault strategy funds or perform manager-only actions. The copied interface only imports `@voltr/vault-sdk`, `@solana/web3.js`, `@solana/spl-token`, and `@coral-xyz/anchor`; it has no manager signer, hot-wallet signer, rebalance endpoint, or NAV attestation call. That design prevents a public website from accidentally exposing the permissions needed to move strategy capital or update the vault's reported strategy value. The shareable repo can show users how to enter and exit the vault without revealing the machinery that operates the strategy.

## Contract Boundary

P: There is no new public contract in this shareable layer because the contract endpoint is the existing Voltr/Ranger vault program.
E: The client calls Voltr SDK builders such as `createDepositVaultIx` and `createInstantWithdrawVaultIx`, then the user's wallet signs the resulting Solana transaction.
E: This means the public repo is not deploying new on-chain code; it is documenting and packaging the client-side instructions that talk to the deployed vault.
L: For audit purposes, the public surface is a transaction builder, while the on-chain authority remains with the Voltr/Ranger programs already deployed.

Polished paragraph:
There is no new public contract in this shareable layer because the contract endpoint is the existing Voltr/Ranger vault program. The client calls Voltr SDK builders such as `createDepositVaultIx` and `createInstantWithdrawVaultIx`, then the user's wallet signs the resulting Solana transaction. This means the public repo is not deploying new on-chain code; it is documenting and packaging the client-side instructions that talk to the deployed vault. For audit purposes, the public surface is a transaction builder, while the on-chain authority remains with the Voltr/Ranger programs already deployed.

## Private Manager Boundary

P: Rebalancing and NAV attestation belong in the private executor repo, not the public FDRY client repo.
E: The private executor has a manager API with guarded actions such as `/rebalance/plan`, `/rebalance/execute`, and `/attest`; live execution requires auth, `DRY_RUN=0`, `EXECUTE=1`, and an idempotency key.
E: Those checks exist because the Trustful strategy path can trade through a hot wallet and report strategy value back to the vault.
L: Anyone reviewing the public repo should see only user entry and exit, while the private repo carries the operational risk controls.

Polished paragraph:
Rebalancing and NAV attestation belong in the private executor repo, not the public FDRY client repo. The private executor has a manager API with guarded actions such as `/rebalance/plan`, `/rebalance/execute`, and `/attest`; live execution requires auth, `DRY_RUN=0`, `EXECUTE=1`, and an idempotency key. Those checks exist because the Trustful strategy path can trade through a hot wallet and report strategy value back to the vault. Anyone reviewing the public repo should see only user entry and exit, while the private repo carries the operational risk controls.

## Current Files To Share

P: The safest public package is the `examples/voltr-vault-interface` folder.
E: It contains the reusable client file, a small test file for amount parsing, a usage README, and this consolidated overview.
E: That is enough for another engineer or auditor to understand how the browser/client side sends user-approved requests to the vault contract without relying on legacy app code elsewhere in the repo.
L: Share this folder when the goal is to explain the client contract interface without exposing the manager system.

Polished paragraph:
The safest public package is the `examples/voltr-vault-interface` folder. It contains the reusable client file, a small test file for amount parsing, a usage README, and this consolidated overview. That is enough for another engineer or auditor to understand how the browser/client side sends user-approved requests to the vault contract without relying on legacy app code elsewhere in the repo. Share this folder when the goal is to explain the client contract interface without exposing the manager system.

## Verification Status

P: The current client interface has a basic regression test and has been checked for private references.
E: `pnpm test` checks decimal parsing inside this folder, and a text scan of `examples/voltr-vault-interface` found no private signer names, token values, repository remotes, or local private host references.
E: This does not prove a live deposit or withdrawal landed on-chain, but it does prove the copied interface is clean, importable, and guarded against bad decimal input.
L: The next proof step is a wallet-signed dry-run or small live transaction against the intended vault.

Polished paragraph:
The current client interface has a basic regression test and has been checked for private references. `pnpm test` checks decimal parsing inside this folder, and a text scan of `examples/voltr-vault-interface` found no private signer names, token values, repository remotes, or local private host references. This does not prove a live deposit or withdrawal landed on-chain, but it does prove the copied interface is clean, importable, and guarded against bad decimal input. The next proof step is a wallet-signed dry-run or small live transaction against the intended vault.

## Open Audit Questions

P: The main remaining audit questions are about operational authority, not the public client helper itself.
E: The private strategy path depends on manager and hot-wallet controls, while the public client helper only builds user-signed deposit and instant-withdraw instructions.
E: Auditors should therefore review multisig setup, manager key custody, NAV attestation policy, swap caps, and stale-price behavior separately from the frontend transaction builder.
L: The public interface can be shared now, but production readiness depends on the private authority model being accepted.

Polished paragraph:
The main remaining audit questions are about operational authority, not the public client helper itself. The private strategy path depends on manager and hot-wallet controls, while the public client helper only builds user-signed deposit and instant-withdraw instructions. Auditors should therefore review multisig setup, manager key custody, NAV attestation policy, swap caps, and stale-price behavior separately from the frontend transaction builder. The public interface can be shared now, but production readiness depends on the private authority model being accepted.

## Codebase Caveat

P: The rest of this public repo is not yet migrated to the current Voltr/Ranger path.
E: `docs/CODE_STATUS.md` marks the root app, bot, scripts, routers, and ledger as legacy until rewritten.
E: That caveat matters because readers may otherwise assume every directory matches the shareable helper.
L: Use the example folder for current review, and treat other directories as reference only.

Polished paragraph:
The rest of this public repo is not yet migrated to the current Voltr/Ranger path. `docs/CODE_STATUS.md` marks the root app, bot, scripts, routers, and ledger as legacy until rewritten. That caveat matters because readers may otherwise assume every directory matches the shareable helper. Use the example folder for current review, and treat other directories as reference only.

## Quick Map

| Need | Public file | Private counterpart |
|---|---|---|
| User deposit tx | `examples/voltr-vault-interface/voltrUserClient.ts` | none |
| User instant withdraw tx | `examples/voltr-vault-interface/voltrUserClient.ts` | none |
| Decimal parsing test | `examples/voltr-vault-interface/voltrUserClient.test.ts` | none |
| Manager rebalance | not public | private executor repo |
| NAV attestation | not public | private executor repo |
| Trustful adaptor IX builders | not public | private executor repo |
