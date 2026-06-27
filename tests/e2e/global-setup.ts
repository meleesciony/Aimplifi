import { execSync } from 'node:child_process';
import { E2E_DB_URL } from '../setup/test-db';

/**
 * Prepare the e2e database (a SQLite file under the OS temp dir — off the
 * OneDrive-synced tree, STATUS #16/#17). All steps run as child processes: the
 * Prisma client (CJS) cannot be imported into Playwright's ESM config loader, so we
 * shell out (the same reason the seed runs via tsx).
 *
 * 1. `db push` creates/syncs the schema. The file lives outside the repo, so the
 *    first run / CI starts from nothing — hence the explicit push before seeding.
 * 2. WAL (before `next start`). The production server is the single writer; in the
 *    default rollback ("delete") journal a writer is blocked until every reader
 *    releases its SHARED lock, so under CPU/IO load an accept/triage write can stall
 *    past the click timeout and hang the disabled-while-pending button (the
 *    phase2-triage flake). WAL lets one writer + concurrent readers proceed and is
 *    persistent on the file. The old dev.db was persistently WAL; a fresh temp DB
 *    must be switched explicitly.
 * 3. Reseed the demo dataset so e2e runs are deterministic and order-independent.
 */
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: E2E_DB_URL };
  execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit', env });
  execSync('npx tsx scripts/set-sqlite-wal.ts', { stdio: 'inherit', env });
  execSync('npx prisma db seed', { stdio: 'inherit', env });
}
