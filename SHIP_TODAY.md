# SHIP_TODAY

## Today Scope

P: Today's safe ship is the public Voltr/Ranger interface package, not a live vault launch.
E: The current repo has a clean shareable helper under `examples/voltr-vault-interface`, but the root app and scripts are still legacy.
E: Shipping the helper lets reviewers inspect the user transaction path without pretending the full app has already been migrated.
L: Publish the interface package first, then migrate the app.

Polished paragraph:
Today's safe ship is the public Voltr/Ranger interface package, not a live vault launch. The current repo has a clean shareable helper under `examples/voltr-vault-interface`, but the root app and scripts are still legacy. Shipping the helper lets reviewers inspect the user transaction path without pretending the full app has already been migrated. Publish the interface package first, then migrate the app.

## Checklist

- Verify `examples/voltr-vault-interface/README.md`.
- Verify `examples/voltr-vault-interface/CONSOLIDATED_OVERVIEW.md`.
- Run `cd examples/voltr-vault-interface && pnpm install && pnpm test`.
- Confirm `docs/VOLTR_RANGER_SETUP.md` and `docs/CODE_STATUS.md` match the current code state.
- Do not run legacy root launch scripts as the current ship path.

## Stop Conditions

P: Stop if the work requires manager authority, strategy trading, or NAV attestation from this public repo.
E: Those operations are intentionally outside the public helper package.
E: Mixing manager actions into the public share package would erase the boundary auditors need to review.
L: Keep today's ship focused on user-signed entry and exit.

Polished paragraph:
Stop if the work requires manager authority, strategy trading, or NAV attestation from this public repo. Those operations are intentionally outside the public helper package. Mixing manager actions into the public share package would erase the boundary auditors need to review. Keep today's ship focused on user-signed entry and exit.
