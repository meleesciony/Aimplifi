/**
 * Known-answer tests for the Radar burn-rate module (src/lib/engine/radar/burn.ts),
 * pinned to docs/EDGE_CASES.md §Cash Flow Radar case E. Fixed today = 2026-06-10.
 * The percentile definition (nearest-rank, complete days, zero-days included) is
 * pinned exactly so a definition change can never pass silently.
 */
import { describe, it, expect } from 'vitest';
import { isoDate } from '@/lib/dates';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import type { TransactionLike } from '@/lib/engine/cash-needed/assemble';
import {
  BURN_LOOKBACK_DAYS,
  BURN_MIN_HISTORY_DAYS,
  computeBurnRates,
  discretionaryDailyOutflows,
  paymentAccountHistoryDays,
} from '@/lib/engine/radar/burn';

const TODAY = isoDate('2026-06-10');
const CHECKING = 'acct-checking';

function txn(over: Partial<TransactionLike> & { date: string; amountCents: number }): TransactionLike {
  return {
    accountId: CHECKING,
    rawDescriptor: 'SQ *CORNER CAFE',
    status: 'POSTED',
    isTransfer: false,
    ...over,
  };
}

/** Build a dailies array from weekly totals (oldest week first), the total on the week's first day. */
const weeks = (totals: number[]): number[] => totals.flatMap((t) => [t, 0, 0, 0, 0, 0, 0]);

describe('computeBurnRates — weekly nearest-rank percentiles (EDGE_CASES §Radar E)', () => {
  it('8 weeks [0,0,7000,7000,14000,14000,21000,70000]: typical 1000/day (p50=7000), heavy 3000/day (p80=21000)', () => {
    const r = computeBurnRates(weeks([0, 0, 7000, 7000, 14000, 14000, 21000, 70000]), 200);
    expect(r.typicalDailyCents).toBe(1000); // rank ceil(0.5·8)=4 → 7000 ÷ 7
    expect(r.heavyDailyCents).toBe(3000); // rank ceil(0.8·8)=7 → 21000 ÷ 7
    expect(r.sampleDays).toBe(56);
  });

  it('sparse-but-real spend does NOT collapse to $0/day (critic #172 P1-2)', () => {
    // one $70 spend per week, 6 zero days each — the old daily-percentile gave 0/0
    const r = computeBurnRates(weeks(Array<number>(8).fill(7000)), 200);
    expect(r.typicalDailyCents).toBe(1000);
    expect(r.heavyDailyCents).toBe(1000);
  });

  it('per-day division rounds half away from zero once: 1000/wk → 143/day', () => {
    const r = computeBurnRates(weeks([1000]), 200);
    expect(r.typicalDailyCents).toBe(143); // 1000 ÷ 7 = 142.857…
  });

  it('a partial trailing week is dropped: 10 dailies → 1 week (the most recent 7)', () => {
    const dailies = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
    const r = computeBurnRates(dailies, 56);
    expect(r.typicalDailyCents).toBe(7000); // last 7 sum 49000 ÷ 7
    expect(r.heavyDailyCents).toBe(7000);
    expect(r.sampleDays).toBe(7);
  });

  it('history clamp: pre-account zeros/noise never bias the pace (weeks counted back within historyDays)', () => {
    // oldest 4 weeks at 2000/day, newest 4 weeks at 1000/day
    const dailies = [...Array<number>(28).fill(2000), ...Array<number>(28).fill(1000)];
    const young = computeBurnRates(dailies, 28); // only the newest 4 weeks are real history
    expect(young.typicalDailyCents).toBe(1000);
    expect(young.heavyDailyCents).toBe(1000);
    expect(young.sampleDays).toBe(28);
    const old = computeBurnRates(dailies, 56); // full history: totals [7000×4, 14000×4]
    expect(old.typicalDailyCents).toBe(1000); // p50 rank 4 → 7000
    expect(old.heavyDailyCents).toBe(2000); // p80 rank 7 → 14000
  });

  it('empty dailies → zero pace, sampleDays 0', () => {
    const r = computeBurnRates([], 56);
    expect(r.typicalDailyCents).toBe(0);
    expect(r.heavyDailyCents).toBe(0);
    expect(r.sampleDays).toBe(0);
  });

  it(`hasEnoughHistory boundary at ${BURN_MIN_HISTORY_DAYS} days: 28 → true, 27 → false`, () => {
    expect(computeBurnRates([0], 28).hasEnoughHistory).toBe(true);
    expect(computeBurnRates([0], 27).hasEnoughHistory).toBe(false);
  });
});

describe('discretionaryDailyOutflows — window + filters (EDGE_CASES §Radar E)', () => {
  const params = {
    paymentAccountId: CHECKING,
    excludedCanonicals: new Set([normalizeMerchant('NETFLIX.COM').canonical]),
    today: TODAY,
  };

  it('window is the 56 complete days [today−56, today−1]; zero-days are 0', () => {
    const rows: TransactionLike[] = [
      txn({ date: '2026-04-15', amountCents: -1200 }), // window start → index 0
      txn({ date: '2026-06-01', amountCents: -2500 }),
      txn({ date: '2026-06-01', amountCents: -500 }), // same-day aggregation
      txn({ date: '2026-06-09', amountCents: -900 }), // yesterday → last index
    ];
    const dailies = discretionaryDailyOutflows(rows, params);
    expect(dailies).toHaveLength(BURN_LOOKBACK_DAYS);
    expect(dailies[0]).toBe(1200);
    expect(dailies[47]).toBe(3000); // daysBetween(04-15, 06-01) = 47
    expect(dailies[55]).toBe(900);
    expect(dailies.reduce((a, b) => a + b, 0)).toBe(1200 + 3000 + 900);
  });

  it('excludes: today, pre-window, pending, inflows, transfers, split parents, other accounts, committed merchants', () => {
    const rows: TransactionLike[] = [
      txn({ date: '2026-06-10', amountCents: -4000 }), // today (partial day)
      txn({ date: '2026-04-14', amountCents: -4000 }), // day before the window
      txn({ date: '2026-06-01', amountCents: -4000, status: 'PENDING' }),
      txn({ date: '2026-06-01', amountCents: 4000 }), // inflow
      txn({ date: '2026-06-01', amountCents: -4000, isTransfer: true }),
      txn({ date: '2026-06-01', amountCents: -4000, isSplitParent: true }),
      txn({ date: '2026-06-01', amountCents: -4000, accountId: 'acct-other' }),
      txn({ date: '2026-06-01', amountCents: -4000, rawDescriptor: 'NETFLIX.COM 866-579-7172' }),
    ];
    const dailies = discretionaryDailyOutflows(rows, params);
    expect(dailies.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('paymentAccountHistoryDays', () => {
  it('age of the oldest payment-account txn; other accounts ignored; 0 when none', () => {
    const rows: TransactionLike[] = [
      txn({ date: '2026-05-13', amountCents: -100 }),
      txn({ date: '2026-06-01', amountCents: -100 }),
      txn({ date: '2026-01-01', amountCents: -100, accountId: 'acct-other' }),
    ];
    expect(paymentAccountHistoryDays(rows, CHECKING, TODAY)).toBe(28); // 05-13 → 06-10
    expect(paymentAccountHistoryDays([], CHECKING, TODAY)).toBe(0);
  });
});
