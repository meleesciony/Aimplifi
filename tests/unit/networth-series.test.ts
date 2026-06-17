import { describe, expect, it } from 'vitest';
import { netWorthSeries } from '@/lib/engine/networth/series';

const accounts = [
  { id: 'chk', type: 'CHECKING', currentBalanceCents: 300_00 },
  { id: 'card', type: 'CREDIT', currentBalanceCents: 50_00 },
  { id: 'home', type: 'REAL_ESTATE', currentBalanceCents: 500_000_00 }, // manual, no snapshots
];

describe('netWorthSeries (DECISIONS #40)', () => {
  it('sums each month-end as assets − liabilities and ends at the live point', () => {
    const snaps = [
      { accountId: 'chk', date: '2026-04-30', balanceCents: 200_00 },
      { accountId: 'card', date: '2026-04-30', balanceCents: 80_00 }, // liability
      { accountId: 'chk', date: '2026-05-31', balanceCents: 260_00 },
      { accountId: 'card', date: '2026-05-31', balanceCents: 60_00 },
    ];
    const series = netWorthSeries({ snapshots: snaps, accounts, today: '2026-06-10' });
    // Apr: 200 − 80 = 120; May: 260 − 60 = 200; today: 300 − 50 + 500000 = 500250
    expect(series).toEqual([
      { date: '2026-04-30', netWorthCents: 120_00 },
      { date: '2026-05-31', netWorthCents: 200_00 },
      { date: '2026-06-10', netWorthCents: 500_250_00 },
    ]);
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
  });

  it('replaces a same-dated snapshot with the live current value', () => {
    const snaps = [{ accountId: 'chk', date: '2026-06-10', balanceCents: 1_00 }];
    const series = netWorthSeries({ snapshots: snaps, accounts, today: '2026-06-10' });
    expect(series).toHaveLength(1);
    expect(series[0].netWorthCents).toBe(500_250_00); // current, not the 1.00 snapshot
  });
});
