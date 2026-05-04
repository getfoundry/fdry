# FDRY Docs

## Canonical Setup

P: The docs now treat the Voltr/Ranger client interface as the canonical public setup.
E: `VOLTR_RANGER_SETUP.md` explains the current boundary, and `CODE_STATUS.md` marks older directories as legacy until they are rewritten.
E: This matches the codebase as it stands: the shareable Voltr/Ranger helper exists under `examples/voltr-vault-interface`, while older app and automation code remains present but inactive.
L: Start with these docs before using any older file in the repo.

Polished paragraph:
The docs now treat the Voltr/Ranger client interface as the canonical public setup. `VOLTR_RANGER_SETUP.md` explains the current boundary, and `CODE_STATUS.md` marks older directories as legacy until they are rewritten. This matches the codebase as it stands: the shareable Voltr/Ranger helper exists under `examples/voltr-vault-interface`, while older app and automation code remains present but inactive. Start with these docs before using any older file in the repo.

## Start Here

| Document | Purpose |
|---|---|
| [VOLTR_RANGER_SETUP.md](./VOLTR_RANGER_SETUP.md) | Current architecture and boundary |
| [CODE_STATUS.md](./CODE_STATUS.md) | Current versus legacy code map |
| [../examples/voltr-vault-interface/README.md](../examples/voltr-vault-interface/README.md) | Shareable client usage |
| [../examples/voltr-vault-interface/CONSOLIDATED_OVERVIEW.md](../examples/voltr-vault-interface/CONSOLIDATED_OVERVIEW.md) | PEEL-style overview |
| [GIT_HYGIENE.md](./GIT_HYGIENE.md) | Public repo safety rules |

## Removed Docs

P: Older strategy docs were removed because they no longer describe the active public setup.
E: The previous docs described an earlier bot, signal, router, and launch plan that no longer matches the current Voltr/Ranger client interface.
E: Keeping those files beside the current setup would make reviewers think stale launch steps are still valid.
L: The remaining docs are intentionally small so the public repo has one clear story.

Polished paragraph:
Older strategy docs were removed because they no longer describe the active public setup. The previous docs described an earlier bot, signal, router, and launch plan that no longer matches the current Voltr/Ranger client interface. Keeping those files beside the current setup would make reviewers think stale launch steps are still valid. The remaining docs are intentionally small so the public repo has one clear story.
