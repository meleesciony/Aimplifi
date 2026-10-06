/**
 * Additive live-demo seeder for DECISIONS #788 ("Money you put in") — one-off, run by
 * hand against the production DB, like `seed-demo-goals-prod.ts` / `seed-demo-tags-prod.ts`.
 *
 * Production's shared demo was seeded once and is never re-seeded (`prisma db seed`
 * wipes every table), so the seed's new Brokerage transfers are not in it and the live
 * card has nothing to show. This writes exactly those rows — taken from
 * `buildSeedData()` by their two descriptors, so the live demo and the seed cannot drift
 * — onto the shared demo user's Everyday Checking, filed Transfer and transfer-flagged
 * exactly as the seed pipeline files them (`pipeline.ts`: a transfer-flagged row files
 * Transfer). Fixed ids (`txn-demo-dep-<date>`), so a second run writes nothing new.
 * Touches nothing else.
 *
 * Refuses unless: the URL is Postgres; `user-demo` exists; its `acct-checking` is
 * CHECKING and `acct-brokerage` is INVESTMENT ending 8842 (the descriptors name it).
 *
 * Undo: DELETE FROM "Transaction" WHERE id LIKE 'txn-demo-dep-%';
 *
 * Usage (owner or a trusted operator, from a shell with the prod DATABASE_URL):
 *   DATABASE_URL="postgresql://…" npx tsx scripts/seed-demo-deposits-prod.ts
 *
 * Node type: state-writer (additive, idempotent, demo-row only).
 */
import { makeAdapter } from '../src/lib/db-adapter';
import { PrismaClient } from '../src/generated/prisma/client';
import { buildSeedData } from '../src/lib/seed/build';

const url = process.env.DATABASE_URL ?? '';
if (!url.startsWith('postgres')) {
  console.error('Refusing: set DATABASE_URL to the production Postgres URL. This script only writes the demo Brokerage transfer rows.');
  process.exit(1);
}

const DESCRIPTORS = new Set(['ONLINE TRANSFER TO BROKERAGE X8842', 'ONLINE TRANSFER FROM BROKERAGE X8842']);
const prisma = new PrismaClient({ adapter: makeAdapter(url) });

async function main() {
  const [user, checking, brokerage] = await Promise.all([
    prisma.user.findUnique({ where: { id: 'user-demo' }, select: { id: true } }),
    prisma.account.findFirst({ where: { id: 'acct-checking', userId: 'user-demo' }, select: { type: true } }),
    prisma.account.findFirst({ where: { id: 'acct-brokerage', userId: 'user-demo' }, select: { type: true, mask: true } }),
  ]);
  if (!user || checking?.type !== 'CHECKING' || brokerage?.type !== 'INVESTMENT' || brokerage.mask !== '8842') {
    console.error('Refusing: the shared demo user, its Everyday Checking or its Brokerage (··8842) is not as the seed describes. Nothing written.');
    process.exit(1);
  }

  const rows = buildSeedData().transactions.filter((t) => t.accountId === 'acct-checking' && DESCRIPTORS.has(t.rawDescriptor));
  let written = 0;
  for (const t of rows) {
    const id = `txn-demo-dep-${t.date}`;
    const existing = await prisma.transaction.findUnique({ where: { id }, select: { id: true } });
    if (existing) continue;
    await prisma.transaction.create({
      data: {
        id,
        accountId: 'acct-checking',
        date: t.date,
        amountCents: t.amountCents,
        rawDescriptor: t.rawDescriptor,
        categoryId: 'transfer',
        confidenceBps: 9900,
        status: 'POSTED',
        needsReview: false,
        isTransfer: true,
      },
    });
    written += 1;
  }
  const onFile = await prisma.transaction.count({ where: { id: { startsWith: 'txn-demo-dep-' } } });
  console.log(`seed rows: ${rows.length}; written now: ${written}; on file: ${onFile}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
