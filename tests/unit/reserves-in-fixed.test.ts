/**
 * C.23 / H.4 — reserves are Fixed, and they are Fixed exactly once.
 *
 * The owner, verbatim: *"other items that aren't explicitly listed as
 * expenditures or fixed are fixed based upon money being reserved every month
 * for home repair… The way I personally categorize yearly membership dues is I
 * divide by 12 and put that cash aside."*
 *
 * H.4 names two acceptance criteria and both are executed here, the second one
 * through the REAL server loader rather than through a hand-built input, because
 * the whole hazard lives in the loader: `plannedSavingsCents` is
 * `max(goalContributions, savingsTarget)` — a floor, never a sum — so a reserve
 * left inside that reduce is committed once as savings and again as Fixed, and
 * the reader's guilt-free line silently shrinks by the reserve. A test that
 * re-derives the loader's expression instead of calling it cannot see that
 * (`a-fix-that-cannot-fail-a-test-is-a-hypothesis`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { getSpendingPlan } from '@/server/spending-plan';
import {
  MAX_RESERVE_COST_CENTS,
  RESERVE_KIND,
  isReserveCadence,
  reserveLabelSuffix,
  reserveTermClause,
  resolveReserves,
} from '@/lib/engine/spending-plan/reserves';
import { computeSpendingPlan, type SpendingPlanInput } from '@/lib/engine/spending-plan/plan';
import { buildFixedList } from '@/lib/engine/spending-plan/fixed-line-items';
import { planRowLabels } from '@/lib/engine/spending-plan/row-labels';

const TODAY = '2026-06-10';
const stamp = `${Date.now()}-${process.pid}`;
const USER = `c23-reserve-${stamp}`;

/** $1,200.00 a year — the owner's own example, and the figure his ÷12 produces. */
const DUES_TRUE_COST = 120_000;
const DUES_MONTHLY = 10_000;
/** A savings goal beside it, so the two can be seen NOT to merge. */
const GOAL_MONTHLY = 25_000;

describe('resolveReserves — the division the reader no longer does', () => {
  it('divides each rhythm by its own period, in integer cents', () => {
    const { lines, monthlyTotalCents, refused } = resolveReserves([
      { id: 'a', name: 'Gym dues', trueCostCents: DUES_TRUE_COST, cadence: 'ANNUAL' },
      { id: 'b', name: 'Water bill', trueCostCents: 30_000, cadence: 'QUARTERLY' },
      { id: 'c', name: 'Insurance', trueCostCents: 60_000, cadence: 'SEMIANNUAL' },
      { id: 'd', name: 'Home repair', trueCostCents: 20_000, cadence: 'MONTHLY' },
    ]);
    expect(refused).toEqual([]);
    const byId = Object.fromEntries(lines.map((l) => [l.id, l.monthlyCents]));
    expect(byId.a).toBe(DUES_MONTHLY); // 120000 / 12
    expect(byId.b).toBe(10_000); // 30000 / 3
    expect(byId.c).toBe(10_000); // 60000 / 6
    expect(byId.d).toBe(20_000); // monthly is itself
    expect(monthlyTotalCents).toBe(50_000);
  });

  /**
   * THE ONE THAT MATTERS MOST. `monthlyRateCents`'s default branch returns the
   * amount unchanged, which is correct for a detected series whose cadence the
   * detector left null and catastrophic for a declaration: a stored 'YEARLY'
   * would enter the plan at TWELVE TIMES its truth, in the direction that eats
   * the reader's whole guilt-free line.
   */
  it('refuses a cadence it does not recognise instead of treating it as monthly', () => {
    const { lines, monthlyTotalCents, refused } = resolveReserves([
      { id: 'a', name: 'Dues', trueCostCents: DUES_TRUE_COST, cadence: 'YEARLY' },
      { id: 'b', name: 'Nothing', trueCostCents: DUES_TRUE_COST, cadence: null },
    ]);
    expect(lines).toEqual([]);
    expect(monthlyTotalCents).toBe(0);
    expect(refused.map((r) => r.reason)).toEqual(['bad-cadence', 'bad-cadence']);
    expect(isReserveCadence('YEARLY')).toBe(false);
    expect(isReserveCadence('ANNUAL')).toBe(true);
  });

  it('refuses a zero, a negative and a non-integer amount, and says which rows', () => {
    const { lines, refused } = resolveReserves([
      { id: 'a', name: 'Zero', trueCostCents: 0, cadence: 'MONTHLY' },
      { id: 'b', name: 'Negative', trueCostCents: -5_000, cadence: 'MONTHLY' },
      { id: 'c', name: 'Fractional', trueCostCents: 10.5, cadence: 'MONTHLY' },
    ]);
    expect(lines).toEqual([]);
    expect(refused.map((r) => r.name)).toEqual(['Zero', 'Negative', 'Fractional']);
    expect(refused.every((r) => r.reason === 'bad-amount')).toBe(true);
  });

  it('every declaration leaves as exactly one line or one refusal', () => {
    const declarations = [
      { id: 'a', name: 'Good', trueCostCents: 12_000, cadence: 'ANNUAL' },
      { id: 'b', name: 'Bad cadence', trueCostCents: 12_000, cadence: 'FORTNIGHTLY' },
      { id: 'c', name: 'Bad amount', trueCostCents: 0, cadence: 'ANNUAL' },
    ];
    const { lines, refused } = resolveReserves(declarations);
    expect(lines.length + refused.length).toBe(declarations.length);
    expect(new Set([...lines.map((l) => l.id), ...refused.map((r) => r.id)]).size).toBe(3);
  });
});

/** A plan input with no history at all, so each test states its own facts. */
function baseInput(over: Partial<SpendingPlanInput> = {}): SpendingPlanInput {
  return {
    today: TODAY as SpendingPlanInput['today'],
    trailingMonthlyIncomeCents: [500_000],
    scheduledIncome: [],
    scheduledFixed: [],
    cardObligationsCents: 0,
    cardObligationsEstimated: false,
    goalContributionsCents: 0,
    savingsTargetBps: null,
    obligationsBeyondMonthCents: 0,
    obligationsBeyondMonthThroughDate: null,
    obligationsBeyondMonthEstimated: false,
    ...over,
  } as SpendingPlanInput;
}

const DUES_LINE = {
  id: 'dues',
  name: 'Gym dues',
  trueCostCents: DUES_TRUE_COST,
  cadence: 'ANNUAL' as const,
  monthlyCents: DUES_MONTHLY,
};

describe('computeSpendingPlan — a reserve is committed once, as Fixed', () => {
  it('enters the fixed term, and the plan identity still sums to income', () => {
    const plan = computeSpendingPlan(baseInput({ reserves: [DUES_LINE] }));
    expect(plan.reserveMonthlyCents).toBe(DUES_MONTHLY);
    expect(plan.fixedExpensesCents).toBe(DUES_MONTHLY);
    expect(plan.suggestedFixedCents).toBe(DUES_MONTHLY);
    // H.4 criterion (2), stated as the identity rather than as a field:
    expect(plan.patternIncomeCents - plan.fixedExpensesCents - plan.plannedSavingsCents).toBe(
      plan.leftToSpendCents,
    );
  });

  /**
   * H.4 criterion (2) proper — the double-count hazard. A reserve is NOT a
   * contribution, so it may not move planned savings by a cent, and the money
   * must appear once in the identity rather than twice.
   */
  it('does not enter planned savings, and does not double-count beside a real goal', () => {
    const withGoal = computeSpendingPlan(
      baseInput({ goalContributionsCents: GOAL_MONTHLY, reserves: [DUES_LINE] }),
    );
    expect(withGoal.plannedSavingsCents).toBe(GOAL_MONTHLY);
    expect(withGoal.fixedExpensesCents).toBe(DUES_MONTHLY);
    // The counterfactual the hazard describes: had the reserve been carried as
    // a goal contribution it would sit inside the max AND in Fixed, and
    // leftToSpend would be DUES_MONTHLY lower than this.
    const asIfContribution = computeSpendingPlan(
      baseInput({
        goalContributionsCents: GOAL_MONTHLY + DUES_MONTHLY,
        reserves: [DUES_LINE],
      }),
    );
    expect(withGoal.leftToSpendCents - asIfContribution.leftToSpendCents).toBe(DUES_MONTHLY);
  });

  it('a savings TARGET floor is untouched by a reserve — the two are different money', () => {
    // 10% of $5,000.00 = $500.00, larger than any goal contribution here.
    const plan = computeSpendingPlan(baseInput({ savingsTargetBps: 1000, reserves: [DUES_LINE] }));
    expect(plan.plannedSavingsCents).toBe(50_000);
    expect(plan.savingsSource).toBe('target');
    expect(plan.leftToSpendCents).toBe(500_000 - 50_000 - DUES_MONTHLY);
  });

  it('with no history the basis is reserves-only — not "none", and not "you set"', () => {
    const plan = computeSpendingPlan(baseInput({ reserves: [DUES_LINE] }));
    expect(plan.fixedBasis).toBe('reserves-only');
    expect(plan.fixedLineItemsCoverRemainder).toBe(true);
    const labels = planRowLabels(plan, {
      undatedCards: [],
      statementPendingCards: [],
      duplicatePairs: [],
      frozenCards: [],
      creditCardCount: 0,
      creditCardsOutsideFigure: 0,
      cardsDatedAfterThisMonth: 0,
      fixedSeries: { detected: 0, counted: 0, onCard: 0, lapsed: 0, uncounted: 0, noCashAccount: 0 },
    });
    expect(labels.fixed.label).toBe('Fixed costs (reserves you declared)');
    // …and it is not silently re-described as a pattern the reader never had.
    expect(labels.fixed.label).not.toContain('monthly pattern');
  });

  it("a typed fixed override does not cancel the reader's separate declaration", () => {
    const plan = computeSpendingPlan(
      baseInput({ fixedOverrideCents: 300_000, reserves: [DUES_LINE] }),
    );
    expect(plan.fixedBasis).toBe('user-set');
    expect(plan.fixedExpensesCents).toBe(300_000 + DUES_MONTHLY);
  });

  /**
   * The override FORM prints the suggestion beside its input and invites the
   * reader to lock it. Printing the reserve-inclusive figure there would have
   * them type a number that then has the reserves added to it AGAIN — the fixed
   * line coming out higher than the figure they just accepted. So the plan
   * publishes the half the input actually replaces, and the view never
   * subtracts anything itself.
   */
  it('publishes the pattern half separately, for the control that replaces only that half', () => {
    const plan = computeSpendingPlan(
      baseInput({ trailingMonthlyFixedCents: [200_000], reserves: [DUES_LINE] }),
    );
    expect(plan.patternFixedCents).toBe(200_000);
    expect(plan.suggestedFixedCents).toBe(200_000 + DUES_MONTHLY);
    expect(plan.suggestedFixedCents - plan.patternFixedCents).toBe(plan.reserveMonthlyCents);
  });

  it('no reserves changes nothing: every figure and label is what it was', () => {
    const without = computeSpendingPlan(baseInput());
    expect(without.reserveMonthlyCents).toBe(0);
    expect(without.reserveLines).toEqual([]);
    expect(without.fixedBasis).toBe('none');
    expect(reserveLabelSuffix(0)).toBe('');
    expect(reserveTermClause(0)).toBe('');
  });
});

describe('buildFixedList — the reserve is a LINE, beside the mortgage', () => {
  /**
   * H.4 criterion (1), on the shape the owner actually has: a mortgage unioned
   * at its full monthly rate (C.24) and a declared yearly reserve, both visible
   * as their own lines, with the printed total equal to the plan's figure.
   */
  it('lists a declared reserve at cost/12 alongside a unioned mortgage, and reconciles', () => {
    const MORTGAGE = 621_707;
    const plan = computeSpendingPlan(
      baseInput({
        categoryFixedCents: 0,
        scheduledFixed: [
          {
            merchantCanonical: 'ROCKET MORTGAGE',
            amountCents: -MORTGAGE,
            cadence: 'MONTHLY',
            categoryId: 'rent',
          },
        ] as SpendingPlanInput['scheduledFixed'],
        reserves: [DUES_LINE],
      }),
    );
    expect(plan.fixedBasis).toBe('detected-series');
    expect(plan.fixedExpensesCents).toBe(MORTGAGE + DUES_MONTHLY);

    const list = buildFixedList({
      plan,
      rollupRows: [],
      nameOfCategory: (id) => id,
    });
    const reserve = list.lines.find((l) => l.kind === 'reserve');
    const mortgage = list.lines.find((l) => l.kind === 'recurring-bill');
    expect(mortgage?.amountCents).toBe(MORTGAGE);
    expect(reserve?.label).toBe('Gym dues');
    expect(reserve?.amountCents).toBe(DUES_MONTHLY);
    expect(reserve?.reserveTrueCostCents).toBe(DUES_TRUE_COST);
    // The line explains its own division, because the figure listed is NOT an
    // amount the reader will ever pay at once.
    expect(reserve?.basisNote).toContain('a twelfth of the yearly cost');
    expect(list.totalCents).toBe(MORTGAGE + DUES_MONTHLY);
    expect(list.reconciles).toBe(true);
    expect(list.unaccountedCents).toBe(0);
  });

  it('a MONTHLY reserve is given no qualifier — there is nothing to qualify', () => {
    const plan = computeSpendingPlan(
      baseInput({
        reserves: [
          { id: 'r', name: 'Home repair', trueCostCents: 20_000, cadence: 'MONTHLY', monthlyCents: 20_000 },
        ],
      }),
    );
    const list = buildFixedList({ plan, rollupRows: [], nameOfCategory: (id) => id });
    expect(list.lines[0]!.basisNote).toBeNull();
  });

  it("under a typed figure the note corrects itself: the reserve is added, not merely suggested", () => {
    const plan = computeSpendingPlan(
      baseInput({ fixedOverrideCents: 300_000, reserves: [DUES_LINE] }),
    );
    const list = buildFixedList({ plan, rollupRows: [], nameOfCategory: (id) => id });
    expect(list.note).toContain('you set yourself');
    expect(list.note).toContain('added on top of the figure you set');
  });
});

/**
 * CRITIC CYCLE 1 — the findings that were EXECUTED against the first cut. Each
 * of these failed before its fix; none is a restatement of a rule.
 */
describe('critic cycle 1 — what the first cut got wrong', () => {
  /**
   * P0-1, and the sharpest thing in this slice: `kind: { not: 'reserve' }` reads
   * as "everything else" and is not. SQL three-valued logic makes
   * `kind <> 'reserve'` NULL for a `kind IS NULL` row, and an ordinary savings
   * goal is EXACTLY that — so the tidy predicate deleted every savings goal from
   * /goals and from the coach's automation blueprint, a feature this slice does
   * not touch. Executed: a three-goal user saw one.
   */
  it('P0-1: excluding reserves in SQL must not exclude NULL-kind savings goals', async () => {
    const u = `${USER}-p0`;
    await prisma.user.deleteMany({ where: { id: u } });
    await prisma.user.create({ data: { id: u, email: `${u}@test.local` } });
    try {
      await prisma.goal.create({ data: { userId: u, name: 'Savings', targetCents: 100_000 } });
      await prisma.goal.create({
        data: { userId: u, name: 'Debt', kind: 'debt_free', targetCents: 100_000 },
      });
      await prisma.goal.create({
        data: { userId: u, name: 'Res', kind: RESERVE_KIND, targetCents: 100_000, cadence: 'ANNUAL' },
      });
      // The naive predicate, kept here as the CONTROL that shows the defect.
      const naive = await prisma.goal.findMany({
        where: { userId: u, kind: { not: RESERVE_KIND } },
        select: { name: true },
      });
      expect(naive.map((g) => g.name)).not.toContain('Savings');
      // The predicate both call sites now use.
      const correct = await prisma.goal.findMany({
        where: { userId: u, OR: [{ kind: null }, { kind: { not: RESERVE_KIND } }] },
        select: { name: true },
      });
      expect(correct.map((g) => g.name).sort()).toEqual(['Debt', 'Savings']);
    } finally {
      await prisma.goal.deleteMany({ where: { userId: u } });
      await prisma.user.deleteMany({ where: { id: u } });
    }
  });

  /**
   * P2-1: a positive cost whose monthly share rounds to nothing. Admitted, it
   * printed a $0.00 line, left the basis at 'none' while a line existed, and
   * walked `buildFixedList` into the one state its ladder has no branch for —
   * an EMPTY note, where the type promises a sentence in every case.
   */
  it('P2-1: a cost too small to have a monthly share is refused, and the list still speaks', () => {
    const { lines, refused } = resolveReserves([
      { id: 'tiny', name: 'Almost nothing', trueCostCents: 5, cadence: 'ANNUAL' },
    ]);
    expect(lines).toEqual([]);
    expect(refused).toEqual([{ id: 'tiny', name: 'Almost nothing', reason: 'rounds-to-zero' }]);
    const plan = computeSpendingPlan(baseInput({ reserves: lines }));
    const list = buildFixedList({ plan, rollupRows: [], nameOfCategory: (id) => id });
    expect(list.note).not.toBe('');
  });
});

/**
 * THE SHARED-DEMO FENCE. `user-demo` is ONE row every anonymous visitor signs
 * into, so a reserve typed there is one stranger's real commitment appearing
 * inside the next visitor's fixed costs and moving their guilt-free figure.
 * This is the typed-figures leg of `shared-demo-account-must-not-learn`, the
 * same rule `updatePlanFigures` applies on the very same page.
 */
describe('createReserve — the shared demo cannot be given a stranger’s commitment', () => {
  const ACTOR = `${USER}-actor`;
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: ACTOR } });
    await prisma.user.create({ data: { id: ACTOR, email: `${ACTOR}@test.local` } });
  }, 60_000);
  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: ACTOR } });
    await prisma.user.deleteMany({ where: { id: ACTOR } });
  });
  /** P1-2: `Goal.targetCents` is a Postgres `integer`. `parseDollarInput`
   *  accepts far more, so without a cap the row is written on the SQLite test
   *  datasource and THROWS on INSERT in production — where the form's catch-all
   *  reloads the page showing no reserve and no error. */
  it('P1-2: a cost larger than the column can hold is refused in words, not at the DB', async () => {
    const { createReserve } = await import('@/server/reserve-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(ACTOR);
    try {
      expect(MAX_RESERVE_COST_CENTS).toBe(2_147_483_647);
      const fd = new FormData();
      fd.set('name', 'Too big');
      fd.set('amount', '99999999999');
      fd.set('cadence', 'ANNUAL');
      const res = await createReserve(null, fd);
      expect(res.ok).toBe(false);
      expect(res.errors?.amount).toContain('larger than this field can hold');
      expect(await prisma.goal.count({ where: { userId: ACTOR, name: 'Too big' } })).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  /** P1-3: /dashboard renders `fixedExpensesCents` through `SafeToSpendCard`, so
   *  a reserve added on /spending-plan left the home page contradicting it. */
  it('P1-3: the write revalidates every route that renders the figure it moves', async () => {
    const { createReserve } = await import('@/server/reserve-actions');
    const { revalidatePath } = await import('next/cache');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(ACTOR);
    vi.mocked(revalidatePath).mockClear();
    try {
      const fd = new FormData();
      fd.set('name', 'Revalidation probe');
      fd.set('amount', '120');
      fd.set('cadence', 'MONTHLY');
      const res = await createReserve(null, fd);
      expect(res.ok).toBe(true);
      const paths = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
      expect(paths).toContain('/spending-plan');
      expect(paths).toContain('/dashboard');
      expect(paths).toContain('/budgets');
    } finally {
      await prisma.goal.deleteMany({ where: { userId: ACTOR, name: 'Revalidation probe' } });
      spy.mockRestore();
    }
  });

  it('refuses the demo account, and writes nothing', async () => {
    const { createReserve } = await import('@/server/reserve-actions');
    const { DEMO_USER_ID } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(DEMO_USER_ID);
    try {
      const before = await prisma.goal.count({ where: { userId: DEMO_USER_ID } });
      const fd = new FormData();
      fd.set('name', 'Home repair');
      fd.set('amount', '1200');
      fd.set('cadence', 'ANNUAL');
      const res = await createReserve(null, fd);
      expect(res.ok).toBe(false);
      expect(res.error).toContain('shared account');
      expect(await prisma.goal.count({ where: { userId: DEMO_USER_ID } })).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * THE LOADER LOCK. `SpendingPlanInput.reserves` is optional, so nothing in the
 * type system makes the one production caller pass it — this is what stands in
 * for that. Deleting `reserves: reserves.lines` from `server/spending-plan.ts`,
 * or deleting the `kind !== RESERVE_KIND` filter beside it, must fail here.
 */
describe('getSpendingPlan — a stored reserve row reaches the plan (and only once)', () => {
  let priorDemoToday: string | undefined;

  beforeAll(async () => {
    priorDemoToday = process.env.DEMO_TODAY;
    process.env.DEMO_TODAY = TODAY;
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    await prisma.account.create({
      data: {
        userId: USER,
        provider: 'demo',
        name: 'Checking',
        type: 'CHECKING',
        currentBalanceCents: 500_000,
      },
    });
    await prisma.goal.create({
      data: {
        userId: USER,
        name: 'Gym dues',
        kind: RESERVE_KIND,
        targetCents: DUES_TRUE_COST,
        cadence: 'ANNUAL',
        savedCents: 0,
        monthlyContributionCents: null,
      },
    });
    await prisma.goal.create({
      data: {
        userId: USER,
        name: 'Emergency fund',
        targetCents: 1_000_000,
        savedCents: 0,
        monthlyContributionCents: GOAL_MONTHLY,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
    if (priorDemoToday === undefined) delete process.env.DEMO_TODAY;
    else process.env.DEMO_TODAY = priorDemoToday;
  });

  it('the stored reserve is in the fixed figure, in the list, and out of savings', async () => {
    const plan = await getSpendingPlan(USER);
    expect(plan.reserveMonthlyCents).toBe(DUES_MONTHLY);
    expect(plan.reserveLines.map((r) => r.name)).toEqual(['Gym dues']);
    expect(plan.fixedExpensesCents).toBeGreaterThanOrEqual(DUES_MONTHLY);
    // The savings goal beside it is untouched, and the reserve is NOT in it.
    expect(plan.plannedSavingsCents).toBe(GOAL_MONTHLY);
    expect(plan.fixedList.lines.some((l) => l.kind === 'reserve' && l.label === 'Gym dues')).toBe(
      true,
    );
    expect(plan.refusedReserves).toEqual([]);
  });

  /**
   * The explicit `kind !== RESERVE_KIND` filter, locked against the only thing
   * that can break it. Today's writer stores `monthlyContributionCents: null` on
   * a reserve, so the filter appears redundant and the sum would come out the
   * same without it — which is exactly how a defence gets deleted as dead code.
   * A row carrying BOTH (a hand-edited row, a future writer, an import) is the
   * case the filter is for, and only the filter keeps that money out of savings
   * while it is already in Fixed.
   */
  it('a reserve carrying a stray contribution is still not savings', async () => {
    const stray = await prisma.goal.create({
      data: {
        userId: USER,
        name: 'Roof fund',
        kind: RESERVE_KIND,
        targetCents: 24_000,
        cadence: 'MONTHLY',
        savedCents: 0,
        monthlyContributionCents: 24_000,
      },
    });
    try {
      const plan = await getSpendingPlan(USER);
      expect(plan.plannedSavingsCents).toBe(GOAL_MONTHLY);
      expect(plan.reserveMonthlyCents).toBe(DUES_MONTHLY + 24_000);
    } finally {
      await prisma.goal.delete({ where: { id: stray.id } });
    }
  });

  it('a reserve stored with an unreadable cadence is refused OUT LOUD, not counted', async () => {
    const bad = await prisma.goal.create({
      data: {
        userId: USER,
        name: 'Broken dues',
        kind: RESERVE_KIND,
        targetCents: DUES_TRUE_COST,
        cadence: 'YEARLY',
        savedCents: 0,
        monthlyContributionCents: null,
      },
    });
    try {
      const plan = await getSpendingPlan(USER);
      expect(plan.reserveMonthlyCents).toBe(DUES_MONTHLY); // unchanged — not 12x
      expect(plan.refusedReserves.map((r) => r.name)).toEqual(['Broken dues']);
    } finally {
      await prisma.goal.delete({ where: { id: bad.id } });
    }
  });
});
