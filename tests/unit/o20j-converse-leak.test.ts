/**
 * O.20j converse leak — measure only (DECISIONS #487).
 *
 * Does NOT change countsInFlows / isSpendRow. Locks:
 *  1. Dual exclusion: isTransfer=true under a spend category vanishes from
 *     BOTH shared bases (the silent undercount #446 named).
 *  2. Partition: H.7b clearable (false-positive) vs endorsed (genuine
 *     overturn that kept the spend category).
 *  3. A one-predicate "spend category overrides isTransfer" rule would
 *     restore endorsed cents — contradicting overturn / H.7b design.
 *
 * Fixture category counts mirror the #446 naming shape (entertainment 5,
 * rent 4, subscriptions 3, transport 3, plus one each of fuel / internet /
 * lawn-garden / home-services / auto-maintenance). Dollars are fixture
 * integers, not a live re-probe — live clearable dollars remain the H.7b
 * measurement (53 / $29,848.84) until the owner runs repair.
 */
import { describe, expect, it } from 'vitest';

import {
  measureConverseTransferLeak,
  type ConverseLeakRow,
} from '@/lib/engine/categorize/converse-transfer-leak';
import { countsInFlows } from '@/lib/engine/fi/insights';
import { isSpendRow } from '@/lib/engine/reports/reports';
import { planTransferFlagRepair } from '@/lib/engine/categorize/transfer-flag-repair';

const base = {
  isTransfer: true as const,
  needsReview: false,
  reviewPinned: false,
  status: 'POSTED',
  currencySupported: true,
  accountType: 'CHECKING',
  isSplitParent: false,
  excludeFromTotals: false,
};

function row(
  over: Partial<ConverseLeakRow> &
    Pick<ConverseLeakRow, 'id' | 'amountCents' | 'categoryId' | 'rawDescriptor'>,
): ConverseLeakRow {
  return {
    accountId: 'checking',
    date: '2026-06-10',
    ...base,
    ...over,
  };
}

/** #446-shaped category multiset (counts only — not live dollars). */
const CATEGORY_SHAPE: ReadonlyArray<{ categoryId: string; n: number }> = [
  { categoryId: 'entertainment', n: 5 },
  { categoryId: 'rent', n: 4 },
  { categoryId: 'subscriptions', n: 3 },
  { categoryId: 'transport', n: 3 },
  { categoryId: 'fuel', n: 1 },
  { categoryId: 'internet', n: 1 },
  { categoryId: 'lawn-garden', n: 1 },
  { categoryId: 'home-services', n: 1 },
  { categoryId: 'auto-maintenance', n: 1 },
];

/**
 * Build a corpus mixing:
 *  - clearable false-positives (CREDIT outflow coincident with spend/income —
 *    today's rule declines; H.7b clears), filling the #446 category shape;
 *  - one endorsed coherent overturn (CHECKING→INVESTMENT) that KEPT a spend
 *    category — must stay excluded from spend.
 */
function documentedShapeCorpus(): ConverseLeakRow[] {
  const rows: ConverseLeakRow[] = [];
  let i = 0;
  for (const { categoryId, n } of CATEGORY_SHAPE) {
    for (let k = 0; k < n; k += 1) {
      i += 1;
      const cents = -(1_000 * i); // distinct amounts so pairs don't cross-match
      // False-positive pair: card purchase ↔ checking inflow of equal |amount|.
      // Card cannot send (CAN_SEND), so today's rule declines both flags.
      rows.push(
        row({
          id: `fp-spend-${categoryId}-${k}`,
          accountId: 'card',
          accountType: 'CREDIT',
          amountCents: cents,
          categoryId,
          rawDescriptor: `MERCHANT ${categoryId.toUpperCase()} ${k}`,
          date: '2026-06-10',
        }),
        row({
          id: `fp-in-${categoryId}-${k}`,
          accountId: 'checking',
          accountType: 'CHECKING',
          amountCents: -cents,
          categoryId: 'income',
          rawDescriptor: `COINCIDENT INFLOW ${categoryId} ${k}`,
          date: '2026-06-11',
        }),
      );
    }
  }

  // Endorsed genuine funding that kept a wrong/leftover spend category
  // (overturn writes the flag, not the leaf — transfer-refresh overturnIds).
  rows.push(
    row({
      id: 'endorsed-out',
      accountId: 'checking',
      accountType: 'CHECKING',
      amountCents: -250_000,
      categoryId: 'groceries',
      rawDescriptor: 'WIRE TO BROKERAGE',
      date: '2026-06-15',
    }),
    row({
      id: 'endorsed-in',
      accountId: 'brokerage',
      accountType: 'INVESTMENT',
      amountCents: 250_000,
      categoryId: 'income',
      rawDescriptor: 'INCOMING WIRE',
      date: '2026-06-16',
    }),
  );

  return rows;
}

describe('O.20j converse leak measurement (no predicate change)', () => {
  it('test_regression__o20j_converse_leak_dual_exclusion_on_documented_category_shape', () => {
    const corpus = documentedShapeCorpus();
    const m = measureConverseTransferLeak(corpus, { fromYm: '2026-06', toYm: '2026-06' });

    // Category shape from #446 (spend-side only — income counterpart legs are
    // not converse-spend).
    expect(m.byCategory.map((b) => [b.categoryId, b.rowCount])).toEqual([
      ['entertainment', 5],
      ['rent', 4],
      ['subscriptions', 3],
      ['transport', 3],
      ['auto-maintenance', 1],
      ['fuel', 1],
      ['groceries', 1], // the endorsed overturn kept this leaf
      ['home-services', 1],
      ['internet', 1],
      ['lawn-garden', 1],
    ]);

    // Hand-sum of fixture outflows on spend categories: Σ 1000..20000 for the
    // 20 false-positive spend legs + 250_000 endorsed = 210_000 + 250_000.
    // 20 legs: amounts -1000,-2000,...,-20000 → sum abs = 1000*(20*21/2)=210_000.
    expect(m.vanishedOutflowCents).toBe(210_000 + 250_000);
    expect(m.vanishedIds).toHaveLength(21);

    // Dual exclusion: every vanished row is refused by BOTH shared bases.
    for (const id of m.vanishedIds) {
      const t = corpus.find((r) => r.id === id)!;
      expect(countsInFlows(t)).toBe(false);
      expect(isSpendRow(t, { fromYm: '2026-06', toYm: '2026-06' })).toBe(false);
    }
  });

  it('test_regression__o20j_converse_leak_h7b_partitions_clearable_vs_endorsed', () => {
    const corpus = documentedShapeCorpus();
    const m = measureConverseTransferLeak(corpus);
    const repair = planTransferFlagRepair(corpus);

    // All 20 false-positive spend legs are clearable; their income counterparts
    // are also clearable but not in the spend-leak population.
    expect(m.clearableIds).toHaveLength(20);
    expect(m.clearableOutflowCents).toBe(210_000);
    expect(m.endorsedIds).toEqual(['endorsed-out']);
    expect(m.endorsedOutflowCents).toBe(250_000);
    expect(m.declinedOutOfScopeIds).toEqual([]);

    // Repair's clear set includes the spend legs (and income counterparts).
    for (const id of m.clearableIds) {
      expect(repair.clearIds).toContain(id);
    }
    // Endorsed spend leg is NOT cleared.
    expect(repair.clearIds).not.toContain('endorsed-out');
  });

  it('test_regression__o20j_converse_leak_spend_category_override_would_restore_endorsed', () => {
    // The tempting one-predicate fix: treat isTransfer as spend-exclude only
    // when categoryId is transfer/uncategorized — i.e. ignore the flag under a
    // real spend leaf. That would restore the ENDORSED overturn's $2,500.00
    // into every spend total (double-count a real account move).
    const corpus = documentedShapeCorpus();
    const m = measureConverseTransferLeak(corpus);
    expect(m.endorsedOutflowCents).toBe(250_000);

    const endorsed = corpus.find((r) => r.id === 'endorsed-out')!;
    // Naive override: pretend the flag does not exclude when category is spend.
    const naiveAdmits =
      !endorsed.isSplitParent &&
      endorsed.status === 'POSTED' &&
      endorsed.categoryId !== 'transfer' &&
      endorsed.categoryId !== null;
    expect(naiveAdmits).toBe(true);
    // Shipped predicates still refuse — correct for an endorsed overturn.
    expect(countsInFlows(endorsed)).toBe(false);
    expect(isSpendRow(endorsed, { fromYm: '2026-06', toYm: '2026-06' })).toBe(false);
  });
});
