/**
 * Repeating-bill names on the spending plan (DECISIONS #580).
 *
 * An unnamed bill printed "A recurring bill we detected" with no way to
 * give it a household name. Overlay only — dollars stay put.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/spending-plan', () => ({ getSpendingPlan: vi.fn() }));

import { prisma } from '@/lib/db';
import {
  MAX_BILL_NAME,
  UNNAMED_BILL_LABEL,
  billNameError,
  billRenameKey,
  namedBillLabel,
} from '@/lib/engine/spending-plan/bill-rename';
import { buildFixedList } from '@/lib/engine/spending-plan/fixed-line-items';
import { recurringOutsideFixedCategoryRows } from '@/lib/engine/spending-plan/plan';

const USER = `bill-rename-${Date.now()}-${process.pid}`;
const nameOfCategory = (id: string) => (id === 'utilities' ? 'Utilities' : id);

describe('namedBillLabel — overlay, never a guessed category name', () => {
  it('test_regression__unnamed_bill_stays_unnamed_without_overlay', () => {
    const { rows } = recurringOutsideFixedCategoryRows(
      [{ amountCents: -5_000, cadence: 'MONTHLY', categoryId: 'utilities' }],
      () => true,
      new Set(),
    );
    expect(namedBillLabel(rows[0]!, new Map(), nameOfCategory)).toContain(UNNAMED_BILL_LABEL);
    expect(namedBillLabel(rows[0]!, new Map(), nameOfCategory)).not.toBe('Utilities');
  });

  it('test_regression__household_can_name_a_repeating_bill', () => {
    const { rows } = recurringOutsideFixedCategoryRows(
      [{ amountCents: -5_000, cadence: 'MONTHLY', categoryId: 'utilities' }],
      () => true,
      new Set(),
    );
    const key = billRenameKey(rows[0]!);
    const names = new Map([[key, 'HOA dues']]);
    const list = buildFixedList({
      plan: {
        fixedBasis: 'category-designations',
        suggestedFixedCents: 5_000,
        fixedExpensesCents: 5_000,
        fixedLineItems: rows,
        fixedLineItemsCoverRemainder: true,
        reserveLines: [],
      },
      rollupRows: [],
      nameOfCategory,
      billNames: names,
    });
    expect(list.lines[0]!.label).toBe('HOA dues');
    expect(list.lines[0]!.label).not.toContain(UNNAMED_BILL_LABEL);
    expect(list.lines[0]!.amountCents).toBe(5_000);
    expect(list.lines[0]!.billKey).toBe(key);
    expect(list.lines[0]!.nameOverlaid).toBe(true);
  });

  it('test_regression__bill_name_refuses_blank_and_over_cap', () => {
    expect(billNameError('')).toMatch(/Give the bill a name/);
    expect(billNameError('   ')).toMatch(/Give the bill a name/);
    expect(billNameError('x'.repeat(MAX_BILL_NAME + 1))).toMatch(/under 60/);
    expect(billNameError('Internet')).toBeUndefined();
  });
});

describe('Spending plan surface lets the household name a repeating bill', () => {
  it('test_regression__spending_plan_bill_name_control_is_on_the_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('BillNameControl');
    const control = readFileSync(resolve('src/components/finance/rename-bill-form.tsx'), 'utf8');
    expect(control).toContain('renameBill');
    expect(control).toContain('clearBillName');
    expect(control).toContain('Save name');
    expect(control).toContain('Clear name');
    expect(control).toContain('onSubmit');
    expect(control).not.toContain('useActionState');
  });
});

describe('renameBill — overlay only; dollars stay put', () => {
  const KEY = 'unnamed:utilities:MONTHLY';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.billRename.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__rename_bill_persists_name_and_leaves_identity', async () => {
    const { getSpendingPlan } = await import('@/server/spending-plan');
    vi.mocked(getSpendingPlan).mockResolvedValue({
      fixedList: { lines: [{ kind: 'recurring-bill', billKey: KEY }] },
      fixedLineItems: [
        { merchantCanonical: null, categoryId: 'utilities', cadence: 'MONTHLY' },
      ],
    } as never);

    const { renameBill } = await import('@/server/bill-rename-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const fd = new FormData();
      fd.set('name', '  HOA dues  ');
      const res = await renameBill(KEY, fd);
      expect(res.ok).toBe(true);
      const row = await prisma.billRename.findUniqueOrThrow({
        where: { userId_billKey: { userId: USER, billKey: KEY } },
      });
      expect(row.name).toBe('HOA dues');
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__rename_bill_refuses_blank', async () => {
    const { renameBill } = await import('@/server/bill-rename-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const fd = new FormData();
      fd.set('name', '   ');
      const res = await renameBill(KEY, fd);
      expect(res.ok).toBe(false);
      expect(res.errors?.name).toMatch(/Give the bill a name/);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__rename_bill_demo_cannot_learn', async () => {
    const { renameBill } = await import('@/server/bill-rename-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const fd = new FormData();
      fd.set('name', 'Internet');
      const res = await renameBill(KEY, fd);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__household_can_clear_a_repeating_bill_name_back_to_what_the_app_detected', async () => {
    const { getSpendingPlan } = await import('@/server/spending-plan');
    vi.mocked(getSpendingPlan).mockResolvedValue({
      fixedList: { lines: [{ kind: 'recurring-bill', billKey: KEY }] },
      fixedLineItems: [
        { merchantCanonical: null, categoryId: 'utilities', cadence: 'MONTHLY' },
      ],
    } as never);

    const { renameBill, clearBillName } = await import('@/server/bill-rename-actions');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const fd = new FormData();
      fd.set('name', 'HOA dues');
      expect((await renameBill(KEY, fd)).ok).toBe(true);
      expect(
        await prisma.billRename.findUnique({
          where: { userId_billKey: { userId: USER, billKey: KEY } },
        }),
      ).not.toBeNull();

      const res = await clearBillName(KEY);
      expect(res.ok).toBe(true);
      expect(
        await prisma.billRename.findUnique({
          where: { userId_billKey: { userId: USER, billKey: KEY } },
        }),
      ).toBeNull();

      const again = await clearBillName(KEY);
      expect(again.ok).toBe(false);
      expect(again.error).toMatch(/already what the app detected/);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__clear_bill_name_demo_cannot_learn', async () => {
    const { clearBillName } = await import('@/server/bill-rename-actions');
    const { DEMO_ENTRY_BLOCKED } = await import('@/lib/demo-user');
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const res = await clearBillName(KEY);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(DEMO_ENTRY_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });
});
