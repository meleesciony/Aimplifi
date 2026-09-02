/**
 * Take a repeating bill off the spending plan (DECISIONS #591).
 *
 * The household could name a bill on the plan but could not take it off
 * from that page. NOT_BILL overlay; transactions stay. Loan payments and
 * unnamed (no-payee) bills are refused. Demo cannot learn.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { DEMO_ENTRY_BLOCKED } from '@/lib/demo-user';
import { takeRepeatingBillOffPlan } from '@/server/bill-rename-actions';
import { getSpendingPlan } from '@/server/spending-plan';

const USER = `bill-off-${Date.now()}-${process.pid}`;
const TODAY = '2026-06-10';
const DESC = 'RIVER BEND INTERNET 4419';
const KEEP_DESC = 'LAKESIDE PROPERTY MGMT RENT';

describe('Spending plan surface lets the household take a repeating bill off', () => {
  it('test_regression__spending_plan_take_bill_off_control_is_on_the_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('TakeBillOffPlanButton');
    const control = readFileSync(
      resolve('src/components/finance/take-bill-off-plan-button.tsx'),
      'utf8',
    );
    expect(control).toContain('takeRepeatingBillOffPlan');
    expect(control).toContain('Take off plan?');
    expect(control).toContain('onClick');
    expect(control).not.toContain('useActionState');
  });
});

describe('takeRepeatingBillOffPlan — real plan path', () => {
  let checkingId = '';

  const wipe = async () => {
    await prisma.recurringOverride.deleteMany({ where: { userId: USER } });
    await prisma.recurringSeries.deleteMany({ where: { userId: USER } });
    await prisma.scheduledTransaction.deleteMany({ where: { account: { userId: USER } } });
    await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  };

  beforeAll(async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const checking = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'manual',
        providerRef: `${USER}-chk`,
        name: 'Everyday Checking',
        type: 'CHECKING',
        currentBalanceCents: 800000,
        currency: 'USD',
      },
    });
    checkingId = checking.id;
    await prisma.user.update({ where: { id: USER }, data: { paymentAccountId: checkingId } });
    await prisma.transaction.createMany({
      data: [
        { accountId: checkingId, date: '2026-03-08', amountCents: -7999, rawDescriptor: DESC, categoryId: null, confidenceBps: 0, needsReview: true },
        { accountId: checkingId, date: '2026-04-08', amountCents: -7999, rawDescriptor: DESC, categoryId: null, confidenceBps: 0, needsReview: true },
        { accountId: checkingId, date: '2026-05-08', amountCents: -7999, rawDescriptor: DESC, categoryId: null, confidenceBps: 0, needsReview: true },
        { accountId: checkingId, date: '2026-03-15', amountCents: -125000, rawDescriptor: KEEP_DESC, categoryId: null, confidenceBps: 0, needsReview: true },
        { accountId: checkingId, date: '2026-04-15', amountCents: -125000, rawDescriptor: KEEP_DESC, categoryId: null, confidenceBps: 0, needsReview: true },
        { accountId: checkingId, date: '2026-05-15', amountCents: -125000, rawDescriptor: KEEP_DESC, categoryId: null, confidenceBps: 0, needsReview: true },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await wipe();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv('DEMO_TODAY', TODAY);
  });

  it('test_regression__household_can_take_a_repeating_bill_off_the_spending_plan', async () => {
    const before = await getSpendingPlan(USER);
    const bill = before.fixedList.lines.find(
      (l) => l.kind === 'recurring-bill' && (l.label.includes('River Bend') || l.billKey?.includes('River Bend')),
    );
    expect(bill, 'internet series must be on the plan before take-off').toBeTruthy();
    const keep = before.fixedList.lines.find(
      (l) => l.kind === 'recurring-bill' && (l.label.includes('Lakeside') || l.billKey?.includes('Lakeside')),
    );
    expect(keep, 'rent series stays as the control bill').toBeTruthy();
    const billKey = bill!.billKey!;
    const keepKey = keep!.billKey!;

    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const res = await takeRepeatingBillOffPlan(billKey);
      expect(res).toEqual({ ok: true });
    } finally {
      spy.mockRestore();
    }

    const after = await getSpendingPlan(USER);
    expect(after.fixedList.lines.some((l) => l.billKey === billKey)).toBe(false);
    expect(after.fixedList.lines.some((l) => l.billKey === keepKey)).toBe(true);
    const leftoverTx = await prisma.transaction.count({
      where: { accountId: checkingId, rawDescriptor: DESC },
    });
    expect(leftoverTx).toBe(3);
    const row = await prisma.recurringOverride.findFirst({
      where: { userId: USER, merchantCanonical: billKey },
    });
    expect(row).toMatchObject({ decision: 'NOT_BILL', cadence: null });
  });
});

describe('takeRepeatingBillOffPlan — refusals', () => {
  it('test_regression__take_bill_off_plan_refuses_loan_payment', async () => {
    const spending = await import('@/server/spending-plan');
    const planSpy = vi.spyOn(spending, 'getSpendingPlan').mockResolvedValue({
      fixedList: {
        lines: [{ kind: 'recurring-bill', billKey: 'Mortgage Servicer', loanPayment: true }],
      },
      fixedLineItems: [{ merchantCanonical: 'Mortgage Servicer', categoryId: 'rent', cadence: 'MONTHLY' }],
    } as never);
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const res = await takeRepeatingBillOffPlan('Mortgage Servicer');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/loan payment stays on the plan/i);
    } finally {
      spy.mockRestore();
      planSpy.mockRestore();
    }
  });

  it('test_regression__take_bill_off_plan_refuses_unnamed', async () => {
    const spending = await import('@/server/spending-plan');
    const planSpy = vi.spyOn(spending, 'getSpendingPlan').mockResolvedValue({
      fixedList: {
        lines: [{ kind: 'recurring-bill', billKey: 'unnamed:internet:MONTHLY', loanPayment: false }],
      },
      fixedLineItems: [{ merchantCanonical: null, categoryId: 'internet', cadence: 'MONTHLY' }],
    } as never);
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const res = await takeRepeatingBillOffPlan('unnamed:internet:MONTHLY');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/no payee/i);
    } finally {
      spy.mockRestore();
      planSpy.mockRestore();
    }
  });

  it('test_regression__take_bill_off_plan_demo_cannot_learn', async () => {
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const res = await takeRepeatingBillOffPlan('River Bend Internet');
      expect(res).toEqual({ ok: false, error: DEMO_ENTRY_BLOCKED });
    } finally {
      spy.mockRestore();
    }
  });
});
