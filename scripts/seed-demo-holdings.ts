/**
 * Additive-only demo-holdings inserter (DECISIONS #79).
 *
 * UPSERTs the five demo brokerage holdings onto ONE investment account and deletes
 * NOTHING — so unlike `prisma db seed` (which wipes every table), this is SAFE to run
 * against a production database that already holds real data. Use it to make a demo
 * account show a portfolio without re-seeding.
 *
 * Usage (from the project root, with the target DB's URL):
 *   DATABASE_URL="postgresql://USER:PASS@ep-xxxx.REGION.aws.neon.tech/pulse?sslmode=require" \
 *     npx tsx scripts/seed-demo-holdings.ts [--account <accountId>]
 *
 * Default target is the demo seed's brokerage id "acct-brokerage". It writes ONLY if
 * that account exists AND is type INVESTMENT; otherwise it exits without any change.
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { makeAdapter } from '../src/lib/db-adapter';
import { buildSeedData } from '../src/lib/seed/build';

const prisma = new PrismaClient({ adapter: makeAdapter(process.env.DATABASE_URL) });

async function main() {
  const accFlag = process.argv.indexOf('--account');
  const accountId = accFlag !== -1 ? process.argv[accFlag + 1] : 'acct-brokerage';

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, name: true, type: true },
  });
  if (!account) {
    console.error(`No account with id "${accountId}" — nothing written. Pass --account <id> to target a specific investment account.`);
    process.exit(1);
  }
  if (account.type !== 'INVESTMENT') {
    console.error(`Account "${accountId}" is ${account.type}, not INVESTMENT — refusing to add holdings. Nothing written.`);
    process.exit(1);
  }

  const holdings = buildSeedData().holdings; // the canonical five demo positions
  for (const h of holdings) {
    await prisma.holding.upsert({
      where: { accountId_symbol: { accountId: account.id, symbol: h.symbol } },
      create: { accountId: account.id, symbol: h.symbol, name: h.name, quantity: h.quantity, costBasisCents: h.costBasisCents, priceCents: h.priceCents },
      update: { name: h.name, quantity: h.quantity, costBasisCents: h.costBasisCents, priceCents: h.priceCents },
    });
  }
  console.log(`Upserted ${holdings.length} demo holding(s) onto "${account.name}" (${account.id}). Nothing else was touched.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
