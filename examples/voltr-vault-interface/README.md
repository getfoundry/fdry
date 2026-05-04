# Voltr Vault Client Interface

## Purpose

P: This folder is the public, shareable client interface for the FDRY Voltr/Ranger vault.
E: It contains `voltrUserClient.ts`, `voltrUserClient.test.ts`, and `CONSOLIDATED_OVERVIEW.md`, with no private manager executor code.
E: That makes it safe to show how user deposits and withdrawals are built without exposing the system that trades strategy funds or reports vault NAV.
L: Use this folder when someone needs to inspect the user-facing contract interface.

Polished paragraph:
This folder is the public, shareable client interface for the FDRY Voltr/Ranger vault. It contains `voltrUserClient.ts`, `voltrUserClient.test.ts`, and `CONSOLIDATED_OVERVIEW.md`, with no private manager executor code. That makes it safe to show how user deposits and withdrawals are built without exposing the system that trades strategy funds or reports vault NAV. Use this folder when someone needs to inspect the user-facing contract interface.

## What It Builds

P: The interface builds unsigned Solana instructions for user deposit and instant withdrawal.
E: `buildDepositVaultIxs(...)` prepares the asset token account, LP token account, compute-budget instruction, and Voltr deposit instruction; `buildInstantWithdrawVaultIxs(...)` prepares the asset token account, compute-budget instruction, and Voltr instant-withdraw instruction.
E: The connected wallet still signs the final transaction, so the app only receives signed transaction bytes.
L: The client prepares the transaction, and the user's wallet decides whether it leaves the wallet.

Polished paragraph:
The interface builds unsigned Solana instructions for user deposit and instant withdrawal. `buildDepositVaultIxs(...)` prepares the asset token account, LP token account, compute-budget instruction, and Voltr deposit instruction; `buildInstantWithdrawVaultIxs(...)` prepares the asset token account, compute-budget instruction, and Voltr instant-withdraw instruction. The connected wallet still signs the final transaction, so the app only receives signed transaction bytes. The client prepares the transaction, and the user's wallet decides whether it leaves the wallet.

## Files

- `voltrUserClient.ts`: reusable interface layer
- `voltrUserClient.test.ts`: amount parsing regression tests
- `CONSOLIDATED_OVERVIEW.md`: PEEL-style explanation of public and private boundaries

## Dependencies

The host app needs:

```bash
pnpm add @voltr/vault-sdk @solana/web3.js @solana/spl-token @coral-xyz/anchor
```

## Usage

P: A host app uses this helper by building instructions, compiling a transaction, and asking the wallet to sign it.
E: The example below creates deposit instructions for a vault, compiles them into a versioned Solana transaction, and submits the wallet-signed bytes.
E: This mirrors the production user flow because the contract request is still approved by the user's connected wallet.
L: Replace the vault and LP mint values, then wire the same pattern into the app's wallet adapter flow.

Polished paragraph:
A host app uses this helper by building instructions, compiling a transaction, and asking the wallet to sign it. The example below creates deposit instructions for a vault, compiles them into a versioned Solana transaction, and submits the wallet-signed bytes. This mirrors the production user flow because the contract request is still approved by the user's connected wallet. Replace the vault and LP mint values, then wire the same pattern into the app's wallet adapter flow.

```ts
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { VoltrClient } from "@voltr/vault-sdk";
import {
  buildDepositVaultIxs,
  buildInstantWithdrawVaultIxs,
  decimalAmountToBaseUnits,
} from "./voltrUserClient";

const client = new VoltrClient(connection);
const payer = wallet.publicKey;

const depositIxs = await buildDepositVaultIxs({
  client,
  payer,
  vault: new PublicKey("Bpr49sQXsxwNXNMRWS2v3tTBGWu2QgZtdA83BX77xBX1"),
  vaultAssetMint: new PublicKey("2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL"),
  lpMint: new PublicKey("REPLACE_WITH_VAULT_LP_MINT"),
  assetTokenProgram: TOKEN_PROGRAM_ID,
  amountBaseUnits: decimalAmountToBaseUnits("1000", 9),
});

const { blockhash } = await connection.getLatestBlockhash("confirmed");
const message = new TransactionMessage({
  payerKey: payer,
  recentBlockhash: blockhash,
  instructions: depositIxs,
}).compileToV0Message();

const tx = new VersionedTransaction(message);
const signed = await wallet.signTransaction(tx);
const sig = await connection.sendRawTransaction(signed.serialize());
```

For instant withdraw, call `buildInstantWithdrawVaultIxs` with
`shareAmountBaseUnits`. The amount is LP/share base units, not asset units.

## Security Boundary

P: This folder is public because it only covers user-approved vault entry and exit.
E: The public flow is: app builds unsigned instructions, user wallet signs, and the signed transaction is submitted to Solana.
E: Manager rebalance, strategy trading, and NAV attestation are private operations and are not included here.
L: Treat this folder as the user contract interface, not the vault operator system.

Polished paragraph:
This folder is public because it only covers user-approved vault entry and exit. The public flow is: app builds unsigned instructions, user wallet signs, and the signed transaction is submitted to Solana. Manager rebalance, strategy trading, and NAV attestation are private operations and are not included here. Treat this folder as the user contract interface, not the vault operator system.
