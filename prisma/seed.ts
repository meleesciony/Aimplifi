/**
 * Database seed — thin shell around the PURE builder in src/lib/seed/build.ts,
 * plus Phase 2 persistence: categories, merchants, per-transaction
 * categorization (pipeline output), and detected recurring series.
 *
 * Usage: npx prisma db seed [-- --asOf 2026-06-10]
 * Same --asOf ⇒ identical dataset (asserted by tests/unit/seed.test.ts).
 */
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../src/generated/prisma/client';
import { DEFAULT_AS_OF, buildSeedData } from '../src/lib/seed/build';
import { CATEGORIES } from '../src/lib/engine/categorize/categories';
import { KNOWN_MERCHANTS } from '../src/lib/engine/categorize/normalize';
import { categorize } from '../src/lib/engine/categorize/pipeline';
import { detectRecurring } from '../src/lib/engine/recurring/detect';
import { isoDate } from '../src/lib/dates';

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
});

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function main() {
  const asOfFlag = process.argv.indexOf('--asOf');
  const asOf = asOfFlag !== -1 ? process.argv[asOfFlag + 1] : DEFAULT_AS_OF;
  const data = buildSeedData(asOf);

  console.log(`Seeding demo dataset (asOf ${data.asOf}) …`);

  // wipe in dependency order (idempotent re-seed)
  await prisma.correction.deleteMany();
  await prisma.categorizationRule.deleteMany();
  await prisma.recurringSeries.deleteMany();
  await prisma.merchantPattern.deleteMany();
  await prisma.cardPayment.deleteMany();
  await prisma.statement.deleteMany();
  await prisma.balanceSnapshot.deleteMany();
  await prisma.scheduledTransaction.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.merchant.deleteMany();
  await prisma.category.deleteMany();
  await prisma.autopayConfig.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.create({ data: data.user });
  await prisma.account.createMany({ data: data.accounts });
  await prisma.autopayConfig.createMany({ data: data.autopays });
  await prisma.statement.createMany({ data: data.statements });
  await prisma.cardPayment.createMany({ data: data.cardPayments });

  // ── Phase 2: categories, merchants, categorized transactions ──
  await prisma.category.createMany({
    data: CATEGORIES.map((c) => ({ id: c.id, name: c.name, isSystem: true })),
  });

  // Categorize every transaction with the pure pipeline (no user rules yet).
  const categorized = data.transactions.map((t) => ({
    txn: t,
    out: categorize({
      rawDescriptor: t.rawDescriptor,
      amountCents: t.amountCents,
      date: t.date,
      accountId: t.accountId,
      isTransfer: t.isTransfer,
    }),
  }));

  // Merchants discovered across the dataset (known + cleaned-up unknowns).
  const merchantIds = new Map<string, string>(); // canonical → id
  for (const { out } of categorized) {
    if (!merchantIds.has(out.merchantCanonical)) {
      merchantIds.set(out.merchantCanonical, `merch-${slug(out.merchantCanonical)}`);
    }
  }
  const knownByCanonical = new Map(KNOWN_MERCHANTS.map((k) => [k.canonical, k]));
  await prisma.merchant.createMany({
    data: [...merchantIds.entries()].map(([canonical, id]) => ({
      id,
      canonical,
      defaultCategoryId: knownByCanonical.get(canonical)?.categoryId ?? null,
    })),
  });
  await prisma.merchantPattern.createMany({
    data: KNOWN_MERCHANTS.filter((k) => merchantIds.has(k.canonical)).map((k, i) => ({
      id: `pat-${String(i + 1).padStart(3, '0')}`,
      merchantId: merchantIds.get(k.canonical)!,
      pattern: k.pattern.source,
      kind: 'REGEX',
    })),
  });

  await prisma.transaction.createMany({
    data: categorized.map(({ txn, out }) => ({
      ...txn,
      merchantId: merchantIds.get(out.merchantCanonical) ?? null,
      categoryId: out.categoryId,
      confidenceBps: out.confidenceBps,
      needsReview: out.needsReview,
    })),
  });

  // ── Phase 2: detected recurring series ──
  const series = detectRecurring(
    data.transactions.filter((t) => t.status === 'POSTED'),
    isoDate(data.asOf),
  );
  await prisma.recurringSeries.createMany({
    data: series
      .filter((s) => merchantIds.has(s.merchantCanonical))
      .map((s, i) => ({
        id: `rec-${String(i + 1).padStart(3, '0')}`,
        userId: data.user.id,
        merchantId: merchantIds.get(s.merchantCanonical)!,
        cadence: s.cadence,
        typicalAmountCents: s.typicalAmountCents,
        lastAmountCents: s.lastAmountCents,
        priceChangedAt: s.priceChangedAt,
        lastSeenAt: s.lastSeenAt,
        nextExpectedAt: s.nextExpectedAt,
        isSubscription: s.isSubscription,
      })),
  });

  await prisma.scheduledTransaction.createMany({ data: data.scheduled });
  await prisma.balanceSnapshot.createMany({ data: data.snapshots });

  const counts = {
    accounts: data.accounts.length,
    statements: data.statements.length,
    cardPayments: data.cardPayments.length,
    transactions: data.transactions.length,
    merchants: merchantIds.size,
    recurringSeries: series.length,
    needsReview: categorized.filter((c) => c.out.needsReview).length,
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
