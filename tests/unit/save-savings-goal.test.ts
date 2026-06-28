/**
 * saveSavingsGoal — integration test against a throwaway user (DECISIONS #126).
 *
 * Proves the security/no-fabrication contract: the client sends the user-STATED target
 * amount + date, and the server RE-SOLVES the monthly contribution from the user's own
 * safe-to-spend before persisting — so the saved monthlyContribution equals an independent
 * solveSavingsGoalByDate, never a client-supplied number. Also: it populates Goal.targetDate
 * on a normal (kind null) savings goal, and rejects an invalid date / amount / unreachable date.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { saveSavingsGoal } from '@/server/goal-actions';
import { getSpendingPlan } from '@/server/spending-plan';
import { solveSavingsGoalByDate } from '@/lib/engine/solve/savings-goal-by-date';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';
import { addMonthsClamped, isoDate, type ISODate } from '@/lib/dates';

describe('saveSavingsGoal (real, throwaway user — DECISIONS #126)', () => {
  const USER = `sgbd-user-${Date.now()}-${process.pid}`;

  async function wipe() {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 500_000 },
    });
  });
  afterAll(wipe);
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    await prisma.goal.deleteMany({ where: { userId: USER } });
  });

  it('persists a savings goal whose monthly equals the server-side re-solve (not a client number)', async () => {
    const targetDate = addMonthsClamped(getProvider().today(USER) as ISODate, 12); // 12 months out
    const goalAmountCents = 1_200_000; // $12,000

    await saveSavingsGoal(targetDate, goalAmountCents);

    const goals = await prisma.goal.findMany({ where: { userId: USER } });
    expect(goals).toHaveLength(1);
    const goal = goals[0];
    expect(goal.targetDate).toBe(targetDate); // the previously-unused field is now populated
    expect(goal.kind).toBeNull(); // a normal savings goal (renders via the flat funding card)
    expect(goal.targetCents).toBe(goalAmountCents);
    expect(goal.savedCents).toBe(0);
    expect(goal.name).toMatch(/^\$12,000\.00 by /);

    // Independently re-solve from the user's own data — the persisted monthly must match,
    // and be NON-ZERO (proving the server computed it, not a 0===0 echo of the client).
    const today = getProvider().today(USER) as ISODate;
    const plan = await getSpendingPlan(USER);
    const expected = solveSavingsGoalByDate({
      goalAmountCents,
      currentSavingsCents: 0,
      targetDate: isoDate(targetDate),
      today,
      safeToSpendCents: plan.leftToSpendCents,
    });
    expect(expected.outcome).toBe('reachable');
    expect(expected.requiredMonthlyCents as number).toBeGreaterThan(0);
    expect(goal.monthlyContributionCents).toBe(expected.requiredMonthlyCents);
  });

  it('rejects a non-positive goal amount without writing a goal', async () => {
    const targetDate = addMonthsClamped(getProvider().today(USER) as ISODate, 12);
    await expect(saveSavingsGoal(targetDate, 0)).rejects.toThrow(/invalid goal amount/i);
    await expect(saveSavingsGoal(targetDate, -5_000)).rejects.toThrow(/invalid goal amount/i);
    expect(await prisma.goal.count({ where: { userId: USER } })).toBe(0);
  });

  it('rejects an invalid date string', async () => {
    await expect(saveSavingsGoal('not-a-date', 1_000_000)).rejects.toThrow(/invalid target date/i);
    expect(await prisma.goal.count({ where: { userId: USER } })).toBe(0);
  });

  it('rejects a non-actionable (too-soon / past) date without writing a goal', async () => {
    await expect(saveSavingsGoal('2015-01-01', 1_000_000)).rejects.toThrow();
    expect(await prisma.goal.count({ where: { userId: USER } })).toBe(0);
  });
});
