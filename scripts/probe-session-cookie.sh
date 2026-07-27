#!/usr/bin/env bash
# One-off evidence probe (not part of the gate): sign in for real against a built
# server and print the session cookie's actual Expires attribute, so the 30-minute
# idle window is demonstrated end-to-end rather than inferred from config.
#
# Usage: bash scripts/probe-session-cookie.sh   (requires a prior `next build`)
set -uo pipefail
PORT=${PORT:-3110}
BASE="http://127.0.0.1:${PORT}"
JAR=$(mktemp)

npx next start -p "$PORT" >/tmp/probe-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  curl -s -o /dev/null "${BASE}/sign-in" && break
  sleep 1
done

echo "=== now (UTC) ==="
date -u

CSRF=$(curl -s -c "$JAR" "${BASE}/api/auth/csrf" | sed 's/.*"csrfToken":"\([^"]*\)".*/\1/')
echo "=== csrfToken obtained: ${#CSRF} chars ==="

echo "=== Set-Cookie on a real demo sign-in ==="
curl -s -i -b "$JAR" -c "$JAR" -X POST "${BASE}/api/auth/callback/demo" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=${CSRF}" \
  --data-urlencode "callbackUrl=${BASE}/dashboard" \
  | grep -i '^set-cookie:.*session-token' \
  | sed 's/;/;\n    /g'
