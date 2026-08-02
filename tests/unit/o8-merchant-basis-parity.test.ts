/**
 * O.8(a) — the cross-surface lock: what /trends "New this month" and Ask's
 * "how much did I spend at M this month" do and do NOT guarantee about each
 * other.
 *
 * Two independent things decide whether the two figures agree:
 *   THE ROW BASIS  — which rows count as spending (posted/pending, refunds,
 *                    category, window). O.8a unified this, and it is locked here.
 *   THE MERCHANT SCOPE — which rows belong to the merchant. It is NOT unified:
 *                    this list keys on the exact canonical name, while
 *                    `merchantMatches` (answer.ts:733) takes a bidirectional
 *                    whole-word prefix, so "Costco Gas" also sweeps "Costco".
 *
 * The first draft of this file asserted parity using ONE merchant name, which
 * makes the two scopes trivially identical — it advertised itself as the
 * assertion the divergence could only be caught by, and could not have caught
 * the divergence that was actually live on the demo seed ($37.38 vs $195.82).
 * The critic's finding, and the reason both halves are pinned below: a lock
 * whose fixture cannot express the failure certifies nothing.
 */
import { describe, expect, it } from 'vitest';
import { computeSpendingTrends, type TrendTxn } from '@/lib/engine/trends/trends';
import { merchantSpend, toAskTxnRows, type AskTxnRow } from '@/lib/engine/assistant/answer';
import { buildSeedData } from '@/lib/seed/build';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { toTrendTxns } from '@/server/trends';

const TODAY = '2026-06-20';
const TF = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };
const MERCHANT = 'Fresh Roasters';

/** One row, expressed for both surfaces. Identical values, two shapes. */
interface Row {
  date: string;
  amountCents: number;
  categoryId: string | null;
  status?: string;
  merchant?: string;
}
const asTrend = (r: Row): TrendTxn => ({
  date: r.date,
  amountCents: r.amountCents,
  categoryId: r.categoryId,
  merchantCategoryId: r.categoryId,
  merchant: r.merchant ?? MERCHANT,
  aggregateMerchant: false,
  isTransfer: false,
  isSplitParent: false,
  status: r.status ?? 'POSTED',
});
const asAsk = (r: Row): AskTxnRow => ({
  date: r.date,
  amountCents: r.amountCents,
  categoryId: r.categoryId,
  merchantCategoryId: r.categoryId,
  merchant: r.merchant ?? MERCHANT,
  aggregateMerchant: false,
  isTransfer: false,
  isSplitParent: false,
  status: r.status ?? 'POSTED',
});

/** Both figures for the same merchant and month, from the same rows. */
function bothSurfaces(rows: Row[]) {
  const trends = computeSpendingTrends({ txns: rows.map(asTrend), today: TODAY, scheduled: [] });
  const card = trends.newMerchants.find((n) => n.merchant === MERCHANT);
  const ask = merchantSpend(rows.map(asAsk), TF, MERCHANT.toLowerCase(), TODAY);
  return { trendsCents: card?.amountCents, askCents: ask.totalCents };
}

describe('O.8a — /trends new-merchant amount equals Ask merchantSpend', () => {
  it('agrees on the measured case that opened this task (pending + refund)', () => {
    const { trendsCents, askCents } = bothSurfaces([
      { date: '2026-06-03', amountCents: -4000, categoryId: 'coffee' },
      { date: '2026-06-10', amountCents: -2500, categoryId: 'coffee' },
      { date: '2026-06-18', amountCents: -3000, categoryId: 'coffee', status: 'PENDING' },
      { date: '2026-06-15', amountCents: 1500, categoryId: 'coffee' },
    ]);
    // Fail-old: /trends answered 6500 (settled purchases, gross) against Ask's 8000.
    expect(askCents).toBe(8000);
    expect(trendsCents).toBe(askCents);
  });

  it('agrees when a pending charge is the only unsettled money', () => {
    const { trendsCents, askCents } = bothSurfaces([
      { date: '2026-06-03', amountCents: -4000, categoryId: 'coffee' },
      { date: '2026-06-18', amountCents: -3000, categoryId: 'coffee', status: 'PENDING' },
    ]);
    expect(askCents).toBe(7000);
    expect(trendsCents).toBe(askCents);
  });

  it('agrees when an UNFILED row sits at the merchant', () => {
    const { trendsCents, askCents } = bothSurfaces([
      { date: '2026-06-03', amountCents: -4000, categoryId: 'coffee' },
      { date: '2026-06-07', amountCents: -1200, categoryId: null },
    ]);
    expect(askCents).toBe(5200);
    expect(trendsCents).toBe(askCents);
  });

  it('agrees on a refund-free, settled-only month (the case that never diverged)', () => {
    const { trendsCents, askCents } = bothSurfaces([
      { date: '2026-06-03', amountCents: -4000, categoryId: 'coffee' },
      { date: '2026-06-10', amountCents: -2500, categoryId: 'coffee' },
    ]);
    expect(askCents).toBe(6500);
    expect(trendsCents).toBe(askCents);
  });

  it('a future-dated row is excluded by BOTH, so the agreement is not a coincidence of scope', () => {
    const { trendsCents, askCents } = bothSurfaces([
      { date: '2026-06-03', amountCents: -4000, categoryId: 'coffee' },
      { date: '2026-06-28', amountCents: -9900, categoryId: 'coffee' }, // after TODAY
    ]);
    expect(askCents).toBe(4000);
    expect(trendsCents).toBe(askCents);
  });
});

/**
 * The half that is NOT guaranteed — pinned so it stays visible.
 *
 * These assertions describe a REAL, LIVE disagreement on the shipped demo seed,
 * not a desired state. They exist so that closing it (TASKS O.10) means changing
 * a test that explains what it is for, rather than discovering the gap a third
 * time from a reader holding two pages open.
 */
describe('O.8a — the merchant SCOPE is not unified, and that is where they still differ', () => {
  const seed = buildSeedData('2026-06-10');
  const trends = computeSpendingTrends({ txns: toTrendTxns(seed.transactions), today: '2026-06-10', scheduled: [] });
  const askRows = toAskTxnRows(seed.transactions);
  const askFor = (q: string) =>
    merchantSpend(askRows, { fromYm: '2026-06', toYm: '2026-06', label: 'this month' }, q, '2026-06-10');

  it('agrees on a merchant with no prefix sibling (the basis IS shared)', () => {
    const card = trends.newMerchants.find((n) => n.merchant === 'Store Card Purchase');
    expect(card!.amountCents).toBe(4350); // golden literal, not a self-comparison
    expect(askFor('store card purchase').totalCents).toBe(card!.amountCents);
  });

  it('DISAGREES on a prefix-family merchant — Ask sweeps in the parent name', () => {
    const card = trends.newMerchants.find((n) => n.merchant === 'Costco Gas');
    expect(card!.amountCents).toBe(3738); // $37.38 — rows canonically "Costco Gas"
    const ask = askFor('costco gas');
    expect(ask.totalCents).toBe(19582); // $195.82 — "Costco" warehouse rows swept in
    // …and it answers under the OTHER merchant's name, which is the sharper half.
    expect(ask.merchant).toBe('Costco');
    expect(card!.amountCents).not.toBe(ask.totalCents);
  });

  it('the gap predates O.8a — it is name resolution, not the money rule', () => {
    // The pre-O.8a figure for Costco Gas was settled-gross, and the seed has no
    // pending row or refund there, so the OLD number was the same $37.38. This
    // slice did not widen the gap; it wrongly claimed to have closed it.
    const settledGross = seed.transactions
      .filter((t) => normalizeMerchant(t.rawDescriptor).canonical === 'Costco Gas')
      .filter((t) => t.date.startsWith('2026-06') && t.date <= '2026-06-10' && t.amountCents < 0)
      .reduce((s, t) => s + -t.amountCents, 0);
    expect(settledGross).toBe(3738);
  });
});
