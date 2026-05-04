# routers

## Status

P: The router directory is legacy and is not part of the current Voltr/Ranger public setup.
E: The current public helper lives in `examples/voltr-vault-interface`, while this directory still contains older revenue-routing assumptions.
E: Running router scripts as-is may follow the wrong vault path or write ledger records that do not match the current setup.
L: Treat this directory as reference material until it is rewritten.

Polished paragraph:
The router directory is legacy and is not part of the current Voltr/Ranger public setup. The current public helper lives in `examples/voltr-vault-interface`, while this directory still contains older revenue-routing assumptions. Running router scripts as-is may follow the wrong vault path or write ledger records that do not match the current setup. Treat this directory as reference material until it is rewritten.

## Rewrite Target

P: Future routers should route revenue through the same Voltr/Ranger boundary used by the public helper.
E: The current helper proves the user-side transaction shape, but revenue routing needs a separate operator-side design before it can be made live.
E: That design must specify who signs, which vault address is used, how accounting is recorded, and how failures are reported.
L: Do not reuse this folder for production until those questions are answered.

Polished paragraph:
Future routers should route revenue through the same Voltr/Ranger boundary used by the public helper. The current helper proves the user-side transaction shape, but revenue routing needs a separate operator-side design before it can be made live. That design must specify who signs, which vault address is used, how accounting is recorded, and how failures are reported. Do not reuse this folder for production until those questions are answered.
