/**
 * E2E data helper — insert a small account set (one USD + two foreign) for ONE
 * throwaway user of the OFF-TREE e2e database, so tests/e2e/currency-disclosure.spec.ts
 * can witness the currency-guard disclosure banner (#135 residual) actually render.
 * The seeded demo dataset is all-USD by design, so without this helper the banner's
 * positive path is untestable. Run as a child process from the spec (the generated
 * Prisma client is CJS — same reason scripts/set-sqlite-wal.ts is a tsx child).
 *
 * GUARDS (this mutates data, so it refuses everything except its one job):
 *   1. DATABASE_URL must be EXACTLY the e2e temp SQLite file (tests/setup/test-db.ts
 *      E2E_DB_URL) — never Postgres/production, never dev.db, never the unit DB.
 *   2. The target email must be an `@aimplifi.test` throwaway (the ad-hoc signup
 *      pattern from tests/e2e/auth.spec.ts) — never the shared demo user, whose
 *      dashboard every parallel spec reads.
 *
 * Usage: npx tsx scripts/e2e-add-foreign-account.ts <user-email@aimplifi.test> [--usd-only]
 *   --usd-only inserts ONLY the supported USD checking account (zero withheld), so the
 *   spec can lock the ZERO-withheld branches (original empty-state copy, no banner)
 *   on a user who still passes the supported-account page gates (#145 checker P2).
 */
import { E2E_DB_URL } from '../tests/setup/test-db';
import { makeAdapter } from '../src/lib/db-adapter';
import { PrismaClient } from '../src/generated/prisma/client';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url !== E2E_DB_URL) {
    console.error(
      '[e2e-add-foreign-account] refusing: DATABASE_URL is not the off-tree e2e test database.\n' +
        `  expected: ${E2E_DB_URL}\n` +
        `  got:      ${url ?? '(unset)'}`,
    );
    process.exit(1);
  }

  const email = process.argv[2];
  if (!email || !email.endsWith('@aimplifi.test')) {
    console.error(
      '[e2e-add-foreign-account] usage: npx tsx scripts/e2e-add-foreign-account.ts <email>\n' +
        '  (email must be an @aimplifi.test throwaway — never the shared demo user)',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: makeAdapter(url) });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`[e2e-add-foreign-account] no user with email ${email} — sign the user up first`);
      process.exit(1);
    }
    // Idempotent: Account has no unique constraint on providerRef, so a bare createMany
    // would silently double the fixture on a second invocation ("4 accounts not included"
    // — checker P2). Delete this helper's own rows first; re-runs converge, never grow.
    const usdOnly = process.argv.includes('--usd-only');
    const refs = ['e2e-fx-usd', 'e2e-fx-eur', 'e2e-fx-gbp', 'e2e-fx-eur-inv'];
    await prisma.account.deleteMany({ where: { userId: user.id, providerRef: { in: refs } } });
    // One supported account so the dashboard gate passes (EmptyDashboard needs 0 USD/null).
    const usd = { userId: user.id, provider: 'simplefin', providerRef: 'e2e-fx-usd', name: 'E2E US Checking', type: 'CHECKING', currentBalanceCents: 1_000_00, currency: 'USD' };
    await prisma.account.createMany({
      data: usdOnly
        ? [usd]
        : [
            usd,
            // Three withheld foreign accounts → banner: "3 accounts not included", "EUR, GBP".
            { userId: user.id, provider: 'simplefin', providerRef: 'e2e-fx-eur', name: 'E2E Euro Savings', type: 'SAVINGS', currentBalanceCents: 9_999_00, currency: 'EUR' },
            { userId: user.id, provider: 'simplefin', providerRef: 'e2e-fx-gbp', name: 'E2E UK Card', type: 'CREDIT', currentBalanceCents: 2_000_00, currency: 'GBP' },
            // INVESTMENT-typed + EUR: the only thing keeping it off /investments is the
            // currency filter itself (getInvestments selects type INVESTMENT first), so
            // the spec's name-absence assertion genuinely witnesses the guard — with the
            // SAVINGS/CREDIT rows alone it structurally could not fail (#145 checker P2).
            { userId: user.id, provider: 'simplefin', providerRef: 'e2e-fx-eur-inv', name: 'E2E Euro Brokerage', type: 'INVESTMENT', currentBalanceCents: 50_000_00, currency: 'EUR' },
          ],
    });
    console.log(
      usdOnly
        ? `[e2e-add-foreign-account] added 1 USD account (zero withheld) for ${email}`
        : `[e2e-add-foreign-account] added 1 USD + 3 foreign accounts for ${email}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
