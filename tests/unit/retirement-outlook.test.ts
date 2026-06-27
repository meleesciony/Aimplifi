/**
 * Retirement outlook server glue (DECISIONS #122). getRetirementOutlook maps the SAME
 * figures /coach shows (getCoachData) into the pure projectRetirement engine. These
 * tests lock the mapping (no swapped return/SWR), the negative-savings floor, the
 * hasData gate, and that the returned projection is byte-identical to running the
 * engine on the grounded inputs (no drift). getCoachData is mocked so this stays a
 * fast, deterministic unit test of the wiring — the engine + coach are tested elsewhere.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/coach', () => ({ getCoachData: vi.fn() }));

import { auth } from '@/auth';
import { getCoachData } from '@/server/coach';
import { getRetirementOutlook } from '@/server/investments';
import { RETIREMENT_ASSUMPTIONS, projectRetirement } from '@/lib/engine/investments/retirement';
import { cents } from '@/lib/money';

type CoachShape = Awaited<ReturnType<typeof getCoachData>>;

const mockCoach = (fi: Record<string, unknown>): void => {
  vi.mocked(getCoachData).mockResolvedValue({
    fi: {
      fiNumberCents: cents(0),
      monthlyIncomeCents: cents(0),
      monthsToFI: null,
      coastIsCoast: false,
      coastRequiredMonthlyCents: null,
      coastTargetYears: 25,
      ...fi,
    },
  } as unknown as CoachShape);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: 'ret-user' } } as never);
});

describe('getRetirementOutlook — grounded mapping', () => {
  it('feeds coach figures to the engine and returns the engine output verbatim', async () => {
    mockCoach({
      portfolioCents: cents(14_200_000),
      annualExpensesCents: cents(6_000_000),
      monthlySavingsCents: cents(120_000),
      expectedReturnBps: 700,
      swrBps: 400,
    });

    const outlook = await getRetirementOutlook();
    const { currentAge, retirementAge, endAge, inflationBps } = RETIREMENT_ASSUMPTIONS;
    const realReturnBps = 700 - inflationBps; // nominal − inflation → today's-dollars projection

    // getCoachData must be scoped to the authenticated user (no hardcoded/other id).
    expect(getCoachData).toHaveBeenCalledWith('ret-user');

    expect(outlook.inputs).toEqual({
      currentAge,
      retirementAge,
      endAge,
      currentPortfolioCents: 14_200_000,
      monthlyContributionCents: 120_000,
      annualRetirementSpendingCents: 6_000_000,
      annualReturnBps: realReturnBps,
      nominalReturnBps: 700,
      inflationBps,
      swrBps: 400,
    });
    expect(outlook.hasData).toBe(true);

    // No drift: the projection must equal the engine run on exactly those inputs (real return).
    const expected = projectRetirement({
      currentPortfolioCents: cents(14_200_000),
      currentAge,
      retirementAge,
      endAge,
      monthlyContributionCents: cents(120_000),
      annualRetirementSpendingCents: cents(6_000_000),
      annualReturnBps: realReturnBps,
      swrBps: 400,
    });
    expect(outlook.projection).toEqual(expected);
  });

  it('floors negative monthly savings (spending > income) to a $0 contribution', async () => {
    mockCoach({
      portfolioCents: cents(5_000_000),
      annualExpensesCents: cents(4_800_000),
      monthlySavingsCents: cents(-50_000), // overspending
      expectedReturnBps: 600,
      swrBps: 350,
    });

    const outlook = await getRetirementOutlook();
    expect(outlook.inputs.monthlyContributionCents).toBe(0);
    expect(outlook.hasData).toBe(true); // still has a portfolio to project
  });

  it('reports no data when there is neither a portfolio nor ongoing savings', async () => {
    mockCoach({
      portfolioCents: cents(0),
      annualExpensesCents: cents(3_600_000),
      monthlySavingsCents: cents(-10_000),
      expectedReturnBps: 700,
      swrBps: 400,
    });

    const outlook = await getRetirementOutlook();
    expect(outlook.hasData).toBe(false);
    expect(outlook.inputs.currentPortfolioCents).toBe(0);
    expect(outlook.inputs.monthlyContributionCents).toBe(0);
  });
});
