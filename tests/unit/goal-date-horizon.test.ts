/**
 * TASKS GL.5 — the 1200-month planning horizon is a WRITER's rule, not only a
 * solver's saturation point. `wholeMonthsUntil` caps at MAX_MONTHS (1200), so a
 * >100-year target date used to be stored and then planned against the cap while
 * the card printed the reader's own far figure — an overstated required monthly
 * and a fake lag. `updateGoalTargetDate` now refuses a target month whose deadline
 * (the month's END — GP-L) lies past the horizon, and the form input carries `max`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { MAX_PLANNING_MONTHS } from '@/lib/engine/solve/debt-free-by-date';

const USER = `goal-date-horizon-${Date.now()}-${process.pid}`;

function monthOf(offset: number): string {
  // YYYY-MM at `offset` whole months past the pinned vitest today (2026-06-10).
  const d = new Date(Date.UTC(2026, 5 + offset, 15));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

describe('updateGoalTargetDate refuses a target month past the 1200-month horizon (GL.5)', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__goal_target_date_past_the_planning_horizon_is_refused', async () => {
    const { updateGoalTargetDate } = await import('@/server/goal-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const goal = await prisma.goal.create({
        data: { userId: USER, name: 'Far future', kind: null, targetCents: 100_000, savedCents: 0 },
      });

      // The month AFTER the horizon: judged on its END, which is past today+1200 months.
      const fd = new FormData();
      fd.set('targetDate', monthOf(MAX_PLANNING_MONTHS + 1));
      const res = await updateGoalTargetDate(goal.id, fd);
      expect(res.ok).toBe(false);
      expect(res.errors?.targetDate).toBeTruthy();
      // The refusal names the horizon month, not a generic error.
      expect(res.errors?.targetDate).toContain('100 years');

      // Nothing was written.
      const row = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(row.targetDate).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('accepts a target month ON the horizon (its end is exactly the last planned month)', async () => {
    const { updateGoalTargetDate } = await import('@/server/goal-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const goal = await prisma.goal.create({
        data: { userId: USER, name: 'Edge of plan', kind: null, targetCents: 100_000, savedCents: 0 },
      });

      const fd = new FormData();
      fd.set('targetDate', monthOf(MAX_PLANNING_MONTHS));
      const res = await updateGoalTargetDate(goal.id, fd);
      expect(res.ok).toBe(true);
      const row = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(row.targetDate).toBe(`${monthOf(MAX_PLANNING_MONTHS)}-01`);
    } finally {
      spy.mockRestore();
    }
  });

  it('still accepts an ordinary near-term month and stores it as the 1st', async () => {
    const { updateGoalTargetDate } = await import('@/server/goal-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const goal = await prisma.goal.create({
        data: { userId: USER, name: 'Normal date', kind: null, targetCents: 100_000, savedCents: 0 },
      });

      const fd = new FormData();
      fd.set('targetDate', '2027-06');
      const res = await updateGoalTargetDate(goal.id, fd);
      expect(res.ok).toBe(true);
      const row = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
      expect(row.targetDate).toBe('2027-06-01');
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__goal_target_date_input_carries_the_horizon_max', () => {
    // The disclosure half: the form's month input advertises the same ceiling
    // natively (max), and the helper text names it. Source lock — the rendering
    // itself is covered by the goals e2e.
    const control = readFileSync(resolve('src/components/finance/goal-target-date-form.tsx'), 'utf8');
    expect(control).toContain('max={maxMonthValue()}');
    expect(control).toContain('MAX_PLANNING_MONTHS');
    expect(control).toContain('100 years');
  });
});

describe('the horizon is EVERY date writer\'s rule (GL.5 critic P1-3)', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    // The Ask solvers resolve safe-to-spend through the payment account.
    await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 500_000 },
    });
    await prisma.user.update({
      where: { id: USER },
      data: { paymentAccountId: (await prisma.account.findFirstOrThrow({ where: { userId: USER } })).id },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__ask_savings_goal_save_refuses_a_past_horizon_date', async () => {
    const { saveSavingsGoal } = await import('@/server/goal-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      // Far past the horizon (year 2200): the solver itself would call it
      // "reachable" at the saturated 1200 months — the writer must refuse.
      await expect(saveSavingsGoal('2200-01-01', 1_200_000)).rejects.toThrow(/100 years/);
      const saved = await prisma.goal.findMany({ where: { userId: USER } });
      expect(saved).toHaveLength(0); // nothing persisted
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__ask_debt_free_goal_save_refuses_a_past_horizon_date', async () => {
    const { saveDebtFreeGoal } = await import('@/server/goal-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      await expect(saveDebtFreeGoal('2200-01-01')).rejects.toThrow(/100 years/);
      const saved = await prisma.goal.findMany({ where: { userId: USER } });
      expect(saved).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
