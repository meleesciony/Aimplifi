/**
 * Savings-goal names on /goals (DECISIONS #581).
 *
 * A savings goal could be created with a name, then only deleted.
 * The household could not rename one already sitting on the page.
 * Overlay is a NAME — dollars stay put.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';
import { MAX_GOAL_NAME, goalNameError } from '@/lib/engine/goals/goal-name';

const USER = `goal-rename-${Date.now()}-${process.pid}`;

describe('goalNameError — the name is a name, never dollars', () => {
  it('test_regression__goal_name_refuses_blank_and_over_cap', () => {
    expect(goalNameError('')).toMatch(/Give the goal a name/);
    expect(goalNameError('   ')).toMatch(/Give the goal a name/);
    expect(goalNameError('x'.repeat(MAX_GOAL_NAME + 1))).toMatch(/under 60/);
    expect(goalNameError('Emergency fund')).toBeUndefined();
    expect(goalNameError('  Italy trip  ')).toBeUndefined();
  });
});

describe('Goals surface lets the household name a savings goal', () => {
  it('test_regression__goals_name_control_is_on_the_page', () => {
    const page = readFileSync(resolve('src/app/(app)/goals/page.tsx'), 'utf8');
    expect(page).toContain('GoalNameControl');
    const control = readFileSync(
      resolve('src/components/finance/rename-goal-form.tsx'),
      'utf8',
    );
    expect(control).toContain('renameGoal');
    expect(control).toContain('Save name');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('form-action');
    expect(control).not.toContain('useActionState');
  });
});

describe('renameGoal — the write is a name, never a money figure', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__household_can_rename_a_savings_goal', async () => {
    const { renameGoal } = await import('@/server/goal-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const goal = await prisma.goal.create({
        data: {
          userId: USER,
          name: 'Trip',
          kind: null,
          targetCents: 500_000,
          savedCents: 12_000,
          monthlyContributionCents: 25_000,
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
      fd.set('name', '  Italy trip  ');
      const res = await renameGoal(goal.id, fd);
      expect(res.ok).toBe(true);

      const renamed = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(renamed.name).toBe('Italy trip');
      expect(renamed.targetCents).toBe(500_000);
      expect(renamed.savedCents).toBe(12_000);
      expect(renamed.monthlyContributionCents).toBe(25_000);

      const blockedReserve = await renameGoal(reserve.id, fd);
      expect(blockedReserve.ok).toBe(false);
      const reserveRow = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(reserveRow.name).toBe('Home repair');
      expect(reserveRow.targetCents).toBe(120_000);

      const blockedDebt = await renameGoal(debt.id, fd);
      expect(blockedDebt.ok).toBe(false);
      const debtRow = await prisma.goal.findUniqueOrThrow({ where: { id: debt.id } });
      expect(debtRow.name).toBe('Debt-free by 2027-06');
      expect(debtRow.targetCents).toBe(1_000_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__goal_rename_refuses_blank', async () => {
    const { renameGoal } = await import('@/server/goal-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const goal = await prisma.goal.create({
        data: {
          userId: USER,
          name: 'Emergency fund',
          kind: null,
          targetCents: 1_000_000,
          savedCents: 0,
          monthlyContributionCents: 50_000,
        },
      });
      const fd = new FormData();
      fd.set('name', '   ');
      const res = await renameGoal(goal.id, fd);
      expect(res.ok).toBe(false);
      expect(res.errors?.name).toMatch(/Give the goal a name/);
      const row = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(row.name).toBe('Emergency fund');
      expect(row.targetCents).toBe(1_000_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__goal_rename_demo_cannot_learn', async () => {
    const { renameGoal } = await import('@/server/goal-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('name', 'Italy trip');
      const res = await renameGoal('any', fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
