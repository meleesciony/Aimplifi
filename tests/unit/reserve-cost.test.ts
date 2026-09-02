/**
 * Typed reserve true-cost edit on the spending plan (DECISIONS #582).
 *
 * A reserve already on the plan could only be created, renamed, or deleted.
 * Changing the whole cost meant delete-and-recreate. Overlay is the COST —
 * name, cadence, and convert pairing stay put. Converted bill-paired
 * reserves refuse the write so the swap stays exact.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';

const USER = `rsv-cost-${Date.now()}-${process.pid}`;

describe('Spending plan surface lets the household change a reserve cost', () => {
  it('test_regression__spending_plan_reserve_cost_control_is_on_the_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('ReserveCostControl');
    const control = readFileSync(
      resolve('src/components/finance/reserve-cost-form.tsx'),
      'utf8',
    );
    expect(control).toContain('updateReserveCost');
    expect(control).toContain('Save cost');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('form-action');
    expect(control).not.toContain('useActionState');
  });
});

describe('updateReserveCost — the write is the true cost, never a name', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__household_can_change_a_reserve_true_cost', async () => {
    const { updateReserveCost } = await import('@/server/reserve-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
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
      const fd = new FormData();
      fd.set('amount', ' 1500 ');
      const res = await updateReserveCost(reserve.id, fd);
      expect(res.ok).toBe(true);

      const row = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(row.targetCents).toBe(150_000);
      expect(row.name).toBe('Home repair');
      expect(row.cadence).toBe('ANNUAL');
      expect(row.monthlyContributionCents).toBeNull();
      expect(row.merchantCanonical).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__converted_reserve_cost_stays_with_the_bill', async () => {
    const { updateReserveCost } = await import('@/server/reserve-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const reserve = await prisma.goal.create({
        data: {
          userId: USER,
          name: 'COMCAST',
          kind: RESERVE_KIND,
          targetCents: 119_880,
          cadence: 'ANNUAL',
          savedCents: 0,
          monthlyContributionCents: null,
          merchantCanonical: 'COMCAST',
        },
      });
      const fd = new FormData();
      fd.set('amount', '2000');
      const res = await updateReserveCost(reserve.id, fd);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/paired with a bill/);
      const row = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(row.targetCents).toBe(119_880);
      expect(row.cadence).toBe('ANNUAL');
      expect(row.merchantCanonical).toBe('COMCAST');
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__reserve_cost_refuses_blank_and_zero', async () => {
    const { updateReserveCost } = await import('@/server/reserve-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const reserve = await prisma.goal.create({
        data: {
          userId: USER,
          name: 'Gym dues',
          kind: RESERVE_KIND,
          targetCents: 36_000,
          cadence: 'ANNUAL',
          savedCents: 0,
          monthlyContributionCents: null,
        },
      });
      const blank = new FormData();
      blank.set('amount', '   ');
      const blankRes = await updateReserveCost(reserve.id, blank);
      expect(blankRes.ok).toBe(false);
      expect(blankRes.errors?.amount).toMatch(/whole cost/);

      const zero = new FormData();
      zero.set('amount', '0');
      const zeroRes = await updateReserveCost(reserve.id, zero);
      expect(zeroRes.ok).toBe(false);
      expect(zeroRes.errors?.amount).toMatch(/whole cost/);

      const row = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(row.targetCents).toBe(36_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__reserve_cost_demo_cannot_learn', async () => {
    const { updateReserveCost } = await import('@/server/reserve-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('amount', '1500');
      const res = await updateReserveCost('any', fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
