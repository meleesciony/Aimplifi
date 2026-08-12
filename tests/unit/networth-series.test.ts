import { describe, expect, it } from 'vitest';
import { netWorthSeries } from '@/lib/engine/networth/series';

const accounts = [
  { id: 'chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 300_00 },
  { id: 'card', name: 'Venture', type: 'CREDIT', currentBalanceCents: 50_00 },
  { id: 'home', name: 'Home', type: 'REAL_ESTATE', currentBalanceCents: 500_000_00 }, // manual, no snapshots
];

describe('netWorthSeries (DECISIONS #40)', () => {
  it('sums each month-end as assets − liabilities and ends at the live point, carrying constituents', () => {
    const snaps = [
      { accountId: 'chk', date: '2026-04-30', balanceCents: 200_00 },
      { accountId: 'card', date: '2026-04-30', balanceCents: 80_00 }, // liability
      { accountId: 'chk', date: '2026-05-31', balanceCents: 260_00 },
      { accountId: 'card', date: '2026-05-31', balanceCents: 60_00 },
    ];
    const series = netWorthSeries({ snapshots: snaps, accounts, today: '2026-06-10' });
    // Apr: 200 − 80 = 120; May: 260 − 60 = 200; today: 300 − 50 + 500000 = 500250
    expect(series).toEqual([
      {
        date: '2026-04-30',
        netWorthCents: 120_00,
        constituents: [
          { accountId: 'chk', name: 'Checking', balanceCents: 200_00 },
          { accountId: 'card', name: 'Venture', balanceCents: -80_00 }, // signed: liability negative
        ],
      },
      {
        date: '2026-05-31',
        netWorthCents: 200_00,
        constituents: [
          { accountId: 'chk', name: 'Checking', balanceCents: 260_00 },
          { accountId: 'card', name: 'Venture', balanceCents: -60_00 },
        ],
      },
      {
        date: '2026-06-10',
        netWorthCents: 500_250_00,
        // Live point: EVERY account, manual items included, signed, sorted by
        // name (O.20f P2-c: "Apr 30" and "Today" panels list the same accounts
        // in the SAME sequence — Checking, Home, Venture here).
        constituents: [
          { accountId: 'chk', name: 'Checking', balanceCents: 300_00 },
          { accountId: 'home', name: 'Home', balanceCents: 500_000_00 },
          { accountId: 'card', name: 'Venture', balanceCents: -50_00 },
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
      { accountId: 'chk', date: '2026-05-31', balanceCents: 100_00 },
      { accountId: 'chk', date: '2026-07-31', balanceCents: 999_00 }, // future → dropped
      { accountId: 'ghost', date: '2026-05-31', balanceCents: 999_00 }, // unknown acct → ignored
    ];
    const series = netWorthSeries({ snapshots: snaps, accounts, today: '2026-06-10' });
    expect(series.map((p) => p.date)).toEqual(['2026-05-31', '2026-06-10']);
    expect(series[0].netWorthCents).toBe(100_00); // only chk counted on 05-31
    expect(series[0].constituents).toEqual([{ accountId: 'chk', name: 'Checking', balanceCents: 100_00 }]);
    // The live point still carries ALL accounts.
    expect(series[1].constituents).toHaveLength(3);
    expect(series[1].constituents.reduce((s, c) => s + c.balanceCents, 0)).toBe(500_250_00);
  });

  it('replaces a same-dated snapshot with the live current value (constituents too)', () => {
    const snaps = [{ accountId: 'chk', date: '2026-06-10', balanceCents: 1_00 }];
    const series = netWorthSeries({ snapshots: snaps, accounts, today: '2026-06-10' });
    expect(series).toHaveLength(1);
    expect(series[0].netWorthCents).toBe(500_250_00); // current, not the 1.00 snapshot
    // The snapshot would have contributed {chk: 1.00}; the live point replaced it wholesale.
    // Name-sorted (O.20f P2-c): Checking < Home < Venture.
    expect(series[0].constituents.map((c) => c.accountId)).toEqual(['chk', 'home', 'card']);
    expect(series[0].constituents.find((c) => c.accountId === 'chk')!.balanceCents).toBe(300_00);
  });

  it('carries two same-account snapshots as two constituents on the same date (Σ still exact)', () => {
    const snaps = [
      { accountId: 'chk', date: '2026-05-31', balanceCents: 100_00 },
      { accountId: 'chk', date: '2026-05-31', balanceCents: 50_00 },
    ];
    const series = netWorthSeries({ snapshots: snaps, accounts, today: '2026-06-10' });
    expect(series[0].netWorthCents).toBe(150_00);
    expect(series[0].constituents).toHaveLength(2);
    expect(series[0].constituents.reduce((s, c) => s + c.balanceCents, 0)).toBe(150_00);
  });
});
