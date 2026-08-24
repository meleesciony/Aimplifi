/**
 * P.1 radar/cash-dip counterfactual — the pure dip/cover delta behind
 * "what should I cut?" (src/lib/engine/radar/cut-counterfactual.ts).
 *
 * applyCutsToScheduled is pinned on matching, sign, partial-vs-full, and
 * one-merchant-one-saving (the same map `sumCutMonthlyCents` uses).
 * cutRadarCounterfactual is pinned on improvement-only: a disappeared dip,
 * a later first-negative, a smaller cover; identical and worsening-only
 * walks are the honest null. Demo wiring: the seed's four opportunities
 * are card-billed and do not sit on checking scheduled, so the walk does
 * not move — a fabricated "July dip disappears" on the demo fails here.
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { cents } from '@/lib/money';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
import { buildSeedData } from '@/lib/seed/build';
import { findOpportunities } from '@/lib/engine/fi/insights';
import { detectRecurring } from '@/lib/engine/recurring/detect';
import { cutByMerchant, sumCutMonthlyCents } from '@/lib/engine/fi/counterfactual';
import {
  applyCutsToScheduled,
  cutRadarCounterfactual,
  monthlyCutToOccurrenceCents,
  radarCutSides,
} from '@/lib/engine/radar/cut-counterfactual';
import { computeRadar, type RadarInput } from '@/lib/engine/radar/radar';
import { radarFromSnapshot } from '@/server/radar';
import type { FinanceSnapshot } from '@/lib/providers/types';
import type { Opportunity } from '@/lib/engine/fi/insights';

const TODAY = isoDate('2026-06-10');

function opportunity(
  over: Partial<Omit<Opportunity, 'monthlyCents'>> & { merchant: string; monthlyCents: number },
): Opportunity {
  return {
    kind: 'unused-subscription',
    todayValue10Cents: cents(0),
    todayValue20Cents: cents(0),
    todayValue30Cents: cents(0),
    isEstimate: false,
    ...over,
    monthlyCents: cents(over.monthlyCents),
  };
}

function sides(over: {
  firstNegativeDate: string | null;
  coverCents: number | null;
}): ReturnType<typeof radarCutSides> {
  return {
    firstNegativeDate: over.firstNegativeDate ? isoDate(over.firstNegativeDate) : null,
    coverCents: over.coverCents === null ? null : cents(over.coverCents),
  };
}

describe('applyCutsToScheduled', () => {
  it('drops a checking outflow whose merchant matches a full unused-subscription cut', () => {
    const rows = [
      { description: 'LA FITNESS MEMBERSHIP DUES', amountCents: -3499, cadence: 'MONTHLY' },
      { description: 'Payroll — Acme Analytics', amountCents: 245000, cadence: 'BIWEEKLY' },
    ];
    const out = applyCutsToScheduled(rows, [opportunity({ merchant: 'LA Fitness', monthlyCents: 3499 })]);
    expect(out).toEqual([{ description: 'Payroll — Acme Analytics', amountCents: 245000, cadence: 'BIWEEKLY' }]);
  });

  it('matches toScheduledRow descriptions that are already canonical', () => {
    const rows = [{ description: 'LA Fitness', amountCents: -3499 }];
    expect(applyCutsToScheduled(rows, [opportunity({ merchant: 'LA Fitness', monthlyCents: 3499 })])).toEqual([]);
  });

  it('reduces a partial cut (price-increase delta, estimate) rather than dropping the series', () => {
    const rows = [{ description: 'NETFLIX.COM 866-579-7172', amountCents: -1799, cadence: 'MONTHLY' }];
    const out = applyCutsToScheduled(rows, [
      opportunity({ merchant: 'Netflix', monthlyCents: 250, kind: 'price-increase' }),
    ]);
    expect(out).toEqual([{ description: 'NETFLIX.COM 866-579-7172', amountCents: -1549, cadence: 'MONTHLY' }]);
  });

  it('never touches an inflow, even if the merchant string collided', () => {
    const rows = [{ description: 'LA Fitness', amountCents: 3499 }];
    expect(applyCutsToScheduled(rows, [opportunity({ merchant: 'LA Fitness', monthlyCents: 3499 })])).toEqual(rows);
  });

  it('leaves unmatched merchants unchanged', () => {
    const rows = [{ description: 'Rent — Peachtree Properties', amountCents: -180000 }];
    expect(applyCutsToScheduled(rows, [opportunity({ merchant: 'LA Fitness', monthlyCents: 3499 })])).toEqual(rows);
  });

  it('consumes one merchant once across two rows (does not double-apply the cut)', () => {
    const rows = [
      { description: 'LA Fitness', amountCents: -3499 },
      { description: 'LA FITNESS MEMBERSHIP DUES', amountCents: -3499 },
    ];
    const out = applyCutsToScheduled(rows, [opportunity({ merchant: 'LA Fitness', monthlyCents: 3499 })]);
    expect(out).toEqual([{ description: 'LA FITNESS MEMBERSHIP DUES', amountCents: -3499 }]);
  });

  it('uses the same per-merchant MAX map as the FI total (unused + increase = full amount once)', () => {
    const ops = [
      opportunity({ merchant: 'LA Fitness', monthlyCents: 3499 }),
      opportunity({ merchant: 'LA Fitness', monthlyCents: 250, kind: 'price-increase' }),
    ];
    expect(sumCutMonthlyCents(ops)).toBe(3499);
    expect(cutByMerchant(ops).get('LA Fitness')).toBe(3499);
    const out = applyCutsToScheduled([{ description: 'LA Fitness', amountCents: -3499 }], ops);
    expect(out).toEqual([]);
  });

  it('a calendar-monthly $20 estimate does not cancel a weekly series (critic P1-1)', () => {
    // $20/mo against a $15 weekly template: occurrence = round(2000*12/52)=462.
    // Cancelling the series would drop ~13 hits (~$195) in 90 days; the $20/mo
    // estimate is ~$60. The row must shrink, not disappear.
    expect(monthlyCutToOccurrenceCents(2000, 'WEEKLY')).toBe(462);
    const rows = [
      { description: 'Xfinity', amountCents: -1500, cadence: 'WEEKLY' as const },
    ];
    const out = applyCutsToScheduled(rows, [
      opportunity({ merchant: 'Xfinity', monthlyCents: 2000, kind: 'negotiable-bill', isEstimate: true }),
    ]);
    expect(out).toEqual([{ description: 'Xfinity', amountCents: -1038, cadence: 'WEEKLY' }]);
  });

  it('unused-subscription still cancels a weekly series whose last charge is the cut', () => {
    const rows = [{ description: 'LA Fitness', amountCents: -1000, cadence: 'WEEKLY' as const }];
    expect(
      applyCutsToScheduled(rows, [opportunity({ merchant: 'LA Fitness', monthlyCents: 1000 })]),
    ).toEqual([]);
  });

  it('preserves extra fields on a reduced row', () => {
    // toScheduledRow writes merchantCanonical as description; Comcast's
    // canonical is Xfinity.
    const rows = [{ description: 'Xfinity', amountCents: -7999, accountId: 'acct-checking', nextDate: '2026-06-18' }];
    const out = applyCutsToScheduled(rows, [
      opportunity({ merchant: 'Xfinity', monthlyCents: 2000, kind: 'negotiable-bill', isEstimate: true }),
    ]);
    expect(out).toEqual([
      { description: 'Xfinity', amountCents: -5999, accountId: 'acct-checking', nextDate: '2026-06-18' },
    ]);
  });
});

describe('cutRadarCounterfactual — improvement only', () => {
  it('identical walks ⇒ moved false (the honest null)', () => {
    const s = sides({ firstNegativeDate: '2026-06-24', coverCents: 105000 });
    const r = cutRadarCounterfactual(s, s);
    expect(r.moved).toBe(false);
    expect(r.dipDisappears).toBe(false);
    expect(r.dipLater).toBe(false);
    expect(r.coverDropCents).toBe(0);
  });

  it('a disappeared dip is movement, even when the cover going to nothing is the same fact', () => {
    const r = cutRadarCounterfactual(
      sides({ firstNegativeDate: '2026-06-24', coverCents: 105000 }),
      sides({ firstNegativeDate: null, coverCents: null }),
    );
    expect(r.dipDisappears).toBe(true);
    expect(r.moved).toBe(true);
    expect(r.coverDropCents).toBe(105000);
    expect(r.baselineDipDate).toBe('2026-06-24');
    expect(r.cutDipDate).toBeNull();
  });

  it('a later first-negative date is movement', () => {
    const r = cutRadarCounterfactual(
      sides({ firstNegativeDate: '2026-06-12', coverCents: 50000 }),
      sides({ firstNegativeDate: '2026-06-25', coverCents: 50000 }),
    );
    expect(r.dipLater).toBe(true);
    expect(r.dipDisappears).toBe(false);
    expect(r.coverDropCents).toBe(0);
    expect(r.moved).toBe(true);
  });

  it('a smaller cover with the same dip date is movement', () => {
    const r = cutRadarCounterfactual(
      sides({ firstNegativeDate: '2026-06-20', coverCents: 50000 }),
      sides({ firstNegativeDate: '2026-06-20', coverCents: 40000 }),
    );
    expect(r.dipDisappears).toBe(false);
    expect(r.dipLater).toBe(false);
    expect(r.coverDropCents).toBe(10000);
    expect(r.moved).toBe(true);
  });

  it('an earlier dip (worsening) is not movement', () => {
    const r = cutRadarCounterfactual(
      sides({ firstNegativeDate: '2026-06-25', coverCents: 40000 }),
      sides({ firstNegativeDate: '2026-06-12', coverCents: 40000 }),
    );
    expect(r.dipLater).toBe(false);
    expect(r.moved).toBe(false);
  });

  it('a larger cover (worsening) is not movement', () => {
    const r = cutRadarCounterfactual(
      sides({ firstNegativeDate: '2026-06-20', coverCents: 40000 }),
      sides({ firstNegativeDate: '2026-06-20', coverCents: 50000 }),
    );
    expect(r.coverDropCents).toBe(0);
    expect(r.moved).toBe(false);
  });

  it('no baseline dip ⇒ nothing to improve', () => {
    const r = cutRadarCounterfactual(
      sides({ firstNegativeDate: null, coverCents: null }),
      sides({ firstNegativeDate: null, coverCents: null }),
    );
    expect(r.moved).toBe(false);
  });
});

describe('cutRadarCounterfactual — against a real computeRadar walk', () => {
  const base = (over: Partial<RadarInput> = {}): RadarInput => ({
    today: TODAY,
    horizonDays: 30,
    startingBalanceCents: cents(40000),
    committedEvents: [],
    cardDues: [],
    accounts: [
      { id: 'acct-checking', name: 'Checking', type: 'CHECKING', currentBalanceCents: 40000, feedDroppedAt: null },
      { id: 'acct-savings', name: 'Savings', type: 'SAVINGS', currentBalanceCents: 500000, feedDroppedAt: null },
    ],
    paymentAccountId: 'acct-checking',
    holidays: [],
    burn: null,
    undatableCards: [],
    ...over,
  });

  it('removing a gym outflow that is what dips the line ⇒ dipDisappears', () => {
    const gym = { date: '2026-06-15', amountCents: -50000, label: 'LA Fitness' };
    const rent = { date: '2026-06-20', amountCents: -80000, label: 'Rent' };
    const withGym = computeRadar(base({ startingBalanceCents: cents(100000), committedEvents: [gym, rent] }));
    const without = computeRadar(base({ startingBalanceCents: cents(100000), committedEvents: [rent] }));
    const r = cutRadarCounterfactual(radarCutSides(withGym), radarCutSides(without));
    expect(withGym.committed.firstNegativeDate).toBe('2026-06-20');
    expect(without.committed.firstNegativeDate).toBeNull();
    expect(r.dipDisappears).toBe(true);
    expect(r.moved).toBe(true);
  });

  it('cancelling a weekly $15 series for a $20/mo estimate would fabricate a disappeared dip — the scaled cut does not', () => {
    // Critic P1-1 hand-compute: start $200, two weekly $15 hits, then $180 rent.
    // Cancel the series → rent alone leaves +$20 (no dip). A real $20/mo
    // (~$4.62/week) still dips. The scaled applyCuts path must follow the
    // second walk, not the first.
    const rent = { date: '2026-06-20', amountCents: -18000, label: 'Rent' };
    const weekly = [
      { date: '2026-06-12', amountCents: -1500, label: 'Xfinity' },
      { date: '2026-06-19', amountCents: -1500, label: 'Xfinity' },
    ];
    const scaled = monthlyCutToOccurrenceCents(2000, 'WEEKLY');
    expect(scaled).toBe(462);
    const reducedWeekly = weekly.map((e) => ({ ...e, amountCents: -(1500 - scaled) }));
    const input = {
      today: TODAY,
      horizonDays: 30,
      startingBalanceCents: cents(20000),
      cardDues: [],
      accounts: [
        { id: 'acct-checking', name: 'Checking', type: 'CHECKING', currentBalanceCents: 20000, feedDroppedAt: null },
        { id: 'acct-savings', name: 'Savings', type: 'SAVINGS', currentBalanceCents: 500000, feedDroppedAt: null },
      ],
      paymentAccountId: 'acct-checking',
      holidays: [],
      burn: null,
      undatableCards: [],
    };
    const cancelled = computeRadar({ ...input, committedEvents: [rent] });
    const scaledWalk = computeRadar({ ...input, committedEvents: [...reducedWeekly, rent] });
    const baseline = computeRadar({ ...input, committedEvents: [...weekly, rent] });
    expect(cutRadarCounterfactual(radarCutSides(baseline), radarCutSides(cancelled)).dipDisappears).toBe(true);
    const r = cutRadarCounterfactual(radarCutSides(baseline), radarCutSides(scaledWalk));
    expect(r.dipDisappears).toBe(false);
  });

  it('a smaller gym bill that does not change the dip date still shrinks the cover', () => {
    const gym = { date: '2026-06-12', amountCents: -10000, label: 'LA Fitness' };
    const rent = { date: '2026-06-20', amountCents: -80000, label: 'Rent' };
    const withGym = computeRadar(base({ committedEvents: [gym, rent] }));
    const without = computeRadar(base({ committedEvents: [rent] }));
    const r = cutRadarCounterfactual(radarCutSides(withGym), radarCutSides(without));
    expect(withGym.committed.firstNegativeDate).toBe('2026-06-20');
    expect(without.committed.firstNegativeDate).toBe('2026-06-20');
    expect(r.dipDisappears).toBe(false);
    expect(r.dipLater).toBe(false);
    expect(r.coverDropCents).toBeGreaterThan(0);
    expect(r.moved).toBe(true);
    expect(without.coverTransfer!.amountCents).toBeLessThan(withGym.coverTransfer!.amountCents);
  });
});

describe('demo wiring — seed opportunities do not invent a radar dip move', () => {
  const seed = buildSeedData('2026-06-10');
  const snap: FinanceSnapshot = {
    paymentAccountId: 'acct-checking',
    accounts: seed.accounts,
    autopays: seed.autopays,
    statements: seed.statements,
    cardPayments: seed.cardPayments,
    transactions: seed.transactions,
    scheduled: seed.scheduled,
    balanceSnapshots: seed.snapshots,
    handoverKeys: new Set<string>(),
  };
  const series = detectRecurring(
    seed.transactions.filter((t) => t.status === 'POSTED'),
    TODAY,
    NO_RECURRING_OVERRIDES,
  );
  const opportunities = findOpportunities(series, 700, 250, []);

  it('the demo has opportunities, and none of them sit on checking scheduled', () => {
    expect(opportunities.length).toBeGreaterThan(0);
    const merchants = new Set(opportunities.map((o) => o.merchant));
    for (const row of seed.scheduled.filter((s) => s.accountId === 'acct-checking')) {
      expect(merchants.has(row.description), `${row.description} is a cut merchant`).toBe(false);
    }
  });

  it('test_regression__p1_cut_does_not_invent_a_radar_dip_on_the_demo_seed', () => {
    const { radar: baseline } = radarFromSnapshot(snap, TODAY, NO_RECURRING_OVERRIDES);
    const { radar: cut } = radarFromSnapshot(
      { ...snap, scheduled: applyCutsToScheduled(snap.scheduled, opportunities) },
      TODAY,
      NO_RECURRING_OVERRIDES,
    );
    const r = cutRadarCounterfactual(radarCutSides(baseline), radarCutSides(cut));
    expect(r.moved).toBe(false);
    expect(cut.committed.firstNegativeDate).toBe(baseline.committed.firstNegativeDate);
    expect(cut.coverTransfer?.amountCents ?? null).toBe(baseline.coverTransfer?.amountCents ?? null);
  });

  it('the same walk DOES move when a matching checking scheduled row is present', () => {
    // Dedicated amount: seed opportunities only cut $34.99, which may not
    // cross the $50 cover round-up on this seed. A full cancel of a $2,000
    // checking series is the non-vacuous harness lock.
    const gymOps = [opportunity({ merchant: 'LA Fitness', monthlyCents: 200000 })];
    const withGym: FinanceSnapshot = {
      ...snap,
      scheduled: [
        ...snap.scheduled,
        {
          accountId: 'acct-checking',
          description: 'LA Fitness',
          amountCents: -200000,
          nextDate: '2026-06-15',
          cadence: 'MONTHLY',
        },
      ],
    };
    const { radar: baseline } = radarFromSnapshot(withGym, TODAY, NO_RECURRING_OVERRIDES);
    const { radar: cut } = radarFromSnapshot(
      { ...withGym, scheduled: applyCutsToScheduled(withGym.scheduled, gymOps) },
      TODAY,
      NO_RECURRING_OVERRIDES,
    );
    const r = cutRadarCounterfactual(radarCutSides(baseline), radarCutSides(cut));
    expect(r.moved).toBe(true);
  });
});
