/**
 * Repeating-bill amount on the spending plan (DECISIONS #605).
 *
 * A repeating bill's dollars were detection-only. Overlay is MONTHLY rate:
 * name, cadence, and loan identity stay put. Loans refuse. Demo cannot learn.
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
  billMonthlyCentsError,
  billRenameKey,
  MAX_BILL_MONTHLY_CENTS,
} from '@/lib/engine/spending-plan/bill-rename';
import { buildFixedList } from '@/lib/engine/spending-plan/fixed-line-items';
import { recurringOutsideFixedCategoryRows } from '@/lib/engine/spending-plan/plan';

const USER = `bill-amount-${Date.now()}-${process.pid}`;
const KEY = 'Comcast';
const nameOfCategory = (id: string) => (id === 'utilities' ? 'Utilities' : id);

const detected = {
  amountCents: -5_000,
  cadence: 'MONTHLY' as const,
  categoryId: 'utilities',
  merchantCanonical: 'Comcast',
};

describe('Spending plan surface lets the household change a repeating bill amount', () => {
  it('test_regression__spending_plan_bill_amount_control_is_on_the_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('BillAmountControl');
    const control = readFileSync(
      resolve('src/components/finance/bill-amount-form.tsx'),
      'utf8',
    );
    expect(control).toContain('updateBillAmount');
    expect(control).toContain('Save amount');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('useActionState');
  });
});

describe('applyBillAmountOverlays — monthly rate, never a name or loan', () => {
  it('test_regression__household_can_change_a_repeating_bill_amount_on_the_spending_plan', () => {
    const key = billRenameKey(detected);
    const overlaid = applyBillAmountOverlays([detected], new Map([[key, 8_000]]));
    const { rows } = recurringOutsideFixedCategoryRows(overlaid, () => true, new Set());
    const list = buildFixedList({
      plan: {
        fixedBasis: 'category-designations',
        suggestedFixedCents: 8_000,
        fixedExpensesCents: 8_000,
        fixedLineItems: rows,
        fixedLineItemsCoverRemainder: true,
        reserveLines: [],
      },
      rollupRows: [],
      nameOfCategory,
    });
    expect(list.lines[0]!.amountCents).toBe(8_000);
    expect(list.lines[0]!.label).toBe('Comcast');
    expect(list.lines[0]!.cadence).toBe('MONTHLY');
    expect(list.lines[0]!.billKey).toBe(key);
    expect(list.totalCents).toBe(8_000);
  });

  it('test_regression__bill_amount_overlay_skips_loan_payments', () => {
    const loan = { ...detected, loanPayment: true, merchantCanonical: 'Mr Cooper' };
    const overlaid = applyBillAmountOverlays([loan], new Map([['Mr Cooper', 1]]));
    expect(overlaid[0]!.monthlyAmountOverlayCents).toBeUndefined();
    const { rows } = recurringOutsideFixedCategoryRows(overlaid, () => true, new Set());
    expect(rows[0]!.monthlyRateCents).toBe(5_000);
  });

  it('test_regression__bill_amount_refuses_blank_zero_and_over_cap', () => {
    expect(billMonthlyCentsError(null)).toMatch(/above \$0/);
    expect(billMonthlyCentsError(0)).toMatch(/above \$0/);
    expect(billMonthlyCentsError(-1)).toMatch(/above \$0/);
    expect(billMonthlyCentsError(MAX_BILL_MONTHLY_CENTS + 1)).toMatch(/too large/);
    expect(billMonthlyCentsError(8_000)).toBeUndefined();
  });
});

describe('updateBillAmount — overlay only; name and cadence stay put', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.billAmount.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__update_bill_amount_persists_monthly_cents_without_a_rename', async () => {
    const { getSpendingPlan } = await import('@/server/spending-plan');
    vi.mocked(getSpendingPlan).mockResolvedValue({
      fixedList: {
        lines: [{ kind: 'recurring-bill', billKey: KEY, loanPayment: false }],
      },
      fixedLineItems: [{ merchantCanonical: KEY, categoryId: 'utilities', cadence: 'MONTHLY' }],
    } as never);

    const { updateBillAmount } = await import('@/server/bill-amount-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const fd = new FormData();
      fd.set('amount', '$80.00');
      const res = await updateBillAmount(KEY, fd);
      expect(res.ok).toBe(true);
      const row = await prisma.billAmount.findUniqueOrThrow({
        where: { userId_billKey: { userId: USER, billKey: KEY } },
      });
      expect(row.monthlyCents).toBe(8_000);
      expect(await prisma.billRename.count({ where: { userId: USER } })).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__bill_amount_refuses_a_loan_payment', async () => {
    const { getSpendingPlan } = await import('@/server/spending-plan');
    vi.mocked(getSpendingPlan).mockResolvedValue({
      fixedList: {
        lines: [{ kind: 'recurring-bill', billKey: 'Mr Cooper', loanPayment: true }],
      },
      fixedLineItems: [{ merchantCanonical: 'Mr Cooper', cadence: 'MONTHLY' }],
    } as never);
    const { updateBillAmount } = await import('@/server/bill-amount-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const fd = new FormData();
      fd.set('amount', '100');
      const res = await updateBillAmount('Mr Cooper', fd);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/loan/i);
      expect(await prisma.billAmount.count({ where: { userId: USER, billKey: 'Mr Cooper' } })).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__bill_amount_demo_cannot_learn', async () => {
    const { updateBillAmount } = await import('@/server/bill-amount-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('amount', '80');
      const res = await updateBillAmount(KEY, fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Settings Fixed costs bill amount (DECISIONS #606)', () => {
  it('test_regression__household_can_change_a_repeating_bill_amount_from_settings_fixed_costs', () => {
    const card = readFileSync(resolve('src/components/settings/fixed-costs-card.tsx'), 'utf8');
    expect(card).toContain('BillAmountControl');
    expect(card).toContain("from '@/components/finance/bill-amount-form'");
    expect(card).toContain('amountTestId="fixed-costs-basis-amount"');
    expect(card).toContain('!l.loanPayment &&');
    expect(card).toContain('canWrite');
    expect(card).not.toContain('updateBillAmount(');
    const control = readFileSync(
      resolve('src/components/finance/bill-amount-form.tsx'),
      'utf8',
    );
    expect(control).toContain('updateBillAmount');
    expect(control).toContain('amountTestId');
  });
});
