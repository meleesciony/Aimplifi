/**
 * W.6(b) next-dollar ranking — hand-verified against docs/EDGE_CASES.md
 * §Next-dollar. Integer cents, nominal APR vs nominal return, strict `>`.
 */
import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import {
  RUNWAY_FLOOR_MONTHS,
  classifyDebts,
  nextDollar,
  type NextDollarDebt,
  type NextDollarInput,
} from '@/lib/engine/fi/next-dollar';

const storeCard: NextDollarDebt = {
  id: 'acct-store',
  name: 'Store Card',
  kind: 'revolving',
  balanceCents: 43_50,
  aprBps: 3199,
};
const autoLoan: NextDollarDebt = {
  id: 'acct-autoloan',
  name: 'Auto Loan',
  kind: 'installment',
  balanceCents: 1_430_000,
  aprBps: 649,
};
const priceyLoan: NextDollarDebt = {
  id: 'acct-personal',
  name: 'Personal Loan',
  kind: 'installment',
  balanceCents: 500_000,
  aprBps: 1200,
};

function plan(over: Partial<NextDollarInput> = {}) {
  return nextDollar({
    debts: [],
    expectedReturnBps: 700,
    returnIsDefault: true,
    runwayMonths: 4.2,
    employerMatch: 'unknown',
    ...over,
  });
}

describe('classifyDebts', () => {
  it('keeps installment loans with a positive balance, including known 0 APR, and skips a null APR', () => {
    const debts = classifyDebts({
      loans: [
        { id: 'l1', name: 'Auto Loan', balanceCents: 1_430_000, aprBps: 649 },
        { id: 'l0', name: 'Paid off', balanceCents: 0, aprBps: 499 },
        { id: 'l2', name: 'Zero-APR', balanceCents: 10_000, aprBps: 0 },
        { id: 'l3', name: 'Unknown APR', balanceCents: 50_000, aprBps: null },
      ],
      pastDueCards: [],
    });
    expect(debts.map((d) => d.id).sort()).toEqual(['l1', 'l2']);
    expect(debts.find((d) => d.id === 'l1')?.kind).toBe('installment');
    expect(debts.find((d) => d.id === 'l2')?.aprBps).toBe(0);
  });

  it('admits a past-due card only with remaining > 0 and APR > 0', () => {
    const debts = classifyDebts({
      loans: [],
      pastDueCards: [
        { id: 'c1', name: 'Store Card', remainingDueCents: cents(4350), aprBps: 3199 },
        { id: 'c2', name: 'Settled', remainingDueCents: cents(0), aprBps: 2499 },
        { id: 'c3', name: 'Promo', remainingDueCents: cents(9000), aprBps: 0 },
        { id: 'c4', name: 'Unknown APR', remainingDueCents: cents(9000), aprBps: null },
      ],
    });
    expect(debts).toEqual([
      {
        id: 'c1',
        name: 'Store Card',
        kind: 'revolving',
        balanceCents: 4350,
        aprBps: 3199,
      },
    ]);
  });
});

describe('nextDollar — EDGE_CASES §Next-dollar', () => {
  it('N1 revolving 31.99% beats a 6.49% loan, a 1.5-month runway, and 7.00% expected return', () => {
    const p = plan({
      debts: [storeCard, autoLoan],
      runwayMonths: 1.5,
    });
    expect(p.destination).toBe('revolving_debt');
    expect(p.debt?.id).toBe('acct-store');
    expect(p.debt?.aprBps).toBe(3199);
    expect(p.skipped).toEqual(['employer_match', 'tax_advantaged']);
  });

  it('N2 uncaptured match beats a thin runway and a loan under the return assumption', () => {
    const p = plan({
      debts: [autoLoan],
      runwayMonths: 1.5,
      employerMatch: 'uncaptured',
    });
    expect(p.destination).toBe('employer_match');
    expect(p.debt).toBeNull();
    expect(p.skipped).toEqual(['tax_advantaged']);
  });

  it('N3 unknown match + runway 1.5 months + 6.49% loan → emergency fund', () => {
    const p = plan({
      debts: [autoLoan],
      runwayMonths: 1.5,
    });
    expect(p.destination).toBe('emergency_fund');
    expect(p.debt).toBeNull();
    expect(p.runwayFloorMonths).toBe(3);
  });

  it('N4 demo shape: 4.2 months runway, 6.49% auto loan, 7.00% return → invest', () => {
    const p = plan({ debts: [autoLoan], runwayMonths: 4.2 });
    expect(p.destination).toBe('invest');
    expect(p.debt).toBeNull();
    expect(p.highestInstallment?.name).toBe('Auto Loan');
    expect(p.highestInstallment?.aprBps).toBe(649);
    expect(p.skipped).toEqual(['employer_match', 'tax_advantaged']);
  });

  it('N5 installment 12.00% beats 7.00% return once runway is at the floor', () => {
    const p = plan({ debts: [priceyLoan, autoLoan], runwayMonths: 4.2 });
    expect(p.destination).toBe('installment_debt');
    expect(p.debt?.id).toBe('acct-personal');
    expect(p.debt?.aprBps).toBe(1200);
  });

  it('N6 APR equal to the return assumption is a wash → invest (strict >)', () => {
    const tied: NextDollarDebt = { ...autoLoan, aprBps: 700 };
    const p = plan({ debts: [tied], runwayMonths: 4.2 });
    expect(p.destination).toBe('invest');
    expect(p.debt).toBeNull();
  });

  it('N7 no debts and unsized runway (no expenses) → invest; both unknown rungs skipped', () => {
    const p = plan({ debts: [], runwayMonths: Infinity });
    expect(p.destination).toBe('invest');
    expect(p.highestInstallment).toBeNull();
    expect(p.skipped).toEqual(['employer_match', 'tax_advantaged']);
  });

  it('N8 a 0% promo revolving card is not an extra-pay destination', () => {
    const promo: NextDollarDebt = {
      id: 'promo',
      name: 'Promo Card',
      kind: 'revolving',
      balanceCents: 90_000,
      aprBps: 0,
    };
    const p = plan({ debts: [promo, autoLoan], runwayMonths: 4.2 });
    expect(p.destination).toBe('invest');
  });

  it('N9 revolving at or under the return assumption falls through to later rungs', () => {
    const cheapCard: NextDollarDebt = {
      id: 'cheap',
      name: 'Cheap Card',
      kind: 'revolving',
      balanceCents: 10_000,
      aprBps: 500,
    };
    const p = plan({ debts: [cheapCard], runwayMonths: 4.2 });
    expect(p.destination).toBe('invest');
  });

  it('N10 non-finite runway does not fire the emergency rung', () => {
    const p = plan({ debts: [autoLoan], runwayMonths: Infinity });
    expect(p.destination).toBe('invest');
  });

  it('the 3-month floor is the same constant the net-worth band uses', () => {
    expect(RUNWAY_FLOOR_MONTHS).toBe(3);
    expect(plan({ runwayMonths: 2.9, debts: [] }).destination).toBe('emergency_fund');
    expect(plan({ runwayMonths: 3, debts: [] }).destination).toBe('invest');
  });

  it('test_regression__w6b_unknown_loan_apr_is_skipped_not_invented_as_zero', () => {
    const p = plan({ debts: [], unknownLoanApr: true, runwayMonths: 4.2 });
    expect(p.destination).toBe('invest');
    expect(p.highestInstallment).toBeNull();
    expect(p.skipped).toContain('loan_apr');
  });
});

describe('copy honesty for 0% / unknown APR (critic P1-2)', () => {
  it('names a known 0% loan instead of denying it exists', async () => {
    const { COACH_COPY } = await import('@/lib/engine/fi/coach-copy');
    const zero: NextDollarDebt = { ...autoLoan, aprBps: 0, name: 'Promo Loan' };
    const p = plan({ debts: [zero], runwayMonths: 4.2 });
    expect(p.destination).toBe('invest');
    const why = COACH_COPY.nextDollarWhy(p);
    expect(why).toContain('Promo Loan');
    expect(why).toContain('0.00% APR');
    expect(why).not.toContain('No installment debt is on file');
  });

  it('unknown APR skip is named, and the why does not invent 0%', async () => {
    const { COACH_COPY } = await import('@/lib/engine/fi/coach-copy');
    const p = plan({ debts: [], unknownLoanApr: true, runwayMonths: 4.2 });
    expect(COACH_COPY.nextDollarSkipped(p)).toContain('we do not invent a rate');
    expect(COACH_COPY.nextDollarWhy(p)).toContain('No installment debt with a known APR is on file');
    expect(COACH_COPY.nextDollarWhy(p)).not.toContain('No installment debt is on file.');
  });
});
