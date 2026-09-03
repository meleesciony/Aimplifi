#!/usr/bin/env bash
# Vercel build (DECISIONS #635).
#
# Production has DATABASE_URL (Neon). Preview often does not — DEPLOY.md
# ticks Production only. An unconditional `prisma db push` then dies with
# "datasource.url property is required" before `next build`, which is why
# every Preview on this repo has been red while Production stays READY.
#
# Unset DATABASE_URL: generate the SQLite client (matches makeAdapter's
# empty-URL fallback) and skip db push. Do not derive the Postgres schema —
# a postgresql client + sqlite adapter throws at import.
# Set DATABASE_URL: gen-pg → generate → push → next build (unchanged).
set -euo pipefail

if [ -n "${DATABASE_URL:-}" ]; then
  node scripts/gen-pg-schema.mjs
  export PRISMA_SCHEMA=prisma/.generated.postgres.prisma
  npx prisma generate
  npx prisma db push --accept-data-loss
else
  echo "vercel-build: DATABASE_URL unset — skipping postgres schema + db push"
  # prisma.config.ts requires datasource.url; generate never connects.
  DATABASE_URL="file:./dev.db" npx prisma generate
fi

next build
