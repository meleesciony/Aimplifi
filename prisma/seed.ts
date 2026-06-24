/**
 * Database seed — thin shell around the PURE builder in src/lib/seed/build.ts,
 * plus Phase 2 persistence: categories, merchants, per-transaction
 * categorization (pipeline output), and detected recurring series.
 *
 * Usage: npx prisma db seed [-- --asOf 2026-06-10]
 * Same --asOf ⇒ identical dataset (asserted by tests/unit/seed.test.ts).
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { isPostgresUrl, makeAdapter } from '../src/lib/db-adapter';
import { DEFAULT_AS_OF, buildSeedData } from '../src/lib/seed/build';
import { CATEGORIES } from '../src/lib/engine/categorize/categories';
import { KNOWN_MERCHANTS } from '../src/lib/engine/categorize/normalize';
import { categorize } from '../src/lib/engine/categorize/pipeline';
import { detectRecurring } from '../src/lib/engine/recurring/detect';
import { isoDate } from '../src/lib/dates';

const prisma = new PrismaClient({ adapter: makeAdapter(process.env.DATABASE_URL) });

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function main() {
  // GUARD: this seed DELETES EVERY ROW (the deleteMany calls below) and re-inserts the
  // demo dataset — catastrophic against a production DB that holds real data. Refuse to
  // run on a Postgres URL unless explicitly forced (a fresh, empty prod before any real
  // signups). Local dev + tests use SQLite, so they are unaffected. To add ONLY demo
  // holdings without wiping, use scripts/seed-demo-holdings.ts instead (DECISIONS #79).
  if (
    isPostgresUrl(process.env.DATABASE_URL) &&
    !process.argv.includes('--force-prod') &&
    process.env.SEED_ALLOW_PROD !== '1'
  ) {
    console.error(
      'Refusing to seed a Postgres (production) database: `prisma db seed` DELETES ALL DATA\n' +
        'and replaces it with the demo dataset. If this DB has real users/accounts, DO NOT seed it.\n' +
        '  • To add ONLY demo holdings without wiping: npx tsx scripts/seed-demo-holdings.ts\n' +
        '  • To force a full seed of a genuinely EMPTY prod DB: re-run with -- --force-prod (or SEED_ALLOW_PROD=1)',
    );
    process.exit(1);
  }
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
  // These also FK-reference Category and must go before it, else a re-seed over an
  // existing DB (e.g. after the budget-targets test created Budget rows) fails with
  // a P2003 foreign-key violation on category.deleteMany():
  await prisma.categoryPrediction.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.merchant.deleteMany();
  await prisma.category.deleteMany();
  await prisma.holding.deleteMany();
  await prisma.autopayConfig.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.create({ data: data.user });
  await prisma.account.createMany({ data: data.accounts });
  await prisma.autopayConfig.createMany({ data: data.autopays });
  await prisma.holding.createMany({ data: data.holdings });
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

  // ── Prediction log for the accuracy/calibration metric (DECISIONS #37) ──
  // One row per transaction: what the pipeline predicted + its confidence.
  // Ground truth (actualCategoryId) is set only where we genuinely know it — a
  // known merchant's canonical category — so the metric is honest: confident
  // known-merchant hits score well; low-confidence items routed to review count
  // as not-yet-correct with low confidence (good calibration). Unknown/ambiguous
  // rows stay unlabeled until the user reviews them.
  await prisma.categoryPrediction.createMany({
    data: categorized.map(({ txn, out }) => ({
      userId: data.user.id,
      transactionId: txn.id,
      predictedCategoryId: out.categoryId,
      confidenceBps: out.confidenceBps,
      actualCategoryId: knownByCanonical.get(out.merchantCanonical)?.categoryId ?? null,
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
        previousAmountCents: s.previousAmountCents,
        possiblyUnused: s.possiblyUnused,
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
    holdings: data.holdings.length,
  };
  console.log('Seeded:', JSON.stringify(counts));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
