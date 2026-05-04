# FDRY Docs

## Canonical Setup

P: The canonical FDRY vault setup is the Voltr/Ranger path.
E: The public docs now point to `VOLTR_RANGER_SETUP.md` and the shareable client package under `examples/voltr-vault-interface`.
E: These files describe user-signed deposit and instant-withdraw transactions against an existing Voltr/Ranger vault, not a separate public strategy contract.
L: Use these docs as the source of truth for the public repo.

Polished paragraph:
The canonical FDRY vault setup is the Voltr/Ranger path. The public docs now point to `VOLTR_RANGER_SETUP.md` and the shareable client package under `examples/voltr-vault-interface`. These files describe user-signed deposit and instant-withdraw transactions against an existing Voltr/Ranger vault, not a separate public strategy contract. Use these docs as the source of truth for the public repo.

## Start Here

| Document | Purpose |
|---|---|
| [VOLTR_RANGER_SETUP.md](./VOLTR_RANGER_SETUP.md) | Current architecture, boundary, and verification status |
| [../examples/voltr-vault-interface/README.md](../examples/voltr-vault-interface/README.md) | Shareable client usage |
| [../examples/voltr-vault-interface/CONSOLIDATED_OVERVIEW.md](../examples/voltr-vault-interface/CONSOLIDATED_OVERVIEW.md) | PEEL-style overview |

## Boundary

P: The public docs cover user entry and exit only.
E: The public interface builds unsigned instructions that the user's wallet signs before submission.
E: Manager rebalance, strategy trading, and NAV attestation are operational controls and stay outside this repo.
L: This separation keeps the public docs useful without exposing manager-only mechanics.

Polished paragraph:
The public docs cover user entry and exit only. The public interface builds unsigned instructions that the user's wallet signs before submission. Manager rebalance, strategy trading, and NAV attestation are operational controls and stay outside this repo. This separation keeps the public docs useful without exposing manager-only mechanics.
