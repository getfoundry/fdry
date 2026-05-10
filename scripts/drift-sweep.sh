#!/bin/bash
# fdry drift sweep — weekly one-command operator routine.
# Re-runs the whitelist data probe, typecheck, and test suite,
# and prints a one-screen PASS/WARN/FAIL summary.
#
# Usage:  bash scripts/drift-sweep.sh
# Exits 0 if all sections pass, non-zero if any failed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WITH_SECRETS="${REPO_ROOT}/scripts/with-secrets"
VOLTR_DIR="${REPO_ROOT}/voltr"

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fdry-drift.XXXXXXXX")"
PROBE_LOG="${LOG_DIR}/probe.log"
TYPECHECK_LOG="${LOG_DIR}/typecheck.log"
TEST_LOG="${LOG_DIR}/test.log"

# Section status: PASS / WARN / FAIL
S1_STATUS="FAIL"; S1_DETAIL=""; S1_FIX=""
S2_STATUS="FAIL"; S2_DETAIL=""; S2_FIX=""
S3_STATUS="FAIL"; S3_DETAIL=""; S3_FIX=""

echo "=== fdry drift sweep — ${TS} ==="

# ─── [1/3] whitelist data probe ──────────────────────────────────────────────
PROBE=""
if [ -f "${REPO_ROOT}/scripts/research/r3-jup-no-side.py" ]; then
  PROBE="${REPO_ROOT}/scripts/research/r3-jup-no-side.py"
elif [ -f "/tmp/r3-jup-no-side.py" ]; then
  PROBE="/tmp/r3-jup-no-side.py"
fi

if [ -z "$PROBE" ]; then
  S1_STATUS="WARN"
  S1_DETAIL="(probe script not found in scripts/research/ or /tmp/)"
  S1_FIX="restore scripts/research/r3-jup-no-side.py from slice B"
else
  if "${WITH_SECRETS}" python3 "$PROBE" >"$PROBE_LOG" 2>&1; then
    VERDICT_JSON="/tmp/jup-no-side-verdict.json"
    if [ -f "$VERDICT_JSON" ]; then
      N_FILT=$(python3 -c "import json;print(json.load(open('${VERDICT_JSON}'))['n_filtered'])" 2>/dev/null || echo "?")
      NO_HIT=$(python3 -c "import json;print(f\"{json.load(open('${VERDICT_JSON}'))['no_outcome_rate']:.3f}\")" 2>/dev/null || echo "?")
      VERDICT=$(python3 -c "import json;print(json.load(open('${VERDICT_JSON}'))['verdict'])" 2>/dev/null || echo "?")
      S1_DETAIL="(n_filtered=${N_FILT}, outcome=${NO_HIT})"
      if [ "$VERDICT" = "GO" ]; then
        S1_STATUS="PASS"
      else
        S1_STATUS="WARN"
        S1_FIX="probe verdict=${VERDICT}; review ${VERDICT_JSON}"
      fi
    else
      S1_STATUS="WARN"
      S1_DETAIL="(probe ran but verdict json not produced)"
      S1_FIX="check ${PROBE_LOG}"
    fi
  else
    S1_STATUS="FAIL"
    S1_DETAIL="(probe exited non-zero)"
    S1_FIX="re-run: ${WITH_SECRETS} python3 ${PROBE}  (log: ${PROBE_LOG})"
  fi
fi
printf "[1/3] whitelist data probe       %-5s %s\n" "$S1_STATUS" "$S1_DETAIL"

# ─── [2/3] typecheck ─────────────────────────────────────────────────────────
if (cd "$VOLTR_DIR" && pnpm typecheck) >"$TYPECHECK_LOG" 2>&1; then
  S2_STATUS="PASS"
else
  S2_STATUS="FAIL"
  S2_FIX="cd voltr && pnpm typecheck  (log: ${TYPECHECK_LOG})"
fi
printf "[2/3] typecheck                  %-5s %s\n" "$S2_STATUS" "$S2_DETAIL"

# ─── [3/3] test suite ────────────────────────────────────────────────────────
TEST_RC=0
(cd "$VOLTR_DIR" && pnpm test) >"$TEST_LOG" 2>&1 || TEST_RC=$?

# Vitest prints two summary lines: "Test Files  19 passed" and "Tests  183 passed | 2 todo".
# Prefer the Tests line for individual test counts.
TESTS_LINE=$(grep -E '^[[:space:]]*Tests[[:space:]]' "$TEST_LOG" | tail -n1 || true)
FILES_LINE=$(grep -E '^[[:space:]]*Test Files[[:space:]]' "$TEST_LOG" | tail -n1 || true)
PASS_N=$(echo "$TESTS_LINE" | grep -Eo '[0-9]+ passed' | head -n1 | awk '{print $1}' || true)
FAIL_N=$(echo "$TESTS_LINE" | grep -Eo '[0-9]+ failed' | head -n1 | awk '{print $1}' || true)
TODO_N=$(echo "$TESTS_LINE" | grep -Eo '[0-9]+ todo' | head -n1 | awk '{print $1}' || true)
FILES_N=$(echo "$FILES_LINE" | grep -Eo '[0-9]+ passed' | head -n1 | awk '{print $1}' || true)

PASS_N="${PASS_N:-0}"; FAIL_N="${FAIL_N:-0}"; TODO_N="${TODO_N:-0}"; FILES_N="${FILES_N:-?}"

DETAIL_BITS="${PASS_N} passed"
[ "$TODO_N" != "0" ] && DETAIL_BITS="${DETAIL_BITS} | ${TODO_N} todo"
[ "$FAIL_N" != "0" ] && DETAIL_BITS="${DETAIL_BITS} | ${FAIL_N} failed"
S3_DETAIL="(${DETAIL_BITS} across ${FILES_N} files)"

if [ "$TEST_RC" -eq 0 ] && [ "$FAIL_N" = "0" ]; then
  S3_STATUS="PASS"
elif [ "$PASS_N" != "0" ] && [ "$FAIL_N" != "0" ]; then
  S3_STATUS="FAIL"
  S3_FIX="cd voltr && pnpm test  (partial fail; log: ${TEST_LOG})"
else
  S3_STATUS="FAIL"
  S3_FIX="cd voltr && pnpm test  (log: ${TEST_LOG})"
fi
printf "[3/3] test suite                 %-5s %s\n" "$S3_STATUS" "$S3_DETAIL"

# ─── summary ─────────────────────────────────────────────────────────────────
OVERALL="PASS"
case "$S1_STATUS $S2_STATUS $S3_STATUS" in
  *FAIL*) OVERALL="FAIL" ;;
  *WARN*) OVERALL="WARN" ;;
esac

case "$OVERALL" in
  PASS) echo "SUMMARY: PASS — no drift detected" ;;
  WARN)
    echo "SUMMARY: WARN — investigate:"
    [ "$S1_STATUS" = "WARN" ] && echo "  - probe: ${S1_FIX}"
    [ "$S2_STATUS" = "WARN" ] && echo "  - typecheck: ${S2_FIX}"
    [ "$S3_STATUS" = "WARN" ] && echo "  - tests: ${S3_FIX}"
    ;;
  FAIL)
    echo "SUMMARY: FAIL — fix:"
    [ "$S1_STATUS" = "FAIL" ] && echo "  - probe: ${S1_FIX}"
    [ "$S2_STATUS" = "FAIL" ] && echo "  - typecheck: ${S2_FIX}"
    [ "$S3_STATUS" = "FAIL" ] && echo "  - tests: ${S3_FIX}"
    ;;
esac

echo "logs: ${LOG_DIR}"

case "$OVERALL" in
  PASS) exit 0 ;;
  WARN) exit 0 ;;
  FAIL) exit 1 ;;
esac
