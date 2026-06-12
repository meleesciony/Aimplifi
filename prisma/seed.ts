/**
 * Database seed — thin shell around the PURE builder in src/lib/seed/build.ts.
 * Usage: npx prisma db seed [-- --asOf 2026-06-10]
 * Same --asOf ⇒ identical dataset (asserted by tests/unit/seed.test.ts).
 */
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../src/generated/prisma/client';
import { DEFAULT_AS_OF, buildSeedData } from '../src/lib/seed/build';

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
});

async function main() {
  const asOfFlag = process.argv.indexOf('--asOf');
  const asOf = asOfFlag !== -1 ? process.argv[asOfFlag + 1] : DEFAULT_AS_OF;
  const data = buildSeedData(asOf);

  console.log(`Seeding demo dataset (asOf ${data.asOf}) …`);

  // wipe in dependency order (idempotent re-seed)
  await prisma.cardPayment.deleteMany();
  await prisma.statement.deleteMany();
  await prisma.balanceSnapshot.deleteMany();
  await prisma.scheduledTransaction.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.autopayConfig.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.create({ data: data.user });
  await prisma.account.createMany({ data: data.accounts });
  await prisma.autopayConfig.createMany({ data: data.autopays });
  await prisma.statement.createMany({ data: data.statements });
  await prisma.cardPayment.createMany({ data: data.cardPayments });
  await prisma.transaction.createMany({ data: data.transactions });
  await prisma.scheduledTransaction.createMany({ data: data.scheduled });
  await prisma.balanceSnapshot.createMany({ data: data.snapshots });

  const counts = {
    accounts: data.accounts.length,
    statements: data.statements.length,
    cardPayments: data.cardPayments.length,
    transactions: data.transactions.length,
    scheduled: data.scheduled.length,
    snapshots: data.snapshots.length,
  };
  console.log('Seeded:', JSON.stringify(counts));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
