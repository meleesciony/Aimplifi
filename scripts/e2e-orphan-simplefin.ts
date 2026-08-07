/**
 * E2E data helper — put ONE throwaway user into the K.2b production state: SimpleFIN
 * accounts that OUTLIVED their connection (the disconnect flow deletes the
 * SimpleFinConnection row and deliberately keeps the data). Found live 2026-08-06: the
 * owner's connection row was deleted ~16 days earlier, 25 accounts sat frozen reading
 * "No new data in 16 days — you may need to reconnect" (a stale-feed guess over a
 * connection that provably no longer existed), and the connect button offered
 * first-time setup. tests/e2e/connection-health.spec.ts uses this to witness the
 * honest surfaces instead: the per-row "Bank connection removed" line and the
 * reconnect-framed front door with the accounts named.
 *
 * GUARDS (mutates data → refuses everything except its one job):
 *   1. DATABASE_URL must be EXACTLY the off-tree e2e temp DB (E2E_DB_URL).
 *   2. The email must be an `@aimplifi.test` throwaway — never the shared demo user.
 *
 * Usage: npx tsx scripts/e2e-orphan-simplefin.ts <email@aimplifi.test>
 */
import { E2E_DB_URL } from '../tests/setup/test-db';
import { makeAdapter } from '../src/lib/db-adapter';
import { PrismaClient } from '../src/generated/prisma/client';

/** The newest data the orphaned accounts hold — a literal, never `new Date()`, so the
 *  spec can assert the exact formatted date the notice prints. Far enough back that the
 *  day count stays positive against any plausible business "today". */
const LAST_DATA_DATE = '2026-05-01';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url !== E2E_DB_URL) {
    console.error(
      '[e2e-orphan-simplefin] refusing: DATABASE_URL is not the off-tree e2e test database.\n' +
        `  expected: ${E2E_DB_URL}\n` +
        `  got:      ${url ?? '(unset)'}`,
    );
    process.exit(1);
  }

  const email = process.argv[2];
  if (!email || !email.endsWith('@aimplifi.test')) {
    console.error(
      '[e2e-orphan-simplefin] usage: npx tsx scripts/e2e-orphan-simplefin.ts <email>\n' +
        '  (email must be an @aimplifi.test throwaway — never the shared demo user)',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: makeAdapter(url) });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`[e2e-orphan-simplefin] no user with email ${email} — sign the user up first`);
      process.exit(1);
    }

    // Idempotent: drop this helper's own rows first. The DELETED connection row is the
    // state under test, so any connection row this user holds is removed — that is the
    // exact shape disconnectSimplefin leaves behind.
    await prisma.account.deleteMany({
      where: { userId: user.id, providerRef: { in: ['e2e-orphan-card', 'e2e-orphan-chk'] } },
    });
    await prisma.simpleFinConnection.deleteMany({ where: { userId: user.id } });

    const card = await prisma.account.create({
      data: {
        userId: user.id,
        provider: 'simplefin',
        providerRef: 'e2e-orphan-card',
        name: 'E2E Orphan Card',
        type: 'CREDIT',
        currentBalanceCents: -25_000,
        currency: 'USD',
      },
    });
    await prisma.account.create({
      data: {
        userId: user.id,
        provider: 'simplefin',
        providerRef: 'e2e-orphan-chk',
        name: 'E2E Orphan Checking',
        type: 'CHECKING',
        currentBalanceCents: 100_000,
        currency: 'USD',
      },
    });
    await prisma.transaction.create({
      data: {
        accountId: card.id,
        providerRef: 'e2e-orphan-txn',
        date: LAST_DATA_DATE,
        amountCents: -50_00,
        rawDescriptor: 'E2E LAST CHARGE BEFORE DISCONNECT',
        status: 'POSTED',
      },
    });

    console.log(`[e2e-orphan-simplefin] gave ${email} 2 SimpleFIN accounts and NO connection row`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
