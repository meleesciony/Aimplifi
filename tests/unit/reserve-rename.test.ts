/**
 * Spending-plan envelope names (DECISIONS #579).
 *
 * A reserve already on the plan could only be created with a name, then
 * deleted. Converted bills kept the merchant spelling. The household
 * could not name an envelope already sitting on the plan.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import {
  MAX_RESERVE_NAME,
  RESERVE_KIND,
  reserveNameError,
} from '@/lib/engine/spending-plan/reserves';

const USER = `rsv-rename-${Date.now()}-${process.pid}`;

describe('reserveNameError — the name is a name, never dollars', () => {
  it('test_regression__spending_plan_envelope_name_refuses_blank_and_over_cap', () => {
    expect(reserveNameError('')).toMatch(/Give the reserve a name/);
    expect(reserveNameError('   ')).toMatch(/Give the reserve a name/);
    expect(reserveNameError('x'.repeat(MAX_RESERVE_NAME + 1))).toMatch(/under 60/);
    expect(reserveNameError('Internet')).toBeUndefined();
    expect(reserveNameError('  Home repair  ')).toBeUndefined();
  });
});

describe('Spending plan surface lets the household name an envelope', () => {
  it('test_regression__spending_plan_envelope_name_control_is_on_the_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('ReserveNameControl');
    expect(page).not.toMatch(
      /<span className="text-foreground" data-testid="reserve-row-name">/,
    );

    const control = readFileSync(
      resolve('src/components/finance/rename-reserve-form.tsx'),
      'utf8',
    );
    expect(control).toContain('renameReserve');
    expect(control).toContain('Save name');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('form-action');
    expect(control).not.toContain('useActionState');
  });
});

describe('renameReserve — the write is a name, never a money figure', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__spending_plan_can_name_each_envelope', async () => {
    const { renameReserve } = await import('@/server/reserve-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const reserve = await prisma.goal.create({
        data: {
          userId: USER,
          name: 'COMCAST',
          kind: RESERVE_KIND,
          targetCents: 120_000,
          cadence: 'ANNUAL',
          savedCents: 0,
          monthlyContributionCents: null,
        },
      });
      const savings = await prisma.goal.create({
        data: {
          userId: USER,
          name: 'Emergency fund',
          kind: null,
          targetCents: 1_000_000,
          savedCents: 0,
          monthlyContributionCents: 25_000,
        },
      });

      const fd = new FormData();
      fd.set('name', '  Internet  ');
      const res = await renameReserve(reserve.id, fd);
      expect(res.ok).toBe(true);

      const renamed = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(renamed.name).toBe('Internet');
      expect(renamed.targetCents).toBe(120_000);
      expect(renamed.cadence).toBe('ANNUAL');
      expect(renamed.monthlyContributionCents).toBeNull();

      const savingsFd = new FormData();
      savingsFd.set('name', 'Not a reserve');
      const blocked = await renameReserve(savings.id, savingsFd);
      expect(blocked.ok).toBe(false);
      const savingsRow = await prisma.goal.findUniqueOrThrow({ where: { id: savings.id } });
      expect(savingsRow.name).toBe('Emergency fund');
      expect(savingsRow.monthlyContributionCents).toBe(25_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__spending_plan_envelope_rename_refuses_blank', async () => {
    const { renameReserve } = await import('@/server/reserve-actions');
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
      const fd = new FormData();
      fd.set('name', '   ');
      const res = await renameReserve(reserve.id, fd);
      expect(res.ok).toBe(false);
      expect(res.errors?.name).toMatch(/Give the reserve a name/);
      const row = await prisma.goal.findUniqueOrThrow({ where: { id: reserve.id } });
      expect(row.name).toBe('Gym dues');
    } finally {
      spy.mockRestore();
    }
  });
});
