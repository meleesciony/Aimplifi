/**
 * TASKS U.4 — the monthly balance-snapshot plan.
 *
 * The contract these lock, in the order they matter:
 *   1. COMPLETENESS. A written month covers EVERY account handed in — the
 *      invariant `netWorthSeries` depends on, since it sums whatever rows share a
 *      date and a missing row is an understated net-worth figure, not an absent
 *      list item. The "only accounts a sync refreshed" and "only accounts whose
 *      balance moved" implementations both fail here.
 *   2. ONE DATE. Every row in a plan carries the same date, so a month is one
 *      bucket rather than several partial ones.
 *   3. ONCE A MONTH, claimed by the first observation — and scoped to the
 *      CALENDAR month, so a July 31 row does not suppress August.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { applyReconciliationBoundary } from '@/lib/engine/account/reconcile-boundary';
import { netWorthSeries } from '@/lib/engine/networth/series';
import { planMonthlyBalanceSnapshots, trendHistoryFloor } from '@/lib/engine/networth/snapshot-plan';

const TODAY = isoDate('2026-06-10');

const ACCOUNTS = [
  { id: 'chk', currentBalanceCents: 250_000, type: 'CHECKING' },
  { id: 'card', currentBalanceCents: 84_231, type: 'CREDIT' },
  { id: 'mortgage-manual', currentBalanceCents: 31_500_000, type: 'MORTGAGE' },
  { id: 'frozen-feed', currentBalanceCents: 1_200, type: 'SAVINGS' },
  { id: 'zero', currentBalanceCents: 0, type: 'CHECKING' },
];

describe('planMonthlyBalanceSnapshots — completeness', () => {
  it('covers every account handed in, at one date, with balances copied verbatim', () => {
    const rows = planMonthlyBalanceSnapshots({
      accounts: ACCOUNTS,
      existingSnapshotDates: [],
      today: TODAY,
    });

    // 1. Completeness: every account, none dropped — including the zero-balance
    //    row, the manual mortgage no sync ever touches, and the frozen feed.
    expect(rows.map((r) => r.accountId).sort()).toEqual(
      ['card', 'chk', 'frozen-feed', 'mortgage-manual', 'zero'],
    );
    // 2. One bucket: a single date across the whole plan.
    expect(new Set(rows.map((r) => r.date))).toEqual(new Set([TODAY]));
    // 3. Balances are the stored positive cents, unmodified (sign is a read-time
    //    concern — `netWorthSeries` applies `isLiabilityType`).
    expect(rows.find((r) => r.accountId === 'mortgage-manual')?.balanceCents).toBe(31_500_000);
    expect(rows.find((r) => r.accountId === 'zero')?.balanceCents).toBe(0);
  });

  it('plans nothing for a user with no accounts', () => {
    expect(
      planMonthlyBalanceSnapshots({ accounts: [], existingSnapshotDates: [], today: TODAY }),
    ).toEqual([]);
  });
});

describe('planMonthlyBalanceSnapshots — once per calendar month', () => {
  it('writes nothing when ANY account already has a row in this month', () => {
    // One row, from one account, on a different day of the same month: the month
    // is claimed. A per-account rule would open a second bucket here.
    const rows = planMonthlyBalanceSnapshots({
      accounts: ACCOUNTS,
      existingSnapshotDates: ['2026-06-02'],
      today: TODAY,
    });
    expect(rows).toEqual([]);
  });

  it('writes when the only rows belong to earlier months — including the day before', () => {
    const rows = planMonthlyBalanceSnapshots({
      accounts: ACCOUNTS,
      existingSnapshotDates: ['2026-04-30', '2026-05-31'],
      today: TODAY,
    });
    expect(rows).toHaveLength(ACCOUNTS.length);
    expect(rows.every((r) => r.date === TODAY)).toBe(true);
  });

  it('a month-end row does not suppress the next month (calendar month, not 30 days)', () => {
    const rows = planMonthlyBalanceSnapshots({
      accounts: ACCOUNTS,
      existingSnapshotDates: ['2026-07-31'],
      today: isoDate('2026-08-01'),
    });
    expect(rows).toHaveLength(ACCOUNTS.length);
    expect(rows.every((r) => r.date === '2026-08-01')).toBe(true);
  });

  it('is idempotent: replaying its own output as the existing set plans nothing', () => {
    const first = planMonthlyBalanceSnapshots({
      accounts: ACCOUNTS,
      existingSnapshotDates: [],
      today: TODAY,
    });
    const second = planMonthlyBalanceSnapshots({
      accounts: ACCOUNTS,
      existingSnapshotDates: first.map((r) => r.date),
      today: TODAY,
    });
    expect(second).toEqual([]);
  });
});

describe('trendHistoryFloor — bounds the payload without capping what is shown', () => {
  it('reaches further back than the 18 points the chip strip renders', () => {
    const floor = trendHistoryFloor(TODAY); // 2026-06-10
    expect(floor).toBe('2024-11-01');
    // The seeded demo's oldest of 18 month-ends, and the oldest point any
    // reader can reach. A 12-month window would silently drop rendered points —
    // the failure this floor exists to avoid.
    expect('2025-01-31' >= floor).toBe(true);
    expect(monthsSpanned(floor, TODAY)).toBeGreaterThan(18);
  });
});

function monthsSpanned(from: string, to: string): number {
  return (
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7)))
  );
}

/**
 * The composition that makes the ONE-DATE rule load-bearing rather than tidy.
 *
 * A reconciled pair here is cross-provider by definition (a SimpleFIN account
 * re-linked through Plaid), and `reconcile-boundary.keepsSnapshot` de-duplicates
 * such a pair ONLY on an exact-date collision. A writer that ran per provider
 * would date the two sides differently, no collision would ever occur, and the
 * same real-world account would count TWICE in the trend. These two cases run the
 * planner's real output through the real boundary and the real series.
 */
describe('planMonthlyBalanceSnapshots × reconciliation boundary', () => {
  const PRED = { id: 'pred', name: 'Pred', type: 'CHECKING', currentBalanceCents: 240_000, feedDroppedAt: null };
  const SUCC = { id: 'succ', name: 'Succ', type: 'CHECKING', currentBalanceCents: 250_000, feedDroppedAt: null };
  const LINK = { predecessorAccountId: 'pred', successorAccountId: 'succ', cutoverDate: '2026-05-31' };

  function pointOn(
    snapshots: { accountId: string; date: string; balanceCents: number; accountType: string | null }[],
  ) {
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [PRED, SUCC],
      transactions: [],
      balanceSnapshots: snapshots,
      statements: [],
      scheduled: [],
      links: [LINK],
    });
    return netWorthSeries({
      snapshots: out.balanceSnapshots,
      accounts: out.accounts,
      today: '2026-06-30', // after the plan date, so the plan's bucket is a HISTORY point
    }).find((p) => p.date === TODAY);
  }

  it('one date per month lets the boundary drop the duplicate — the pair counts once', () => {
    const planned = planMonthlyBalanceSnapshots({
      accounts: [PRED, SUCC],
      existingSnapshotDates: [],
      today: TODAY,
    });
    const point = pointOn([...planned]);
    // Post-cutover, the successor owns the date: 250_000, NOT 490_000.
    expect(point?.netWorthCents).toBe(250_000);
    expect(point?.constituents.map((c) => c.accountId)).toEqual(['succ']);
  });

  it('FAIL-OLD: dating the two sides separately (a per-provider writer) double-counts', () => {
    // The same two accounts, planned as two provider syncs would have stamped
    // them — one day apart. No collision, so the boundary cannot fire.
    const split = [
      { accountId: 'pred', date: '2026-06-09', balanceCents: 240_000, accountType: 'CHECKING' },
      { accountId: 'succ', date: TODAY as string, balanceCents: 250_000, accountType: 'CHECKING' },
    ];
    const out = applyReconciliationBoundary({
      paymentAccountId: null,
      accounts: [PRED, SUCC],
      transactions: [],
      balanceSnapshots: split,
      statements: [],
      scheduled: [],
      links: [LINK],
    });
    expect(out.balanceSnapshots).toHaveLength(2); // nothing de-duplicated
    const series = netWorthSeries({
      snapshots: out.balanceSnapshots,
      accounts: out.accounts,
      today: '2026-06-30',
    });
    // Two partial points instead of one whole one: the trend zigzags, and the
    // account the reader re-linked is present on both days under two names.
    expect(series.map((p) => p.netWorthCents)).toEqual([240_000, 250_000, 250_000]);
  });
});
