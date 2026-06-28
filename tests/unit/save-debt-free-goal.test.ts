/**
 * saveDebtFreeGoal — integration test against a throwaway user (DECISIONS #125).
 *
 * Proves the security/no-fabrication contract: the client sends ONLY a target date,
 * and the server RE-SOLVES every figure from the user's own debts + safe-to-spend
 * before persisting — so the saved monthly contribution equals an independent
 * solveDebtFreeByDate, never a client-supplied number. Also: it populates the
 * (previously unused) Goal.targetDate, and rejects an invalid or non-actionable date.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { saveDebtFreeGoal } from '@/server/goal-actions';
import { loadDebtAccounts } from '@/server/debt';
import { getSpendingPlan } from '@/server/spending-plan';
import { solveDebtFreeByDate } from '@/lib/engine/solve/debt-free-by-date';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';
import { addMonthsClamped, isoDate, type ISODate } from '@/lib/dates';

describe('saveDebtFreeGoal (real, throwaway user — DECISIONS #125)', () => {
  const USER = `dfbd-user-${Date.now()}-${process.pid}`;

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
    await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Rewards Card', type: 'CREDIT', currentBalanceCents: 120_000, aprBps: 1999 },
    });
  });
  afterAll(wipe);
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    await prisma.goal.deleteMany({ where: { userId: USER } });
  });

  it('persists a goal whose contribution equals the server-side re-solve (not a client number)', async () => {
    const targetDate = '2035-12-31';
    await saveDebtFreeGoal(targetDate);

    const goals = await prisma.goal.findMany({ where: { userId: USER } });
    expect(goals).toHaveLength(1);
    const goal = goals[0];
    expect(goal.targetDate).toBe(targetDate); // the previously-unused field is now populated
    expect(goal.kind).toBe('debt_free'); // tagged so /goals renders it with the solver's date
    expect(goal.name).toMatch(/^Debt-free by /);
    expect(goal.targetCents).toBe(120_000); // total debt balance

    // Independently re-solve from the user's own data — the persisted contribution must match.
    const today = getProvider().today(USER) as ISODate;
    const [debts, plan] = await Promise.all([loadDebtAccounts(USER), getSpendingPlan(USER)]);
    const expected = solveDebtFreeByDate({
      debts,
      strategy: 'avalanche',
      targetDate: isoDate(targetDate),
      today,
      safeToSpendCents: plan.leftToSpendCents,
    });
    expect(expected.outcome === 'reachable' || expected.outcome === 'on-track').toBe(true);
    expect(goal.monthlyContributionCents).toBe(expected.requiredExtraMonthlyCents);
  });

  it('re-solves a NON-ZERO contribution server-side (not a 0===0 tautology — TC-2)', async () => {
    // A target ~12 months out is well inside the ~52 months the $1,200 card needs on its $35
    // minimum, so the solver MUST require a real, non-zero extra — proving the server computed
    // it rather than echoing a client value (the client only ever sends the date).
    const today = getProvider().today(USER) as ISODate;
    const targetDate = addMonthsClamped(today, 12);
    await saveDebtFreeGoal(targetDate);

    const goal = (await prisma.goal.findMany({ where: { userId: USER } }))[0];
    const [debts, plan] = await Promise.all([loadDebtAccounts(USER), getSpendingPlan(USER)]);
    const expected = solveDebtFreeByDate({
      debts,
      strategy: 'avalanche',
      targetDate: isoDate(targetDate),
      today,
      safeToSpendCents: plan.leftToSpendCents,
    });
    expect(expected.outcome).toBe('reachable');
    expect(expected.requiredExtraMonthlyCents as number).toBeGreaterThan(0);
    expect(goal.monthlyContributionCents).toBe(expected.requiredExtraMonthlyCents);
  });

  it('rejects a non-actionable (too-soon / past) date without writing a goal', async () => {
    await expect(saveDebtFreeGoal('2015-01-01')).rejects.toThrow();
    expect(await prisma.goal.count({ where: { userId: USER } })).toBe(0);
  });

  it('rejects an invalid date string', async () => {
    await expect(saveDebtFreeGoal('not-a-date')).rejects.toThrow(/invalid target date/i);
    expect(await prisma.goal.count({ where: { userId: USER } })).toBe(0);
  });
});
