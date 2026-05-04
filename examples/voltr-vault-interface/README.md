# Voltr Vault Client Interface

Shareable client-side interface for the public FDRY repo.

This layer builds unsigned Solana instructions for user deposit and instant
withdrawal against an existing Voltr/Ranger vault. Users still sign and submit
with their own wallet. No manager key, admin key, hot-wallet key, or private
executor API is included here.

## Files

- `voltrUserClient.ts`: reusable interface layer
- `voltrUserClient.test.ts`: amount parsing regression tests

## Dependencies

The host app needs:

```bash
pnpm add @voltr/vault-sdk @solana/web3.js @solana/spl-token @coral-xyz/anchor
```

## Usage

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

Public user flow:

1. App builds unsigned instructions.
2. User wallet signs.
3. User wallet submits or app broadcasts the signed transaction.

Private manager flow is separate and must not be exposed from this folder.
Manager rebalance and NAV attestation live in the private executor repo.
