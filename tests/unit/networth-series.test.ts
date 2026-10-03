import { describe, expect, it } from 'vitest';
import { netWorthSeries } from '@/lib/engine/networth/series';
import { applyReconciliationBoundary } from '@/lib/engine/account/reconcile-boundary';
import { netWorthCents } from '@/lib/engine/cash-needed/assemble';
import { netWorthDelta } from '@/lib/engine/networth/panel';

const accounts = [
  { id: 'chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 300_00 },
  { id: 'card', name: 'Venture', type: 'CREDIT', currentBalanceCents: 50_00 },
  { id: 'home', name: 'Home', type: 'REAL_ESTATE', currentBalanceCents: 500_000_00 }, // manual, no snapshots
];

describe('netWorthSeries (DECISIONS #40)', () => {
  it('sums each month-end as assets − liabilities and ends at the live point, carrying constituents', () => {
    const snaps = [
      { accountId: 'chk', date: '2026-04-30', balanceCents: 200_00, accountType: 'CHECKING' },
      { accountId: 'card', date: '2026-04-30', balanceCents: 80_00, accountType: 'CREDIT' }, // liability
      { accountId: 'chk', date: '2026-05-31', balanceCents: 260_00, accountType: 'CHECKING' },
      { accountId: 'card', date: '2026-05-31', balanceCents: 60_00, accountType: 'CREDIT' },
    ];
    const series = netWorthSeries({ supersededAccountIds: [], snapshots: snaps, accounts, today: '2026-06-10' });
    // Apr: 200 − 80 = 120; May: 260 − 60 = 200; today: 300 − 50 + 500000 = 500250
    expect(series).toEqual([
      {
        date: '2026-04-30',
        netWorthCents: 120_00,
        constituents: [
          { accountId: 'chk', name: 'Checking', balanceCents: 200_00, isLiability: false },
          // signed: liability negative
          { accountId: 'card', name: 'Venture', balanceCents: -80_00, isLiability: true },
        ],
      },
      {
        date: '2026-05-31',
        netWorthCents: 200_00,
        constituents: [
          { accountId: 'chk', name: 'Checking', balanceCents: 260_00, isLiability: false },
          { accountId: 'card', name: 'Venture', balanceCents: -60_00, isLiability: true },
        ],
      },
      {
        date: '2026-06-10',
        netWorthCents: 500_250_00,
        // Live point: EVERY account, manual items included, signed, sorted by
        // name (O.20f P2-c: "Apr 30" and "Today" panels list the same accounts
        // in the SAME sequence — Checking, Home, Venture here).
        constituents: [
          { accountId: 'chk', name: 'Checking', balanceCents: 300_00, isLiability: false },
          { accountId: 'home', name: 'Home', balanceCents: 500_000_00, isLiability: false },
          { accountId: 'card', name: 'Venture', balanceCents: -50_00, isLiability: true },
        ],
      },
    ]);
    // O.20d invariant: every point's netWorthCents is the Σ of its constituents.
    for (const p of series) {
      expect(p.constituents.reduce((s, c) => s + c.balanceCents, 0)).toBe(p.netWorthCents);
    }
  });

  it('drops snapshots dated after today and snapshots for unknown accounts', () => {
    const snaps = [
      { accountId: 'chk', date: '2026-05-31', balanceCents: 100_00, accountType: 'CHECKING' },
      { accountId: 'chk', date: '2026-07-31', balanceCents: 999_00, accountType: 'CHECKING' }, // future → dropped
      { accountId: 'ghost', date: '2026-05-31', balanceCents: 999_00, accountType: 'CHECKING' }, // unknown acct → ignored
    ];
    const series = netWorthSeries({ supersededAccountIds: [], snapshots: snaps, accounts, today: '2026-06-10' });
    expect(series.map((p) => p.date)).toEqual(['2026-05-31', '2026-06-10']);
    expect(series[0].netWorthCents).toBe(100_00); // only chk counted on 05-31
    expect(series[0].constituents).toEqual([
      { accountId: 'chk', name: 'Checking', balanceCents: 100_00, isLiability: false },
    ]);
    // The live point still carries ALL accounts.
    expect(series[1].constituents).toHaveLength(3);
    expect(series[1].constituents.reduce((s, c) => s + c.balanceCents, 0)).toBe(500_250_00);
  });

  it('replaces a same-dated snapshot with the live current value (constituents too)', () => {
    const snaps = [{ accountId: 'chk', date: '2026-06-10', balanceCents: 1_00, accountType: 'CHECKING' }];
    const series = netWorthSeries({ supersededAccountIds: [], snapshots: snaps, accounts, today: '2026-06-10' });
    expect(series).toHaveLength(1);
    expect(series[0].netWorthCents).toBe(500_250_00); // current, not the 1.00 snapshot
    // The snapshot would have contributed {chk: 1.00}; the live point replaced it wholesale.
    // Name-sorted (O.20f P2-c): Checking < Home < Venture.
    expect(series[0].constituents.map((c) => c.accountId)).toEqual(['chk', 'home', 'card']);
    expect(series[0].constituents.find((c) => c.accountId === 'chk')!.balanceCents).toBe(300_00);
  });

  // ── U.6: a recorded balance keeps the class it was read under ───────────────
  // Both providers rewrite `Account.type` on every ordinary sync, so signing a
  // stored row by the account's CURRENT type made one reclassification rewrite
  // every past point for that account — silently, with nothing on any surface
  // saying a historical figure had moved.
  describe('U.6 — the row carries its own class', () => {
    // The account is a CREDIT card TODAY; the feed called it CHECKING in April.
    const reclassified = [
      { id: 'flip', name: 'Reclassified', type: 'CREDIT', currentBalanceCents: 1_000_00 },
    ];

    it('signs a stored row by the class it recorded, not by what the account has become', () => {
      const series = netWorthSeries({ supersededAccountIds: [],
        snapshots: [
          { accountId: 'flip', date: '2026-04-30', balanceCents: 10_000_00, accountType: 'CHECKING' },
        ],
        accounts: reclassified,
        today: '2026-06-10',
      });
      // FAILS OLD: pre-U.6 this read isLiabilityType('CREDIT') and printed
      // −$10,000.00 for a month the app had recorded $10,000.00 of ASSET.
      expect(series[0].netWorthCents).toBe(10_000_00);
      expect(series[0].constituents[0].isLiability).toBe(false);
      // ...and the live point still speaks for what the account is NOW.
      expect(series[1].netWorthCents).toBe(-1_000_00);
      expect(series[1].constituents[0].isLiability).toBe(true);
    });

    it('a reclassification moves no past point: the same rows sum the same either way', () => {
      const snapshots = [
        { accountId: 'flip', date: '2026-04-30', balanceCents: 10_000_00, accountType: 'CHECKING' },
      ];
      const asChecking = netWorthSeries({ supersededAccountIds: [],
        snapshots,
        accounts: [{ ...reclassified[0], type: 'CHECKING' }],
        today: '2026-06-10',
      });
      const asCredit = netWorthSeries({ supersededAccountIds: [], snapshots, accounts: reclassified, today: '2026-06-10' });
      // The account's current type differs between these two calls; the recorded
      // point must not. (Pre-U.6 it was +$10,000.00 and −$10,000.00.)
      expect(asChecking[0]).toEqual(asCredit[0]);
    });

    it('a row with no recorded class — null OR empty — falls back to the account today, the old behaviour kept only there', () => {
      const legacy = netWorthSeries({ supersededAccountIds: [],
        // Null is the pre-U.6 row. The empty string is the same absence spelled
        // differently: the column is free-text `String?` that raw SQL can write,
        // and `''` would otherwise miss `isLiabilityType`'s set and turn a credit
        // card into an asset.
        snapshots: [
          { accountId: 'flip', date: '2026-04-30', balanceCents: 10_000_00, accountType: null },
          { accountId: 'flip', date: '2026-05-31', balanceCents: 10_000_00, accountType: '' },
        ],
        accounts: reclassified,
        today: '2026-06-10',
      });
      expect(legacy[0].netWorthCents).toBe(-10_000_00);
      expect(legacy[0].constituents[0].isLiability).toBe(true);
      expect(legacy[1].netWorthCents).toBe(-10_000_00);
      expect(legacy[1].constituents[0].isLiability).toBe(true);
    });

    it('an asset can hold a negative balance, so a constituent sign never proves its class', () => {
      // Why `isLiability` is carried rather than read back off the sign: Plaid
      // keeps its own sign (an overpaid CARD is negative) and an overdrawn
      // checking / margin account is a genuinely negative ASSET.
      const series = netWorthSeries({ supersededAccountIds: [],
        snapshots: [
          { accountId: 'chk', date: '2026-05-31', balanceCents: -400_00, accountType: 'CHECKING' },
          { accountId: 'card', date: '2026-05-31', balanceCents: -25_00, accountType: 'CREDIT' },
        ],
        accounts,
        today: '2026-06-10',
      });
      const may = series[0].constituents;
      // The overdrawn asset stays negative and is NOT a liability; the overpaid
      // card negates to a positive contribution and IS one.
      expect(may.find((c) => c.accountId === 'chk')).toEqual({
        accountId: 'chk',
        name: 'Checking',
        balanceCents: -400_00,
        isLiability: false,
      });
      expect(may.find((c) => c.accountId === 'card')).toEqual({
        accountId: 'card',
        name: 'Venture',
        balanceCents: 25_00,
        isLiability: true,
      });
      expect(series[0].netWorthCents).toBe(-375_00);
    });
  });

  it('carries two same-account snapshots as two constituents on the same date (Σ still exact)', () => {
    const snaps = [
      { accountId: 'chk', date: '2026-05-31', balanceCents: 100_00, accountType: 'CHECKING' },
      { accountId: 'chk', date: '2026-05-31', balanceCents: 50_00, accountType: 'CHECKING' },
    ];
    const series = netWorthSeries({ supersededAccountIds: [], snapshots: snaps, accounts, today: '2026-06-10' });
    expect(series[0].netWorthCents).toBe(150_00);
    expect(series[0].constituents).toHaveLength(2);
    expect(series[0].constituents.reduce((s, c) => s + c.balanceCents, 0)).toBe(150_00);
  });
});

// Owner-reported 2026-10-03: "some of my accounts are being counted twice, specifically 0977".
// The 0977 pair was already combined (reconciliation link, predecessor zeroed) and every recorded
// point counted it once — but the LIVE point listed the combined-away row at $0.00 beside the live
// one (two `CREDIT CARD` rows in "Net worth today"), and the combined-away rows made the change
// line read "No comparison — N accounts joined". Balances below are invented, not the owner's.
describe('netWorthSeries — combined-away rows leave the live point (owner 0977 report)', () => {
  // The live shape: old and new connection each pulled CREDIT CARD ····0977; the user combined them.
  const pairAccounts = [
    { id: 'chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 1_000_00, feedDroppedAt: null },
    { id: 'old0977', name: 'CREDIT CARD', type: 'CREDIT', currentBalanceCents: 6_000_00, feedDroppedAt: null },
    { id: 'live0977', name: 'CREDIT CARD', type: 'CREDIT', currentBalanceCents: 8_000_00, feedDroppedAt: null },
  ];
  const pairSnaps = [
    // Before the cutover only the old row was reading the card.
    { accountId: 'old0977', date: '2025-02-28', balanceCents: 500_00, accountType: 'CREDIT' },
    // The snapshot writer still records the disconnected row; the boundary must drop it.
    { accountId: 'chk', date: '2026-09-30', balanceCents: 900_00, accountType: 'CHECKING' },
    { accountId: 'live0977', date: '2026-09-30', balanceCents: 7_950_00, accountType: 'CREDIT' },
    { accountId: 'old0977', date: '2026-09-30', balanceCents: 6_000_00, accountType: 'CREDIT' },
  ];
  const link = { predecessorAccountId: 'old0977', successorAccountId: 'live0977', cutoverDate: '2025-03-15' };

  function boundaryThenSeries() {
    const boundary = applyReconciliationBoundary({
      paymentAccountId: 'chk',
      accounts: pairAccounts,
      transactions: [],
      balanceSnapshots: pairSnaps,
      statements: [],
      scheduled: [],
      links: [link],
    });
    const series = netWorthSeries({
      snapshots: boundary.balanceSnapshots,
      accounts: boundary.accounts,
      supersededAccountIds: boundary.supersededAccountIds,
      today: '2026-10-03',
    });
    return { boundary, series };
  }

  it('lists the card ONCE in "Net worth today", and the figure still equals the headline', () => {
    const { boundary, series } = boundaryThenSeries();
    expect(boundary.supersededAccountIds).toEqual(['old0977']);
    const today = series[series.length - 1];
    expect(today.date).toBe('2026-10-03');
    // 1,000.00 − 8,000.00 = −7,000.00 — the old row contributes nothing and is not listed.
    expect(today.netWorthCents).toBe(-7_000_00);
    expect(today.netWorthCents).toBe(netWorthCents([...boundary.accounts]));
    expect(today.constituents.map((c) => c.accountId)).toEqual(['chk', 'live0977']);
    expect(today.constituents.filter((c) => c.name === 'CREDIT CARD')).toHaveLength(1);
  });

  it('keeps the combined-away row in HISTORY before its cutover (why it stays in `accounts`)', () => {
    const { series } = boundaryThenSeries();
    const beforeCutover = series.find((p) => p.date === '2025-02-28');
    expect(beforeCutover?.constituents).toEqual([
      { accountId: 'old0977', name: 'CREDIT CARD', balanceCents: -500_00, isLiability: true },
    ]);
    // …and the post-cutover snapshot the writer kept recording for it is not counted.
    const recorded = series.find((p) => p.date === '2026-09-30');
    expect(recorded?.constituents.map((c) => c.accountId)).toEqual(['chk', 'live0977']);
    expect(recorded?.netWorthCents).toBe(900_00 - 7_950_00);
  });

  it('lets the change line compare again instead of "No comparison — 1 account joined"', () => {
    const { series } = boundaryThenSeries();
    const delta = netWorthDelta(series[series.length - 2], series[series.length - 1]);
    // (−7,000.00) − (900.00 − 7,950.00 = −7,050.00) = +50.00
    expect(delta.deltaCents).toBe(50_00);
    expect(delta.label).not.toMatch(/No comparison/);
  });

  it('never moves the figure: a superseded row still carrying a balance stays in the live point', () => {
    const series = netWorthSeries({
      snapshots: [],
      accounts: [
        { id: 'chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 300_00 },
        { id: 'stale', name: 'Old card', type: 'CREDIT', currentBalanceCents: 50_00 },
      ],
      supersededAccountIds: ['stale'],
      today: '2026-10-03',
    });
    expect(series).toHaveLength(1);
    expect(series[0].netWorthCents).toBe(250_00);
    expect(series[0].constituents.map((c) => c.accountId)).toEqual(['chk', 'stale']);
  });

  it('keeps a $0.00 account that was NOT combined away, even while other links exist (critic P2-2)', () => {
    // A paid-off card is one of your accounts right now; dropping it would also make the change
    // line refuse with "1 account left".
    const series = netWorthSeries({
      snapshots: [],
      accounts: [
        { id: 'chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 300_00 },
        { id: 'paidoff', name: 'Paid-off card', type: 'CREDIT', currentBalanceCents: 0 },
        { id: 'old', name: 'Old card', type: 'CREDIT', currentBalanceCents: 0 },
      ],
      supersededAccountIds: ['old'],
      today: '2026-10-03',
    });
    expect(series[0].constituents.map((c) => c.accountId)).toEqual(['chk', 'paidoff']);
    expect(series[0].netWorthCents).toBe(300_00);
  });

  it('with nothing superseded the live point is every account, unchanged', () => {
    const series = netWorthSeries({ snapshots: [], accounts, supersededAccountIds: [], today: '2026-06-10' });
    expect(series[0].constituents.map((c) => c.accountId)).toEqual(['chk', 'home', 'card']);
    expect(series[0].netWorthCents).toBe(300_00 - 50_00 + 500_000_00);
  });
});
