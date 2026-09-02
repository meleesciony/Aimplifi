/**
 * Mark a repeating bill paid this cycle (DECISIONS #584).
 *
 * Overlay advances the projected next date. It does not write a transaction,
 * change lastSeenAt, or change the monthly rate. Converted pairing N/A.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isoDate } from '@/lib/dates';
import {
  type RecurringTxn,
  detectRecurring,
  toScheduledTransactions,
} from '@/lib/engine/recurring/detect';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
import { paidThisCycleRefusal } from '@/lib/engine/recurring/paid-through';
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { OVERRIDE_DEMO_BLOCKED } from '@/server/recurring-overrides';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const TODAY = isoDate('2026-06-10');
const RENT_DESC = 'LAKESIDE PROPERTY MGMT RENT';
const RENT_CANONICAL = 'Lakeside Property Mgmt Rent';
const CHECKING = 'acct-checking';

const txn = (date: string, amountCents: number, rawDescriptor: string): RecurringTxn => ({
  id: `${rawDescriptor}-${date}`,
  accountId: CHECKING,
  date,
  amountCents,
  rawDescriptor,
});

const THREE_MONTHLY_RENTS = [
  txn('2026-03-15', -125000, RENT_DESC),
  txn('2026-04-15', -125000, RENT_DESC),
  txn('2026-05-15', -125000, RENT_DESC),
];

const USER = `paid-cycle-${Date.now()}-${process.pid}`;

describe('Spending-plan-adjacent Recurring surface lets the household mark a bill paid', () => {
  it('test_regression__recurring_paid_this_cycle_control_is_on_the_page', () => {
    const page = readFileSync(resolve('src/components/finance/recurring-view.tsx'), 'utf8');
    expect(page).toContain('PaidThisCycleButton');
    const control = readFileSync(
      resolve('src/components/finance/recurring-verdict-controls.tsx'),
      'utf8',
    );
    expect(control).toContain('recordRepeatingBillPaidThisCycle');
    expect(control).toContain('Paid this cycle');
    expect(control).toContain('onClick');
    expect(control).not.toContain('form-action');
    expect(control).not.toContain('useActionState');
  });

  it('test_regression__production_detectRecurring_honors_paid_through', () => {
    for (const file of [
      'src/server/recurring.ts',
      'src/server/spending-plan.ts',
      'src/server/coach.ts',
      'src/server/transactions.ts',
    ]) {
      const src = readFileSync(resolve(file), 'utf8');
      expect(src, file).toContain('getRecurringPaidThrough');
      expect(src, file).toContain('detectRecurring');
    }
  });
});

describe('paid-through overlay — next date advances, dollars stay put', () => {
  it('test_regression__household_can_record_repeating_bill_paid_this_cycle', () => {
    const raw = detectRecurring(THREE_MONTHLY_RENTS, TODAY, NO_RECURRING_OVERRIDES);
    expect(raw).toHaveLength(1);
    expect(raw[0]!.merchantCanonical).toBe(RENT_CANONICAL);
    expect(raw[0]!.nextExpectedAt).toBe('2026-06-15');
    expect(raw[0]!.lastSeenAt).toBe('2026-05-15');
    expect(raw[0]!.paidThisCycle).toBe(false);
    expect(raw[0]!.typicalAmountCents).toBe(-125000);

    const marked = detectRecurring(THREE_MONTHLY_RENTS, TODAY, NO_RECURRING_OVERRIDES, [
      { merchantCanonical: RENT_CANONICAL, paidThrough: '2026-06-15' },
    ]);
    expect(marked).toHaveLength(1);
    expect(marked[0]!.nextExpectedAt).toBe('2026-07-15');
    expect(marked[0]!.lastSeenAt).toBe('2026-05-15');
    expect(marked[0]!.paidThisCycle).toBe(true);
    expect(marked[0]!.typicalAmountCents).toBe(-125000);
    expect(marked[0]!.cadence).toBe('MONTHLY');

    const scope = {
      paymentAccountId: CHECKING,
      cashAccountIds: new Set([CHECKING]),
      creditAccountIds: new Set<string>(),
    };
    const scheduled = toScheduledTransactions(marked, scope, TODAY);
    const rentRow = scheduled.find((r) => r.description === RENT_CANONICAL);
    expect(rentRow?.nextDate).toBe('2026-07-15');
    expect(rentRow?.amountCents).toBe(-125000);
  });

  it('test_regression__paid_this_cycle_refuses_income_inactive_and_already_marked', () => {
    expect(paidThisCycleRefusal(null)).toMatch(/isn't on Recurring/);
    expect(
      paidThisCycleRefusal({ isIncome: true, active: true, cadence: 'MONTHLY' }),
    ).toMatch(/Income/);
    expect(
      paidThisCycleRefusal({ isIncome: false, active: false, cadence: 'MONTHLY' }),
    ).toMatch(/still charging/);
    expect(
      paidThisCycleRefusal({
        isIncome: false,
        active: true,
        cadence: 'MONTHLY',
        paidThisCycle: true,
      }),
    ).toMatch(/already marked paid/);
    expect(
      paidThisCycleRefusal({ isIncome: false, active: true, cadence: 'MONTHLY' }),
    ).toBeNull();
  });
});

describe('recordRepeatingBillPaidThisCycle — demo cannot learn', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  }, 60_000);

  afterAll(async () => {
    await prisma.recurringPaidThrough.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('test_regression__paid_this_cycle_demo_cannot_learn', async () => {
    const { recordRepeatingBillPaidThisCycle } = await import(
      '@/server/recurring-override-actions'
    );
    const authz = await import('@/server/authz');
    const spy = vi.spyOn(authz, 'requireUserId').mockResolvedValue(DEMO_USER_ID);
    try {
      const res = await recordRepeatingBillPaidThisCycle({ merchantCanonical: RENT_CANONICAL });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe(OVERRIDE_DEMO_BLOCKED);
    } finally {
      spy.mockRestore();
    }
  });

  it('test_regression__paid_this_cycle_persists_overlay_not_a_transaction', async () => {
    const { setRecurringPaidThrough, getRecurringPaidThrough } = await import(
      '@/server/recurring-paid-through'
    );
    const saved = await setRecurringPaidThrough(USER, RENT_CANONICAL, '2026-06-15');
    expect(saved.ok).toBe(true);
    const rows = await getRecurringPaidThrough(USER);
    expect(rows).toEqual([{ merchantCanonical: RENT_CANONICAL, paidThrough: '2026-06-15' }]);
    const txCount = await prisma.transaction.count({ where: { account: { userId: USER } } });
    expect(txCount).toBe(0);
  });
});
