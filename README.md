# fdry

FDRY uses a Voltr/Ranger vault interface on Solana. The public repo documents the user-signed deposit and instant-withdraw path; private strategy operation is kept outside the public client package.

## Current Truth

P: The current vault setup is Voltr/Ranger, not the old basket-vault design.
E: The public interface lives in `examples/voltr-vault-interface` and uses `@voltr/vault-sdk` builders for deposit and instant withdraw.
E: That means users interact with an existing Voltr/Ranger vault contract through wallet-signed Solana transactions, while strategy management stays separate.
L: Treat this README and `docs/VOLTR_RANGER_SETUP.md` as the canonical setup.

Polished paragraph:
The current vault setup is Voltr/Ranger, not the old basket-vault design. The public interface lives in `examples/voltr-vault-interface` and uses `@voltr/vault-sdk` builders for deposit and instant withdraw. That means users interact with an existing Voltr/Ranger vault contract through wallet-signed Solana transactions, while strategy management stays separate. Treat this README and `docs/VOLTR_RANGER_SETUP.md` as the canonical setup.

## What Is Public

P: The public repo exposes only the user-facing contract interface.
E: `examples/voltr-vault-interface/voltrUserClient.ts` builds unsigned instructions for deposit and instant withdraw, and `voltrUserClient.test.ts` checks amount parsing.
E: A browser or app can compile those instructions, ask the connected wallet to sign, and submit the signed transaction without receiving operator credentials.
L: The public surface is for vault users and auditors who need to inspect how user transactions are built.

Polished paragraph:
The public repo exposes only the user-facing contract interface. `examples/voltr-vault-interface/voltrUserClient.ts` builds unsigned instructions for deposit and instant withdraw, and `voltrUserClient.test.ts` checks amount parsing. A browser or app can compile those instructions, ask the connected wallet to sign, and submit the signed transaction without receiving operator credentials. The public surface is for vault users and auditors who need to inspect how user transactions are built.

## What Is Private

P: Strategy operation is private because it controls manager-side actions, not user deposits.
E: Rebalancing, strategy trading, and NAV attestation require privileged operator controls and are not included in this public share package.
E: Keeping that code separate prevents a public frontend from becoming a path to manager-only vault operations.
L: The public repo explains user entry and exit; the private operator repo carries the strategy-risk controls.

Polished paragraph:
Strategy operation is private because it controls manager-side actions, not user deposits. Rebalancing, strategy trading, and NAV attestation require privileged operator controls and are not included in this public share package. Keeping that code separate prevents a public frontend from becoming a path to manager-only vault operations. The public repo explains user entry and exit; the private operator repo carries the strategy-risk controls.

## Start Here

| Document | Purpose |
|---|---|
| [docs/VOLTR_RANGER_SETUP.md](./docs/VOLTR_RANGER_SETUP.md) | Canonical setup and boundary doc |
| [examples/voltr-vault-interface/README.md](./examples/voltr-vault-interface/README.md) | Shareable client interface usage |
| [examples/voltr-vault-interface/CONSOLIDATED_OVERVIEW.md](./examples/voltr-vault-interface/CONSOLIDATED_OVERVIEW.md) | PEEL-style explanation for mixed technical readers |
| [examples/voltr-vault-interface/voltrUserClient.ts](./examples/voltr-vault-interface/voltrUserClient.ts) | User-side transaction builder |

## Install Dependencies For The Example

```bash
pnpm add @voltr/vault-sdk @solana/web3.js @solana/spl-token @coral-xyz/anchor
```

## Verify The Example

```bash
cd frontend
npm run test -- voltrUserClient
```
