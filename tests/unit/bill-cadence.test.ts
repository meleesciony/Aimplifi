/**
 * Repeating-bill cadence on the spending plan (DECISIONS #608).
 *
 * A repeating bill's cadence was detection-only. Overlay rewrites cadence
 * after identity is stamped: name, typical charge, and loan identity stay
 * put. Unnamed keys do not drift. Loans refuse. Demo cannot learn.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/spending-plan', () => ({ getSpendingPlan: vi.fn() }));

import { prisma } from '@/lib/db';
import {
  applyBillAmountOverlays,
  applyBillCadenceOverlays,
  billCadenceError,
  billRenameKey,
  stampBillKeys,
} from '@/lib/engine/spending-plan/bill-rename';
import { buildFixedList } from '@/lib/engine/spending-plan/fixed-line-items';
import {
  monthlyRateCents,
  recurringOutsideFixedCategoryRows,
} from '@/lib/engine/spending-plan/plan';

const USER = `bill-cadence-${Date.now()}-${process.pid}`;
const KEY = 'Comcast';
const nameOfCategory = (id: string) => (id === 'utilities' ? 'Utilities' : id);

const detected = {
  amountCents: -9_000,
  cadence: 'MONTHLY' as const,
  categoryId: 'utilities',
  merchantCanonical: 'Comcast',
};

describe('Spending plan surface lets the household change a repeating bill cadence', () => {
  it('test_regression__spending_plan_bill_cadence_control_is_on_the_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('BillCadenceControl');
    const control = readFileSync(
      resolve('src/components/finance/bill-cadence-form.tsx'),
      'utf8',
    );
    expect(control).toContain('updateBillCadence');
    expect(control).toContain('Save rhythm');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('useActionState');
  });
});

describe('applyBillCadenceOverlays — rhythm, never a name or loan', () => {
  it('test_regression__household_can_change_how_often_a_repeating_bill_comes_around', () => {
    const stamped = stampBillKeys([detected]);
    const key = billRenameKey(stamped[0]!);
    const overlaid = applyBillCadenceOverlays(stamped, new Map([[key, 'QUARTERLY']]));
    const { rows } = recurringOutsideFixedCategoryRows(overlaid, () => true, new Set());
    const list = buildFixedList({
      plan: {
        fixedBasis: 'category-designations',
        suggestedFixedCents: monthlyRateCents(9_000, 'QUARTERLY'),
        fixedExpensesCents: monthlyRateCents(9_000, 'QUARTERLY'),
        fixedLineItems: rows,
        fixedLineItemsCoverRemainder: true,
        reserveLines: [],
      },
      rollupRows: [],
      nameOfCategory,
    });
    expect(overlaid[0]!.cadence).toBe('QUARTERLY');
    expect(overlaid[0]!.amountCents).toBe(-9_000);
    expect(list.lines[0]!.cadence).toBe('QUARTERLY');
    expect(list.lines[0]!.amountCents).toBe(monthlyRateCents(9_000, 'QUARTERLY'));
    expect(list.lines[0]!.label).toBe('Comcast');
    expect(list.lines[0]!.billKey).toBe(key);
    expect(list.totalCents).toBe(monthlyRateCents(9_000, 'QUARTERLY'));
  });

  it('test_regression__bill_cadence_overlay_does_not_drift_unnamed_bill_key', () => {
    const unnamed = {
      amountCents: -9_000,
      cadence: 'MONTHLY' as const,
      categoryId: 'utilities',
    };
    const stamped = stampBillKeys([unnamed]);
    expect(stamped[0]!.billKey).toBe('unnamed:utilities:MONTHLY');
    const overlaid = applyBillCadenceOverlays(
      stamped,
      new Map([['unnamed:utilities:MONTHLY', 'QUARTERLY']]),
    );
    expect(overlaid[0]!.cadence).toBe('QUARTERLY');
    expect(billRenameKey(overlaid[0]!)).toBe('unnamed:utilities:MONTHLY');
    const { rows } = recurringOutsideFixedCategoryRows(overlaid, () => true, new Set());
    expect(rows[0]!.cadence).toBe('QUARTERLY');
    expect(rows[0]!.monthlyRateCents).toBe(monthlyRateCents(9_000, 'QUARTERLY'));
    expect(billRenameKey(rows[0]!)).toBe('unnamed:utilities:MONTHLY');
  });

  it('test_regression__bill_amount_overlay_still_wins_when_cadence_is_overlaid', () => {
    const stamped = stampBillKeys([detected]);
    const cadenced = applyBillCadenceOverlays(stamped, new Map([[KEY, 'QUARTERLY']]));
    const both = applyBillAmountOverlays(cadenced, new Map([[KEY, 8_000]]));
    const { rows } = recurringOutsideFixedCategoryRows(both, () => true, new Set());
    expect(rows[0]!.monthlyRateCents).toBe(8_000);
    expect(rows[0]!.cadence).toBe('QUARTERLY');
  });

  it('test_regression__bill_cadence_overlay_skips_loan_payments', () => {
    const loan = { ...detected, loanPayment: true, merchantCanonical: 'Mr Cooper' };
    const stamped = stampBillKeys([loan]);
    const overlaid = applyBillCadenceOverlays(stamped, new Map([['Mr Cooper', 'QUARTERLY']]));
    expect(overlaid[0]!.cadence).toBe('MONTHLY');
    const { rows } = recurringOutsideFixedCategoryRows(overlaid, () => true, new Set());
    expect(rows[0]!.monthlyRateCents).toBe(9_000);
  });

  it('test_regression__bill_cadence_refuses_blank_and_unknown', () => {
    expect(billCadenceError('')).toMatch(/how often/);
    expect(billCadenceError('   ')).toMatch(/how often/);
    expect(billCadenceError('IRREGULAR')).toMatch(/weekly through yearly/);
    expect(billCadenceError('QUARTERLY')).toBeUndefined();
    expect(billCadenceError('WEEKLY')).toBeUndefined();
  });
});

describe('updateBillCadence — overlay only; detection cadence stays put', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.billCadence.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__update_bill_cadence_persists_without_rewriting_detection', async () => {
    const { getSpendingPlan } = await import('@/server/spending-plan');
    vi.mocked(getSpendingPlan).mockResolvedValue({
      fixedList: {
        lines: [{ kind: 'recurring-bill', billKey: KEY, loanPayment: false }],
      },
      fixedLineItems: [{ merchantCanonical: KEY, categoryId: 'utilities', cadence: 'MONTHLY' }],
    } as never);

    const { updateBillCadence } = await import('@/server/bill-cadence-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const fd = new FormData();
      fd.set('cadence', 'QUARTERLY');
      const res = await updateBillCadence(KEY, fd);
      expect(res.ok).toBe(true);
      const row = await prisma.billCadence.findUniqueOrThrow({
        where: { userId_billKey: { userId: USER, billKey: KEY } },
      });
      expect(row.cadence).toBe('QUARTERLY');
      expect(await prisma.billRename.count({ where: { userId: USER } })).toBe(0);
      expect(await prisma.billAmount.count({ where: { userId: USER } })).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__bill_cadence_refuses_a_loan_payment', async () => {
    const { getSpendingPlan } = await import('@/server/spending-plan');
    vi.mocked(getSpendingPlan).mockResolvedValue({
      fixedList: {
        lines: [{ kind: 'recurring-bill', billKey: 'Mr Cooper', loanPayment: true }],
      },
      fixedLineItems: [{ merchantCanonical: 'Mr Cooper', cadence: 'MONTHLY' }],
    } as never);
    const { updateBillCadence } = await import('@/server/bill-cadence-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const fd = new FormData();
      fd.set('cadence', 'QUARTERLY');
      const res = await updateBillCadence('Mr Cooper', fd);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/loan/i);
      expect(await prisma.billCadence.count({ where: { userId: USER, billKey: 'Mr Cooper' } })).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__bill_cadence_demo_cannot_learn', async () => {
    const { updateBillCadence } = await import('@/server/bill-cadence-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('cadence', 'QUARTERLY');
      const res = await updateBillCadence(KEY, fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
