/**
 * E2E data helper — give ONE throwaway user a LINKED (SimpleFIN) account whose data is
 * a month old, so tests/e2e/connection-health.spec.ts can witness the staleness surfaces
 * (Competitive-Gap plan, Gap 1 §3–4) actually render: the dashboard "data may be out of
 * date" banner and the /accounts "you may need to reconnect" hint. The seeded demo user's
 * accounts are all provider 'demo' (never linked → never stale) by design, so the positive
 * path is otherwise untestable. Run as a tsx child process from the spec (CJS Prisma client).
 *
 * GUARDS (mutates data → refuses everything except its one job):
 *   1. DATABASE_URL must be EXACTLY the off-tree e2e temp DB (E2E_DB_URL).
 *   2. The email must be an `@aimplifi.test` throwaway — never the shared demo user.
 *
 * Usage: npx tsx scripts/e2e-add-stale-linked-account.ts <email@aimplifi.test>
 */
import { E2E_DB_URL } from '../tests/setup/test-db';
import { makeAdapter } from '../src/lib/db-adapter';
import { PrismaClient } from '../src/generated/prisma/client';

/** Far enough in the past to grade very_stale (≥14 days) against any plausible "today".
 *  A literal, never `new Date()` — the classifier is deterministic on this input. */
const OLD_DATE = '2026-05-01';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url !== E2E_DB_URL) {
    console.error(
      '[e2e-add-stale-linked-account] refusing: DATABASE_URL is not the off-tree e2e test database.\n' +
        `  expected: ${E2E_DB_URL}\n` +
        `  got:      ${url ?? '(unset)'}`,
    );
    process.exit(1);
  }

  const email = process.argv[2];
  if (!email || !email.endsWith('@aimplifi.test')) {
    console.error(
      '[e2e-add-stale-linked-account] usage: npx tsx scripts/e2e-add-stale-linked-account.ts <email>\n' +
        '  (email must be an @aimplifi.test throwaway — never the shared demo user)',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: makeAdapter(url) });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`[e2e-add-stale-linked-account] no user with email ${email} — sign the user up first`);
      process.exit(1);
    }

    // Idempotent: drop this helper's own rows first (deleting the account cascades its
    // transactions). Re-runs converge, never accumulate.
    await prisma.account.deleteMany({ where: { userId: user.id, providerRef: 'e2e-stale-chk' } });
    await prisma.simpleFinConnection.deleteMany({ where: { userId: user.id } });

    const acct = await prisma.account.create({
      data: {
        userId: user.id,
        provider: 'simplefin', // a LINKED provider → subject to staleness (vs 'demo'/'manual')
        providerRef: 'e2e-stale-chk',
        name: 'E2E Linked Checking',
        type: 'CHECKING',
        currentBalanceCents: 1_000_00,
        currency: 'USD',
      },
    });
    // One month-old transaction — the newest across the user's linked accounts, so
    // getDataFreshness grades the whole feed very_stale.
    await prisma.transaction.create({
      data: {
        accountId: acct.id,
        providerRef: 'e2e-stale-txn',
        date: OLD_DATE,
        amountCents: -50_00,
        rawDescriptor: 'E2E STALE MERCHANT',
        status: 'POSTED',
      },
    });
    // A connection with an OLD lastSyncedAt drives the /accounts connected-row health.
    // accessUrl is NEVER decrypted on render (getAccountsView selects only lastSyncedAt)
    // and the spec never triggers a sync, so a placeholder ciphertext is safe.
    await prisma.simpleFinConnection.create({
      data: { userId: user.id, accessUrl: 'e2e-placeholder-not-decrypted', lastSyncedAt: OLD_DATE },
    });

    console.log(`[e2e-add-stale-linked-account] added a stale linked account + connection for ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
