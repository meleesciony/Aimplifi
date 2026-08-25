/**
 * Mortgage extra-principal what-if (DECISIONS #517). Reuses planDebtPayoff —
 * goldens are the same hand-verified table as EDGE_CASES §Debt-payoff A/C.
 */
import { describe, expect, it } from 'vitest';

import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import {
  mortgageEarlyPayoff,
  pickMortgageForEarlyPayoff,
  type MortgageCandidate,
} from '@/lib/engine/debt/mortgage-early-payoff';

const house = (over: Partial<Parameters<typeof mortgageEarlyPayoff>[0]> = {}) =>
  mortgageEarlyPayoff({
    id: 'acct-house',
    name: 'Home loan',
    balanceCents: 30_000,
    aprBps: 1200,
    minimumPaymentCents: 10_000,
    extraMonthlyCents: 0,
    ...over,
  });

const candidate = (over: Partial<MortgageCandidate> = {}): MortgageCandidate => ({
  id: 'm1',
  name: 'Mortgage',
  type: 'MORTGAGE',
  balanceCents: 250_000_00,
  aprBps: 675,
  minimumPaymentCents: 180_000,
  ...over,
});

describe('pickMortgageForEarlyPayoff', () => {
  it('returns none when no mortgage is owed', () => {
    expect(pickMortgageForEarlyPayoff([])).toEqual({ kind: 'none' });
    expect(
      pickMortgageForEarlyPayoff([
        candidate({ type: 'LOAN', name: 'Auto Loan', id: 'acct-autoloan' }),
        candidate({ type: 'CREDIT', name: 'Sapphire', id: 'acct-sapphire', balanceCents: 2_000_00 }),
      ]),
    ).toEqual({ kind: 'none' });
    expect(
      pickMortgageForEarlyPayoff([candidate({ type: 'MORTGAGE', name: 'Home', balanceCents: 0 })]),
    ).toMatchObject({ kind: 'paid-off', candidate: { name: 'Home' } });
  });

  it('prefers a ready mortgage over an incomplete larger one', () => {
    const pick = pickMortgageForEarlyPayoff([
      candidate({
        id: 'big-unknown',
        name: 'Big',
        balanceCents: 400_000_00,
        aprBps: null,
        minimumPaymentCents: 300_000,
      }),
      candidate({ id: 'ready', name: 'Ready', balanceCents: 200_000_00 }),
    ]);
    expect(pick.kind).toBe('ready');
    if (pick.kind === 'ready') expect(pick.candidate.id).toBe('ready');
  });

  it('picks the largest ready balance; a known 0% rate is ready', () => {
    const pick = pickMortgageForEarlyPayoff([
      candidate({ id: 'small', balanceCents: 80_000_00, aprBps: 0 }),
      candidate({ id: 'large', balanceCents: 120_000_00, aprBps: 0 }),
    ]);
    expect(pick.kind).toBe('ready');
    if (pick.kind === 'ready') {
      expect(pick.candidate.id).toBe('large');
      expect(pick.candidate.aprBps).toBe(0);
    }
  });

  it('names the missing term when the only mortgage cannot run', () => {
    expect(
      pickMortgageForEarlyPayoff([candidate({ aprBps: null })]),
    ).toEqual({
      kind: 'incomplete',
      candidate: candidate({ aprBps: null }),
      missing: 'rate',
    });
    expect(
      pickMortgageForEarlyPayoff([candidate({ minimumPaymentCents: 0 })]),
    ).toMatchObject({ kind: 'incomplete', missing: 'minimum' });
    expect(
      pickMortgageForEarlyPayoff([
        candidate({ aprBps: null, minimumPaymentCents: null }),
      ]),
    ).toMatchObject({ kind: 'incomplete', missing: 'rate-and-minimum' });
  });
});

describe('mortgageEarlyPayoff — EDGE §Mortgage early-payoff', () => {
  it('ME1: $300 @ 12%, $100/mo, $0 extra matches the pinned 4-month walk', () => {
    const r = house();
    expect(r.baselineMonths).toBe(4);
    expect(r.extraMonths).toBe(4);
    expect(r.monthsSaved).toBe(0);
    expect(r.baselineInterestCents).toBe(614);
    expect(r.extraInterestCents).toBe(614);
    expect(r.interestSavedCents).toBe(0);
  });

  it('ME2: +$100 extra matches EDGE C — 2 months, $4.03 interest, $2.11 saved', () => {
    const r = house({ extraMonthlyCents: 10_000 });
    expect(r.baselineMonths).toBe(4);
    expect(r.extraMonths).toBe(2);
    expect(r.monthsSaved).toBe(2);
    expect(r.extraInterestCents).toBe(403);
    expect(r.interestSavedCents).toBe(211);
  });

  it('ME3: a known 0% rate is principal division, not a missing rate', () => {
    const r = house({
      balanceCents: 100_000,
      aprBps: 0,
      minimumPaymentCents: 10_000,
      extraMonthlyCents: 10_000,
    });
    expect(r.baselineMonths).toBe(10);
    expect(r.extraMonths).toBe(5);
    expect(r.monthsSaved).toBe(5);
    expect(r.baselineInterestCents).toBe(0);
    expect(r.interestSavedCents).toBe(0);
  });

  it('ME4: negative-amortization baseline stays null; extra that clears does not invent months-saved', () => {
    const r = house({
      balanceCents: 100_000,
      aprBps: 3600,
      minimumPaymentCents: 1_000,
      extraMonthlyCents: 4_000,
    });
    expect(r.baselineMonths).toBeNull();
    // Extra $40 on a $10 min does clear — month count is planDebtPayoff's
    // (already pinned). What this wrapper must not do is subtract from null.
    expect(r.extraMonths).toBeGreaterThan(0);
    expect(r.monthsSaved).toBeNull();
    expect(r.interestSavedCents).toBeNull();
  });

  it('ME5: extra that still cannot clear reports both legs never', () => {
    const r = house({
      balanceCents: 100_000,
      aprBps: 3600,
      minimumPaymentCents: 1_000,
      extraMonthlyCents: 500,
    });
    expect(r.baselineMonths).toBeNull();
    expect(r.extraMonths).toBeNull();
    expect(r.monthsSaved).toBeNull();
    expect(r.interestSavedCents).toBeNull();
  });
});

describe('mortgage early-payoff copy', () => {
  it('test_regression__mortgage_early_payoff_zero_extra_is_idle_not_a_savings_claim', () => {
    const row = house();
    expect(COACH_COPY.mortgageEarlyPayoff(row)).toBeNull();
    const idle = COACH_COPY.mortgageEarlyPayoffIdle(row);
    expect(idle).toContain('$100.00');
    expect(idle).toContain('12.00%');
    expect(idle).toContain('4 months');
    expect(idle).toContain('$6.14');
    expect(idle).toMatch(/assum/);
    expect(idle).not.toMatch(/sooner/);
    expect(idle).not.toMatch(/avoid/);
  });

  it('test_regression__mortgage_early_payoff_names_only_this_loan_and_does_not_nudge', () => {
    const sentence = COACH_COPY.mortgageEarlyPayoff(house({ extraMonthlyCents: 10_000 }))!;
    expect(sentence).toContain('Home loan');
    expect(sentence).toContain('2 months sooner');
    expect(sentence).toContain('$2.11');
    expect(sentence).toContain('Illustration, not advice');
    expect(sentence).toContain('not a recommendation to prepay');
    expect(sentence).not.toMatch(/Auto Loan/);
    expect(sentence).not.toMatch(/this card|\bbelow\b|the tile/i);
    expect(sentence).not.toMatch(/you should/i);
    expect(sentence).toContain('cash payment due');
    expect(sentence).toContain('not split out');
  });

  it('test_regression__mortgage_early_payoff_names_cash_due_is_not_split_escrow', () => {
    const idle = COACH_COPY.mortgageEarlyPayoffIdle(house());
    expect(idle).toContain('cash payment due');
    expect(idle).toContain('escrow');
    expect(idle).toContain('not split out');
  });
});
