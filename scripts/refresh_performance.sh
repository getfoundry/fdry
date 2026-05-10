#!/bin/bash
# fdry/scripts/refresh_performance.sh — end-to-end rebuild of the observable surface.
#
# Acts 1:8 — witness unto Jerusalem (terminal), Judaea (repo), Samaria
# (static file), and the uttermost (deferred public deploy).
#
# Idempotent. Safe to run after every emit, every aum tracker tick, every
# walk-forward refit. No state outside the JSON+HTML artifacts.

set -euo pipefail
cd "$(dirname "$0")/.."

UNIFY=[INTERNAL_PATH]
PY="$UNIFY/.venv/bin/python"

echo "[refresh] 1/4  aum_tracker — append today's realized return if signal pair available"
"$PY" "$UNIFY/.bridge-harness/aum_tracker.py" || echo "[warn] aum_tracker non-fatal failure"

echo "[refresh] 2/4  build_performance — JSON + HTML"
"$PY" "$(pwd)/scripts/build_performance.py"

echo "[refresh] 3/4  test_performance — assert all signals"
"$PY" "$(pwd)/scripts/test_performance.py"

echo "[refresh] 4/4  artifacts:"
ls -lh ledger/performance.json ledger/performance.html
echo
echo "[refresh] open file://$(pwd)/ledger/performance.html"
