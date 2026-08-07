#!/usr/bin/env bash
# scripts/ci-status.sh — block until GitHub Actions' verify run for a commit completes,
# then exit with its verdict.
#
# K.8: CLAUDE.md rule 5 proves the DEPLOY reached READY; nothing proved the GATE that
# guards main. Three shipped fences (#244, K.3, K.6) each left the full suite red
# unnoticed, and over 2026-08-02..06 CI was 50 failure / 49 cancelled / 0 success while
# every session reported "verify green" — a green local verify is not a green gate.
# This script is the missing read: run it after every push, before claiming shipped.
#
# Usage: bash scripts/ci-status.sh [ref]      (defaults to HEAD; short shas fine)
# Exit:  0 = success
#        1 = failure / timed out waiting
#        2 = no run found for the sha
#        3 = cancelled (superseded by a newer push to the same ref — check the NEWEST
#            run for the ref instead; this is not a test failure)
#        4 = gh itself failed (auth/network) — the verdict is UNKNOWN, not "no run"
set -u

# Critic F5: `gh run list --commit` matches only FULL 40-char shas — a short sha
# silently returns [] and used to read as "was it pushed?". Resolve through git first.
ref="${1:-HEAD}"
if ! sha="$(git rev-parse --verify "${ref}^{commit}" 2>/dev/null)"; then
  echo "ci-status: '${ref}' is not a commit this checkout knows" >&2
  exit 2
fi

# Critic F6: a gh auth/network error must not masquerade as "no run found".
gh_probe_err="$(gh run list --workflow verify.yml --limit 1 2>&1 >/dev/null)" || {
  echo "ci-status: gh failed — verdict UNKNOWN, not 'no run': ${gh_probe_err}" >&2
  exit 4
}

# The run can take a few seconds to appear after the push. (--limit 1 is fine for
# direct pushes to main; a PR branch can carry a push AND a pull_request run for one
# sha — if that ever matters here, disambiguate with --event.)
run_id=""
for _ in $(seq 1 12); do
  run_id="$(gh run list --workflow verify.yml --commit "$sha" --limit 1 \
      --json databaseId --jq '.[0].databaseId' 2>/dev/null)" || run_id=""
  if [ -n "$run_id" ] && [ "$run_id" != "null" ]; then break; fi
  sleep 10
done
if [ -z "$run_id" ] || [ "$run_id" = "null" ]; then
  echo "ci-status: no verify.yml run found for ${sha} — was it pushed?" >&2
  exit 2
fi

echo "ci-status: watching verify run ${run_id} for ${sha:0:12} …"
deadline=$(( $(date +%s) + 40 * 60 ))   # verify.yml's own job timeout is 30 min
while :; do
  status="$(gh run view "$run_id" --json status --jq .status 2>/dev/null)" || status=""
  if [ "$status" = "completed" ]; then break; fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "ci-status: run ${run_id} still '${status:-unreachable}' after 40 min" >&2
    exit 1
  fi
  sleep 30
done

conclusion="$(gh run view "$run_id" --json conclusion --jq .conclusion 2>/dev/null)" || conclusion=""
url="$(gh run view "$run_id" --json url --jq .url 2>/dev/null)" || url=""
echo "ci-status: ${conclusion:-unknown} — ${url}"
case "$conclusion" in
  success)   exit 0 ;;
  cancelled) # Critic F3: ~half of all runs are concurrency-cancels of superseded
             # pushes. That is not a red gate — it means a NEWER push owns the ref.
             echo "ci-status: cancelled = superseded by a newer push; re-run against the newest sha" >&2
             exit 3 ;;
  *)         exit 1 ;;
esac
