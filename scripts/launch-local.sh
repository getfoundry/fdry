#!/usr/bin/env bash
# ============================================================================
# launch-local.sh — local dev runner for fdry
# ----------------------------------------------------------------------------
# Loads .env, checks required vars, and runs either the bot or a snapshot.
#
# Usage:
#   ./scripts/launch-local.sh bot        # run the daily rebalance once
#   ./scripts/launch-local.sh snapshot   # record a ledger snapshot once
#   ./scripts/launch-local.sh dry-run    # simulate rebalance without signing
#
# Secrets live in .env (gitignored). This script never prints them.
# ============================================================================

set -euo pipefail

# Resolve repo root regardless of where the script is invoked from.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO_ROOT"

# ---- load .env --------------------------------------------------------------
if [[ ! -f "$REPO_ROOT/.env" ]]; then
  echo "ERROR: $REPO_ROOT/.env not found." >&2
  echo "       Copy .env.example to .env and fill in real values." >&2
  exit 1
fi

# Export every KEY=VAL line from .env without echoing values.
set -a
# shellcheck disable=SC1091
source "$REPO_ROOT/.env"
set +a

# ---- required vars ----------------------------------------------------------
REQUIRED=(
  SOLANA_RPC_URL
  CREATOR_KEY
  HOT_WALLET_KEY
  SYMMETRY_PROGRAM_ID
  SIGNAL_FILE_PATH
  LEDGER_DIR
)

missing=()
for var in "${REQUIRED[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "ERROR: missing required env vars in .env:" >&2
  for v in "${missing[@]}"; do echo "  - $v" >&2; done
  exit 1
fi

# VAULT_PUBKEY is optional on first run (createVault will produce it).
if [[ -z "${VAULT_PUBKEY:-}" ]]; then
  echo "WARN: VAULT_PUBKEY is empty. If this is not your first run, set it in .env."
fi

# ---- ensure dirs & tooling --------------------------------------------------
mkdir -p "$LEDGER_DIR"
mkdir -p "$(dirname "$SIGNAL_FILE_PATH")"
mkdir -p "$REPO_ROOT/logs"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm not found on PATH. Install with: npm i -g pnpm" >&2
  exit 1
fi

if ! command -v tsx >/dev/null 2>&1 && [[ ! -x "$REPO_ROOT/node_modules/.bin/tsx" ]]; then
  echo "Installing deps (tsx not found)..."
  pnpm install
fi

# Prefer local tsx to avoid PATH surprises.
TSX="$REPO_ROOT/node_modules/.bin/tsx"
[[ -x "$TSX" ]] || TSX="tsx"

# ---- dispatch ---------------------------------------------------------------
CMD="${1:-bot}"
TS=$(date -u +"%Y%m%dT%H%M%SZ")

case "$CMD" in
  bot)
    echo "[$TS] launching bot/src/main.ts (daily rebalance)"
    "$TSX" "$REPO_ROOT/bot/src/main.ts" 2>&1 | tee -a "$REPO_ROOT/logs/bot-$TS.log"
    ;;
  snapshot)
    echo "[$TS] launching ledger/snapshot.ts"
    "$TSX" "$REPO_ROOT/ledger/snapshot.ts" 2>&1 | tee -a "$REPO_ROOT/logs/snapshot-$TS.log"
    ;;
  dry-run)
    echo "[$TS] dry-run: bot/src/main.ts with DRY_RUN=1"
    DRY_RUN=1 "$TSX" "$REPO_ROOT/bot/src/main.ts" 2>&1 | tee -a "$REPO_ROOT/logs/dry-run-$TS.log"
    ;;
  *)
    echo "Usage: $0 {bot|snapshot|dry-run}" >&2
    exit 2
    ;;
esac