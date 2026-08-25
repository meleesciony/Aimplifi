/**
 * W.6(c) — fulfillment curve pinned to docs/EDGE_CASES.md §Fulfillment.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import {
  FULFILLMENT_TOP_N,
  FULFILLMENT_WINDOW_MONTHS,
  fulfillmentByCategory,
} from '@/lib/engine/fi/fulfillment';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { TxnLike } from '@/lib/engine/fi/insights';

const TODAY = isoDate('2026-06-10');
const WAGE = 3800; // $38/hr — demo seed

function outflow(
  date: string,
  amountCents: number,
  categoryId: string,
  extras: Partial<TxnLike> = {},
): TxnLike {
  return {
    date,
    amountCents: -Math.abs(amountCents),
    rawDescriptor: extras.rawDescriptor ?? 'TEST MERCHANT',
    accountId: extras.accountId ?? 'acct-checking',
    isTransfer: extras.isTransfer ?? false,
    status: extras.status ?? 'POSTED',
    categoryId,
    isSplitParent: extras.isSplitParent ?? false,
    id: extras.id,
  };
}

describe('fulfillmentByCategory (EDGE_CASES §Fulfillment)', () => {
  it('F1: wage unset or non-positive → null (hours are the lens)', () => {
    const txns = [outflow('2026-05-15', 19_000, 'dining')];
    expect(
      fulfillmentByCategory({
        transactions: txns,
        today: TODAY,
        hourlyWageCents: 0,
      }),
    ).toBeNull();
    expect(
      fulfillmentByCategory({
        transactions: txns,
        today: TODAY,
        hourlyWageCents: -100,
      }),
    ).toBeNull();
  });

  it('F2: flat dining $190/mo × 6 → 5.0 hrs/mo, 30.0 hrs total, flat trend', () => {
    // Complete months before 2026-06: Dec..May. $190.00 = 19000¢ → 5.0 hrs @ $38.
    const months = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
    const txns = months.map((m) => outflow(`${m}-15`, 19_000, 'dining'));
    const curve = fulfillmentByCategory({
      transactions: txns,
      today: TODAY,
      hourlyWageCents: WAGE,
      moneyDialIds: ['dining', 'travel'],
    });
    expect(curve).not.toBeNull();
    expect(curve!.windowMonths).toBe(FULFILLMENT_WINDOW_MONTHS);
    expect(curve!.months).toEqual(months);
    expect(curve!.categories).toHaveLength(1);
    const dining = curve!.categories[0]!;
    expect(dining.categoryId).toBe('dining');
    expect(dining.isMoneyDial).toBe(true);
    expect(dining.totalSpendCents).toBe(19_000 * 6);
    expect(dining.totalHours).toBe(30);
    expect(dining.monthly.every((row) => row.hours === 5)).toBe(true);
    expect(dining.trendMeasured).toBe(true);
    expect(dining.trendBps).toBe(0);
  });

  it('F3: rising spend — first-half median $100 → second-half $200 = +100%', () => {
    const txns = [
      outflow('2025-12-10', 10_000, 'shopping'),
      outflow('2026-01-10', 10_000, 'shopping'),
      outflow('2026-02-10', 10_000, 'shopping'),
      outflow('2026-03-10', 20_000, 'shopping'),
      outflow('2026-04-10', 20_000, 'shopping'),
      outflow('2026-05-10', 20_000, 'shopping'),
    ];
    const curve = fulfillmentByCategory({
      transactions: txns,
      today: TODAY,
      hourlyWageCents: WAGE,
    });
    const shopping = curve!.categories[0]!;
    expect(shopping.trendMeasured).toBe(true);
    expect(shopping.trendBps).toBe(10_000);
    expect(shopping.totalSpendCents).toBe(90_000);
    const sparkSum =
      Math.round(shopping.monthly.reduce((s, m) => s + m.hours, 0) * 10) / 10;
    expect(shopping.totalHours).toBe(sparkSum);
  });

  it('F4: transfers, split parents, and loan-excluded ids do not count', () => {
    const txns: TxnLike[] = [
      outflow('2026-05-10', 50_000, 'dining'),
      { ...outflow('2026-05-11', 50_000, 'dining'), isTransfer: true },
      { ...outflow('2026-05-12', 50_000, 'dining'), isSplitParent: true },
      { ...outflow('2026-05-13', 50_000, 'dining'), id: 'loan-pay-1' },
    ];
    const curve = fulfillmentByCategory({
      transactions: txns,
      today: TODAY,
      hourlyWageCents: WAGE,
      excludedFlowIds: new Set(['loan-pay-1']),
    });
    expect(curve!.categories[0]!.totalSpendCents).toBe(50_000);
  });

  it('F5: non-discretionary and uncategorized are excluded', () => {
    const txns = [
      outflow('2026-05-10', 200_000, 'rent'), // not discretionary
      outflow('2026-05-11', 19_000, 'uncategorized'),
      outflow('2026-05-12', 19_000, 'dining'),
    ];
    const curve = fulfillmentByCategory({
      transactions: txns,
      today: TODAY,
      hourlyWageCents: WAGE,
      meta: CATEGORY_BY_ID,
    });
    expect(curve!.categories.map((c) => c.categoryId)).toEqual(['dining']);
  });

  it('F6: the in-progress current month is outside the window', () => {
    const txns = [
      outflow('2026-05-15', 19_000, 'dining'),
      outflow('2026-06-05', 500_000, 'dining'), // current month — ignored
    ];
    const curve = fulfillmentByCategory({
      transactions: txns,
      today: TODAY,
      hourlyWageCents: WAGE,
      windowMonths: 1,
    });
    expect(curve!.months).toEqual(['2026-05']);
    expect(curve!.categories[0]!.totalSpendCents).toBe(19_000);
  });

  it('F7: ranks by total spend and caps at topN', () => {
    const txns = [
      outflow('2026-05-01', 10_000, 'dining'),
      outflow('2026-05-02', 20_000, 'shopping'),
      outflow('2026-05-03', 30_000, 'travel'),
      outflow('2026-05-04', 5_000, 'entertainment'),
      outflow('2026-05-05', 40_000, 'personal-care'),
      outflow('2026-05-06', 1_000, 'subscriptions'),
    ];
    const curve = fulfillmentByCategory({
      transactions: txns,
      today: TODAY,
      hourlyWageCents: WAGE,
      windowMonths: 1,
      topN: 3,
    });
    expect(FULFILLMENT_TOP_N).toBe(5);
    expect(curve!.categories.map((c) => c.categoryId)).toEqual([
      'personal-care',
      'travel',
      'shopping',
    ]);
    expect(curve!.categoryCount).toBe(6);
    expect(COACH_COPY.fulfillmentSubtitle(curve!)).toContain('that took the most');
    expect(COACH_COPY.fulfillmentSubtitle(curve!)).toContain('(of 6)');
    expect(COACH_COPY.fulfillmentSubtitle(curve!)).not.toMatch(/\beach\b/);
    expect(COACH_COPY.fulfillmentOmitted(curve!)).toContain('3 more discretionary');
  });

  it('F8: wage set but no discretionary spend → empty categories, not null', () => {
    const curve = fulfillmentByCategory({
      transactions: [outflow('2026-05-10', 100_000, 'rent')],
      today: TODAY,
      hourlyWageCents: WAGE,
    });
    expect(curve).not.toBeNull();
    expect(curve!.categories).toEqual([]);
  });
});
