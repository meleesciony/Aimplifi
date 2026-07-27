/**
 * getSpendingPlan — the L.22 pattern re-spec (owner instruction 2026-07-26),
 * driven through the REAL server path against a throwaway user (a pure-builder
 * test cannot catch a wiring bug — the L.15 lesson). Locks the claims the
 * re-spec makes, plus the critic-cycle fixes that survive it:
 *
 *  1. THE PATTERN: income is the median of complete PRIOR months over
 *     non-credit accounts — the current month's own paycheck is deliberately
 *     NOT in it, a one-time spike is median-immune, and (critic F5) a
 *     credit-card POSITIVE (cashback / statement credit) is not income either.
 *  2. NO OCCURRENCE MATH: a scheduled biweekly paycheck series does not move
 *     the pattern (the F4 windowing the owner hit is gone from the plan; the
 *     walk survives only in the L.11(D) beyond-month reservation).
 *  3. THE MONTH WINDOW (critic F1): only obligations DUE THIS CALENDAR MONTH
 *     are subtracted — a statement due next month is reserved against next
 *     month's income, never two months'.
 *  4. THE SETTINGS WIRING: `User.savingsTargetBps` reaches the engine, is a
 *     FLOOR over goals (never a sum), and its unallocated reserve is carried.
 *  5. DISCLOSURES: an undatable OWING card is excluded from the term and
 *     NAMED (the dangerous direction); an overpaid undated card is NOT named
 *     under that claim (critic F8); a statement-pending card due this month
 *     is named with its own mechanism (critic F2).
 *
 * NOTE liability balances are stored POSITIVE-owing (seed convention).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSpendingPlan } from '@/server/spending-plan';
import { getCashNeeded } from '@/server/finance';
import { traceSafeToSpend } from '@/lib/engine/glass-box/trace';
import { prisma } from '@/lib/db';

const TODAY = '2026-06-10';

describe('getSpendingPlan — guilt-free spending (L.22), real server path', () => {
  const uid = `gfs-${Date.now()}-${process.pid}`;
  let checkingId = '';
  let cardId = '';

  const wipe = async () => {
    await prisma.goal.deleteMany({ where: { userId: uid } });
    await prisma.account.deleteMany({ where: { userId: uid } }); // cascades transactions/statements/scheduled
    await prisma.user.deleteMany({ where: { id: uid } });
  };

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: uid, email: `${uid}@test.local` } });
    const checking = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'manual',
        providerRef: `${uid}-chk`,
        name: 'Everyday Checking',
        type: 'CHECKING',
        currentBalanceCents: 800000,
        currency: 'USD',
      },
    });
    checkingId = checking.id;
    await prisma.user.update({ where: { id: uid }, data: { paymentAccountId: checkingId } });
    const card = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'manual',
        providerRef: `${uid}-card`,
        name: 'Rewards Card',
        type: 'CREDIT',
        currentBalanceCents: 30000, // owes $300 (stored positive)
        currency: 'USD',
      },
    });
    cardId = card.id;
    // Income lands in checking in the two COMPLETE months (the pattern's basis)
    // AND in the current one (deliberately NOT in the pattern — L.22). A card
    // PURCHASE posts on the credit account (no term for it anywhere), and a
    // card CASHBACK posts positive on the credit account in May (must not
    // count as income — critic F5).
    await prisma.transaction.createMany({
      data: [
        { accountId: checkingId, date: '2026-04-03', amountCents: 500000, rawDescriptor: 'ACME PAYROLL', categoryId: 'income', confidenceBps: 9900, needsReview: false },
        { accountId: checkingId, date: '2026-05-03', amountCents: 500000, rawDescriptor: 'ACME PAYROLL', categoryId: 'income', confidenceBps: 9900, needsReview: false },
        { accountId: checkingId, date: '2026-06-03', amountCents: 500000, rawDescriptor: 'ACME PAYROLL', categoryId: 'income', confidenceBps: 9900, needsReview: false },
        { accountId: checkingId, date: '2026-06-05', amountCents: -40000, rawDescriptor: 'GROCERY MART', categoryId: 'groceries', confidenceBps: 9000, needsReview: false },
        { accountId: cardId, date: '2026-06-06', amountCents: -25000, rawDescriptor: 'BIG BOX STORE', categoryId: 'shopping', confidenceBps: 9000, needsReview: false },
        { accountId: cardId, date: '2026-05-07', amountCents: 5000, rawDescriptor: 'CASHBACK REWARD', categoryId: null, confidenceBps: 0, needsReview: false },
      ],
    });
    // The card's generated statement: $300.00 due June 25 → due THIS month.
    await prisma.statement.create({
      data: {
        accountId: cardId,
        cycleStart: '2026-05-06',
        cycleEnd: '2026-06-05',
        dueDate: '2026-06-25',
        statementBalanceCents: 30000,
        minimumPaymentCents: 3500,
      },
    });
  });
  afterAll(async () => {
    await wipe();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    vi.stubEnv('DEMO_TODAY', TODAY);
  });

  it('the pattern reads complete months only — current-month income, card spend, and cashback are all out of it', async () => {
    const plan = await getSpendingPlan(uid);

    // (1) The median of April + May — the June paycheck is deliberately NOT in
    // the pattern, and the May cashback on the CARD is not income (critic F5:
    // if it were, May would read $5,050 and the median would move).
    expect(plan.trailingMonthlyIncomeCents).toEqual([500000, 500000]);
    expect(plan.patternIncomeCents).toBe(500000);
    expect(plan.incomeBasis).toBe('trailing-median');
    expect(plan.incomeMonths).toBe(2);
    // No detected recurring series in this fixture → no fixed term.
    expect(plan.fixedExpensesCents).toBe(0);
    // (3) The statement due June 25 is this month's obligation.
    expect(plan.cardObligationsCents).toBe(30000);
    expect(plan.cardObligationsEstimated).toBe(false);
    // Full identity: 5000 (pattern) − 0 (fixed) − 300 (card) − 0 (savings).
    expect(plan.plannedSavingsCents).toBe(0);
    expect(plan.leftToSpendCents).toBe(470000);
    // No suspected duplicates, nothing frozen, nothing excluded.
    expect(plan.disclosures.duplicatePairs).toEqual([]);
    expect(plan.disclosures.frozenCards).toEqual([]);
    expect(plan.disclosures.undatedCards).toEqual([]);
    expect(plan.disclosures.statementPendingCards).toEqual([]);
  });

  it('a statement due NEXT month is not reserved against this month (critic F1)', async () => {
    const border = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'manual',
        providerRef: `${uid}-border`,
        name: 'Border Card',
        type: 'CREDIT',
        currentBalanceCents: 90000,
        currency: 'USD',
      },
    });
    await prisma.statement.create({
      data: {
        accountId: border.id,
        cycleStart: '2026-05-16',
        cycleEnd: '2026-06-15',
        dueDate: '2026-07-10', // next month
        statementBalanceCents: 90000,
        minimumPaymentCents: 3500,
      },
    });
    try {
      const plan = await getSpendingPlan(uid);
      // June's plan reserves only the June-due $300 — the $900 due July 10 is
      // July's income's problem, not June's AND July's (the F1 double-reserve).
      expect(plan.cardObligationsCents).toBe(30000);
      // It is not "excluded and silent" either: it is simply next month's due,
      // which no disclosure needs to apologize for (it has a real statement).
      expect(plan.disclosures.statementPendingCards).toEqual([]);
    } finally {
      await prisma.account.delete({ where: { id: border.id } });
    }
  });

  it('the Settings savings target reaches the engine, is a FLOOR over goals, and carries its reserve', async () => {
    await prisma.user.update({ where: { id: uid }, data: { savingsTargetBps: 2000 } });
    await prisma.goal.create({
      data: { userId: uid, name: 'Emergency fund', targetCents: 1000000, savedCents: 0, monthlyContributionCents: 50000 },
    });
    try {
      const plan = await getSpendingPlan(uid);
      // 20% of $5,000 pattern = $1,000 > $500 goal contribution → the target wins.
      expect(plan.savingsTargetBps).toBe(2000);
      expect(plan.goalContributionsCents).toBe(50000);
      expect(plan.plannedSavingsCents).toBe(100000);
      expect(plan.savingsSource).toBe('target');
      expect(plan.unallocatedSavingsCents).toBe(50000); // the reserve beyond named goals (critic F3)
      expect(plan.leftToSpendCents).toBe(370000); // 470000 − 100000
    } finally {
      await prisma.goal.deleteMany({ where: { userId: uid } });
      await prisma.user.update({ where: { id: uid }, data: { savingsTargetBps: null } });
    }
  });

  it('NO OCCURRENCE MATH: a scheduled biweekly paycheck series does not move the pattern (L.22)', async () => {
    // The F4 windowing the owner hit — a series counted once per remaining
    // occurrence — is gone from the plan's income term. The series below would
    // have added $5,000 under the old model; under the pattern it changes
    // nothing (it feeds only the no-history fallback and the L.11(D) walk).
    await prisma.scheduledTransaction.create({
      data: {
        accountId: checkingId,
        description: 'ACME PAYROLL',
        amountCents: 250000,
        nextDate: '2026-06-12',
        cadence: 'BIWEEKLY',
        source: 'payroll-detected',
      },
    });
    try {
      const plan = await getSpendingPlan(uid);
      expect(plan.patternIncomeCents).toBe(500000); // unchanged — the median rules
      expect(plan.incomeBasis).toBe('trailing-median');
    } finally {
      await prisma.scheduledTransaction.deleteMany({ where: { accountId: checkingId } });
    }
  });

  it('the detected-series fallback engages only when NO complete month exists', async () => {
    // New user, no history, one detected paycheck series: income is the series
    // at a monthly rate — not zero, and not "this month so far".
    const fresh = `${uid}-fresh`;
    await prisma.user.create({ data: { id: fresh, email: `${fresh}@test.local` } });
    const chk = await prisma.account.create({
      data: { userId: fresh, provider: 'manual', providerRef: `${fresh}-chk`, name: 'Checking', type: 'CHECKING', currentBalanceCents: 100000, currency: 'USD' },
    });
    await prisma.user.update({ where: { id: fresh }, data: { paymentAccountId: chk.id } });
    await prisma.scheduledTransaction.create({
      data: {
        accountId: chk.id,
        description: 'ACME PAYROLL',
        amountCents: 250000,
        nextDate: '2026-06-12',
        cadence: 'BIWEEKLY',
        source: 'payroll-detected',
      },
    });
    try {
      const plan = await getSpendingPlan(fresh);
      // 250000 × 26/12 = 541666.67 → 541667, half-up.
      expect(plan.patternIncomeCents).toBe(541667);
      expect(plan.incomeBasis).toBe('detected-series');
      expect(plan.incomeMonths).toBe(0);
    } finally {
      await prisma.account.deleteMany({ where: { userId: fresh } });
      await prisma.user.delete({ where: { id: fresh } });
    }
  });

  it('an undatable OWING card is excluded from the term AND named; an OVERPAID one is not (critic F8)', async () => {
    const ghost = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'manual',
        providerRef: `${uid}-ghost`,
        name: 'Ghost Card',
        type: 'CREDIT',
        currentBalanceCents: 50000, // owes $500, no statement, no cycle days
        currency: 'USD',
      },
    });
    const overpaid = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'manual',
        providerRef: `${uid}-overpaid`,
        name: 'Overpaid Card',
        type: 'CREDIT',
        currentBalanceCents: -2000, // credit balance — owes nothing
        currency: 'USD',
      },
    });
    try {
      const plan = await getSpendingPlan(uid);
      expect(plan.cardObligationsCents).toBe(30000); // unchanged — nothing invented
      // Only the owing card may drive "the real figure may be lower".
      expect(plan.disclosures.undatedCards.map((c) => c.cardName)).toEqual(['Ghost Card']);
    } finally {
      await prisma.account.delete({ where: { id: ghost.id } });
      await prisma.account.delete({ where: { id: overpaid.id } });
    }
  });

  it('a statement-pending card due this month is excluded from the term and named with its own mechanism (critic F2)', async () => {
    // Cycle days but no generated statement → the estimate path; with the
    // Rewards Card's REAL statement present, the engine parks the estimate in
    // `upcoming` — excluded from the term even though it is due this month.
    const pending = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'manual',
        providerRef: `${uid}-pending`,
        name: 'Pending Card',
        type: 'CREDIT',
        currentBalanceCents: 80000,
        currency: 'USD',
        dueDayOfMonth: 24,
        cycleCloseDayOfMonth: 11,
      },
    });
    try {
      const plan = await getSpendingPlan(uid);
      expect(plan.cardObligationsCents).toBe(30000); // the estimate is NOT summed
      expect(plan.disclosures.statementPendingCards.map((c) => c.cardName)).toEqual(['Pending Card']);
      // …and it is NOT misfiled under the no-dates-at-all mechanism.
      expect(plan.disclosures.undatedCards).toEqual([]);
    } finally {
      await prisma.account.delete({ where: { id: pending.id } });
    }
  });
});

/**
 * TASKS L.11(D) through the real server path — the owner's 2026-07-25 report,
 * "It's worse now", reduced to its shape: every card dated just past the end of
 * this month, so the month's card term was $0.00 and the plan handed back the
 * whole month's income while the dashboard, on the same screen, said that money
 * was needed within days.
 *
 * A pure-engine test cannot catch this: the bug was never in the arithmetic, it
 * was in which rows reached it.
 */
describe("getSpendingPlan — card payments dated past the month's edge (L.11(D))", () => {
  const uid = `gfs-edge-${Date.now()}-${process.pid}`;
  const TODAY_JULY = '2026-07-26';
  let checkingEdgeId = '';

  const wipe = async () => {
    await prisma.goal.deleteMany({ where: { userId: uid } });
    await prisma.account.deleteMany({ where: { userId: uid } });
    await prisma.user.deleteMany({ where: { id: uid } });
  };

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: uid, email: `${uid}@test.local` } });
    const checking = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'manual',
        providerRef: `${uid}-chk`,
        name: 'Investor Checking',
        type: 'CHECKING',
        currentBalanceCents: 980000,
        currency: 'USD',
      },
    });
    checkingEdgeId = checking.id;
    await prisma.user.update({ where: { id: uid }, data: { paymentAccountId: checking.id } });
    const card = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'manual',
        providerRef: `${uid}-card`,
        name: 'Travel Card',
        type: 'CREDIT',
        currentBalanceCents: 900000,
        currency: 'USD',
      },
    });
    // Income in the two COMPLETE months (the pattern's basis) and in July
    // (deliberately NOT in the pattern — the July paycheck no longer arrives
    // in the plan's income at all).
    await prisma.transaction.createMany({
      data: [
        { accountId: checking.id, date: '2026-05-03', amountCents: 1000000, rawDescriptor: 'ACME PAYROLL', categoryId: 'income', confidenceBps: 9900, needsReview: false },
        { accountId: checking.id, date: '2026-06-03', amountCents: 1000000, rawDescriptor: 'ACME PAYROLL', categoryId: 'income', confidenceBps: 9900, needsReview: false },
        { accountId: checking.id, date: '2026-07-03', amountCents: 1000000, rawDescriptor: 'ACME PAYROLL', categoryId: 'income', confidenceBps: 9900, needsReview: false },
      ],
    });
    // Due FIVE DAYS after the month this plan describes ends — the owner's shape.
    await prisma.statement.create({
      data: {
        accountId: card.id,
        cycleStart: '2026-06-06',
        cycleEnd: '2026-07-05',
        dueDate: '2026-08-05',
        statementBalanceCents: 900000,
        minimumPaymentCents: 3500,
      },
    });
  });
  afterAll(async () => {
    await wipe();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    vi.stubEnv('DEMO_TODAY', TODAY_JULY);
  });

  it('reserves the beyond-month statement as its own term, and names its date in the product’s voice', async () => {
    const plan = await getSpendingPlan(uid);

    // The month's own term is still empty — that filter is unchanged, and this
    // is the vacuity guard: it is exactly what the old code left as the whole
    // answer, so a term that silently stopped applying would fail below.
    expect(plan.cardObligationsCents).toBe(0);
    expect(plan.obligationsBeyondMonthCents).toBe(900000);
    expect(plan.reservesBeyondMonth).toBe(true);
    expect(plan.obligationsBeyondMonthThroughDate).toBe('Wed, Aug 5');
    expect(plan.leftToSpendCents).toBe(100000); // $10,000 pattern − $9,000 dated
    expect(plan.overspent).toBe(false);
  });

  it('holds back exactly what the cash-needed answer demands — the two cannot disagree', async () => {
    const [plan, cash] = await Promise.all([getSpendingPlan(uid), getCashNeeded(uid)]);
    // The figure the hero prints as "needed by Wed, Aug 5" is the figure this
    // plan subtracts. Same rows, one filter, opposite sides.
    expect(cash.result.headline.requiredCents).toBe(900000);
    expect(plan.obligationsBeyondMonthCents).toBe(cash.result.headline.requiredCents);
    expect(plan.leftToSpendCents).toBeLessThan(plan.patternIncomeCents);
  });

  it('splits the SAME set at the boundary — neither side may swallow the other', async () => {
    // The whole slice is one filter, and with a single beyond-month card the
    // suite could not tell a working filter from no filter at all (cycle-2
    // critic). Two cards, one each side of the edge, and the two terms must
    // partition exactly what the cash-needed answer demands.
    const inMonth = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'manual',
        providerRef: `${uid}-inmonth`,
        name: 'Everyday Card',
        type: 'CREDIT',
        currentBalanceCents: 120000,
        currency: 'USD',
      },
    });
    await prisma.statement.create({
      data: {
        accountId: inMonth.id,
        cycleStart: '2026-06-21',
        cycleEnd: '2026-07-20',
        dueDate: '2026-07-31', // the LAST day of the month: in-month, not beyond
        statementBalanceCents: 120000,
        minimumPaymentCents: 2500,
      },
    });
    try {
      const [plan, cash] = await Promise.all([getSpendingPlan(uid), getCashNeeded(uid)]);
      expect(plan.cardObligationsCents).toBe(120000);
      expect(plan.obligationsBeyondMonthCents).toBe(900000);
      // Exact partition, neither side zero — the assertion a single-card
      // fixture cannot make.
      expect(plan.cardObligationsCents + plan.obligationsBeyondMonthCents).toBe(
        cash.result.headline.requiredCents,
      );
      expect(plan.leftToSpendCents).toBe(1000000 - 120000 - 900000);
    } finally {
      await prisma.account.delete({ where: { id: inMonth.id } });
    }
  });

  it('a LIVE anchor before the window is stepped INTO it — the walk is not blind to mid-month paydays (L.22 money critic P1-1)', async () => {
    // FAIL-OLD: the old call passed endOfMonth as the counter's `today`, so this weekly
    // paycheck — anchored Jul 28, landing Aug 4, one day before the Aug 5 statement — read
    // as "stale" and contributed ZERO: the full $9,000 was reserved (900000 / 100000)
    // instead of the part the arriving income does not cover (300000 / 700000).
    const payday = await prisma.scheduledTransaction.create({
      data: {
        accountId: checkingEdgeId,
        description: 'ACME PAYROLL',
        amountCents: 600000,
        nextDate: '2026-07-28', // live vs the pinned Jul 26 today; steps to Aug 4 inside the window
        cadence: 'WEEKLY',
        source: 'payroll-detected',
      },
    });
    try {
      const plan = await getSpendingPlan(uid);
      expect(plan.obligationsBeyondMonthCents).toBe(300000); // 900000 − 600000 arriving Aug 4
      expect(plan.leftToSpendCents).toBe(700000);
      expect(plan.obligationsBeyondMonthThroughDate).toBe('Wed, Aug 5');
    } finally {
      await prisma.scheduledTransaction.delete({ where: { id: payday.id } });
    }
  });

  it('reserves only what next month’s income has not arrived in time to cover', async () => {
    // The gross version reserved a full statement every month, permanently, for
    // anyone paid before their cards come due — the same double-reservation
    // L.11(C) existed to kill, with the sign flipped (cycle-2, both critics).
    const payday = await prisma.scheduledTransaction.create({
      data: {
        accountId: checkingEdgeId,
        description: 'ACME PAYROLL',
        amountCents: 600000,
        nextDate: '2026-08-01', // lands BEFORE the Aug 5 statement
        source: 'user',
      },
    });
    try {
      const plan = await getSpendingPlan(uid);
      // $9,000 due Aug 5, $6,000 arriving Aug 1 → this month must cover $3,000.
      expect(plan.obligationsBeyondMonthCents).toBe(300000);
      expect(plan.leftToSpendCents).toBe(700000);
      // …and the August income is NOT also counted as this month's income.
      expect(plan.patternIncomeCents).toBe(1000000);
    } finally {
      await prisma.scheduledTransaction.delete({ where: { id: payday.id } });
    }
  });

  it('reserves nothing when the income arrives first and covers it whole', async () => {
    const payday = await prisma.scheduledTransaction.create({
      data: {
        accountId: checkingEdgeId,
        description: 'ACME PAYROLL',
        amountCents: 1200000,
        nextDate: '2026-08-03',
        source: 'user',
      },
    });
    try {
      const plan = await getSpendingPlan(uid);
      expect(plan.obligationsBeyondMonthCents).toBe(0);
      expect(plan.reservesBeyondMonth).toBe(false);
      expect(plan.obligationsBeyondMonthThroughDate).toBeNull();
      expect(plan.leftToSpendCents).toBe(1000000);
    } finally {
      await prisma.scheduledTransaction.delete({ where: { id: payday.id } });
    }
  });

  it('income landing AFTER a payment cannot pay it — the worst running gap wins', async () => {
    const late = await prisma.scheduledTransaction.create({
      data: {
        accountId: checkingEdgeId,
        description: 'ACME PAYROLL',
        amountCents: 1200000,
        nextDate: '2026-08-20', // after the Aug 5 due date
        source: 'user',
      },
    });
    try {
      const plan = await getSpendingPlan(uid);
      expect(plan.obligationsBeyondMonthCents).toBe(900000); // unchanged
      expect(plan.obligationsBeyondMonthThroughDate).toBe('Wed, Aug 5');
    } finally {
      await prisma.scheduledTransaction.delete({ where: { id: late.id } });
    }
  });

  it('is a FLOW, not a balance: a thin account before payday changes nothing', async () => {
    // The first attempt at this capped the answer at the funding account's
    // projected low point, which is recorded on day one of the walk — so a
    // reader whose balance dips before payday was told a $200 float was all he
    // could spend, and a $1,000 card was blamed for $6,000 of it. Drop the
    // balance to $200 with the same income and the same card: the answer must
    // not move, because nothing about what he EARNS or OWES has changed.
    const before = await getSpendingPlan(uid);
    await prisma.account.update({ where: { id: checkingEdgeId }, data: { currentBalanceCents: 20000 } });
    try {
      const after = await getSpendingPlan(uid);
      expect(after.leftToSpendCents).toBe(before.leftToSpendCents);
      expect(after.obligationsBeyondMonthCents).toBe(before.obligationsBeyondMonthCents);
      // And the cash-needed answer DOES move — proving the fixture really is a
      // case where a balance-based cap would have collapsed (a vacuity guard).
      const cash = await getCashNeeded(uid);
      expect(cash.result.intraPeriodMinimum?.balanceCents).toBe(-880000);
    } finally {
      await prisma.account.update({ where: { id: checkingEdgeId }, data: { currentBalanceCents: 980000 } });
    }
  });
});

/**
 * The estimate half, in its own fixture because it cannot coexist with the one
 * above: the cash-needed engine uses estimates ONLY when no card has a real
 * statement (`real.length > 0 ? real : estimated`), so a single real statement
 * anywhere parks every estimate in `upcoming`, outside `perDueDate` entirely.
 */
describe('getSpendingPlan — a beyond-month term made entirely of estimates (L.11(D))', () => {
  const uid = `gfs-est-${Date.now()}-${process.pid}`;

  const wipe = async () => {
    await prisma.account.deleteMany({ where: { userId: uid } });
    await prisma.user.deleteMany({ where: { id: uid } });
  };

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: uid, email: `${uid}@test.local` } });
    const checking = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'manual',
        providerRef: `${uid}-chk`,
        name: 'Everyday Checking',
        type: 'CHECKING',
        currentBalanceCents: 500000,
        currency: 'USD',
      },
    });
    await prisma.user.update({ where: { id: uid }, data: { paymentAccountId: checking.id } });
    await prisma.transaction.create({
      data: {
        accountId: checking.id,
        date: '2026-07-03',
        amountCents: 1000000,
        rawDescriptor: 'ACME PAYROLL',
        categoryId: 'income',
        confidenceBps: 9900,
        needsReview: false,
      },
    });
    // No Statement row anywhere: the cycle closes on the 28th and the payment is
    // due on the 20th, so the engine estimates an obligation dated in AUGUST.
    await prisma.account.create({
      data: {
        userId: uid,
        provider: 'manual',
        providerRef: `${uid}-est`,
        name: 'No Statement Card',
        type: 'CREDIT',
        currentBalanceCents: 500000,
        currency: 'USD',
        dueDayOfMonth: 20,
        cycleCloseDayOfMonth: 28,
      },
    });
  });
  afterAll(async () => {
    await wipe();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    vi.stubEnv('DEMO_TODAY', '2026-07-26');
  });

  it('marks the beyond-month term estimated on its own, not on the in-month flag', async () => {
    const plan = await getSpendingPlan(uid);
    expect(plan.obligationsBeyondMonthCents).toBeGreaterThan(0);
    expect(plan.obligationsBeyondMonthEstimated).toBe(true);
    // The in-month flag is false BY CONSTRUCTION here — its own term is empty —
    // which is exactly why a second flag had to exist.
    expect(plan.cardObligationsCents).toBe(0);
    expect(plan.cardObligationsEstimated).toBe(false);
  });

  it('the trace row says "estimated" and the panel still reconciles', async () => {
    const plan = await getSpendingPlan(uid);
    const trace = traceSafeToSpend(plan, plan.disclosures);
    const row = trace.rows.find((r) => r.id === 'card-payments-next');
    expect(row).toBeDefined();
    expect(row?.isEstimated).toBe(true);
    expect(trace.reconciles).toBe(true);
  });
});
