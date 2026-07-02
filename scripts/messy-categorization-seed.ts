/**
 * Baseline seeder (PULSE_CATEGORIZATION_FIX Phase 2): persist the messy 60-day corpus
 * for a dedicated baseline user, running every row through the REAL pure pipeline
 * (categorize(), no user rules) exactly the way prisma/seed.ts and live ingest do —
 * so needsReview/confidence/merchant identity are the production verdicts, not a
 * simulation. Deliberately mirrors LIVE ingest, not the demo seed: no
 * CategoryPrediction rows, no recurring detection (live sync creates neither).
 *
 * GUARD: refuses to run unless DATABASE_URL is a file: SQLite URL whose filename
 * contains 'aimplifi-baseline' — never the dev DB, never the unit/e2e DBs, never
 * Postgres. This script WIPES the target DB.
 *
 * Usage: DATABASE_URL=<baseline url> npx tsx scripts/messy-categorization-seed.ts [--asOf 2026-07-01]
 * Prints a stats JSON line (dataset + queue shape + auto-file-mismatch counts).
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { makeAdapter } from '../src/lib/db-adapter';
import { CATEGORIES } from '../src/lib/engine/categorize/categories';
import { KNOWN_MERCHANTS } from '../src/lib/engine/categorize/normalize';
import { categorize } from '../src/lib/engine/categorize/pipeline';
import { hashPassword } from '../src/lib/auth/password';
import { BASELINE_EMAIL, BASELINE_PASSWORD, buildMessyTransactions } from './messy-corpus';

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith('file:') || !url.includes('aimplifi-baseline')) {
    console.error(
      '[messy-seed] refusing: DATABASE_URL must be the dedicated baseline SQLite file ' +
        `(file:...aimplifi-baseline...). got: ${url ?? '(unset)'}`,
    );
    process.exit(1);
  }
  const asOfFlag = process.argv.indexOf('--asOf');
  const asOf = asOfFlag !== -1 ? process.argv[asOfFlag + 1] : '2026-07-01';

  const prisma = new PrismaClient({ adapter: makeAdapter(url) });
  try {
    // wipe in dependency order (dedicated DB — same idiom as prisma/seed.ts)
    await prisma.correction.deleteMany();
    await prisma.categorizationRule.deleteMany();
    await prisma.recurringSeries.deleteMany();
    await prisma.merchantPattern.deleteMany();
    await prisma.cardPayment.deleteMany();
    await prisma.statement.deleteMany();
    await prisma.balanceSnapshot.deleteMany();
    await prisma.scheduledTransaction.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.categoryPrediction.deleteMany();
    await prisma.budget.deleteMany();
    await prisma.merchant.deleteMany();
    await prisma.category.deleteMany();
    await prisma.holding.deleteMany();
    await prisma.autopayConfig.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();

    const user = await prisma.user.create({
      data: { id: 'mb-user', email: BASELINE_EMAIL, passwordHash: hashPassword(BASELINE_PASSWORD) },
    });
    const checking = await prisma.account.create({
      data: { id: 'mb-acct-chk', userId: user.id, provider: 'simplefin', providerRef: 'mb-chk', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 8_412_00, currency: 'USD' },
    });
    const card = await prisma.account.create({
      data: { id: 'mb-acct-card', userId: user.id, provider: 'simplefin', providerRef: 'mb-card', name: 'Rewards Card', type: 'CREDIT', currentBalanceCents: 1_874_00, currency: 'USD' },
    });

    await prisma.category.createMany({
      data: CATEGORIES.map((c) => ({ id: c.id, name: c.name, isSystem: true })),
    });

    const rows = buildMessyTransactions(asOf, checking.id, card.id);
    const categorized = rows.map((t) => ({
      txn: t,
      out: categorize(
        { rawDescriptor: t.rawDescriptor, amountCents: t.amountCents, date: t.date, accountId: t.accountId, isTransfer: t.isTransfer },
        [], // live account, day one: no user rules yet
      ),
    }));

    const merchantIds = new Map<string, string>();
    const usedIds = new Set<string>();
    for (const { out } of categorized) {
      if (!merchantIds.has(out.merchantCanonical)) {
        let id = `mb-merch-${slug(out.merchantCanonical)}`;
        if (usedIds.has(id)) {
          // Two DISTINCT canonicals reduced to one slug — normalization-fragmentation
          // evidence in its own right; log it and keep ids unique.
          console.log(`[messy-seed] slug collision: "${out.merchantCanonical}" vs existing ${id}`);
          let n = 2;
          while (usedIds.has(`${id}-${n}`)) n += 1;
          id = `${id}-${n}`;
        }
        usedIds.add(id);
        merchantIds.set(out.merchantCanonical, id);
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

    await prisma.transaction.createMany({
      data: categorized.map(({ txn, out }) => ({
        id: txn.id,
        accountId: txn.accountId,
        providerRef: txn.providerRef,
        date: txn.date,
        amountCents: txn.amountCents,
        rawDescriptor: txn.rawDescriptor,
        status: txn.status,
        isTransfer: txn.isTransfer,
        merchantId: merchantIds.get(out.merchantCanonical) ?? null,
        categoryId: out.categoryId,
        confidenceBps: out.confidenceBps,
        needsReview: out.needsReview,
      })),
    });

    // ── stats: the Phase-2 reproduction numbers ──
    const review = categorized.filter((c) => c.out.needsReview);
    const reviewMerchants = new Set(review.map((c) => c.out.merchantCanonical));
    const allMerchants = new Set(categorized.map((c) => c.out.merchantCanonical));
    // auto-filed to a category that differs from the independent human label
    // (the #55 "AUTO ✗" metric at dataset scale — silent misfiles, no tap cost)
    const autoMismatch = categorized.filter(
      (c) => !c.out.needsReview && c.out.categoryId !== c.txn.intended && c.out.categoryId !== 'transfer',
    );
    const perMerchant = [...reviewMerchants].map((m) => ({
      merchant: m,
      rows: review.filter((c) => c.out.merchantCanonical === m).length,
    })).sort((a, b) => b.rows - a.rows);

    const stats = {
      asOf,
      transactions: rows.length,
      windowDays: 60,
      distinctPipelineMerchants: allMerchants.size,
      distinctHumanMerchants: new Set(rows.map((r) => r.merchantName)).size,
      reviewRows: review.length,
      reviewRatePct: ((review.length / rows.length) * 100).toFixed(1),
      distinctMerchantsInReview: reviewMerchants.size,
      autoFiledMismatchRows: autoMismatch.length,
      autoFiledMismatchPct: ((autoMismatch.length / rows.length) * 100).toFixed(1),
      reviewByMerchant: perMerchant,
    };
    console.log('[messy-seed] STATS ' + JSON.stringify(stats));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
