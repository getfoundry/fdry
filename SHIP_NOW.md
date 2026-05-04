# SHIP_NOW

## Current Ship Gate

P: The public repo is not ready for a full product launch from its root scripts.
E: The only current Voltr/Ranger-aligned code is the shareable helper in `examples/voltr-vault-interface`.
E: Older launch scripts and app code still exist, but they are legacy and do not describe the current vault setup.
L: Ship only the public helper package until the app and operations are migrated.

Polished paragraph:
The public repo is not ready for a full product launch from its root scripts. The only current Voltr/Ranger-aligned code is the shareable helper in `examples/voltr-vault-interface`. Older launch scripts and app code still exist, but they are legacy and do not describe the current vault setup. Ship only the public helper package until the app and operations are migrated.

## What Can Ship Now

P: The shareable client interface can be shared now.
E: It includes a usage README, a consolidated overview, a transaction builder, and a small test for decimal parsing.
E: That package is enough for an auditor or frontend engineer to inspect how user-signed vault transactions are prepared.
L: The safe current shipment is documentation plus the public client helper.

Polished paragraph:
The shareable client interface can be shared now. It includes a usage README, a consolidated overview, a transaction builder, and a small test for decimal parsing. That package is enough for an auditor or frontend engineer to inspect how user-signed vault transactions are prepared. The safe current shipment is documentation plus the public client helper.

## What Must Happen Before Product Launch

P: Product launch needs a migrated frontend and a live transaction proof.
E: The current `frontend/` directory still reflects legacy assumptions and is not the canonical Voltr/Ranger app path.
E: A real launch needs the app wired to `voltrUserClient.ts`, configured with the intended vault and mint addresses, and tested with a small deposit plus instant withdraw.
L: Launch readiness starts after the public helper is integrated into the actual app.

Polished paragraph:
Product launch needs a migrated frontend and a live transaction proof. The current `frontend/` directory still reflects legacy assumptions and is not the canonical Voltr/Ranger app path. A real launch needs the app wired to `voltrUserClient.ts`, configured with the intended vault and mint addresses, and tested with a small deposit plus instant withdraw. Launch readiness starts after the public helper is integrated into the actual app.
