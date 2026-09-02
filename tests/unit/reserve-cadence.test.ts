/**
 * Typed reserve cadence edit on the spending plan (DECISIONS #583).
 *
 * A reserve already on the plan could have its cost changed, but not how
 * often that cost comes around. Overlay is the CADENCE — name, true cost,
 * and convert pairing stay put. Converted bill-paired reserves refuse
 * the write so the swap stays exact.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';

const USER = `rsv-cadence-${Date.now()}-${process.pid}`;

describe('Spending plan surface lets the household change reserve cadence', () => {
  it('test_regression__spending_plan_reserve_cadence_control_is_on_the_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('ReserveCadenceControl');
    const control = readFileSync(
      resolve('src/components/finance/reserve-cadence-form.tsx'),
      'utf8',
    );
    expect(control).toContain('updateReserveCadence');
    expect(control).toContain('Save rhythm');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('form-action');
    expect(control).not.toContain('useActionState');
  });
});

describe('updateReserveCadence — the write is the rhythm, never the dollars', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__household_can_change_typed_reserve_cadence', async () => {
    const { updateReserveCadence } = await import('@/server/reserve-actions');
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
      fd.set('cadence', 'QUARTERLY');
      const res = await updateReserveCadence(reserve.id, fd);
      expect(res.ok).toBe(true);

      const row = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(row.cadence).toBe('QUARTERLY');
      expect(row.targetCents).toBe(120_000);
      expect(row.name).toBe('Home repair');
      expect(row.monthlyContributionCents).toBeNull();
      expect(row.merchantCanonical).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__converted_reserve_cadence_stays_with_the_bill', async () => {
    const { updateReserveCadence } = await import('@/server/reserve-actions');
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
      fd.set('cadence', 'MONTHLY');
      const res = await updateReserveCadence(reserve.id, fd);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/paired with a bill/);
      const row = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(row.cadence).toBe('ANNUAL');
      expect(row.targetCents).toBe(119_880);
      expect(row.merchantCanonical).toBe('COMCAST');
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__reserve_cadence_refuses_blank_and_unknown', async () => {
    const { updateReserveCadence } = await import('@/server/reserve-actions');
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
      blank.set('cadence', '   ');
      const blankRes = await updateReserveCadence(reserve.id, blank);
      expect(blankRes.ok).toBe(false);
      expect(blankRes.errors?.cadence).toMatch(/how often/);

      const bogus = new FormData();
      bogus.set('cadence', 'YEARLY');
      const bogusRes = await updateReserveCadence(reserve.id, bogus);
      expect(bogusRes.ok).toBe(false);
      expect(bogusRes.errors?.cadence).toMatch(/how often/);

      const row = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(row.cadence).toBe('ANNUAL');
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__reserve_cadence_demo_cannot_learn', async () => {
    const { updateReserveCadence } = await import('@/server/reserve-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('cadence', 'MONTHLY');
      const res = await updateReserveCadence('any', fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
