/**
 * O.8(a) + O.10a — the cross-surface lock: what /trends "New this month" and
 * Ask's "how much did I spend at M this month" guarantee about each other.
 *
 * Two independent things decide whether the two figures agree:
 *   THE ROW BASIS  — which rows count as spending (posted/pending, refunds,
 *                    category, window). O.8a unified this, and it is locked here.
 *   THE MERCHANT SCOPE — which rows belong to the merchant. O.10a closed the
 *                    gap: Ask's `merchantMatches` is now punctuation-folded
 *                    EXACT equality (same store-identity rule as /trends'
 *                    exact canonical key and the register's `merchantNameEquals`),
 *                    so "Costco Gas" no longer sweeps "Costco".
 *
 * The O.8a critic pinned the live demo divergence ($37.38 vs $195.82 under the
 * name "Costco") so closing it meant changing a test that explained itself —
 * that pin is flipped below to the agreed $37.38 / "Costco Gas".
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
 * Merchant SCOPE — closed by O.10a. The O.8a critic pinned the live demo
 * disagreement ($37.38 vs $195.82 under "Costco") so this file would have to
 * change when Ask stopped sweeping sibling stores. Both surfaces now agree.
 */
describe('O.8a/O.10a — merchant SCOPE agrees with /trends on exact store identity', () => {
  const seed = buildSeedData('2026-06-10');
  const trends = computeSpendingTrends({ txns: toTrendTxns(seed.transactions), today: '2026-06-10', scheduled: [] });
  const askRows = toAskTxnRows(seed.transactions);
  const askFor = (q: string) =>
    merchantSpend(askRows, { fromYm: '2026-06', toYm: '2026-06', label: 'this month' }, q, '2026-06-10');

  it('agrees on a merchant with no sibling store (the basis IS shared)', () => {
    const card = trends.newMerchants.find((n) => n.merchant === 'Store Card Purchase');
    expect(card!.amountCents).toBe(4350); // golden literal, not a self-comparison
    expect(askFor('store card purchase').totalCents).toBe(card!.amountCents);
  });

  it('AGREES on Costco Gas — Ask no longer sweeps the warehouse rows', () => {
    const card = trends.newMerchants.find((n) => n.merchant === 'Costco Gas');
    expect(card!.amountCents).toBe(3738); // $37.38 — rows canonically "Costco Gas"
    const ask = askFor('costco gas');
    // Fail-old (prefix match): Ask answered 19582 and named "Costco".
    expect(ask.totalCents).toBe(3738);
    expect(ask.merchant).toBe('Costco Gas');
    expect(ask.totalCents).toBe(card!.amountCents);
  });

  it('test_regression__o10a_costco_gas_is_not_costco', () => {
    // Fail-old: restore `c.startsWith(\`${qq} \`) || qq.startsWith(\`${c} \`)`
    // in merchantMatches ⇒ Ask "costco gas" returns 19582 under "Costco".
    const askGas = askFor('costco gas');
    const askCostco = askFor('costco');
    expect(askGas.totalCents).toBe(3738);
    expect(askGas.merchant).toBe('Costco Gas');
    expect(askGas.totalCents).not.toBe(askCostco.totalCents);
    expect(askCostco.merchant).toBe('Costco');
    // Hand-check: Costco Gas settled-gross on the seed equals the Ask total.
    const settledGross = seed.transactions
      .filter((t) => normalizeMerchant(t.rawDescriptor).canonical === 'Costco Gas')
      .filter((t) => t.date.startsWith('2026-06') && t.date <= '2026-06-10' && t.amountCents < 0)
      .reduce((s, t) => s + -t.amountCents, 0);
    expect(settledGross).toBe(3738);
    expect(askGas.totalCents).toBe(settledGross);
  });
});
