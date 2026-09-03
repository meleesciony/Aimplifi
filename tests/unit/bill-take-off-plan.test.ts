/**
 * Take a repeating bill off the spending plan (DECISIONS #591 / #592 / #597).
 *
 * Payee bills: NOT_BILL overlay. Unnamed bills (no merchantCanonical): BillOffPlan
 * overlay keyed by billRenameKey. Transactions stay. Loan payments refused.
 * Demo cannot learn.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { DEMO_ENTRY_BLOCKED } from '@/lib/demo-user';
import { isoDate } from '@/lib/dates';
import {
  billRenameKey,
  excludeOffPlanBills,
} from '@/lib/engine/spending-plan/bill-rename';
import { buildFixedList } from '@/lib/engine/spending-plan/fixed-line-items';
import {
  computeSpendingPlan,
  type PlanScheduledItem,
} from '@/lib/engine/spending-plan/plan';
import { putRepeatingBillBackOnPlan, takeRepeatingBillOffPlan } from '@/server/bill-rename-actions';
import { getBillOffPlanKeys, getBillsTakenOffPlan } from '@/server/bill-names';
import { getSpendingPlan } from '@/server/spending-plan';

const USER = `bill-off-${Date.now()}-${process.pid}`;
const UNNAMED_USER = `bill-off-unnamed-${Date.now()}-${process.pid}`;
const TODAY = '2026-06-10';
const DESC = 'RIVER BEND INTERNET 4419';
const KEEP_DESC = 'LAKESIDE PROPERTY MGMT RENT';
const UNNAMED_DESC = 'MISC UTILITY DRAFT';

function planInput(scheduledFixed: PlanScheduledItem[]) {
  return {
    today: isoDate(TODAY),
    trailingMonthlyIncomeCents: [500_000],
    scheduledIncome: [] as PlanScheduledItem[],
    scheduledFixed,
    cardObligationsCents: 0,
    cardObligationsEstimated: false,
    obligationsBeyondMonthCents: 0,
    obligationsBeyondMonthThroughDate: null,
    obligationsBeyondMonthEstimated: false,
    goalContributionsCents: 0,
    savingsTargetBps: null,
  };
}

describe('Spending plan surface lets the household take a repeating bill off', () => {
  it('test_regression__spending_plan_take_bill_off_control_is_on_the_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('TakeBillOffPlanButton');
    expect(page).not.toContain("startsWith('unnamed:')");
    const control = readFileSync(
      resolve('src/components/finance/take-bill-off-plan-button.tsx'),
      'utf8',
    );
    expect(control).toContain('takeRepeatingBillOffPlan');
    expect(control).toContain('Take off plan?');
    expect(control).toContain('onClick');
    expect(control).not.toContain('useActionState');
    const loader = readFileSync(resolve('src/server/spending-plan.ts'), 'utf8');
    expect(loader).toContain('getBillOffPlanKeys');
    expect(loader).toContain('excludeOffPlanBills');
  });

  it('test_regression__spending_plan_put_bill_back_control_is_on_the_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('PutBillBackOnPlanButton');
    expect(page).toContain('bills-taken-off');
    const control = readFileSync(
      resolve('src/components/finance/put-bill-back-on-plan-button.tsx'),
      'utf8',
    );
    expect(control).toContain('putRepeatingBillBackOnPlan');
    expect(control).toContain('Put back?');
    expect(control).toContain('onClick');
    expect(control).not.toContain('useActionState');
    const loader = readFileSync(resolve('src/server/spending-plan.ts'), 'utf8');
    expect(loader).toContain('getBillsTakenOffPlan');
    expect(loader).toContain('billsTakenOff');
  });
});

describe('takeRepeatingBillOffPlan — real plan path', () => {
  let checkingId = '';

  const wipe = async () => {
    await prisma.billOffPlan.deleteMany({ where: { userId: USER } });
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

describe('unnamed repeating bill take-off (DECISIONS #592)', () => {
  const unnamedItem: PlanScheduledItem = {
    amountCents: -7_999,
    cadence: 'MONTHLY',
    categoryId: 'internet',
  };
  const namedItem: PlanScheduledItem = {
    amountCents: -125_000,
    cadence: 'MONTHLY',
    merchantCanonical: 'Lakeside Property Mgmt',
    categoryId: 'rent',
  };
  const unnamedKey = billRenameKey({
    merchantCanonical: null,
    categoryId: 'internet',
    cadence: 'MONTHLY',
  });
  const namedKey = billRenameKey(namedItem);
  let checkingId = '';

  const wipe = async () => {
    await prisma.billOffPlan.deleteMany({ where: { userId: UNNAMED_USER } });
    await prisma.transaction.deleteMany({ where: { account: { userId: UNNAMED_USER } } });
    await prisma.account.deleteMany({ where: { userId: UNNAMED_USER } });
    await prisma.user.deleteMany({ where: { id: UNNAMED_USER } });
  };

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: UNNAMED_USER, email: `${UNNAMED_USER}@test.local` } });
    const checking = await prisma.account.create({
      data: {
        userId: UNNAMED_USER,
        provider: 'manual',
        providerRef: `${UNNAMED_USER}-chk`,
        name: 'Everyday Checking',
        type: 'CHECKING',
        currentBalanceCents: 800000,
        currency: 'USD',
      },
    });
    checkingId = checking.id;
    await prisma.transaction.createMany({
      data: [
        { accountId: checkingId, date: '2026-03-08', amountCents: -7999, rawDescriptor: UNNAMED_DESC, categoryId: 'internet', confidenceBps: 0, needsReview: true },
        { accountId: checkingId, date: '2026-04-08', amountCents: -7999, rawDescriptor: UNNAMED_DESC, categoryId: 'internet', confidenceBps: 0, needsReview: true },
        { accountId: checkingId, date: '2026-05-08', amountCents: -7999, rawDescriptor: UNNAMED_DESC, categoryId: 'internet', confidenceBps: 0, needsReview: true },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await wipe();
  });

  it('test_regression__household_can_take_an_unnamed_repeating_bill_off_the_spending_plan', async () => {
    expect(unnamedKey.startsWith('unnamed:')).toBe(true);
    const beforeItems = [unnamedItem, namedItem];
    const beforePlan = computeSpendingPlan(planInput(beforeItems));
    const beforeList = buildFixedList({
      plan: beforePlan,
      rollupRows: [],
      nameOfCategory: (id) => id,
    });
    expect(beforeList.lines.some((l) => l.billKey === unnamedKey)).toBe(true);
    expect(beforeList.lines.some((l) => l.billKey === namedKey)).toBe(true);
    const unnamedCents = beforeList.lines.find((l) => l.billKey === unnamedKey)!.amountCents;
    const beforeFixed = beforePlan.fixedExpensesCents;

    const spending = await import('@/server/spending-plan');
    const planSpy = vi.spyOn(spending, 'getSpendingPlan').mockResolvedValue({
      fixedList: {
        lines: [
          { kind: 'recurring-bill', billKey: unnamedKey, loanPayment: false },
          { kind: 'recurring-bill', billKey: namedKey, loanPayment: false },
        ],
      },
      fixedLineItems: [
        { merchantCanonical: null, categoryId: 'internet', cadence: 'MONTHLY' },
        { merchantCanonical: 'Lakeside Property Mgmt', categoryId: 'rent', cadence: 'MONTHLY' },
      ],
    } as never);
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(UNNAMED_USER);
    try {
      const res = await takeRepeatingBillOffPlan(unnamedKey);
      expect(res).toEqual({ ok: true });
    } finally {
      spy.mockRestore();
      planSpy.mockRestore();
    }

    const stored = await prisma.billOffPlan.findUnique({
      where: { userId_billKey: { userId: UNNAMED_USER, billKey: unnamedKey } },
    });
    expect(stored).toMatchObject({ billKey: unnamedKey, userId: UNNAMED_USER });
    const keys = await getBillOffPlanKeys(UNNAMED_USER);
    expect(keys.has(unnamedKey)).toBe(true);
    expect(keys.has(namedKey)).toBe(false);

    // Same filter getSpendingPlan applies to scheduledFixed (one loader).
    const afterItems = excludeOffPlanBills(beforeItems, keys);
    const afterPlan = computeSpendingPlan(planInput(afterItems));
    const afterList = buildFixedList({
      plan: afterPlan,
      rollupRows: [],
      nameOfCategory: (id) => id,
    });
    expect(afterList.lines.some((l) => l.billKey === unnamedKey)).toBe(false);
    expect(afterList.lines.some((l) => l.billKey === namedKey)).toBe(true);
    expect(afterPlan.fixedExpensesCents).toBe(beforeFixed - unnamedCents);
    expect(afterList.totalCents).toBe(beforeList.totalCents - unnamedCents);

    const leftoverTx = await prisma.transaction.count({
      where: { accountId: checkingId, rawDescriptor: UNNAMED_DESC },
    });
    expect(leftoverTx).toBe(3);

    const src = readFileSync(resolve('src/server/spending-plan.ts'), 'utf8');
    expect(src).toContain('getBillOffPlanKeys');
    expect(src).toMatch(/excludeOffPlanBills\(scheduledDetected,\s*offPlanKeys\)/);
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

describe('putRepeatingBillBackOnPlan — unnamed path (DECISIONS #593)', () => {
  const unnamedItem: PlanScheduledItem = {
    amountCents: -7_999,
    cadence: 'MONTHLY',
    categoryId: 'internet',
  };
  const namedItem: PlanScheduledItem = {
    amountCents: -125_000,
    cadence: 'MONTHLY',
    merchantCanonical: 'Lakeside Property Mgmt',
    categoryId: 'rent',
  };
  const unnamedKey = billRenameKey({
    merchantCanonical: null,
    categoryId: 'internet',
    cadence: 'MONTHLY',
  });
  const namedKey = billRenameKey(namedItem);

  const wipe = async () => {
    await prisma.billOffPlan.deleteMany({ where: { userId: UNNAMED_USER } });
    await prisma.transaction.deleteMany({ where: { account: { userId: UNNAMED_USER } } });
    await prisma.account.deleteMany({ where: { userId: UNNAMED_USER } });
    await prisma.user.deleteMany({ where: { id: UNNAMED_USER } });
  };

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: UNNAMED_USER, email: `${UNNAMED_USER}@test.local` } });
    const checking = await prisma.account.create({
      data: {
        userId: UNNAMED_USER,
        provider: 'manual',
        providerRef: `${UNNAMED_USER}-chk-putback`,
        name: 'Everyday Checking',
        type: 'CHECKING',
        currentBalanceCents: 800000,
        currency: 'USD',
      },
    });
    await prisma.transaction.createMany({
      data: [
        { accountId: checking.id, date: '2026-03-08', amountCents: -7999, rawDescriptor: UNNAMED_DESC, categoryId: 'internet', confidenceBps: 0, needsReview: true },
        { accountId: checking.id, date: '2026-04-08', amountCents: -7999, rawDescriptor: UNNAMED_DESC, categoryId: 'internet', confidenceBps: 0, needsReview: true },
        { accountId: checking.id, date: '2026-05-08', amountCents: -7999, rawDescriptor: UNNAMED_DESC, categoryId: 'internet', confidenceBps: 0, needsReview: true },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await wipe();
  });

  it('test_regression__household_can_put_a_repeating_bill_back_on_the_spending_plan', async () => {
    expect(unnamedKey.startsWith('unnamed:')).toBe(true);
    const beforeItems = [unnamedItem, namedItem];
    const beforePlan = computeSpendingPlan(planInput(beforeItems));
    const beforeList = buildFixedList({
      plan: beforePlan,
      rollupRows: [],
      nameOfCategory: (id) => id,
    });
    const unnamedCents = beforeList.lines.find((l) => l.billKey === unnamedKey)!.amountCents;
    const beforeFixed = beforePlan.fixedExpensesCents;

    const spending = await import('@/server/spending-plan');
    const planSpy = vi.spyOn(spending, 'getSpendingPlan').mockResolvedValue({
      fixedList: {
        lines: [
          { kind: 'recurring-bill', billKey: unnamedKey, loanPayment: false },
          { kind: 'recurring-bill', billKey: namedKey, loanPayment: false },
        ],
      },
      fixedLineItems: [
        { merchantCanonical: null, categoryId: 'internet', cadence: 'MONTHLY' },
        { merchantCanonical: 'Lakeside Property Mgmt', categoryId: 'rent', cadence: 'MONTHLY' },
      ],
    } as never);
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(UNNAMED_USER);
    try {
      const taken = await takeRepeatingBillOffPlan(unnamedKey);
      expect(taken).toEqual({ ok: true });
    } finally {
      planSpy.mockRestore();
    }

    const stored = await prisma.billOffPlan.findUnique({
      where: { userId_billKey: { userId: UNNAMED_USER, billKey: unnamedKey } },
    });
    expect(stored).toMatchObject({ billKey: unnamedKey, userId: UNNAMED_USER });
    const offKeys = await getBillOffPlanKeys(UNNAMED_USER);
    expect(offKeys.has(unnamedKey)).toBe(true);
    const takenOff = await getBillsTakenOffPlan(UNNAMED_USER);
    expect(takenOff.some((b) => b.billKey === unnamedKey)).toBe(true);
    const goneItems = excludeOffPlanBills(beforeItems, offKeys);
    const gonePlan = computeSpendingPlan(planInput(goneItems));
    const goneList = buildFixedList({
      plan: gonePlan,
      rollupRows: [],
      nameOfCategory: (id) => id,
    });
    expect(goneList.lines.some((l) => l.billKey === unnamedKey)).toBe(false);
    expect(goneList.lines.some((l) => l.billKey === namedKey)).toBe(true);
    expect(gonePlan.fixedExpensesCents).toBe(beforeFixed - unnamedCents);

    try {
      const putBack = await putRepeatingBillBackOnPlan(unnamedKey);
      expect(putBack).toEqual({ ok: true });
    } finally {
      spy.mockRestore();
    }

    const goneRow = await prisma.billOffPlan.findUnique({
      where: { userId_billKey: { userId: UNNAMED_USER, billKey: unnamedKey } },
    });
    expect(goneRow).toBeNull();
    const keysAfter = await getBillOffPlanKeys(UNNAMED_USER);
    expect(keysAfter.has(unnamedKey)).toBe(false);
    const listedAfter = await getBillsTakenOffPlan(UNNAMED_USER);
    expect(listedAfter.some((b) => b.billKey === unnamedKey)).toBe(false);

    const afterItems = excludeOffPlanBills(beforeItems, keysAfter);
    const afterPlan = computeSpendingPlan(planInput(afterItems));
    const afterList = buildFixedList({
      plan: afterPlan,
      rollupRows: [],
      nameOfCategory: (id) => id,
    });
    expect(afterList.lines.some((l) => l.billKey === unnamedKey)).toBe(true);
    expect(afterList.lines.some((l) => l.billKey === namedKey)).toBe(true);
    expect(afterPlan.fixedExpensesCents).toBe(beforeFixed);
    expect(afterList.totalCents).toBe(beforeList.totalCents);

    const leftoverTx = await prisma.transaction.count({
      where: { account: { userId: UNNAMED_USER }, rawDescriptor: UNNAMED_DESC },
    });
    expect(leftoverTx).toBe(3);
  });
});

describe('putRepeatingBillBackOnPlan — payee path', () => {
  const wipe = async () => {
    await prisma.billOffPlan.deleteMany({ where: { userId: USER } });
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
        providerRef: `${USER}-chk-putback`,
        name: 'Everyday Checking',
        type: 'CHECKING',
        currentBalanceCents: 800000,
        currency: 'USD',
      },
    });
    await prisma.user.update({ where: { id: USER }, data: { paymentAccountId: checking.id } });
    await prisma.transaction.createMany({
      data: [
        { accountId: checking.id, date: '2026-03-08', amountCents: -7999, rawDescriptor: DESC, categoryId: null, confidenceBps: 0, needsReview: true },
        { accountId: checking.id, date: '2026-04-08', amountCents: -7999, rawDescriptor: DESC, categoryId: null, confidenceBps: 0, needsReview: true },
        { accountId: checking.id, date: '2026-05-08', amountCents: -7999, rawDescriptor: DESC, categoryId: null, confidenceBps: 0, needsReview: true },
        { accountId: checking.id, date: '2026-03-15', amountCents: -125000, rawDescriptor: KEEP_DESC, categoryId: null, confidenceBps: 0, needsReview: true },
        { accountId: checking.id, date: '2026-04-15', amountCents: -125000, rawDescriptor: KEEP_DESC, categoryId: null, confidenceBps: 0, needsReview: true },
        { accountId: checking.id, date: '2026-05-15', amountCents: -125000, rawDescriptor: KEEP_DESC, categoryId: null, confidenceBps: 0, needsReview: true },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await wipe();
    vi.unstubAllEnvs();
  });

  it('test_regression__household_can_put_a_payee_repeating_bill_back_on_the_spending_plan', async () => {
    await prisma.recurringOverride.deleteMany({ where: { userId: USER } });
    await prisma.billOffPlan.deleteMany({ where: { userId: USER } });

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
    const beforeCents = before.fixedList.lines.find((l) => l.billKey === billKey)!.amountCents;
    const beforeFixed = before.fixedExpensesCents;

    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const taken = await takeRepeatingBillOffPlan(billKey);
      expect(taken).toEqual({ ok: true });

      const off = await getSpendingPlan(USER);
      expect(off.fixedList.lines.some((l) => l.billKey === billKey)).toBe(false);
      expect(off.fixedList.lines.some((l) => l.billKey === keepKey)).toBe(true);
      expect(off.billsTakenOff.some((b) => b.billKey === billKey)).toBe(true);
      expect(off.fixedExpensesCents).toBe(beforeFixed - beforeCents);

      const putBack = await putRepeatingBillBackOnPlan(billKey);
      expect(putBack).toEqual({ ok: true });
    } finally {
      spy.mockRestore();
    }

    const after = await getSpendingPlan(USER);
    expect(after.fixedList.lines.some((l) => l.billKey === billKey)).toBe(true);
    expect(after.fixedList.lines.some((l) => l.billKey === keepKey)).toBe(true);
    expect(after.billsTakenOff.some((b) => b.billKey === billKey)).toBe(false);
    expect(after.fixedExpensesCents).toBe(beforeFixed);
    const leftoverTx = await prisma.transaction.count({
      where: { account: { userId: USER }, rawDescriptor: DESC },
    });
    expect(leftoverTx).toBe(3);
    const row = await prisma.recurringOverride.findFirst({
      where: { userId: USER, merchantCanonical: billKey },
    });
    expect(row).toBeNull();
  });
});

describe('putRepeatingBillBackOnPlan — refusals', () => {
  it('test_regression__put_bill_back_on_plan_demo_cannot_learn', async () => {
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const res = await putRepeatingBillBackOnPlan('River Bend Internet');
      expect(res).toEqual({ ok: false, error: DEMO_ENTRY_BLOCKED });
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__put_bill_back_on_plan_refuses_missing_or_not_off_key', async () => {
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const res = await putRepeatingBillBackOnPlan('not-off-the-plan');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/isn't off your plan/i);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Settings Fixed costs take-off (DECISIONS #597)', () => {
  it('test_regression__household_can_take_a_repeating_bill_off_the_plan_from_settings_fixed_costs', () => {
    const card = readFileSync(resolve('src/components/settings/fixed-costs-card.tsx'), 'utf8');
    expect(card).toContain('TakeBillOffPlanButton');
    expect(card).toContain("from '@/components/finance/take-bill-off-plan-button'");
    expect(card).toContain('TakeBillOffPlanButton billKey={l.billKey}');
    expect(card).toContain('!l.loanPayment && canWrite');
    expect(card).not.toContain("startsWith('unnamed:')");
    expect(card).not.toContain('takeRepeatingBillOffPlan');
  });
});
