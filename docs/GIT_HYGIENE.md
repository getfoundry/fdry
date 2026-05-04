# Git Hygiene

## Public Boundary

P: The public repo must contain only shareable code, docs, and placeholders.
E: The active public package is `examples/voltr-vault-interface`, and it does not need operator credentials to build user-signed transaction instructions.
E: Keeping credentials and operator-only details out of this repo protects the boundary between user transactions and manager actions.
L: Review every commit against that boundary before pushing.

Polished paragraph:
The public repo must contain only shareable code, docs, and placeholders. The active public package is `examples/voltr-vault-interface`, and it does not need operator credentials to build user-signed transaction instructions. Keeping credentials and operator-only details out of this repo protects the boundary between user transactions and manager actions. Review every commit against that boundary before pushing.

## Never Commit

- `.env`, `.env.local`, or real runtime environment files
- Solana keypair files
- private RPC URLs
- local hostnames or private remotes
- logs that include wallet addresses plus operational context
- generated build output
- `node_modules`

## Pre-commit Check

```bash
git status --short
git diff --cached
git diff --cached | rg '([A-Za-z0-9]{70,}|PRIVATE KEY|MANAGER|SECRET|TOKEN)' && echo "review" || echo "clean"
```

## Recovery

P: If sensitive material enters git history, rotate it before cleaning the repo.
E: Removing a file from history does not make an exposed key safe again.
E: The safe order is rotate, move funds or privileges if needed, then rewrite or remove the public history.
L: Treat public git exposure as compromise, not as a formatting mistake.

Polished paragraph:
If sensitive material enters git history, rotate it before cleaning the repo. Removing a file from history does not make an exposed key safe again. The safe order is rotate, move funds or privileges if needed, then rewrite or remove the public history. Treat public git exposure as compromise, not as a formatting mistake.
