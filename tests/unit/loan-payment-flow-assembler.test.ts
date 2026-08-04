/**
 * C.25 (DECISIONS #403, critic P2-4) — the assembler wiring, locked against
 * the REAL Prisma client on a throwaway user (the account-rename-server
 * pattern). The unit suite proves the four-gate engine; the seed proves
 * NOTHING here by construction (acct-autoloan has zero transactions, so the
 * demo exclusion is always empty and every golden stays byte-identical).
 * This file is the lock that would catch the assembler itself regressing —
 * the query scoping, the obligation derivation, the snapshot field — and it
 * also nails the golden invariant: the demo snapshot carries no exclusion.
 *
 * The fixture mirrors the owner's measured shape (#400): the same $6,217.07
 * charge flagged in two months (pair landed ≤3 days), unflagged in two more
 * (no counterpart / 4-day settlement) — the month-to-month flip the
 * read-side exclusion must level out.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const USER = `loanflow-${Date.now()}-${process.pid}`;
const MTG_AMOUNT = -621_707;
const DESCRIPTOR = 'TRUIST MORTG OL B MTGPMT';

let prisma: typeof import('@/lib/db').prisma;
let DemoProvider: typeof import('@/lib/providers/demo').DemoProvider;
let getReports: typeof import('@/server/reports').getReports;
let DEMO_USER_ID: string;

beforeAll(async () => {
  ({ prisma } = await import('@/lib/db'));
  ({ DemoProvider } = await import('@/lib/providers/demo'));
  ({ getReports } = await import('@/server/reports'));
  ({ DEMO_USER_ID } = await import('@/lib/demo-user'));

  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  const chk = await prisma.account.create({
    data: {
      userId: USER,
      provider: 'demo',
      name: 'Everyday Checking',
      type: 'CHECKING',
      mask: '0001',
      currentBalanceCents: 100_000,
      minimumPaymentCents: null,
      dueDayOfMonth: null,
      cycleCloseDayOfMonth: null,
    },
  });
  const mtg = await prisma.account.create({
    data: {
      userId: USER,
      provider: 'plaid',
      name: 'Mortgage 1192',
      type: 'MORTGAGE',
      mask: '1192',
      currentBalanceCents: -30_000_000,
      minimumPaymentCents: 621_707, // dateable → selectLoanObligations projects it
      dueDayOfMonth: 1,
      cycleCloseDayOfMonth: null,
    },
  });
  const rows: { accountId: string; date: string; amountCents: number; rawDescriptor: string; isTransfer?: boolean }[] = [
    // The mortgage: flagged May/Jun (pair ≤3 days), UNFLAGGED Apr (no
    // counterpart) and Jul (4-day settlement) — the measured owner shape.
    { accountId: chk.id, date: '2026-04-03', amountCents: MTG_AMOUNT, rawDescriptor: DESCRIPTOR },
    { accountId: chk.id, date: '2026-05-04', amountCents: MTG_AMOUNT, rawDescriptor: DESCRIPTOR, isTransfer: true },
    { accountId: chk.id, date: '2026-06-03', amountCents: MTG_AMOUNT, rawDescriptor: DESCRIPTOR, isTransfer: true },
    { accountId: chk.id, date: '2026-07-06', amountCents: MTG_AMOUNT, rawDescriptor: DESCRIPTOR },
    // Loan-side inflows (#62 withholds these from the snapshot; the
    // assembler's targeted query is the only way the exclusion sees them).
    { accountId: mtg.id, date: '2026-05-05', amountCents: 621_707, rawDescriptor: 'Payment' },
    { accountId: mtg.id, date: '2026-06-04', amountCents: 621_707, rawDescriptor: 'Payment' },
    { accountId: mtg.id, date: '2026-07-10', amountCents: 621_707, rawDescriptor: 'Payment' },
  ];
  // Groceries on the 15th: the control spend that must survive untouched.
  for (const m of ['2026-04-15', '2026-05-15', '2026-06-15', '2026-07-15']) {
    rows.push({ accountId: chk.id, date: m, amountCents: -10_000, rawDescriptor: 'GROCERY STORE 101' });
  }
  for (const r of rows) {
    await prisma.transaction.create({
      data: {
        accountId: r.accountId,
        date: r.date,
        amountCents: r.amountCents,
        rawDescriptor: r.rawDescriptor,
        isTransfer: r.isTransfer ?? false,
      },
    });
  }
}, 60_000);

afterAll(async () => {
  await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.$disconnect();
});

describe('C.25 assembler wiring (real Prisma client)', () => {
  it('computes the exclusion ONCE, on the snapshot, with the disclosure facts', async () => {
    const snap = await new DemoProvider().getFinanceSnapshot(USER);
    const ex = snap.loanPaymentFlowExclusions;
    expect(ex).toBeDefined();
    // All four mortgage outflows — the flagged two and the unflagged two.
    expect(ex!.excludeIds.size).toBe(4);
    expect(ex!.excluded).toHaveLength(1);
    expect(ex!.excluded[0].paymentCents).toBe(621_707);
    // Loan-side inflows never leak into the snapshot's transactions (#62).
    expect(snap.transactions.some((t) => t.amountCents === 621_707)).toBe(false);
  });

  it('levels the month totals: /reports reads no mortgage in any month', async () => {
    const reports = await getReports(USER);
    const months = reports.months.filter((m) => ['2026-04', '2026-05', '2026-06', '2026-07'].includes(m.month));
    expect(months).toHaveLength(4);
    for (const m of months) {
      expect(m.expensesCents).toBe(10_000); // groceries only, every month
    }
    expect(reports.loanPaymentExclusions).toHaveLength(1);
    expect(reports.loanPaymentExclusions[0].paymentCents).toBe(621_707);
    expect(reports.loanPaymentRefusedCategories.length).toBeGreaterThan(0);
  });

  it('the demo golden is untouched: no exclusion on the seeded dataset', async () => {
    const snap = await new DemoProvider().getFinanceSnapshot(DEMO_USER_ID);
    expect(snap.loanPaymentFlowExclusions).toBeUndefined();
  });
});
