/**
 * Savings-goal target-date clear on /goals (DECISIONS #603).
 *
 * #601 shipped a date write that refused blank. Clearing still meant
 * delete-and-recreate. Overlay is TARGET DATE = null — name, target,
 * saved, and monthly stay put. Null, not a fake date. Reserves and
 * debt-free rows refuse. A dateless goal has nothing to clear.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';

const USER = `goal-target-date-clear-${Date.now()}-${process.pid}`;

describe('Goals surface lets the household clear a savings goal target date', () => {
  it('test_regression__goals_target_date_clear_is_on_the_control', () => {
    const control = readFileSync(
      resolve('src/components/finance/goal-target-date-form.tsx'),
      'utf8',
    );
    expect(control).toContain('clearGoalTargetDate');
    expect(control).toContain('Clear date');
    expect(control).toContain('goal-target-date-clear');
    expect(control).toContain('updateGoalTargetDate');
    expect(control).not.toContain('useActionState');
  });
});

describe('clearGoalTargetDate — the write is date null, never a name or target', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__household_can_clear_a_savings_goal_target_date_without_deleting_it', async () => {
    const { clearGoalTargetDate } = await import('@/server/goal-actions');
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

      const res = await clearGoalTargetDate(goal.id);
      expect(res.ok).toBe(true);
      const updated = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(updated.targetDate).toBeNull();
      expect(updated.name).toBe('Italy trip');
      expect(updated.targetCents).toBe(800_000);
      expect(updated.savedCents).toBe(12_000);
      expect(updated.monthlyContributionCents).toBe(25_000);

      const noneRes = await clearGoalTargetDate(none.id);
      expect(noneRes.ok).toBe(false);
      const noneRow = await prisma.goal.findUniqueOrThrow({ where: { id: none.id } });
      expect(noneRow.targetDate).toBeNull();
      expect(noneRow.name).toBe('Emergency fund');

      const blockedReserve = await clearGoalTargetDate(reserve.id);
      expect(blockedReserve.ok).toBe(false);
      const reserveRow = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(reserveRow.targetDate).toBe('2026-12-01');
      expect(reserveRow.name).toBe('Home repair');

      const blockedDebt = await clearGoalTargetDate(debt.id);
      expect(blockedDebt.ok).toBe(false);
      const debtRow = await prisma.goal.findUniqueOrThrow({ where: { id: debt.id } });
      expect(debtRow.targetDate).toBe('2027-06-01');
      expect(debtRow.name).toBe('Debt-free by 2027-06');
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__goal_target_date_clear_demo_cannot_learn', async () => {
    const { clearGoalTargetDate } = await import('@/server/goal-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const res = await clearGoalTargetDate('any');
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
