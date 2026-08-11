/**
 * Retirement outlook server glue (DECISIONS #122). getRetirementOutlook maps the SAME
 * figures /coach shows (getCoachData) into the pure projectRetirement engine. These
 * tests lock the mapping (no swapped return/SWR), the negative-savings floor, the
 * hasData gate, and that the returned projection is byte-identical to running the
 * engine on the grounded inputs (no drift). getCoachData is mocked so this stays a
 * fast, deterministic unit test of the wiring — the engine + coach are tested elsewhere.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/coach', () => ({ getCoachData: vi.fn() }));

import { auth } from '@/auth';
import { getCoachData } from '@/server/coach';
import { getRetirementOutlook } from '@/server/investments';
import {
  RETIREMENT_ASSUMPTIONS,
  buildRetirementInputs,
  projectRetirement,
} from '@/lib/engine/investments/retirement';
import { cents } from '@/lib/money';
import { prisma } from '@/lib/db';

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
    // Audit P2 — the frozen-account qualifier the outlook now threads through:
    // empty by default (nothing frozen → no note), overridable per test.
    frozenBalances: { portfolio: [], liquid: [] },
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
      // O.20d-FU F2 — the UNCLAMPED sum, equal to the clamped one whenever the
      // portfolio is non-negative (the case here). It exists so the
      // age-currentAge panel can tell a real $0.00 apart from a floored one; the
      // divergent case is locked in the margin-balance test below.
      rawPortfolioCents: 14_200_000,
      monthlyContributionCents: 120_000,
      annualRetirementSpendingCents: 6_000_000,
      annualReturnBps: realReturnBps,
      nominalReturnBps: 700,
      // W.13 — the mocked coach data leaves `expectedReturnBps` at the app's own 700, so the
      // outlook copy may not call it "your expected return". The exhaustive `toEqual` is what
      // makes this field unforgettable: a new input that the card can print has to be answered
      // here before the suite goes green.
      returnIsDefault: true,
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

  it('O.20d-FU F2 — a margin balance is floored for the projection but carried raw for the copy', async () => {
    // One INVESTMENT account with a −$5,000.00 margin balance. The projection
    // must start from $0.00 (a negative balance cannot be compounded forward),
    // but the panel that PRINTS that $0.00 has to know it is a clamp: the old
    // copy called it "the live balance of your investment accounts today",
    // misstating the reader's position by $5,000.00 in the flattering direction.
    mockCoach({
      portfolioCents: cents(-500_000),
      annualExpensesCents: cents(4_800_000),
      monthlySavingsCents: cents(100_000),
      expectedReturnBps: 700,
      swrBps: 400,
    });

    const outlook = await getRetirementOutlook();
    expect(outlook.inputs.currentPortfolioCents).toBe(0); // what the engine compounds
    expect(outlook.inputs.rawPortfolioCents).toBe(-500_000); // what the reader actually holds
    // The two must be able to disagree — a `rawPortfolioCents` sourced from the
    // clamped value would pass every other assertion in this file.
    expect(outlook.inputs.rawPortfolioCents).not.toBe(outlook.inputs.currentPortfolioCents);
    expect(outlook.hasData).toBe(true); // the contribution alone still renders the card
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

  it('uses the documented defaults when the user has not customized the plan', async () => {
    // auth is 'ret-user' (no such row) → planning fields resolve to RETIREMENT_ASSUMPTIONS.
    mockCoach({
      portfolioCents: cents(10_000_000),
      annualExpensesCents: cents(4_000_000),
      monthlySavingsCents: cents(80_000),
      expectedReturnBps: 700,
      swrBps: 400,
    });
    const outlook = await getRetirementOutlook();
    expect(outlook.inputs.currentAge).toBe(RETIREMENT_ASSUMPTIONS.currentAge);
    expect(outlook.inputs.retirementAge).toBe(RETIREMENT_ASSUMPTIONS.retirementAge);
    expect(outlook.inputs.endAge).toBe(RETIREMENT_ASSUMPTIONS.endAge);
    expect(outlook.inputs.inflationBps).toBe(RETIREMENT_ASSUMPTIONS.inflationBps);
  });

  it('threads the frozen-portfolio qualifier only when a portfolio account is frozen (audit P2)', async () => {
    mockCoach({
      portfolioCents: cents(14_200_000),
      annualExpensesCents: cents(6_000_000),
      monthlySavingsCents: cents(120_000),
      expectedReturnBps: 700,
      swrBps: 400,
    });

    // Nothing frozen → no note (the empty mockCoach default).
    const quiet = await getRetirementOutlook();
    expect(quiet.frozenPortfolioNote).toBeNull();

    // One frozen INVESTMENT row → the note names it and the figure it qualifies.
    mockCoach({
      portfolioCents: cents(14_200_000),
      annualExpensesCents: cents(6_000_000),
      monthlySavingsCents: cents(120_000),
      expectedReturnBps: 700,
      swrBps: 400,
    });
    vi.mocked(getCoachData).mockResolvedValueOnce({
      fi: {
        fiNumberCents: cents(0),
        monthlyIncomeCents: cents(0),
        monthsToFI: null,
        coastIsCoast: false,
        coastRequiredMonthlyCents: null,
        coastTargetYears: 25,
        portfolioCents: cents(14_200_000),
        annualExpensesCents: cents(6_000_000),
        monthlySavingsCents: cents(120_000),
        expectedReturnBps: 700,
        swrBps: 400,
      },
      frozenBalances: {
        portfolio: [{ label: 'My Brokerage', frozenSince: '2026-05-01' }],
        liquid: [],
      },
    } as unknown as CoachShape);
    const frozen = await getRetirementOutlook();
    expect(frozen.frozenPortfolioNote).not.toBeNull();
    expect(frozen.frozenPortfolioNote).toContain('My Brokerage');
    expect(frozen.frozenPortfolioNote).toContain('the portfolio these projections start from');
  });
});

describe('getRetirementOutlook — user-edited planning assumptions (DECISIONS #123)', () => {
  const PLAN_USER = `ret-plan-${Date.now()}-${process.pid}`;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: PLAN_USER } });
    await prisma.user.create({
      data: {
        id: PLAN_USER,
        email: `${PLAN_USER}@test.local`,
        currentAge: 30,
        retirementAge: 55,
        endAge: 90,
        inflationBps: 300,
      },
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: PLAN_USER } });
  });

  it('feeds the user’s saved ages + inflation to the engine instead of the defaults', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: PLAN_USER } } as never);
    mockCoach({
      portfolioCents: cents(20_000_000),
      annualExpensesCents: cents(7_200_000),
      monthlySavingsCents: cents(200_000),
      expectedReturnBps: 800,
      swrBps: 400,
    });

    const outlook = await getRetirementOutlook();
    expect(outlook.inputs.currentAge).toBe(30);
    expect(outlook.inputs.retirementAge).toBe(55);
    expect(outlook.inputs.endAge).toBe(90);
    expect(outlook.inputs.inflationBps).toBe(300);
    expect(outlook.inputs.annualReturnBps).toBe(500); // nominal 800 − inflation 300

    // No drift: identical to running the shared builder + engine on those exact inputs.
    const expected = projectRetirement(
      buildRetirementInputs(
        {
          currentPortfolioCents: 20_000_000,
          monthlyContributionCents: 200_000,
          annualRetirementSpendingCents: 7_200_000,
          nominalReturnBps: 800,
          swrBps: 400,
        },
        { currentAge: 30, retirementAge: 55, endAge: 90, inflationBps: 300 },
      ),
    );
    expect(outlook.projection).toEqual(expected);
  });
});
