/**
 * Cash-flow forecast engine (DECISIONS #72) — known-answer tests for cadence
 * expansion and the day-by-day balance walk (milestones, lowest point, first
 * negative date, inflow/outflow totals).
 */
import { describe, expect, it } from 'vitest';
import {
  computeForecast,
  expandScheduled,
  loanObligationsToScheduledFlows,
} from '@/lib/engine/forecast/forecast';
import type { LoanObligation } from '@/lib/engine/loans/obligations';
import { isoDate } from '@/lib/dates';
import { cents } from '@/lib/money';

describe('expandScheduled', () => {
  it('expands a biweekly flow into occurrences strictly after today within the horizon', () => {
    const events = expandScheduled(
      [{ description: 'Payroll', amountCents: 245000, nextDate: '2026-06-12', cadence: 'BIWEEKLY' }],
      '2026-06-10',
      30,
    );
    expect(events.map((e) => e.date)).toEqual(['2026-06-12', '2026-06-26', '2026-07-10']);
    expect(events.every((e) => e.amountCents === 245000)).toBe(true);
  });

  it('expands a monthly flow with clamped month arithmetic', () => {
    const events = expandScheduled(
      [{ description: 'Rent', amountCents: -180000, nextDate: '2026-06-30', cadence: 'MONTHLY' }],
      '2026-06-10',
      95,
    );
    // 30 Jun, then clamped to month length (Jul 30, Aug 30, Sep 30 > horizon)
    expect(events.map((e) => e.date)).toEqual(['2026-06-30', '2026-07-30', '2026-08-30']);
  });

  it('drops occurrences on or before today and beyond the horizon', () => {
    const events = expandScheduled(
      [{ description: 'Weekly', amountCents: -1000, nextDate: '2026-06-03', cadence: 'WEEKLY' }],
      '2026-06-10',
      14,
    );
    // 03 and 10 excluded (≤ today); 17 and 24 inside; 01 Jul beyond horizon
    expect(events.map((e) => e.date)).toEqual(['2026-06-17', '2026-06-24']);
  });

  it('treats a null cadence as a single dated occurrence', () => {
    const events = expandScheduled(
      [{ description: 'One-off', amountCents: -5000, nextDate: '2026-06-20', cadence: null }],
      '2026-06-10',
      60,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ date: '2026-06-20', amountCents: -5000 });
  });
});

describe('computeForecast', () => {
  it('walks the balance forward and reports milestones, lowest, and totals', () => {
    const events = [
      { date: '2026-06-20', amountCents: -180000, label: 'Rent' }, // dips
      { date: '2026-06-26', amountCents: 245000, label: 'Payroll' }, // recovers
    ];
    const f = computeForecast({
      today: '2026-06-10',
      startingBalanceCents: 340000,
      horizonDays: 90,
      events,
    });
    expect(f.days).toHaveLength(91); // inclusive today..+90
    expect(f.days[0].balanceCents).toBe(340000); // today = anchor, no flows
    // lowest is after rent, before payroll
    expect(f.lowest.balanceCents).toBe(160000);
    expect(f.lowest.date).toBe('2026-06-20');
    expect(f.endingBalanceCents).toBe(340000 - 180000 + 245000); // 405000
    expect(f.totalInflowCents).toBe(245000);
    expect(f.totalOutflowCents).toBe(180000);
    expect(f.firstNegativeDate).toBeNull();
    // 30/60/90 day milestones all present and reflect post-payroll balance
    expect(f.milestones.map((m) => m.dayOffset)).toEqual([30, 60, 90]);
    expect(f.milestones[0].balanceCents).toBe(405000);
  });

  it('flags the first date the balance goes negative', () => {
    const f = computeForecast({
      today: '2026-06-10',
      startingBalanceCents: 50000,
      horizonDays: 30,
      events: [
        { date: '2026-06-15', amountCents: -30000, label: 'Bill A' },
        { date: '2026-06-18', amountCents: -40000, label: 'Bill B' }, // 50k-30k-40k = -20k
      ],
    });
    expect(f.firstNegativeDate).toBe('2026-06-18');
    expect(f.lowest.balanceCents).toBe(-20000);
  });

  it('only emits milestones that fall within the horizon', () => {
    const f = computeForecast({
      today: '2026-06-10',
      startingBalanceCents: 10000,
      horizonDays: 45,
      events: [],
    });
    expect(f.milestones.map((m) => m.dayOffset)).toEqual([30]); // 60/90 beyond 45d
  });
});

describe('loanObligationsToScheduledFlows (#134 — loan payments in the balance projection)', () => {
  const loanObligation = (over: Partial<LoanObligation> = {}): LoanObligation => ({
    accountId: 'acct-autoloan',
    accountName: 'Auto Loan',
    accountType: 'LOAN',
    dueDate: isoDate('2026-07-05'),
    effectiveDueDate: isoDate('2026-07-03'), // business-day-shifted — the mapper must IGNORE this
    paymentCents: cents(38500),
    isEstimated: false,
    frozenSince: null,
    ...over,
  });

  it('maps a loan obligation to a MONTHLY outflow anchored on the RAW dueDate, never effectiveDueDate', () => {
    const flows = loanObligationsToScheduledFlows([loanObligation()]);
    expect(flows).toEqual([
      { description: 'Auto Loan', amountCents: -38500, nextDate: '2026-07-05', cadence: 'MONTHLY' },
    ]);
    // guard the docstring invariant: a business-day-shifted anchor would drag the shift into
    // every future month, so the mapper must use dueDate, not effectiveDueDate.
    expect(flows[0].nextDate).not.toBe('2026-07-03');
  });

  it('drops a non-positive payment; empty in → empty out', () => {
    expect(loanObligationsToScheduledFlows([])).toEqual([]);
    expect(loanObligationsToScheduledFlows([loanObligation({ paymentCents: cents(0) })])).toEqual([]);
  });

  it('folds into the projection: 3 monthly occurrences over the demo 90-day horizon (−$385/−$770/−$1,155)', () => {
    // The loan's ISOLATED contribution to a bare $3,400 start (today 2026-06-10, auto-loan
    // $385.00 due day 5). Hand-verified in docs/EDGE_CASES.md §LO-H. NOTE: this is NOT the
    // on-screen /forecast milestone (that also carries payroll/rent/savings) — see §LO-H.
    const events = expandScheduled(loanObligationsToScheduledFlows([loanObligation()]), '2026-06-10', 90);
    expect(events.map((e) => e.date)).toEqual(['2026-07-05', '2026-08-05', '2026-09-05']);
    const f = computeForecast({
      today: '2026-06-10',
      startingBalanceCents: 340000,
      horizonDays: 90,
      events,
    });
    expect(f.milestones[0].balanceCents).toBe(301500); // 30d (07-10): −$385
    expect(f.milestones[1].balanceCents).toBe(263000); // 60d (08-09): −$770
    expect(f.milestones[2].balanceCents).toBe(224500); // 90d (09-08): −$1,155
    expect(f.totalOutflowCents).toBe(115500); // 3 × $385
  });

  it('does NOT de-duplicate a loan already present as a scheduled row (documents the accepted STATUS #134 residual)', () => {
    // A loan ACH that is ALSO recurring-detected as a checking scheduled row coexists with the
    // loan-due flow and double-counts — no structural key links a checking row to a loan Account,
    // and heuristic money-matching is rejected. This PINS the accepted limitation; update it only
    // if a future non-heuristic link is introduced.
    const scheduledRow = {
      description: 'Auto Loan ACH',
      amountCents: -38500,
      nextDate: '2026-07-05',
      cadence: 'MONTHLY' as const,
    };
    const events = expandScheduled(
      [scheduledRow, ...loanObligationsToScheduledFlows([loanObligation()])],
      '2026-06-10',
      40, // one occurrence of each within the horizon
    );
    const f = computeForecast({
      today: '2026-06-10',
      startingBalanceCents: 340000,
      horizonDays: 40,
      events,
    });
    expect(f.totalOutflowCents).toBe(77000); // 2 × $385 — the documented double-count
  });
});
