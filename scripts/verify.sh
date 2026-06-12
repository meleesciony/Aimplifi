#!/usr/bin/env bash
# Single source of truth for "Definition of Done" verification.
# A phase is NOT done unless this exits 0 with real output shown.
set -uo pipefail
fail=0
run() { echo; echo "════ $1 ════"; shift; "$@" || fail=1; }

run "TYPECHECK (tsc --noEmit)"  npx tsc --noEmit
run "LINT (eslint)"             npx eslint . --max-warnings=0
run "UNIT TESTS (vitest)"       npx vitest run
run "BUILD (next build)"        npx next build

# E2E is opt-in per environment (needs browsers): VERIFY_E2E=1 bash scripts/verify.sh
if [ "${VERIFY_E2E:-0}" = "1" ]; then
  run "E2E (playwright)"        npx playwright test
else
  echo; echo "════ E2E SKIPPED (set VERIFY_E2E=1) — phase still requires an e2e or"
  echo "     labeled scripted simulation before sign-off ════"
fi

echo
if [ $fail -eq 0 ]; then echo "✅ VERIFY GREEN"; else echo "❌ VERIFY FAILED"; exit 1; fi
