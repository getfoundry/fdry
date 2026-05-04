# ledger

## Status

P: The ledger directory is legacy static data, not the current source of truth for the Voltr/Ranger setup.
E: The current public setup is the client helper in `examples/voltr-vault-interface`, and no live Voltr/Ranger ledger writer is included in this repo.
E: Existing JSON and dashboard files may be useful as historical examples, but they should not be presented as current vault accounting.
L: Treat on-chain wallet-signed transactions as the current proof until a new ledger writer is built.

Polished paragraph:
The ledger directory is legacy static data, not the current source of truth for the Voltr/Ranger setup. The current public setup is the client helper in `examples/voltr-vault-interface`, and no live Voltr/Ranger ledger writer is included in this repo. Existing JSON and dashboard files may be useful as historical examples, but they should not be presented as current vault accounting. Treat on-chain wallet-signed transactions as the current proof until a new ledger writer is built.

## Future Ledger Requirements

P: A new ledger should record only facts that can be checked against Solana transactions.
E: Each deposit or withdrawal record should include timestamp, wallet, vault address, mint addresses, transaction signature, and parsed amount.
E: That lets users compare the static ledger to the chain instead of trusting a private database.
L: Rebuild this directory only after the Voltr/Ranger transaction flow is live.

Polished paragraph:
A new ledger should record only facts that can be checked against Solana transactions. Each deposit or withdrawal record should include timestamp, wallet, vault address, mint addresses, transaction signature, and parsed amount. That lets users compare the static ledger to the chain instead of trusting a private database. Rebuild this directory only after the Voltr/Ranger transaction flow is live.
