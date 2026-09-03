/**
 * Savings-goal monthly contribution clear on /goals (DECISIONS #602).
 *
 * #600 shipped a monthly write that refused blank. Clearing still meant
 * delete-and-recreate. Overlay is MONTHLY = null — name, target, saved,
 * and target date stay put. Null, not zero. Reserves and debt-free rows
 * refuse. A goal with no monthly has nothing to clear.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';

const USER = `goal-monthly-clear-${Date.now()}-${process.pid}`;

describe('Goals surface lets the household clear a savings goal monthly', () => {
  it('test_regression__goals_monthly_clear_is_on_the_control', () => {
    const control = readFileSync(
      resolve('src/components/finance/goal-monthly-form.tsx'),
      'utf8',
    );
    expect(control).toContain('clearGoalMonthly');
    expect(control).toContain('Clear monthly');
    expect(control).toContain('goal-monthly-clear');
    expect(control).toContain('updateGoalMonthly');
    expect(control).not.toContain('useActionState');
  });
});

describe('clearGoalMonthly — the write is monthly null, never a name or target', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__household_can_clear_a_savings_goal_monthly_contribution_without_deleting_it', async () => {
    const { clearGoalMonthly } = await import('@/server/goal-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const goal = await prisma.goal.create({
        data: {
          userId: USER,
          name: 'Italy trip',
          kind: null,
          targetCents: 800_000,
          savedCents: 12_000,
          monthlyContributionCents: 25_000,
          targetDate: '2027-06-01',
        },
      });
      const none = await prisma.goal.create({
        data: {
          userId: USER,
          name: 'Emergency fund',
          kind: null,
          targetCents: 1_000_000,
          savedCents: 40_000,
          monthlyContributionCents: null,
        },
      });
      const reserve = await prisma.goal.create({
        data: {
          userId: USER,
          name: 'Home repair',
          kind: RESERVE_KIND,
          targetCents: 120_000,
          cadence: 'ANNUAL',
          savedCents: 0,
          monthlyContributionCents: 10_000,
        },
      });
      const debt = await prisma.goal.create({
        data: {
          userId: USER,
          name: 'Debt-free by 2027-06',
          kind: 'debt_free',
          targetCents: 1_000_000,
          savedCents: 0,
          monthlyContributionCents: 50_000,
        },
      });

      const res = await clearGoalMonthly(goal.id);
      expect(res.ok).toBe(true);
      const updated = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(updated.monthlyContributionCents).toBeNull();
      expect(updated.name).toBe('Italy trip');
      expect(updated.targetCents).toBe(800_000);
      expect(updated.savedCents).toBe(12_000);
      expect(updated.targetDate).toBe('2027-06-01');

      const noneRes = await clearGoalMonthly(none.id);
      expect(noneRes.ok).toBe(false);
      const noneRow = await prisma.goal.findUniqueOrThrow({ where: { id: none.id } });
      expect(noneRow.monthlyContributionCents).toBeNull();
      expect(noneRow.name).toBe('Emergency fund');

      const blockedReserve = await clearGoalMonthly(reserve.id);
      expect(blockedReserve.ok).toBe(false);
      const reserveRow = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(reserveRow.monthlyContributionCents).toBe(10_000);
      expect(reserveRow.name).toBe('Home repair');

      const blockedDebt = await clearGoalMonthly(debt.id);
      expect(blockedDebt.ok).toBe(false);
      const debtRow = await prisma.goal.findUniqueOrThrow({ where: { id: debt.id } });
      expect(debtRow.monthlyContributionCents).toBe(50_000);
      expect(debtRow.name).toBe('Debt-free by 2027-06');
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__goal_monthly_clear_demo_cannot_learn', async () => {
    const { clearGoalMonthly } = await import('@/server/goal-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const res = await clearGoalMonthly('any');
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
