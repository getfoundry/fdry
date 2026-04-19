# GIT_HYGIENE — Public-Repo Safety for fdry

Protocol for keeping the public repo clean and secret-free.

## What goes in the public repo

- Source code: `bot/`, `frontend/`, `ledger/`, `shared/`, `scripts/`, `routers/`
- Configs (non-secret): `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `railway.toml`
- Docs: `README.md`, `RUNBOOK.md`, `SHIP_NOW.md`, everything under `docs/`
- Templates: `.env.example` (placeholders only — never real values)
- `.gitignore` itself

## What stays private (never committed)

- `.env`, `.env.local`, `.env.*.local` — all real environment files
- `*.keypair.json` — Solana creator/treasury keypairs
- `*.key`, `*.pem`, `id_rsa`, `id_ed25519` — any private keys
- `logs/`, `*.log` — runtime logs (may contain wallet addresses, tx sigs, PII)
- `runs/` — local run artifacts
- `node_modules/`, `dist/`, `build/`, `.cache/`, `.DS_Store`

The `.gitignore` at repo root enforces this list. Audit with `git check-ignore -v <path>`.

## Pre-commit hygiene check

Run before every commit:

```bash
# 1. Nothing tracked that should be ignored
git ls-files | grep -E '\.(env|key|keypair\.json|pem)$|^logs/|^runs/' && echo "LEAK" || echo "clean"

# 2. No base58/long secrets in staged diff
git diff --cached | grep -E '[A-Za-z0-9]{70,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' && echo "SECRET" || echo "clean"

# 3. Dry-run what you are about to commit
git status --short
```

Add it as a pre-commit hook at `.git/hooks/pre-commit` (chmod +x) if desired.

## Recovery — if a secret was ever committed

**Rotate the secret first.** The moment a private key hits git history, assume it is compromised — generate a fresh keypair, move funds, update `.env`. Scrubbing history only prevents re-exposure; it does not un-leak.

Then rewrite history:

```bash
# Modern tool (recommended):
pip install git-filter-repo
git filter-repo --path path/to/leaked.keypair.json --invert-paths

# Legacy fallback:
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch path/to/leaked.keypair.json" \
  --prune-empty --tag-name-filter cat -- --all

# Purge local refs
rm -rf .git/refs/original .git/logs
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force-push to every remote (coordinate with collaborators first)
git push origin --force --all
git push origin --force --tags
```

For GitHub, also open a support ticket to purge cached views and any forks.

## Invariants

- `.env.example` has placeholders like `REPLACE_WITH_BASE58_CREATOR_PUBKEY` — never real values.
- Keypairs live in `/tmp/` or `~/.config/solana/`, referenced by path in `.env`.
- `CREATOR_KEY` in `.env` is a **path** to a keypair file, not the key itself.
