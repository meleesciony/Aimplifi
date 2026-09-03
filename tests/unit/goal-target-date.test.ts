/**
 * Savings-goal target-date edit on /goals (DECISIONS #601).
 *
 * A savings goal could be created, renamed, or have its target and
 * monthly changed. Changing the target date meant delete-and-recreate,
 * and a dateless goal had nothing to tap. Overlay is TARGET DATE —
 * name, target, saved, and monthly stay put. Reserves and debt-free
 * rows refuse the write. Does not re-solve monthly from the date.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';

const USER = `goal-target-date-${Date.now()}-${process.pid}`;

describe('Goals surface lets the household change a savings goal target date', () => {
  it('test_regression__goals_target_date_control_is_on_the_page', () => {
    const page = readFileSync(resolve('src/app/(app)/goals/page.tsx'), 'utf8');
    expect(page).toContain('GoalTargetDateControl');
    expect(page).toContain('GoalMonthlyControl');
    expect(page).toContain('targetDate={goal.targetDate}');
    const control = readFileSync(
      resolve('src/components/finance/goal-target-date-form.tsx'),
      'utf8',
    );
    expect(control).toContain('updateGoalTargetDate');
    expect(control).toContain('Save date');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('form-action');
    expect(control).not.toContain('useActionState');
  });
});

describe('updateGoalTargetDate — the write is the date, never a name or target', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__household_can_change_a_savings_goal_target_date_without_deleting_it', async () => {
    const { updateGoalTargetDate } = await import('@/server/goal-actions');
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
          monthlyContributionCents: 50_000,
          targetDate: null,
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
          targetDate: '2026-12-01',
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
          targetDate: '2027-06-01',
        },
      });

      const fd = new FormData();
      fd.set('targetDate', '2028-12');
      const res = await updateGoalTargetDate(goal.id, fd);
      expect(res.ok).toBe(true);

      const updated = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(updated.targetDate).toBe('2028-12-01');
      expect(updated.name).toBe('Italy trip');
      expect(updated.targetCents).toBe(800_000);
      expect(updated.savedCents).toBe(12_000);
      expect(updated.monthlyContributionCents).toBe(25_000);

      const add = new FormData();
      add.set('targetDate', '2029-03-15');
      const addRes = await updateGoalTargetDate(none.id, add);
      expect(addRes.ok).toBe(true);
      const added = await prisma.goal.findUniqueOrThrow({ where: { id: none.id } });
      expect(added.targetDate).toBe('2029-03-15');
      expect(added.name).toBe('Emergency fund');
      expect(added.targetCents).toBe(1_000_000);
      expect(added.monthlyContributionCents).toBe(50_000);

      const blockedReserve = await updateGoalTargetDate(reserve.id, fd);
      expect(blockedReserve.ok).toBe(false);
      const reserveRow = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(reserveRow.targetDate).toBe('2026-12-01');
      expect(reserveRow.name).toBe('Home repair');

      const blockedDebt = await updateGoalTargetDate(debt.id, fd);
      expect(blockedDebt.ok).toBe(false);
      const debtRow = await prisma.goal.findUniqueOrThrow({ where: { id: debt.id } });
      expect(debtRow.targetDate).toBe('2027-06-01');
      expect(debtRow.name).toBe('Debt-free by 2027-06');
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__goal_target_date_refuses_blank_and_garbage', async () => {
    const { updateGoalTargetDate } = await import('@/server/goal-actions');
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
          targetDate: '2030-08-01',
        },
      });
      const blank = new FormData();
      blank.set('targetDate', '   ');
      const blankRes = await updateGoalTargetDate(goal.id, blank);
      expect(blankRes.ok).toBe(false);
      expect(blankRes.errors?.targetDate).toMatch(/month/);

      const garbage = new FormData();
      garbage.set('targetDate', 'not-a-date');
      const garbageRes = await updateGoalTargetDate(goal.id, garbage);
      expect(garbageRes.ok).toBe(false);
      expect(garbageRes.errors?.targetDate).toMatch(/month/);

      const row = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(row.targetDate).toBe('2030-08-01');
      expect(row.name).toBe('College');
      expect(row.targetCents).toBe(2_000_000);
      expect(row.monthlyContributionCents).toBe(10_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__goal_target_date_demo_cannot_learn', async () => {
    const { updateGoalTargetDate } = await import('@/server/goal-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('targetDate', '2028-12');
      const res = await updateGoalTargetDate('any', fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
