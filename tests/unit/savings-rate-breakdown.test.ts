/**
 * Owner request, 2026-08-02: *"if i want to know why and where cash come from
 * that caused greater savings for a specific month, i should be able to click on
 * the graph itself"*.
 *
 * `buildMonthFlowBreakdowns` is already tested as an engine
 * (`month-flow-breakdown.test.ts`). What is NOT covered by that file, and is the
 * only thing that can rot here, is the WIRING: that `getCoachData` hands the
 * builder the very array `monthlyFlows` summed, and keys a panel for every month
 * the chart draws. Two arrays that merely *look* alike would pass every engine
 * test and put rows under a bar they do not add up to.
 *
 * So this runs against real Prisma and the real `getCoachData`, and checks each
 * panel against the FIGURE the page renders (`flows`), never against a second
 * derivation.
 *
 * `DEMO_TODAY=2026-06-10` is pinned in `.env` for every user, so the full months
 * are April and May 2026.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCoachData } from '@/server/coach';
import { prisma } from '@/lib/db';

const U = `savings-breakdown-${Date.now()}-${process.pid}`;

/** May: $5,000 in, $2,000 groceries + $500 dining − $100 returned = $2,400 out. */
const MAY_INCOME = 500_000;
const MAY_GROCERIES = -200_000;
const MAY_DINING = -50_000;
const MAY_REFUND = 10_000; // a positive row in a NON-income category → nets spend DOWN
const MAY_EXPENSES = 240_000;
/** April: $4,000 in, $3,600 out — the month May is "higher savings" than. */
const APR_INCOME = 400_000;
const APR_RENT = -360_000;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { id: U } });
  await prisma.user.create({ data: { id: U, email: `${U}@test.local` } });
  const account = await prisma.account.create({
    data: {
      userId: U,
      provider: 'manual',
      providerRef: `${U}-chk`,
      name: 'Everyday Checking',
      type: 'CHECKING',
      currency: 'USD',
      currentBalanceCents: 100_000,
    },
  });
  const mk = (date: string, amountCents: number, rawDescriptor: string, categoryId: string) =>
    prisma.transaction.create({
      data: {
        accountId: account.id,
        date,
        amountCents,
        rawDescriptor,
        categoryId,
        status: 'POSTED',
      },
    });
  await mk('2026-05-01', MAY_INCOME, 'ACME PAYROLL', 'paycheck');
  await mk('2026-05-04', MAY_GROCERIES, 'SAFEWAY #1234', 'groceries');
  await mk('2026-05-11', MAY_DINING, 'BLUE BOTTLE COFFEE', 'dining');
  await mk('2026-05-19', MAY_REFUND, 'SAFEWAY #1234 RETURN', 'groceries');
  await mk('2026-04-01', APR_INCOME, 'ACME PAYROLL', 'paycheck');
  await mk('2026-04-03', APR_RENT, 'PROPERTY MGMT RENT', 'rent');
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: U } });
});

describe('/coach savings-rate bars expand into the rows their month was summed from', () => {
  it('keys a panel for every month the chart draws — no bar can open nothing', async () => {
    const data = await getCoachData(U);
    // The fixture's hard case, asserted before anything else: this reader HAS
    // full months. Without it the loop below is vacuous on an empty account.
    expect(data.flows.map((f) => f.month)).toEqual(['2026-04', '2026-05']);
    for (const f of data.flows) {
      expect(data.monthFlows[`${f.month}:income`], `${f.month} income panel`).toBeDefined();
      expect(data.monthFlows[`${f.month}:expense`], `${f.month} expense panel`).toBeDefined();
    }
  });

  it('every panel reconciles against the figure the page rendered', async () => {
    const data = await getCoachData(U);
    for (const f of data.flows) {
      const income = data.monthFlows[`${f.month}:income`]!;
      const expense = data.monthFlows[`${f.month}:expense`]!;
      // headlineCents is the flow's own figure, passed in — so this asserts the
      // builder was given THIS page's numbers and not a re-derivation.
      expect(income.headlineCents).toBe(f.incomeCents);
      expect(expense.headlineCents).toBe(f.expensesCents);
      expect(income.sumCents).toBe(f.incomeCents);
      expect(expense.sumCents).toBe(f.expensesCents);
      expect(income.reconciles).toBe(true);
      expect(expense.reconciles).toBe(true);
    }
  });

  it('answers the owner question — May saved more, and the rows say where it came from', async () => {
    const data = await getCoachData(U);
    const may = data.flows.find((f) => f.month === '2026-05')!;
    const apr = data.flows.find((f) => f.month === '2026-04')!;
    // 52.00% vs 10.00% — the "greater savings" month.
    expect(may.savingsRateBps).toBe(5200);
    expect(apr.savingsRateBps).toBe(1000);

    const income = data.monthFlows['2026-05:income']!;
    expect(income.rows).toHaveLength(1);
    expect(income.rows[0]!.amountCents).toBe(MAY_INCOME);
    // The register's own display name, so one charge reads the same in both places.
    expect(income.rows[0]!.label).toBe('Acme Payroll');

    const expense = data.monthFlows['2026-05:expense']!;
    expect(expense.rows).toHaveLength(3);
    expect(expense.sumCents).toBe(MAY_EXPENSES);
    // The refund is a visibly NEGATIVE contribution to spending, which is exactly
    // the kind of thing "why was this month better" is asking about — and it is
    // the row a panel built on the category basis would have shown differently.
    const refund = expense.rows.find((r) => r.amountCents < 0)!;
    expect(refund).toBeDefined();
    expect(refund.amountCents).toBe(-MAY_REFUND);
  });

  it('a month is split so no row is in both halves', async () => {
    const data = await getCoachData(U);
    const income = data.monthFlows['2026-05:income']!;
    const expense = data.monthFlows['2026-05:expense']!;
    const ids = [...income.rows, ...expense.rows].map((r) => r.transactionId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
