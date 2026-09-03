// Derive a PostgreSQL Prisma schema from the canonical SQLite schema.
//
// We keep ONE source of truth — prisma/schema.prisma (provider = "sqlite"),
// which local dev and the whole test suite use with zero credentials. For a
// production deploy on Postgres we need a schema whose datasource provider is
// "postgresql" (Prisma validates the runtime adapter against the client's
// provider). Rather than maintain a second hand-written schema that can drift,
// we transform the canonical one deterministically here. The schema content is
// already Postgres-portable: Int cents, String dates, no enums/Json/Decimal.
//
// Output: prisma/.generated.postgres.prisma (gitignored). Used by
// scripts/vercel-build.sh when DATABASE_URL is set.
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'prisma/schema.prisma';
const OUT = 'prisma/.generated.postgres.prisma';

const src = readFileSync(SRC, 'utf8');

// Pure provider swap. The connection URL is supplied by prisma.config.ts
// (datasource.url = env("DATABASE_URL")) for BOTH providers — defining it here
// too would be a duplicate-definition validation error.
const out = src.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');

if (out === src || !out.includes('provider = "postgresql"')) {
  console.error('gen-pg-schema: failed to swap the datasource provider in ' + SRC);
  process.exit(1);
}

const banner =
  '// AUTO-GENERATED from prisma/schema.prisma by scripts/gen-pg-schema.mjs.\n' +
  '// DO NOT EDIT — edit the canonical SQLite schema and regenerate.\n\n';

writeFileSync(OUT, banner + out);
console.log('gen-pg-schema: wrote ' + OUT + ' (provider=postgresql)');
