/**
 * Driver-adapter selection by connection-string scheme (DECISIONS #35).
 *
 * Local dev + the entire test suite run on SQLite with ZERO credentials
 * (`file:./dev.db`) — the demo-mode invariant. Production runs on Postgres when
 * DATABASE_URL is a `postgres://` / `postgresql://` URL (e.g. the deployed Neon
 * database). Nothing else in the app changes: every engine is pure and every
 * query goes through Prisma.
 *
 * IMPORTANT: the GENERATED Prisma client must be built against the matching
 * provider, because Prisma validates the adapter against the client's provider:
 *   - locally / tests: `prisma generate` from prisma/schema.prisma (sqlite)
 *     + the better-sqlite3 adapter.
 *   - production build: scripts/gen-pg-schema.mjs derives a postgresql schema
 *     and `prisma generate` runs against it + the pg adapter (see vercel.json).
 * This keeps ONE canonical schema (no drift) with a deterministic transform.
 */
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';

const DEFAULT_SQLITE_URL = 'file:./dev.db';

/** True for Postgres connection strings (postgres:// or postgresql://). */
export function isPostgresUrl(url: string | undefined | null): boolean {
  return /^postgres(ql)?:\/\//i.test(url ?? '');
}

/**
 * Build the Prisma driver adapter for the given connection string. Falls back
 * to the local SQLite file when no URL is provided (zero-credential demo).
 */
export function makeAdapter(url: string | undefined | null) {
  const resolved = url && url.length > 0 ? url : DEFAULT_SQLITE_URL;
  return isPostgresUrl(resolved)
    ? new PrismaPg({ connectionString: resolved })
    : new PrismaBetterSqlite3({ url: resolved });
}
