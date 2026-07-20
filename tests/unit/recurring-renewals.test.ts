/**
 * Upcoming renewals — forward renewal schedule (AI plan §3.4, DECISIONS #246).
 *
 * Known-answer tests with hand-verified expected values (docs/EDGE_CASES.md
 * §Upcoming renewals). TODAY = 2026-07-10 throughout, so the 90-day window ends
 * 2026-10-08 inclusive (Jul: 21 remaining, Aug: 31, Sep: 30, Oct: 8).
 */
import { describe, expect, it } from 'vitest';
import { buildSeedData } from '@/lib/seed/build';
import { detectRecurring } from '@/lib/engine/recurring/detect';
import { summarizeRecurring, type RecurringItem } from '@/lib/engine/recurring/summary';
import { upcomingRenewals } from '@/lib/engine/recurring/renewals';
import { isoDate } from '@/lib/dates';

const TODAY = '2026-07-10';

/** Fixture builder: a plausible active expense subscription unless overridden.
 * Date fields accept plain strings and are branded here (ISODate). */
function item(
  over: {
    merchantCanonical: string;
    cadence: RecurringItem['cadence'];
    lastAmountCents: number;
    nextExpectedAt: string;
    priceChangedAt?: string;
    lastSeenAt?: string;
  } & Partial<Omit<RecurringItem, 'nextExpectedAt' | 'priceChangedAt' | 'lastSeenAt'>>,
): RecurringItem {
  const { nextExpectedAt, priceChangedAt, lastSeenAt, ...rest } = over;
  return {
    categoryId: 'subscriptions',
    typicalAmountCents: over.lastAmountCents,
    previousAmountCents: null,
    occurrences: 6,
    isSubscription: true,
    isIncome: false,
    possiblyUnused: false,
    accountId: 'acc-1',
    monthlyEquivalentCents: Math.abs(over.lastAmountCents),
    active: true,
    daysSinceLast: 20,
    ...rest,
    nextExpectedAt: isoDate(nextExpectedAt),
    priceChangedAt: priceChangedAt ? isoDate(priceChangedAt) : null,
    lastSeenAt: isoDate(lastSeenAt ?? '2026-06-20'),
  };
}

describe('upcomingRenewals — occurrence expansion (hand-verified)', () => {
  it('monthly series: 3 occurrences in 90 days, stepping by calendar month', () => {
    const r = upcomingRenewals(
      [item({ merchantCanonical: 'netflix', cadence: 'MONTHLY', lastAmountCents: -1799, nextExpectedAt: '2026-07-28' })],
      TODAY,
    );
    expect(r.occurrences.map((o) => o.date)).toEqual(['2026-07-28', '2026-08-28', '2026-09-28']);
    expect(r.occurrences.map((o) => o.amountCents)).toEqual([1799, 1799, 1799]);
    expect(r.occurrences.map((o) => o.daysOut)).toEqual([18, 49, 80]);
  });

  it('weekly series: 13 occurrences in 90 days', () => {
    const r = upcomingRenewals(
      [item({ merchantCanonical: 'carwash-club', cadence: 'WEEKLY', lastAmountCents: -500, nextExpectedAt: '2026-07-12' })],
      TODAY,
    );
    expect(r.occurrences).toHaveLength(13);
    expect(r.occurrences[0].date).toBe('2026-07-12');
    expect(r.occurrences[12].date).toBe('2026-10-04'); // next (10-11) is past 10-08
  });

  it('biweekly series: 7 occurrences in 90 days', () => {
    const r = upcomingRenewals(
      [item({ merchantCanonical: 'geico', cadence: 'BIWEEKLY', lastAmountCents: -3499, nextExpectedAt: '2026-07-15', categoryId: 'auto-insurance', isSubscription: true })],
      TODAY,
    );
    expect(r.occurrences.map((o) => o.date)).toEqual([
      '2026-07-15', '2026-07-29', '2026-08-12', '2026-08-26', '2026-09-09', '2026-09-23', '2026-10-07',
    ]);
  });

  it('month-end stepping clamps: Jul 31 → Aug 31 → Sep 30 (same rule as detection)', () => {
    const r = upcomingRenewals(
      [item({ merchantCanonical: 'rent-co', cadence: 'MONTHLY', lastAmountCents: -180000, nextExpectedAt: '2026-07-31', categoryId: 'rent', isSubscription: false })],
      TODAY,
    );
    expect(r.occurrences.map((o) => o.date)).toEqual(['2026-07-31', '2026-08-31', '2026-09-30']);
  });

  it('a renewal expected TODAY counts, and lands in the 7-day bucket', () => {
    const r = upcomingRenewals(
      [item({ merchantCanonical: 'icloud', cadence: 'MONTHLY', lastAmountCents: -299, nextExpectedAt: TODAY })],
      TODAY,
    );
    expect(r.occurrences[0]).toMatchObject({ date: TODAY, daysOut: 0 });
    expect(r.horizons[0]).toMatchObject({ days: 7, count: 1, totalCents: 299 });
  });

  it('a stale nextExpectedAt (before today) advances by cadence, never emitting past dates', () => {
    const r = upcomingRenewals(
      [item({ merchantCanonical: 'spotify', cadence: 'MONTHLY', lastAmountCents: -1199, nextExpectedAt: '2026-07-01' })],
      TODAY,
    );
    expect(r.occurrences.map((o) => o.date)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
  });

  it('window boundary is inclusive at exactly today+90 and exclusive after', () => {
    const inside = upcomingRenewals(
      [item({ merchantCanonical: 'edge', cadence: 'ANNUAL', lastAmountCents: -9900, nextExpectedAt: '2026-10-08' })],
      TODAY,
    );
    expect(inside.occurrences.map((o) => o.date)).toEqual(['2026-10-08']);
    expect(inside.occurrences[0].daysOut).toBe(90);
    const outside = upcomingRenewals(
      [item({ merchantCanonical: 'edge', cadence: 'ANNUAL', lastAmountCents: -9900, nextExpectedAt: '2026-10-09' })],
      TODAY,
    );
    expect(outside.occurrences).toEqual([]);
  });
});

describe('upcomingRenewals — inclusion rules', () => {
  it('excludes income series (payroll is not a renewal)', () => {
    const r = upcomingRenewals(
      [item({ merchantCanonical: 'acme analytics', cadence: 'BIWEEKLY', lastAmountCents: 245000, nextExpectedAt: '2026-07-14', isIncome: true, isSubscription: false, categoryId: 'income' })],
      TODAY,
    );
    expect(r.occurrences).toEqual([]);
  });

  it('excludes inactive (appears-to-have-stopped) series', () => {
    const r = upcomingRenewals(
      [item({ merchantCanonical: 'old-box', cadence: 'MONTHLY', lastAmountCents: -999, nextExpectedAt: '2026-07-20', active: false })],
      TODAY,
    );
    expect(r.occurrences).toEqual([]);
  });

  it('never invents a schedule for an IRREGULAR series (contract, not reachable live)', () => {
    const r = upcomingRenewals(
      [item({ merchantCanonical: 'random-shop', cadence: 'IRREGULAR', lastAmountCents: -1500, nextExpectedAt: '2026-07-15' })],
      TODAY,
    );
    expect(r.occurrences).toEqual([]);
  });

  it('includes an ANNUAL series when detection genuinely found one', () => {
    const r = upcomingRenewals(
      [item({ merchantCanonical: 'domain-registrar', cadence: 'ANNUAL', lastAmountCents: -9900, nextExpectedAt: '2026-09-01', categoryId: 'software' })],
      TODAY,
    );
    expect(r.occurrences.map((o) => o.date)).toEqual(['2026-09-01']);
    // daysOut 53: in the 90-day bucket, not the 30-day one.
    expect(r.horizons.map((h) => h.count)).toEqual([0, 0, 1]);
  });

  it('includes non-subscription bills (the obligation is coming regardless of label)', () => {
    const r = upcomingRenewals(
      [item({ merchantCanonical: 'auto-loan-servicer', cadence: 'MONTHLY', lastAmountCents: -38500, nextExpectedAt: '2026-08-05', categoryId: 'auto-loan', isSubscription: false })],
      TODAY,
    );
    expect(r.occurrences[0]).toMatchObject({ isSubscription: false, amountCents: 38500 });
  });
});

describe('upcomingRenewals — predicted amount is the last REAL charge, verbatim', () => {
  it('after a detected price increase, every future occurrence predicts the NEW price and flags it', () => {
    const r = upcomingRenewals(
      [item({
        merchantCanonical: 'netflix', cadence: 'MONTHLY', lastAmountCents: -1799,
        previousAmountCents: -1549, priceChangedAt: '2026-03-28', nextExpectedAt: '2026-07-28',
      })],
      TODAY,
    );
    expect(r.occurrences.every((o) => o.amountCents === 1799)).toBe(true);
    // The badge carries the magnitude it rose FROM — the UI says "was $15.49",
    // never a time claim the detector doesn't record (critic P2-1).
    expect(r.occurrences.every((o) => o.increasedFromCents === 1549)).toBe(true);
  });

  it('a price DECREASE is not flagged as increased', () => {
    const r = upcomingRenewals(
      [item({
        merchantCanonical: 'cheaper-now', cadence: 'MONTHLY', lastAmountCents: -899,
        previousAmountCents: -1099, priceChangedAt: '2026-05-01', nextExpectedAt: '2026-07-20',
      })],
      TODAY,
    );
    expect(r.occurrences[0].increasedFromCents).toBeNull();
  });
});

describe('upcomingRenewals — horizons (hand-verified totals)', () => {
  const fixtures = [
    // weekly $5.00 from 07-12: 13 occ / 90d; 1 in 7d; 5 in 30d (07-12,19,26,08-02,08-09)
    item({ merchantCanonical: 'carwash-club', cadence: 'WEEKLY', lastAmountCents: -500, nextExpectedAt: '2026-07-12' }),
    // monthly $17.99 from 07-28: 3 occ / 90d; 0 in 7d; 1 in 30d
    item({ merchantCanonical: 'netflix', cadence: 'MONTHLY', lastAmountCents: -1799, nextExpectedAt: '2026-07-28' }),
    // annual $99.00 on 09-01: 1 occ, 90d bucket only
    item({ merchantCanonical: 'domain-registrar', cadence: 'ANNUAL', lastAmountCents: -9900, nextExpectedAt: '2026-09-01', categoryId: 'software' }),
  ];

  it('7/30/90 buckets nest and totals are exact sums of expected charges', () => {
    const r = upcomingRenewals(fixtures, TODAY);
    expect(r.horizons).toEqual([
      { days: 7, count: 1, totalCents: 500 },
      { days: 30, count: 6, totalCents: 5 * 500 + 1799 }, // 4299
      { days: 90, count: 17, totalCents: 13 * 500 + 3 * 1799 + 9900 }, // 21797
    ]);
  });

  it('buckets are monotone (7d ⊆ 30d ⊆ 90d) — structural, not incidental', () => {
    const r = upcomingRenewals(fixtures, TODAY);
    expect(r.horizons[0].count).toBeLessThanOrEqual(r.horizons[1].count);
    expect(r.horizons[1].count).toBeLessThanOrEqual(r.horizons[2].count);
    expect(r.horizons[0].totalCents).toBeLessThanOrEqual(r.horizons[1].totalCents);
    expect(r.horizons[1].totalCents).toBeLessThanOrEqual(r.horizons[2].totalCents);
  });

  it('empty input → empty schedule, zeroed horizons', () => {
    const r = upcomingRenewals([], TODAY);
    expect(r.occurrences).toEqual([]);
    expect(r.horizons).toEqual([
      { days: 7, count: 0, totalCents: 0 },
      { days: 30, count: 0, totalCents: 0 },
      { days: 90, count: 0, totalCents: 0 },
    ]);
  });
});

describe('upcomingRenewals — on the real seed (demo-first)', () => {
  // The exact pipeline getRecurring runs for the demo user.
  const ASOF = '2026-06-10';
  const seed = buildSeedData(ASOF);
  const posted = seed.transactions.filter((t) => t.status === 'POSTED');
  const series = detectRecurring(posted, isoDate(ASOF));
  const summary = summarizeRecurring(series, ASOF);
  const r = upcomingRenewals(summary.items, ASOF);

  it('never emits a past date, and buckets stay monotone', () => {
    expect(r.occurrences.length).toBeGreaterThan(0);
    for (const o of r.occurrences) expect(o.daysOut).toBeGreaterThanOrEqual(0);
    expect(r.horizons[0].count).toBeLessThanOrEqual(r.horizons[1].count);
    expect(r.horizons[1].count).toBeLessThanOrEqual(r.horizons[2].count);
    expect(r.horizons[1].totalCents).toBeGreaterThan(0); // demo has monthly subs due within 30d
  });

  it('predicts Netflix at the NEW post-increase price ($17.99, never $15.49) and flags it', () => {
    const netflix = r.occurrences.filter((o) => o.merchantCanonical === 'Netflix');
    expect(netflix.length).toBeGreaterThanOrEqual(2); // monthly, 90-day window
    for (const o of netflix) {
      expect(o.amountCents).toBe(1799);
      expect(o.increasedFromCents).toBe(1549);
    }
  });

  it('payroll never appears as an upcoming charge', () => {
    expect(r.occurrences.some((o) => o.merchantCanonical === 'Acme Analytics (Payroll)')).toBe(false);
  });
});

describe('upcomingRenewals — ordering', () => {
  it('sorts by date, then merchant for same-day charges', () => {
    const r = upcomingRenewals(
      [
        item({ merchantCanonical: 'zeta-tv', cadence: 'MONTHLY', lastAmountCents: -1299, nextExpectedAt: '2026-07-20' }),
        item({ merchantCanonical: 'alpha-news', cadence: 'MONTHLY', lastAmountCents: -899, nextExpectedAt: '2026-07-20' }),
        item({ merchantCanonical: 'icloud', cadence: 'MONTHLY', lastAmountCents: -299, nextExpectedAt: '2026-07-15' }),
      ],
      TODAY,
    );
    expect(r.occurrences.slice(0, 3).map((o) => `${o.date} ${o.merchantCanonical}`)).toEqual([
      '2026-07-15 icloud',
      '2026-07-20 alpha-news',
      '2026-07-20 zeta-tv',
    ]);
  });
});
