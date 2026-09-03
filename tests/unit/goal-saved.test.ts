/**
 * Savings-goal already-saved edit on /goals (DECISIONS #623).
 *
 * A savings goal's savedCents was printed with no write. Overlay is
 * the already-saved amount — name, target, monthly contribution, and
 * target date stay put. Zero is valid. Reserves and debt-free rows
 * refuse the write.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';

const USER = `goal-saved-${Date.now()}-${process.pid}`;

describe('Goals surface lets the household record already saved', () => {
  it('test_regression__goals_saved_control_is_on_the_page', () => {
    const page = readFileSync(resolve('src/app/(app)/goals/page.tsx'), 'utf8');
    expect(page).toContain('GoalSavedControl');
    const control = readFileSync(
      resolve('src/components/finance/goal-saved-form.tsx'),
      'utf8',
    );
    expect(control).toContain('updateGoalSaved');
    expect(control).toContain('Save amount');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('form-action');
    expect(control).not.toContain('useActionState');
  });
});

describe('updateGoalSaved — the write is saved, never a target', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__household_can_record_how_much_is_already_saved_toward_a_savings_goal', async () => {
    const { updateGoalSaved } = await import('@/server/goal-actions');
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
      fd.set('saved', '2500');
      const res = await updateGoalSaved(goal.id, fd);
      expect(res.ok).toBe(true);

      const updated = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(updated.savedCents).toBe(250_000);
      expect(updated.name).toBe('Italy trip');
      expect(updated.targetCents).toBe(500_000);
      expect(updated.monthlyContributionCents).toBe(25_000);
      expect(updated.targetDate).toBe('2027-06-01');

      const blockedReserve = await updateGoalSaved(reserve.id, fd);
      expect(blockedReserve.ok).toBe(false);
      const reserveRow = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(reserveRow.savedCents).toBe(0);
      expect(reserveRow.name).toBe('Home repair');

      const blockedDebt = await updateGoalSaved(debt.id, fd);
      expect(blockedDebt.ok).toBe(false);
      const debtRow = await prisma.goal.findUniqueOrThrow({ where: { id: debt.id } });
      expect(debtRow.savedCents).toBe(0);
      expect(debtRow.name).toBe('Debt-free by 2027-06');
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__goal_saved_refuses_blank_and_negative', async () => {
    const { updateGoalSaved } = await import('@/server/goal-actions');
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
      blank.set('saved', '   ');
      const blankRes = await updateGoalSaved(goal.id, blank);
      expect(blankRes.ok).toBe(false);
      expect(blankRes.errors?.saved).toMatch(/\$0 or more/);

      const negative = new FormData();
      negative.set('saved', '-1');
      const negativeRes = await updateGoalSaved(goal.id, negative);
      expect(negativeRes.ok).toBe(false);
      expect(negativeRes.errors?.saved).toMatch(/\$0 or more/);

      const still = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(still.savedCents).toBe(40_000);
      expect(still.name).toBe('Emergency fund');
      expect(still.targetCents).toBe(1_000_000);

      const zero = new FormData();
      zero.set('saved', '0');
      const zeroRes = await updateGoalSaved(goal.id, zero);
      expect(zeroRes.ok).toBe(true);
      const row = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(row.savedCents).toBe(0);
      expect(row.name).toBe('Emergency fund');
      expect(row.targetCents).toBe(1_000_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__goal_saved_demo_cannot_learn', async () => {
    const { updateGoalSaved } = await import('@/server/goal-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('saved', '2500');
      const res = await updateGoalSaved('any', fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
