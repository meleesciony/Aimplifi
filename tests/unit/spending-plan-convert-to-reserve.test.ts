/**
 * Turn a repeating bill into a reserve from the spending plan
 * (DECISIONS #594 / #595 / #596).
 *
 * #594: ConvertToReserveButton on Spending plan for a payee bill.
 * #595: a household-named unnamed bill (no payee, BillRename overlay) can
 * convert too — BillOffPlan + Goal, never RecurringOverride NOT_BILL.
 * #596: Settings Fixed costs offers the same convert for a named no-payee
 * bill (pass billKey; do not require merchantCanonical).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { DEMO_ENTRY_BLOCKED } from '@/lib/demo-user';
import { isoDate } from '@/lib/dates';
import { billRenameKey, excludeOffPlanBills } from '@/lib/engine/spending-plan/bill-rename';
import { buildFixedList } from '@/lib/engine/spending-plan/fixed-line-items';
import {
  computeSpendingPlan,
  monthlyRateCents,
  type PlanScheduledItem,
} from '@/lib/engine/spending-plan/plan';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';
import { proposeFixedSetup } from '@/lib/engine/spending-plan/setup-proposals';
import { createReserveFromSeries, deleteReserve } from '@/server/reserve-actions';
import { getBillOffPlanKeys, getBillsTakenOffPlan } from '@/server/bill-names';

const USER = `unnamed-cvt-${Date.now()}-${process.pid}`;
const TODAY = '2026-06-10';
const OVERLAY = 'HOA dues';
const TRUE_COST = 120_000;
const CADENCE = 'ANNUAL' as const;
const unnamedItem: PlanScheduledItem = {
  amountCents: -TRUE_COST,
  cadence: CADENCE,
  categoryId: 'insurance',
};
const unnamedKey = billRenameKey({
  merchantCanonical: null,
  categoryId: 'insurance',
  cadence: CADENCE,
});
const MONTHLY = monthlyRateCents(TRUE_COST, CADENCE);

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

describe('Spending plan surface lets the household turn a repeating bill into a reserve', () => {
  it('test_regression__household_can_turn_a_repeating_bill_into_a_reserve_from_the_spending_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('ConvertToReserveButton');
    expect(page).toContain("from '@/components/finance/convert-to-reserve-button'");
    expect(page).not.toContain('createReserveFromSeries');
    expect(page).toContain('canEditFigures');
    expect(page).toContain('convertibleToReserve');
    expect(page).toContain('b.billKey === l.billKey');
    expect(page).not.toMatch(/<ConvertToReserveButton merchantCanonical=\{l\.billKey\}/);
    expect(page).not.toContain('merchantCanonical === l.billKey');

    const button = readFileSync(
      resolve('src/components/finance/convert-to-reserve-button.tsx'),
      'utf8',
    );
    expect(button).toContain('createReserveFromSeries');
    expect(button).toContain('export function ConvertToReserveButton');
  });

  it('test_regression__household_can_turn_a_named_no_payee_bill_into_a_reserve_from_settings_fixed_costs', () => {
    const card = readFileSync(resolve('src/components/settings/fixed-costs-card.tsx'), 'utf8');
    expect(card).toContain('ConvertToReserveButton');
    expect(card).toContain("from '@/components/finance/convert-to-reserve-button'");
    expect(card).not.toContain('createReserveFromSeries');
    expect(card).toContain('convertibleToReserve && canWrite && b.billKey');
    expect(card).toContain('merchantCanonical={b.billKey}');
    expect(card).not.toMatch(/convertibleToReserve && canWrite && b\.merchantCanonical/);
    expect(card).not.toMatch(/<ConvertToReserveButton merchantCanonical=\{b\.merchantCanonical\}/);
    expect(card).toContain("b.convertInput?.name ?? b.merchantCanonical ?? 'A repeating expense'");
  });
});

describe('named no-payee bill → reserve from the spending plan (DECISIONS #595)', () => {
  const wipe = async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.billOffPlan.deleteMany({ where: { userId: USER } });
    await prisma.billRename.deleteMany({ where: { userId: USER } });
    await prisma.recurringOverride.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  };

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    await prisma.billRename.create({
      data: { userId: USER, billKey: unnamedKey, name: OVERLAY },
    });
  });

  afterAll(wipe);

  beforeEach(async () => {
    await prisma.goal.deleteMany({ where: { userId: USER } });
    await prisma.billOffPlan.deleteMany({ where: { userId: USER } });
    await prisma.recurringOverride.deleteMany({ where: { userId: USER } });
  });

  it('test_regression__household_can_turn_a_named_no_payee_bill_into_a_reserve_from_the_spending_plan', async () => {
    expect(unnamedKey.startsWith('unnamed:')).toBe(true);
    expect(unnamedKey).toBe('unnamed:insurance:ANNUAL');

    const engine = proposeFixedSetup({
      items: [unnamedItem],
      categoryIsFixed: () => true,
      billNames: new Map([[unnamedKey, OVERLAY]]),
    });
    expect(engine.bills[0]!.convertibleToReserve).toBe(true);
    expect(engine.bills[0]!.convertInput!.name).toBe(OVERLAY);
    expect(engine.bills[0]!.billKey).toBe(unnamedKey);
    expect(engine.bills[0]!.merchantCanonical).toBe(null);

    const withoutOverlay = proposeFixedSetup({
      items: [unnamedItem],
      categoryIsFixed: () => true,
    });
    expect(withoutOverlay.bills[0]!.convertibleToReserve).toBe(false);

    const beforePlan = computeSpendingPlan(planInput([unnamedItem]));
    const beforeList = buildFixedList({
      plan: beforePlan,
      rollupRows: [],
      nameOfCategory: (id) => id,
      billNames: new Map([[unnamedKey, OVERLAY]]),
    });
    expect(beforeList.lines.some((l) => l.billKey === unnamedKey)).toBe(true);
    const billCents = beforeList.lines.find((l) => l.billKey === unnamedKey)!.amountCents;
    expect(billCents).toBe(MONTHLY);
    const beforeFixed = beforePlan.fixedExpensesCents;

    const convertibleProposal = engine.bills[0]!;
    const spending = await import('@/server/spending-plan');
    const planSpy = vi.spyOn(spending, 'getSpendingPlan').mockResolvedValue({
      fixedSetup: { bills: [convertibleProposal] },
      fixedList: {
        lines: [{ kind: 'recurring-bill', billKey: unnamedKey, loanPayment: false }],
      },
    } as never);
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const res = await createReserveFromSeries(unnamedKey);
      expect(res).toEqual({ ok: true });
    } finally {
      spy.mockRestore();
      planSpy.mockRestore();
    }

    const goal = await prisma.goal.findFirst({ where: { userId: USER, kind: RESERVE_KIND } });
    expect(goal).toMatchObject({
      name: OVERLAY,
      targetCents: TRUE_COST,
      cadence: CADENCE,
      merchantCanonical: unnamedKey,
      monthlyContributionCents: null,
    });
    const off = await prisma.billOffPlan.findUnique({
      where: { userId_billKey: { userId: USER, billKey: unnamedKey } },
    });
    expect(off).toMatchObject({ billKey: unnamedKey, userId: USER });
    expect(
      await prisma.recurringOverride.count({
        where: { userId: USER, merchantCanonical: unnamedKey, decision: 'NOT_BILL' },
      }),
    ).toBe(0);
    expect(await prisma.recurringOverride.count({ where: { userId: USER } })).toBe(0);

    const keys = await getBillOffPlanKeys(USER);
    expect(keys.has(unnamedKey)).toBe(true);
    const takenOff = await getBillsTakenOffPlan(USER);
    expect(takenOff.some((b) => b.billKey === unnamedKey)).toBe(false);

    const afterItems = excludeOffPlanBills([unnamedItem], keys);
    const afterPlan = computeSpendingPlan({
      ...planInput(afterItems),
      reserves: [
        {
          id: goal!.id,
          name: OVERLAY,
          trueCostCents: TRUE_COST,
          cadence: CADENCE,
          monthlyCents: MONTHLY,
          pairedToBill: true,
        },
      ],
    });
    const afterList = buildFixedList({
      plan: afterPlan,
      rollupRows: [],
      nameOfCategory: (id) => id,
      billNames: new Map([[unnamedKey, OVERLAY]]),
    });
    expect(afterList.lines.some((l) => l.billKey === unnamedKey)).toBe(false);
    expect(afterList.lines.some((l) => l.kind === 'reserve' && l.label === OVERLAY)).toBe(true);
    expect(afterPlan.fixedExpensesCents).toBe(beforeFixed);
    expect(afterPlan.reserveMonthlyCents).toBe(MONTHLY);
    expect(afterList.totalCents).toBe(beforeList.totalCents);

    const delAuth = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      await deleteReserve(goal!.id);
    } finally {
      delAuth.mockRestore();
    }
    expect(await prisma.goal.count({ where: { userId: USER, kind: RESERVE_KIND } })).toBe(0);
    expect(
      await prisma.billOffPlan.findUnique({
        where: { userId_billKey: { userId: USER, billKey: unnamedKey } },
      }),
    ).toBeNull();
    const restoredKeys = await getBillOffPlanKeys(USER);
    expect(restoredKeys.has(unnamedKey)).toBe(false);
    const restoredItems = excludeOffPlanBills([unnamedItem], restoredKeys);
    const restoredPlan = computeSpendingPlan(planInput(restoredItems));
    const restoredList = buildFixedList({
      plan: restoredPlan,
      rollupRows: [],
      nameOfCategory: (id) => id,
      billNames: new Map([[unnamedKey, OVERLAY]]),
    });
    expect(restoredList.lines.some((l) => l.billKey === unnamedKey)).toBe(true);
    expect(restoredPlan.fixedExpensesCents).toBe(beforeFixed);

    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('b.billKey === l.billKey');
    expect(page).not.toContain('merchantCanonical === l.billKey');
    expect(page).toContain('convertBill.billKey');
  });

  it('unnamed without overlay is still refused', async () => {
    const refused = proposeFixedSetup({
      items: [unnamedItem],
      categoryIsFixed: () => true,
    }).bills[0]!;
    expect(refused.convertibleToReserve).toBe(false);
    const spending = await import('@/server/spending-plan');
    const planSpy = vi.spyOn(spending, 'getSpendingPlan').mockResolvedValue({
      fixedSetup: { bills: [refused] },
    } as never);
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(USER);
    try {
      const res = await createReserveFromSeries(unnamedKey);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/can't become a reserve/i);
    } finally {
      spy.mockRestore();
      planSpy.mockRestore();
    }
    expect(await prisma.goal.count({ where: { userId: USER, kind: RESERVE_KIND } })).toBe(0);
    expect(await prisma.billOffPlan.count({ where: { userId: USER } })).toBe(0);
  });

  it('demo cannot convert an unnamed named bill', async () => {
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue('user-demo');
    try {
      const res = await createReserveFromSeries(unnamedKey);
      expect(res).toEqual({ ok: false, error: DEMO_ENTRY_BLOCKED });
    } finally {
      spy.mockRestore();
    }
  });
});
