/**
 * E2E data helper — give ONE throwaway user a LINKED account plus a SimpleFIN connection
 * whose last sync actually FAILED (a persisted `lastSyncError`), so
 * tests/e2e/connection-health.spec.ts can witness the Gap 1 §4 reconnect alert render on
 * the dashboard. The seeded demo user has no connection row at all, so the broken-connection
 * path is otherwise untestable. Run as a tsx child process from the spec (CJS Prisma client).
 *
 * GUARDS (mutates data → refuses everything except its one job):
 *   1. DATABASE_URL must be EXACTLY the off-tree e2e temp DB (E2E_DB_URL).
 *   2. The email must be an `@aimplifi.test` throwaway — never the shared demo user.
 *
 * Usage: npx tsx scripts/e2e-set-broken-connection.ts <email@aimplifi.test>
 */
import { E2E_DB_URL } from '../tests/setup/test-db';
import { makeAdapter } from '../src/lib/db-adapter';
import { PrismaClient } from '../src/generated/prisma/client';

/** A literal attempt date (never `new Date()`); the classifier keys off the ERROR, not recency. */
const ATTEMPT_DATE = '2026-05-01';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url !== E2E_DB_URL) {
    console.error(
      '[e2e-set-broken-connection] refusing: DATABASE_URL is not the off-tree e2e test database.\n' +
        `  expected: ${E2E_DB_URL}\n` +
        `  got:      ${url ?? '(unset)'}`,
    );
    process.exit(1);
  }

  const email = process.argv[2];
  if (!email || !email.endsWith('@aimplifi.test')) {
    console.error(
      '[e2e-set-broken-connection] usage: npx tsx scripts/e2e-set-broken-connection.ts <email>\n' +
        '  (email must be an @aimplifi.test throwaway — never the shared demo user)',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: makeAdapter(url) });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`[e2e-set-broken-connection] no user with email ${email} — sign the user up first`);
      process.exit(1);
    }

    // Idempotent: drop this helper's own rows first. Re-runs converge, never accumulate.
    await prisma.account.deleteMany({ where: { userId: user.id, providerRef: 'e2e-broken-chk' } });
    await prisma.simpleFinConnection.deleteMany({ where: { userId: user.id } });

    // A linked account so the dashboard renders (not the empty-state) — its recency is
    // irrelevant to the alert, which is driven purely by the connection's lastSyncError.
    await prisma.account.create({
      data: {
        userId: user.id,
        provider: 'simplefin',
        providerRef: 'e2e-broken-chk',
        name: 'E2E Linked Checking',
        type: 'CHECKING',
        currentBalanceCents: 1_000_00,
        currency: 'USD',
      },
    });
    // The connection is in a FAILED state: last attempt errored (sanitized reason 'auth'),
    // and it never succeeded (lastSyncedAt null). accessUrl is never decrypted on render.
    await prisma.simpleFinConnection.create({
      data: {
        userId: user.id,
        accessUrl: 'e2e-placeholder-not-decrypted',
        lastSyncedAt: null,
        lastSyncAttemptAt: ATTEMPT_DATE,
        lastSyncError: 'auth',
      },
    });

    console.log(`[e2e-set-broken-connection] set a broken SimpleFIN connection for ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
