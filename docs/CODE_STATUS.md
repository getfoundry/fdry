# Code Status

## Current Code

P: The current code path is the shareable Voltr/Ranger user interface helper.
E: `examples/voltr-vault-interface/voltrUserClient.ts` imports `@voltr/vault-sdk` and builds deposit plus instant-withdraw instructions.
E: That is the only code in this repo that matches the current public vault story.
L: Treat this folder as the active interface until the app is migrated.

Polished paragraph:
The current code path is the shareable Voltr/Ranger user interface helper. `examples/voltr-vault-interface/voltrUserClient.ts` imports `@voltr/vault-sdk` and builds deposit plus instant-withdraw instructions. That is the only code in this repo that matches the current public vault story. Treat this folder as the active interface until the app is migrated.

## Legacy Code

P: Several directories are legacy and should not be used as current launch instructions.
E: `frontend/`, `bot/`, `scripts/`, `routers/`, and `ledger/` still contain older vault assumptions, package dependencies, or static records.
E: They may be useful as reference material, but they do not describe the active Voltr/Ranger client path and may fail or perform the wrong flow if run as-is.
L: Rewrite or archive those directories before presenting them as production code.

Polished paragraph:
Several directories are legacy and should not be used as current launch instructions. `frontend/`, `bot/`, `scripts/`, `routers/`, and `ledger/` still contain older vault assumptions, package dependencies, or static records. They may be useful as reference material, but they do not describe the active Voltr/Ranger client path and may fail or perform the wrong flow if run as-is. Rewrite or archive those directories before presenting them as production code.

## Verification

P: Current verification is limited to the public helper's unit test.
E: `cd examples/voltr-vault-interface && pnpm install && pnpm test` verifies exact decimal parsing for the shareable helper.
E: A live wallet-signed deposit and instant-withdraw proof still needs to be run against the target vault before public deposits.
L: The docs are now aligned to code status, but production readiness still needs an on-chain proof.

Polished paragraph:
Current verification is limited to the public helper's unit test. `cd examples/voltr-vault-interface && pnpm install && pnpm test` verifies exact decimal parsing for the shareable helper. A live wallet-signed deposit and instant-withdraw proof still needs to be run against the target vault before public deposits. The docs are now aligned to code status, but production readiness still needs an on-chain proof.
