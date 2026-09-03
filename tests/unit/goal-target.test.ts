/**
 * Savings-goal target edit on /goals (DECISIONS #599).
 *
 * A savings goal could be created, renamed, or deleted. Changing the
 * target meant delete-and-recreate. Overlay is the TARGET — name,
 * saved, monthly contribution, and target date stay put. Reserves and
 * debt-free rows refuse the write.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';

const USER = `goal-target-${Date.now()}-${process.pid}`;

describe('Goals surface lets the household change a savings goal target', () => {
  it('test_regression__goals_target_control_is_on_the_page', () => {
    const page = readFileSync(resolve('src/app/(app)/goals/page.tsx'), 'utf8');
    expect(page).toContain('GoalTargetControl');
    expect(page).toContain('GoalNameControl');
    const control = readFileSync(
      resolve('src/components/finance/goal-target-form.tsx'),
      'utf8',
    );
    expect(control).toContain('updateGoalTarget');
    expect(control).toContain('Save target');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('form-action');
    expect(control).not.toContain('useActionState');
  });
});

describe('updateGoalTarget — the write is the target, never a name', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__household_can_change_a_savings_goal_target_without_deleting_it', async () => {
    const { updateGoalTarget } = await import('@/server/goal-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const goal = await prisma.goal.create({
        data: {
          userId: USER,
          name: 'Italy trip',
          kind: null,
          targetCents: 500_000,
          savedCents: 12_000,
          monthlyContributionCents: 25_000,
          targetDate: '2027-06-01',
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
      fd.set('target', '8000');
      const res = await updateGoalTarget(goal.id, fd);
      expect(res.ok).toBe(true);

      const updated = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(updated.targetCents).toBe(800_000);
      expect(updated.name).toBe('Italy trip');
      expect(updated.savedCents).toBe(12_000);
      expect(updated.monthlyContributionCents).toBe(25_000);
      expect(updated.targetDate).toBe('2027-06-01');

      const blockedReserve = await updateGoalTarget(reserve.id, fd);
      expect(blockedReserve.ok).toBe(false);
      const reserveRow = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(reserveRow.targetCents).toBe(120_000);
      expect(reserveRow.name).toBe('Home repair');

      const blockedDebt = await updateGoalTarget(debt.id, fd);
      expect(blockedDebt.ok).toBe(false);
      const debtRow = await prisma.goal.findUniqueOrThrow({ where: { id: debt.id } });
      expect(debtRow.targetCents).toBe(1_000_000);
      expect(debtRow.name).toBe('Debt-free by 2027-06');
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__goal_target_refuses_blank_and_zero', async () => {
    const { updateGoalTarget } = await import('@/server/goal-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const goal = await prisma.goal.create({
        data: {
          userId: USER,
          name: 'Emergency fund',
          kind: null,
          targetCents: 1_000_000,
          savedCents: 40_000,
          monthlyContributionCents: 50_000,
        },
      });
      const blank = new FormData();
      blank.set('target', '   ');
      const blankRes = await updateGoalTarget(goal.id, blank);
      expect(blankRes.ok).toBe(false);
      expect(blankRes.errors?.target).toMatch(/above \$0/);

      const zero = new FormData();
      zero.set('target', '0');
      const zeroRes = await updateGoalTarget(goal.id, zero);
      expect(zeroRes.ok).toBe(false);
      expect(zeroRes.errors?.target).toMatch(/above \$0/);

      const row = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(row.targetCents).toBe(1_000_000);
      expect(row.name).toBe('Emergency fund');
      expect(row.savedCents).toBe(40_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__goal_target_demo_cannot_learn', async () => {
    const { updateGoalTarget } = await import('@/server/goal-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('target', '8000');
      const res = await updateGoalTarget('any', fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
