/**
 * Savings-goal monthly contribution edit on /goals (DECISIONS #600).
 *
 * A savings goal could be created, renamed, or have its target changed.
 * Changing monthly meant delete-and-recreate, and a goal with none had
 * nothing to tap. Overlay is MONTHLY — name, target, saved, and target
 * date stay put. Reserves and debt-free rows refuse the write.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';

const USER = `goal-monthly-${Date.now()}-${process.pid}`;

describe('Goals surface lets the household change a savings goal monthly', () => {
  it('test_regression__goals_monthly_control_is_on_the_page', () => {
    const page = readFileSync(resolve('src/app/(app)/goals/page.tsx'), 'utf8');
    expect(page).toContain('GoalMonthlyControl');
    expect(page).toContain('GoalTargetControl');
    expect(page).toContain('monthlyCents={goal.monthlyContributionCents}');
    const control = readFileSync(
      resolve('src/components/finance/goal-monthly-form.tsx'),
      'utf8',
    );
    expect(control).toContain('updateGoalMonthly');
    expect(control).toContain('Save monthly');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('form-action');
    expect(control).not.toContain('useActionState');
  });
});

describe('updateGoalMonthly — the write is monthly, never a name or target', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__household_can_change_a_savings_goal_monthly_contribution_without_deleting_it', async () => {
    const { updateGoalMonthly } = await import('@/server/goal-actions');
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
          monthlyContributionCents: null,
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

      const fd = new FormData();
      fd.set('monthly', '400');
      const res = await updateGoalMonthly(goal.id, fd);
      expect(res.ok).toBe(true);

      const updated = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(updated.monthlyContributionCents).toBe(40_000);
      expect(updated.name).toBe('Italy trip');
      expect(updated.targetCents).toBe(800_000);
      expect(updated.savedCents).toBe(12_000);
      expect(updated.targetDate).toBe('2027-06-01');

      const add = new FormData();
      add.set('monthly', '500');
      const addRes = await updateGoalMonthly(none.id, add);
      expect(addRes.ok).toBe(true);
      const added = await prisma.goal.findUniqueOrThrow({ where: { id: none.id } });
      expect(added.monthlyContributionCents).toBe(50_000);
      expect(added.name).toBe('Emergency fund');
      expect(added.targetCents).toBe(1_000_000);

      const blockedReserve = await updateGoalMonthly(reserve.id, fd);
      expect(blockedReserve.ok).toBe(false);
      const reserveRow = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(reserveRow.monthlyContributionCents).toBeNull();
      expect(reserveRow.name).toBe('Home repair');

      const blockedDebt = await updateGoalMonthly(debt.id, fd);
      expect(blockedDebt.ok).toBe(false);
      const debtRow = await prisma.goal.findUniqueOrThrow({ where: { id: debt.id } });
      expect(debtRow.monthlyContributionCents).toBe(50_000);
      expect(debtRow.name).toBe('Debt-free by 2027-06');
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__goal_monthly_refuses_blank_and_zero', async () => {
    const { updateGoalMonthly } = await import('@/server/goal-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const goal = await prisma.goal.create({
        data: {
          userId: USER,
          name: 'College',
          kind: null,
          targetCents: 2_000_000,
          savedCents: 0,
          monthlyContributionCents: 10_000,
        },
      });
      const blank = new FormData();
      blank.set('monthly', '   ');
      const blankRes = await updateGoalMonthly(goal.id, blank);
      expect(blankRes.ok).toBe(false);
      expect(blankRes.errors?.monthly).toMatch(/above \$0/);

      const zero = new FormData();
      zero.set('monthly', '0');
      const zeroRes = await updateGoalMonthly(goal.id, zero);
      expect(zeroRes.ok).toBe(false);
      expect(zeroRes.errors?.monthly).toMatch(/above \$0/);

      const row = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(row.monthlyContributionCents).toBe(10_000);
      expect(row.name).toBe('College');
      expect(row.targetCents).toBe(2_000_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__goal_monthly_demo_cannot_learn', async () => {
    const { updateGoalMonthly } = await import('@/server/goal-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('monthly', '400');
      const res = await updateGoalMonthly('any', fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
