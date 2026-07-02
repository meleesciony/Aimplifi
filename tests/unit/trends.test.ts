/**
 * Spending Trends engine known-answer tests (DECISIONS #74). Every expected
 * value is hand-derived in the comments; see docs/EDGE_CASES.md §Trends.
 */
import { describe, expect, it } from 'vitest';
import { buildSeedData } from '@/lib/seed/build';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { computeSpendingTrends, type TrendTxn } from '@/lib/engine/trends/trends';

const T = (
  date: string,
  amountCents: number,
  categoryId: string | null,
  extra: Partial<TrendTxn> = {},
): TrendTxn => ({ date, amountCents, categoryId, ...extra });

const TODAY = '2026-06-10'; // asOf June; last completed = May; baseline = Apr/Mar/Feb

describe('computeSpendingTrends — movers (completed-month comparison)', () => {
  // May vs avg(Apr,Mar,Feb), all amounts in cents (negative = spend):
  //   dining   : May 10000 | base (4000+6000+2000)/3 = 4000  → +6000  (+150%) up
  //   groceries: May  8000 | base (8000+8000+8000)/3 = 8000  →     0          (drop)
  //   coffee   : May  3000 | base 0 (absent)                  → new 3000        new
  //   shopping : May  2500 | base (10000+10000+10000)/3=10000 → -7500 (-75%)  down
  //   alcohol  : May  2200 | base (2000+2000+2000)/3 = 2000   →  +200  (+10%)  (drop, <20%)
  const txns: TrendTxn[] = [
    // May (last completed month)
    T('2026-05-04', -10000, 'dining'),
    T('2026-05-06', -8000, 'groceries'),
    T('2026-05-08', -3000, 'coffee'),
    T('2026-05-10', -2500, 'shopping'),
    T('2026-05-12', -2200, 'alcohol'),
    T('2026-05-15', 400000, 'income'), // income excluded from spend
    // April
    T('2026-04-04', -4000, 'dining'),
    T('2026-04-06', -8000, 'groceries'),
    T('2026-04-10', -10000, 'shopping'),
    T('2026-04-12', -2000, 'alcohol'),
    // March
    T('2026-03-04', -6000, 'dining'),
    T('2026-03-06', -8000, 'groceries'),
    T('2026-03-10', -10000, 'shopping'),
    T('2026-03-12', -2000, 'alcohol'),
    // February
    T('2026-02-04', -2000, 'dining'),
    T('2026-02-06', -8000, 'groceries'),
    T('2026-02-10', -10000, 'shopping'),
    T('2026-02-12', -2000, 'alcohol'),
  ];

  it('compares the last completed month to the 3-month prior average', () => {
    const r = computeSpendingTrends({ txns, today: TODAY });
    expect(r.asOfYm).toBe('2026-06');
    expect(r.comparedYm).toBe('2026-05');
    expect(r.baselineMonths).toEqual(['2026-04', '2026-03', '2026-02']);
  });

  it('surfaces only material movers, sorted by absolute delta', () => {
    const r = computeSpendingTrends({ txns, today: TODAY });
    expect(r.movers.map((m) => m.categoryId)).toEqual(['shopping', 'dining', 'coffee']);

    const [shopping, dining, coffee] = r.movers;
    expect(shopping).toMatchObject({
      direction: 'down',
      currentCents: 2500,
      baselineCents: 10000,
      deltaCents: -7500,
      pctChange: -0.75,
    });
    expect(dining).toMatchObject({
      direction: 'up',
      currentCents: 10000,
      baselineCents: 4000,
      deltaCents: 6000,
      pctChange: 1.5,
    });
    expect(coffee).toMatchObject({
      direction: 'new',
      currentCents: 3000,
      baselineCents: 0,
      deltaCents: 3000,
      pctChange: null,
    });
  });
});

describe('computeSpendingTrends — pace (in-progress month projection)', () => {
  // June spend so far (≤ 06-10): dining 3000 + groceries 2000 = 5000.
  // The lone shopping refund (+500) nets its own category to ≤0 → dropped.
  // The 06-20 row is future-dated → excluded from "so far".
  // Projection = round(5000 / 10 days * 30 days) = 15000. Prior (May) = 20000.
  const txns: TrendTxn[] = [
    T('2026-06-03', -3000, 'dining'),
    T('2026-06-08', -2000, 'groceries'),
    T('2026-06-05', 500, 'shopping'), // standalone refund → category drops
    T('2026-06-20', -9999, 'dining'), // future-dated, excluded
    T('2026-05-15', -20000, 'dining'), // prior month total spend
  ];

  it('projects month-end at the current daily rate and compares to last month', () => {
    const r = computeSpendingTrends({ txns, today: TODAY });
    expect(r.pace).toMatchObject({
      ym: '2026-06',
      daysElapsed: 10,
      daysInMonth: 30,
      spentSoFarCents: 5000,
      projectedCents: 15000,
      priorMonthCents: 20000,
      deltaVsPriorCents: -5000,
    });
  });
});

describe('computeSpendingTrends — largest purchases this month', () => {
  const txns: TrendTxn[] = [
    T('2026-06-02', -3000, 'groceries', { merchant: 'WHOLE FOODS' }),
    T('2026-06-04', -8000, 'electronics', { merchant: 'BIG TV' }),
    T('2026-06-06', -2000, 'shopping', { merchant: 'SHELL' }),
    T('2026-06-07', 5000, 'shopping', { merchant: 'REFUND CO' }), // refund excluded
    T('2026-06-08', -50000, 'transfer', { merchant: 'XFER', isTransfer: true }), // excluded
    T('2026-06-25', -99999, 'electronics', { merchant: 'FUTURE' }), // future excluded
  ];

  it('ranks real purchases by size, excluding refunds/transfers/future', () => {
    const r = computeSpendingTrends({ txns, today: TODAY });
    expect(r.largest).toEqual([
      { date: '2026-06-04', merchant: 'BIG TV', categoryName: 'Electronics', amountCents: 8000 },
      { date: '2026-06-02', merchant: 'WHOLE FOODS', categoryName: 'Groceries', amountCents: 3000 },
      { date: '2026-06-06', merchant: 'SHELL', categoryName: 'Shopping', amountCents: 2000 },
    ]);
  });
});

describe('computeSpendingTrends — new merchants this month', () => {
  // Lookback window for June = [2025-12, 2026-05] inclusive.
  //   NEW GYM   : only June (06-03 + 06-09 = 5000)            → new, firstDate 06-03
  //   OLD SHOP  : last seen 2025-11 (outside window) + June   → new again (4000)
  //   NETFLIX   : June + May (inside window)                  → not new
  //   RECENT    : 2025-12 (== earliestPrior, inside) + June   → not new (boundary)
  const txns: TrendTxn[] = [
    T('2026-06-09', -2000, 'shopping', { merchant: 'NEW GYM' }),
    T('2026-06-03', -3000, 'shopping', { merchant: 'NEW GYM' }),
    T('2025-11-15', -3000, 'shopping', { merchant: 'OLD SHOP' }),
    T('2026-06-04', -4000, 'shopping', { merchant: 'OLD SHOP' }),
    T('2026-05-15', -1799, 'shopping', { merchant: 'NETFLIX' }),
    T('2026-06-05', -1799, 'shopping', { merchant: 'NETFLIX' }),
    T('2025-12-15', -2000, 'shopping', { merchant: 'RECENT' }),
    T('2026-06-06', -2500, 'shopping', { merchant: 'RECENT' }),
  ];

  it('flags merchants absent from the prior 6 months, respecting the window boundary', () => {
    const r = computeSpendingTrends({ txns, today: TODAY });
    expect(r.newMerchants.map((m) => m.merchant)).toEqual(['NEW GYM', 'OLD SHOP']);
    expect(r.newMerchants[0]).toMatchObject({ amountCents: 5000, firstDate: '2026-06-03' });
    expect(r.newMerchants[1]).toMatchObject({ amountCents: 4000, firstDate: '2026-06-04' });
  });
});

describe('computeSpendingTrends — non-actionable categories & aggregate merchants', () => {
  it('keeps cash/transfers/uncategorized OUT of category movers', () => {
    const txns: TrendTxn[] = [
      // a huge cash swing that would dominate if it were not excluded
      T('2026-05-04', -50000, 'cash'),
      T('2026-04-04', -1000, 'cash'),
      T('2026-03-04', -1000, 'cash'),
      T('2026-02-04', -1000, 'cash'),
      // a real dining swing that should surface
      T('2026-05-05', -10000, 'dining'),
      T('2026-04-05', -4000, 'dining'),
      T('2026-03-05', -4000, 'dining'),
      T('2026-02-05', -4000, 'dining'),
    ];
    const r = computeSpendingTrends({ txns, today: TODAY });
    const ids = r.movers.map((m) => m.categoryId);
    expect(ids).toContain('dining');
    expect(ids).not.toContain('cash');
  });

  it('excludes non-purchase rows (ATM/cash) from largest', () => {
    const txns: TrendTxn[] = [
      T('2026-06-03', -20000, 'cash', { merchant: 'ATM Withdrawal', aggregateMerchant: true }),
      T('2026-06-04', -8000, 'electronics', { merchant: 'BIG TV' }),
    ];
    const r = computeSpendingTrends({ txns, today: TODAY });
    expect(r.largest.map((l) => l.merchant)).toEqual(['BIG TV']);
  });

  it('excludes aggregate pseudo-merchants from new merchants', () => {
    const txns: TrendTxn[] = [
      T('2026-06-03', -5000, 'shopping', { merchant: 'Store Card Purchase', aggregateMerchant: true }),
      T('2026-06-04', -3000, 'shopping', { merchant: 'Real Boutique' }),
    ];
    const r = computeSpendingTrends({ txns, today: TODAY });
    expect(r.newMerchants.map((m) => m.merchant)).toEqual(['Real Boutique']);
  });
});

describe('computeSpendingTrends on the seed (real-volume, default normalization)', () => {
  // Built from the demo seed and categorized via the SAME default normalization
  // the detector/coach use (seed rows carry no stored categoryId). Mirrors the
  // recurring-summary seed test: exercises the engine end-to-end on real volume.
  // Numbers are observed-then-pinned to lock regressions.
  const seed = buildSeedData('2026-06-10');
  const txns: TrendTxn[] = seed.transactions
    .filter((t) => t.status === 'POSTED')
    .map((t) => {
      const m = normalizeMerchant(t.rawDescriptor);
      return {
        date: t.date,
        amountCents: t.amountCents,
        categoryId: m.categoryId,
        isTransfer: t.isTransfer,
        merchant: m.canonical,
        aggregateMerchant: m.aggregate,
      };
    });
  const r = computeSpendingTrends({ txns, today: '2026-06-10' });

  it('anchors on the in-progress month, last completed month, and 3-month baseline', () => {
    expect(r.asOfYm).toBe('2026-06');
    expect(r.comparedYm).toBe('2026-05');
    expect(r.baselineMonths).toEqual(['2026-04', '2026-03', '2026-02']);
  });

  it('projects the in-progress month exactly from spend-so-far', () => {
    expect(r.pace).toMatchObject({
      daysElapsed: 10,
      daysInMonth: 30,
      spentSoFarCents: 73929,
      projectedCents: 221787, // round(73929 / 10 * 30)
      priorMonthCents: 458700,
    });
    expect(r.pace!.projectedCents).toBe(
      Math.round((r.pace!.spentSoFarCents / r.pace!.daysElapsed) * r.pace!.daysInMonth),
    );
  });

  it('ranks category movers by absolute delta, excluding non-actionable groups', () => {
    // food-delivery joined the movers when Uber Eats moved dining → food-delivery
    // (Phase 3a: the KNOWN entry now agrees with the generic keyword table).
    expect(r.movers.map((m) => m.categoryId)).toEqual(['shopping', 'travel', 'groceries', 'fuel', 'food-delivery']);
    for (const m of r.movers) expect(m.group).not.toBe('Transfers & Other');
    for (let i = 1; i < r.movers.length; i++) {
      expect(Math.abs(r.movers[i - 1].deltaCents)).toBeGreaterThanOrEqual(Math.abs(r.movers[i].deltaCents));
    }
    expect(r.movers[0]).toMatchObject({
      categoryId: 'shopping',
      currentCents: 75511,
      baselineCents: 28456,
      deltaCents: 47055,
      direction: 'up',
    });
  });

  it('lists the largest real purchases (no cash/transfers), sorted descending', () => {
    expect(r.largest.length).toBeGreaterThan(0);
    expect(r.largest.slice(0, 3).map((l) => l.merchant)).toEqual(['Costco', "Lowe's", "Trader Joe's"]);
    for (const l of r.largest) expect(l.amountCents).toBeGreaterThan(0);
    for (let i = 1; i < r.largest.length; i++) {
      expect(r.largest[i - 1].amountCents).toBeGreaterThanOrEqual(r.largest[i].amountCents);
    }
  });

  it('surfaces new merchants not seen in the prior 6 months', () => {
    expect(r.newMerchants.map((m) => m.merchant)).toContain('Costco Gas');
    for (const m of r.newMerchants) expect(m.amountCents).toBeGreaterThan(0);
  });
});

describe('computeSpendingTrends — integrated with normalizeMerchant (server path)', () => {
  // Builds TrendTxns the way src/server/trends.ts does — merchant + aggregate
  // flag DERIVED from normalizeMerchant(rawDescriptor), not stubbed — so this
  // exercises the real wiring the critic flagged (FIN-1/#74).
  const fromRaw = (date: string, amountCents: number, raw: string): TrendTxn => {
    const m = normalizeMerchant(raw);
    return { date, amountCents, categoryId: m.categoryId, merchant: m.canonical, aggregateMerchant: m.aggregate };
  };

  it('excludes genuine aggregates (Zelle/Check) but keeps a real new merchant', () => {
    const txns: TrendTxn[] = [
      fromRaw('2026-06-03', -5000, 'ZELLE PAYMENT TO ALEX'), // aggregate → excluded
      fromRaw('2026-06-04', -2000, 'CHECK # 1842'), // aggregate → excluded
      fromRaw('2026-06-05', -1500, 'SQ *BLUE BOTTLE COFFEE'), // real merchant → new
    ];
    const names = computeSpendingTrends({ txns, today: TODAY }).newMerchants.map((n) => n.merchant);
    expect(names).toContain('Blue Bottle Coffee');
    expect(names).not.toContain('Zelle Payment');
    expect(names).not.toContain('Check');
  });

  it('keeps "Store Card Purchase" — intentionally a real, rule-eligible merchant in this codebase', () => {
    // assign.ts isRuleEligibleMerchant + the triage flow treat it as a real
    // merchant (rules ARE offered), so trends surfaces it too — consistent with
    // /reports. This locks the resolution of the #74 critic P1.
    const txns: TrendTxn[] = [fromRaw('2026-06-06', -4350, 'STORE CARD PURCHASE 0064 ATL')];
    const r = computeSpendingTrends({ txns, today: TODAY });
    expect(r.newMerchants.map((n) => n.merchant)).toContain('Store Card Purchase');
  });
});

describe('computeSpendingTrends — degenerate input', () => {
  it('returns empty insights for no transactions', () => {
    const r = computeSpendingTrends({ txns: [], today: TODAY });
    expect(r.pace).toBeNull();
    expect(r.comparedYm).toBeNull();
    expect(r.baselineMonths).toEqual([]);
    expect(r.movers).toEqual([]);
    expect(r.largest).toEqual([]);
    expect(r.newMerchants).toEqual([]);
  });
});
