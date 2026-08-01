/**
 * Spending Trends engine known-answer tests (DECISIONS #74). Every expected
 * value is hand-derived in the comments; see docs/EDGE_CASES.md §Trends.
 */
import { describe, expect, it } from 'vitest';
import { buildSeedData } from '@/lib/seed/build';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { computeSpendingTrends, type TrendTxn } from '@/lib/engine/trends/trends';
import { toTrendTxns } from '@/server/trends';

const T = (
  date: string,
  amountCents: number,
  categoryId: string | null,
  extra: Partial<TrendTxn> = {},
  // O.6 made `status` required on TrendTxn so no production caller can omit it.
  // Existing fixtures predate the split and are all settled rows, so the factory
  // supplies POSTED and a pending case opts in with `{ status: 'PENDING' }`.
): TrendTxn => ({ date, amountCents, categoryId, status: 'POSTED', ...extra });

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
  // O.6: no POSTED pre-filter — the server stopped doing that, and the engine now
  // owns the split (every row feeds the category figures; only the row-naming
  // insights read settled rows). Passing the pending rows through is what makes
  // this test exercise that split instead of hiding it.
  const txns: TrendTxn[] = seed.transactions.map((t) => {
    const m = normalizeMerchant(t.rawDescriptor);
    return {
      date: t.date,
      amountCents: t.amountCents,
      categoryId: m.categoryId,
      status: t.status,
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
      // #249: the engineered Blue Bottle anomaly (−$214.36 on 2026-06-02) joined the
      // current partial month: 73929 + 21436 = 95365.
      //
      // O.6 moved this pin DELIBERATELY, by exactly the seed's three pending rows —
      // the whole point of the slice, so the number had to move or the fix did
      // nothing. Hand-verified: 95365 + 25000 (ZELLE lawn care, build.ts:539)
      // + 675 (Blue Bottle, :540) + 4318 (Amazon, :541) = 125358, i.e. +$299.93.
      // Failure direction is the safe one: pace now projects HIGHER, because money
      // already committed but not yet settled is money the reader cannot spend twice.
      spentSoFarCents: 125358,
      projectedCents: 376074, // round(125358 / 10 * 30)
      priorMonthCents: 458700,
    });
    expect(r.pace!.projectedCents).toBe(
      Math.round((r.pace!.spentSoFarCents / r.pace!.daysElapsed) * r.pace!.daysInMonth),
    );
  });

  it('ranks category movers by absolute delta, excluding non-actionable groups', () => {
    // food-delivery joined the movers when Uber Eats moved dining → food-delivery
    // (Phase 3a: the KNOWN entry now agrees with the generic keyword table).
    // #163: Delta re-pointed travel → air-travel, splitting the old 'travel'
    // mover into two independently-ranked movers (travel = hotels/Airbnb,
    // air-travel = flights), and the ranking re-ordered by absolute delta.
    expect(r.movers.map((m) => m.categoryId)).toEqual(['travel', 'shopping', 'air-travel', 'groceries', 'fuel', 'food-delivery']);
    for (const m of r.movers) expect(m.group).not.toBe('Transfers & Other');
    for (let i = 1; i < r.movers.length; i++) {
      expect(Math.abs(r.movers[i - 1].deltaCents)).toBeGreaterThanOrEqual(Math.abs(r.movers[i].deltaCents));
    }
    // #163: 'travel' (now hotels/Airbnb only — flights split to air-travel)
    // had baseline spend and none this window, so its drop outranks shopping.
    expect(r.movers[0]).toMatchObject({
      categoryId: 'travel',
      currentCents: 0,
      baselineCents: 48998,
      deltaCents: -48998,
      direction: 'down',
    });
    // The shopping mover keeps its original hand-verified values, one rank down.
    expect(r.movers[1]).toMatchObject({
      categoryId: 'shopping',
      currentCents: 75511,
      baselineCents: 28456,
      deltaCents: 47055,
      direction: 'up',
    });
  });

  it('lists the largest real purchases (no cash/transfers), sorted descending', () => {
    expect(r.largest.length).toBeGreaterThan(0);
    // #249: the engineered $214.36 Blue Bottle anomaly now tops the window's purchases.
    expect(r.largest.slice(0, 3).map((l) => l.merchant)).toEqual(['Blue Bottle Coffee', 'Costco', "Lowe's"]);
    for (const l of r.largest) expect(l.amountCents).toBeGreaterThan(0);
    for (let i = 1; i < r.largest.length; i++) {
      expect(r.largest[i - 1].amountCents).toBeGreaterThanOrEqual(r.largest[i].amountCents);
    }
  });

  it('surfaces new merchants not seen in the prior 6 months', () => {
    // GOLDEN LITERALS (O.8a critic). `amountCents > 0` used to stand here and is
    // now tautological — the net-<=-0 drop guarantees it — so it compared the
    // code against its own default and could never fail. These two numbers are
    // the seed's actual figures and are unchanged by O.8a (the seed has no
    // pending row or refund at either merchant), which is what makes them a
    // regression lock rather than a restatement of the new behaviour.
    expect(r.newMerchants.map((m) => m.merchant)).toEqual(['Store Card Purchase', 'Costco Gas']);
    expect(r.newMerchants.map((m) => m.amountCents)).toEqual([4350, 3738]);
  });
});

describe('computeSpendingTrends — integrated with normalizeMerchant (server path)', () => {
  // Builds TrendTxns the way src/server/trends.ts does — merchant + aggregate
  // flag DERIVED from normalizeMerchant(rawDescriptor), not stubbed — so this
  // exercises the real wiring the critic flagged (FIN-1/#74).
  const fromRaw = (date: string, amountCents: number, raw: string, status = 'POSTED'): TrendTxn => {
    const m = normalizeMerchant(raw);
    return { date, amountCents, categoryId: m.categoryId, status, merchant: m.canonical, aggregateMerchant: m.aggregate };
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

/**
 * O.6 — /trends asks two questions of one row set, and they take different bases.
 *
 * The category figures (movers, pace) count PENDING rows, because a pending charge
 * has already reduced what the reader can spend and every other spending surface
 * in the app counts it — that agreement is what makes a mover figure safe to link
 * to the register. The two insights that NAME an individual row as a settled fact
 * (largest purchases, new merchants) do not, because a pending amount is
 * provisional. Both halves are asserted here so neither can drift onto the other's
 * basis unnoticed.
 */
describe('O.6 — pending rows count as spending, but are never named as settled facts', () => {
  const TODAY = '2026-06-10';
  // May is the compared month; a pending May row must reach the movers.
  const txns: TrendTxn[] = [
    T('2026-05-04', -10000, 'dining'),
    T('2026-05-05', -6000, 'dining', { status: 'PENDING' }),
    T('2026-04-04', -2000, 'dining'),
    T('2026-03-04', -2000, 'dining'),
    T('2026-02-04', -2000, 'dining'),
    // In-progress June: a big PENDING purchase at a merchant never seen before.
    T('2026-06-02', -90000, 'shopping', { status: 'PENDING', merchant: 'Provisional Motors' }),
    T('2026-06-03', -1500, 'shopping', { merchant: 'Settled Corner Store' }),
  ];
  const r = computeSpendingTrends({ txns, today: TODAY });

  it('counts a PENDING row in the category mover it belongs to', () => {
    const dining = r.movers.find((m) => m.categoryId === 'dining');
    expect(dining).toBeDefined();
    // 100.00 posted + 60.00 pending = 160.00 against a 20.00 baseline.
    expect(dining!.currentCents).toBe(16000);
  });

  it('counts a PENDING row in the pace projection', () => {
    // June so far = 900.00 pending + 15.00 posted.
    expect(r.pace!.spentSoFarCents).toBe(91500);
  });

  it('does NOT name a PENDING row as the biggest purchase', () => {
    // $900 pending outranks everything, and is still refused: "your biggest
    // purchase" is a claim about a settled amount. The $15 posted row wins.
    expect(r.largest.map((l) => l.amountCents)).not.toContain(90000);
    expect(r.largest[0].amountCents).toBe(1500);
  });

  it('does NOT announce a new merchant on the strength of a PENDING row', () => {
    const names = r.newMerchants.map((m) => m.merchant);
    expect(names).not.toContain('Provisional Motors');
    expect(names).toContain('Settled Corner Store'); // anti-vacuity: the list is not simply empty
  });

  it('the pending row is doing the work — stripping it moves the mover (anti-vacuity)', () => {
    const withoutPending = computeSpendingTrends({
      txns: txns.filter((t) => t.status !== 'PENDING'),
      today: TODAY,
    });
    expect(withoutPending.movers.find((m) => m.categoryId === 'dining')!.currentCents).toBe(10000);
  });
});

/**
 * O.6 — the stored category is the only category.
 *
 * `src/server/trends.ts` used to fall back to `normalizeMerchant(...).categoryId`
 * for a row with no stored category. That guess is not what the register filters
 * on, so a mover figure named rows the destination could not show. The population
 * is real: undoing a split restores a row with `isSplitParent: false` and
 * `categoryId: null` (src/server/triage-actions.ts:641), left `needsReview: true`
 * precisely so the reader re-files it.
 */
describe('O.6 — an unfiled row is Uncategorized here, exactly as everywhere else', () => {
  const TODAY = '2026-06-10';
  const txns: TrendTxn[] = [
    // A recognisable grocery descriptor with NO stored category — the shape the
    // normalizer used to file as `groceries` on this surface alone.
    T('2026-05-04', -40000, null, { merchant: 'Safeway' }),
    T('2026-05-05', -9000, 'dining'),
    T('2026-04-05', -1000, 'dining'),
    T('2026-03-05', -1000, 'dining'),
  ];
  const r = computeSpendingTrends({ txns, today: TODAY });

  it('does not invent a category bucket for a row nobody filed', () => {
    // The movers list skips the non-actionable group, which includes
    // uncategorized — so the $400 lands nowhere rather than inflating groceries.
    expect(r.movers.map((m) => m.categoryId)).not.toContain('groceries');
    expect(r.movers.map((m) => m.categoryId)).not.toContain('uncategorized');
    expect(r.movers.map((m) => m.categoryId)).toContain('dining'); // anti-vacuity
  });

  it('mutation guard: filing that same row DOES produce the grocery mover', () => {
    // Proves the assertion above is about the missing category and not about the
    // fixture failing to reach the movers at all.
    const filed = computeSpendingTrends({
      txns: txns.map((t) => (t.categoryId === null ? { ...t, categoryId: 'groceries' } : t)),
      today: TODAY,
    });
    expect(filed.movers.find((m) => m.categoryId === 'groceries')!.currentCents).toBe(40000);
  });
});

/**
 * O.6 critic P1-4 — the intake itself, which nothing could previously fail on.
 *
 * `src/server/trends.ts` held BOTH narrowings this slice removed, and no test in
 * the repo imported it: the demo seed's only pending rows sit in the in-progress
 * month (movers compare the month before it) and it holds zero null-category
 * rows, so re-adding `.filter(t => t.status === 'POSTED')` or restoring
 * `stored ?? m.categoryId` left the entire suite green. These assertions are the
 * fail-old lock — each one breaks if its narrowing comes back.
 */
describe('toTrendTxns — the /trends intake (O.6 fail-old lock)', () => {
  const row = (over: Partial<Parameters<typeof toTrendTxns>[0][number]> & { categoryId?: string | null } = {}) => ({
    date: '2026-05-04',
    amountCents: -4000,
    rawDescriptor: 'SAFEWAY #1234',
    status: 'POSTED',
    isTransfer: false,
    isSplitParent: false,
    ...over,
  });

  it('does NOT drop pending rows — re-adding the status filter fails here', () => {
    const out = toTrendTxns([row({ status: 'PENDING' }), row()]);
    expect(out).toHaveLength(2);
    expect(out.map((t) => t.status)).toEqual(['PENDING', 'POSTED']);
  });

  it('carries the STORED category verbatim, including a null one', () => {
    // "SAFEWAY #1234" normalizes to a real category, so a fallback would show up
    // here as a non-null value — which is exactly the bug this pins.
    const [unfiled] = toTrendTxns([row({ categoryId: null })]);
    expect(unfiled.categoryId).toBeNull();

    const [filed] = toTrendTxns([row({ categoryId: 'dining' })]);
    expect(filed.categoryId).toBe('dining');
  });

  it('carries the merchant-table category in its OWN field, never merged into categoryId', () => {
    // The P0 the first draft shipped ran in the other direction: dropping this
    // field entirely made an unfiled row vanish from "biggest purchases", because
    // `uncategorized` is in the non-actionable group.
    const [t] = toTrendTxns([row({ categoryId: null })]);
    expect(t.merchantCategoryId).toBe('groceries');
    expect(t.categoryId).toBeNull();
  });

  it('still derives the merchant fields from the shared normalizer', () => {
    const [t] = toTrendTxns([row({ rawDescriptor: 'ZELLE PAYMENT TO ALEX' })]);
    expect(t.aggregateMerchant).toBe(true);
    expect(t.merchant).toBeTruthy();
  });
});

/**
 * O.8(a) — the "New this month" AMOUNT is an aggregate, so it reads the register
 * basis; only the NAMING half stays settled-only.
 *
 * Opened by the O.7 critics and MEASURED before it was fixed: four rows at one
 * brand-new merchant (two settled purchases, one pending purchase, one settled
 * refund) made /trends print $65.00 and Ask print $80.00 for the same merchant
 * and the same month. Both sentences were true of their own basis and each was
 * disclosed, which is exactly why nobody could see it — the surfaces are never
 * shown side by side. O.6/O.7 settled that one question gets one basis.
 */
describe('O.8a — new-merchant amounts read the register basis', () => {
  const NM_TODAY = '2026-06-20';
  /** The measured case. `Fresh Roasters` is unseen in the prior 6 months. */
  const rows: TrendTxn[] = [
    T('2026-06-03', -4000, 'coffee', { merchant: 'Fresh Roasters' }),
    T('2026-06-10', -2500, 'coffee', { merchant: 'Fresh Roasters' }),
    T('2026-06-18', -3000, 'coffee', { merchant: 'Fresh Roasters', status: 'PENDING' }),
    T('2026-06-15', 1500, 'coffee', { merchant: 'Fresh Roasters' }), // a REFUND
  ];
  const nm = (txns: TrendTxn[], today = NM_TODAY) =>
    computeSpendingTrends({ txns, today }).newMerchants.find((n) => n.merchant === 'Fresh Roasters');

  it('counts a PENDING charge and nets a REFUND: 40 + 25 + 30 − 15 = $80.00', () => {
    // Fail-old: the settled-gross rule returned 4000 + 2500 = 6500.
    expect(nm(rows)!.amountCents).toBe(8000);
  });

  it('the pending row and the refund are each doing work (anti-vacuity, both directions)', () => {
    expect(nm(rows.filter((t) => t.status !== 'PENDING'))!.amountCents).toBe(5000); // 40+25−15
    expect(nm(rows.filter((t) => t.amountCents < 0))!.amountCents).toBe(9500); // 40+25+30
  });

  it('still refuses to NAME a merchant new on a pending row alone', () => {
    // The naming half did not move. One pending charge, nothing settled ⇒ absent.
    const pendingOnly: TrendTxn[] = [
      T('2026-06-18', -3000, 'coffee', { merchant: 'Fresh Roasters', status: 'PENDING' }),
      T('2026-06-03', -1000, 'coffee', { merchant: 'Anchor Cafe' }), // anti-vacuity
    ];
    const r = computeSpendingTrends({ txns: pendingOnly, today: NM_TODAY });
    expect(r.newMerchants.map((n) => n.merchant)).toEqual(['Anchor Cafe']);
  });

  it('drops a merchant whose refunds cancelled the month rather than printing a negative', () => {
    // #74 accepted gross to avoid "a confusing negative new-merchant line";
    // netting answers it with the rule /reports already applies to a category.
    const cancelled: TrendTxn[] = [
      T('2026-06-03', -4000, 'coffee', { merchant: 'Fresh Roasters' }),
      T('2026-06-09', 4200, 'coffee', { merchant: 'Fresh Roasters' }),
      T('2026-06-03', -1000, 'coffee', { merchant: 'Anchor Cafe' }), // anti-vacuity
    ];
    const r = computeSpendingTrends({ txns: cancelled, today: NM_TODAY });
    expect(r.newMerchants.map((n) => n.merchant)).toEqual(['Anchor Cafe']);
  });

  it('counts an UNFILED row at the merchant, which the naming pass cannot see', () => {
    // `uncategorized` is in the non-actionable group, so it can never NAME a new
    // merchant — but the register counts it and so does Ask, so it must reach
    // the money. This is the axis `isPurchaseRow` would have silently dropped.
    const withUnfiled: TrendTxn[] = [
      T('2026-06-03', -4000, 'coffee', { merchant: 'Fresh Roasters' }),
      T('2026-06-07', -1200, null, { merchant: 'Fresh Roasters' }),
    ];
    expect(nm(withUnfiled)!.amountCents).toBe(5200);
  });

  it('an aggregate pseudo-merchant is still excluded entirely (the O.7 guard, by name)', () => {
    const withAggregate: TrendTxn[] = [
      T('2026-06-03', -4900, null, { merchant: 'ATM Withdrawal', aggregateMerchant: true }),
      T('2026-06-03', -1000, 'coffee', { merchant: 'Anchor Cafe' }),
    ];
    const r = computeSpendingTrends({ txns: withAggregate, today: NM_TODAY });
    expect(r.newMerchants.map((n) => n.merchant)).toEqual(['Anchor Cafe']);
  });
});

/**
 * O.8a critic (P1) — pending money cannot NAME a merchant, but it CAN un-name
 * one, and the card's basis line has to survive that asymmetry.
 *
 * These pin the drop rule's reach. They are not a claim that the asymmetry is
 * ideal: they exist so it is disclosed and visible rather than discovered.
 */
describe('O.8a — what the net-<=-0 drop actually removes', () => {
  const D_TODAY = '2026-06-20';
  const other = T('2026-06-03', -1000, 'coffee', { merchant: 'Anchor Cafe' }); // anti-vacuity
  const names = (txns: TrendTxn[]) =>
    computeSpendingTrends({ txns, today: D_TODAY }).newMerchants.map((n) => n.merchant);

  it('a settled purchase fully refunded drops off, while Biggest purchases still names it', () => {
    const txns = [
      T('2026-06-03', -4000, 'coffee', { merchant: 'Fresh Roasters' }),
      T('2026-06-09', 4000, 'coffee', { merchant: 'Fresh Roasters' }),
      other,
    ];
    const r = computeSpendingTrends({ txns, today: D_TODAY });
    expect(r.newMerchants.map((n) => n.merchant)).toEqual(['Anchor Cafe']);
    // The same page still names the purchase on the other card — the two cards
    // answer different questions, and the basis line says which this one asks.
    expect(r.largest.map((l) => l.merchant)).toContain('Fresh Roasters');
  });

  it('a PENDING refund can veto a merchant that a settled purchase confirmed', () => {
    // The asymmetry, stated: a pending row may not name an event, but it counts
    // toward the money, so a provisional credit can remove the line. Disclosed
    // by the card's "nets refunds against them … drops off this list".
    expect(
      names([
        T('2026-06-03', -12000, 'coffee', { merchant: 'Fresh Roasters' }),
        T('2026-06-18', 12500, 'coffee', { merchant: 'Fresh Roasters', status: 'PENDING' }),
        other,
      ]),
    ).toEqual(['Anchor Cafe']);
  });

  it('a $0 verification hold neither names nor perturbs a merchant', () => {
    expect(
      names([T('2026-06-03', 0, 'fuel', { merchant: 'Sunoco' }), other]),
    ).toEqual(['Anchor Cafe']);
  });

  it('once NAMED, a non-actionable row at the same merchant reaches the money (parity, by decision)', () => {
    // The guard the money pass deliberately does NOT re-apply — see the
    // NON_ACTIONABLE_GROUP docblock. Bounded in practice by the aggregate gate.
    const r = computeSpendingTrends({
      txns: [
        T('2026-06-03', -4000, 'coffee', { merchant: 'Fresh Roasters' }),
        T('2026-06-06', -1500, 'cash', { merchant: 'Fresh Roasters' }),
      ],
      today: D_TODAY,
    });
    expect(r.newMerchants[0]).toMatchObject({ merchant: 'Fresh Roasters', amountCents: 5500 });
  });
});

// ─── O.19c — pre-cap counts beside the capped lists ──────────────────────────
// "What changed" / "New this month" read as complete; the UI can only state a
// binding cap if the engine reports how many QUALIFIED before the slice. Both
// counts come from the same array the slice truncates, so `total > shown` is
// exactly "the cap bound" — and equality is the abstention case the UI renders
// nothing on.
describe('O.19c — moverTotal / newMerchantTotal', () => {
  it('7 qualifying movers: 6 listed, moverTotal 7', () => {
    // Seven categories each new in May at ≥ $20 (baseline empty) → all surface.
    const txns: TrendTxn[] = [
      T('2026-05-01', -10000, 'dining'),
      T('2026-05-02', -9000, 'groceries'),
      T('2026-05-03', -8000, 'coffee'),
      T('2026-05-04', -7000, 'shopping'),
      T('2026-05-05', -6000, 'alcohol'),
      T('2026-05-06', -5000, 'fuel'),
      T('2026-05-07', -4000, 'entertainment'),
    ];
    const r = computeSpendingTrends({ txns, today: '2026-06-10' });
    expect(r.movers).toHaveLength(6);
    expect(r.moverTotal).toBe(7);
    // The listed six are the biggest — the $40 mover is the one the cap dropped.
    expect(r.movers.map((m) => m.categoryId)).not.toContain('entertainment');
  });

  it('uncapped movers: moverTotal equals the listed count (abstention basis)', () => {
    const txns: TrendTxn[] = [T('2026-05-01', -10000, 'dining'), T('2026-05-02', -9000, 'groceries')];
    const r = computeSpendingTrends({ txns, today: '2026-06-10' });
    expect(r.movers).toHaveLength(2);
    expect(r.moverTotal).toBe(2);
  });

  it('6 qualifying new merchants: 5 listed, newMerchantTotal 6', () => {
    const m = (name: string) => ({ merchant: name, aggregateMerchant: false });
    const txns: TrendTxn[] = [
      T('2026-06-01', -6000, 'dining', m('Alpha Cafe')),
      T('2026-06-02', -5000, 'dining', m('Bravo Bistro')),
      T('2026-06-03', -4000, 'dining', m('Charlie Deli')),
      T('2026-06-04', -3000, 'dining', m('Delta Diner')),
      T('2026-06-05', -2000, 'dining', m('Echo Eats')),
      T('2026-06-06', -1000, 'dining', m('Foxtrot Food')),
    ];
    const r = computeSpendingTrends({ txns, today: '2026-06-10' });
    expect(r.newMerchants).toHaveLength(5);
    expect(r.newMerchantTotal).toBe(6);
    expect(r.newMerchants.map((n) => n.merchant)).not.toContain('Foxtrot Food'); // smallest dropped
  });

  it('uncapped new merchants: total equals the listed count', () => {
    const txns: TrendTxn[] = [
      T('2026-06-01', -6000, 'dining', { merchant: 'Alpha Cafe', aggregateMerchant: false }),
    ];
    const r = computeSpendingTrends({ txns, today: '2026-06-10' });
    expect(r.newMerchants).toHaveLength(1);
    expect(r.newMerchantTotal).toBe(1);
  });

  it('a net-refunded merchant is outside BOTH the list and the total', () => {
    // The `amountCents <= 0 → drop` rule runs before the cap, so the count may
    // not quietly include a merchant the list rule excludes.
    const txns: TrendTxn[] = [
      T('2026-06-01', -6000, 'dining', { merchant: 'Alpha Cafe', aggregateMerchant: false }),
      T('2026-06-02', -3000, 'dining', { merchant: 'Refund Mart', aggregateMerchant: false }),
      T('2026-06-03', 3000, 'dining', { merchant: 'Refund Mart', aggregateMerchant: false }),
    ];
    const r = computeSpendingTrends({ txns, today: '2026-06-10' });
    expect(r.newMerchants.map((n) => n.merchant)).toEqual(['Alpha Cafe']);
    expect(r.newMerchantTotal).toBe(1);
  });
});
