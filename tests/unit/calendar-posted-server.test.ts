/**
 * TASKS K.1 — the K.1 GATE, server-level: the calendar's posted read and the
 * register must not disagree on a total.
 *
 * The pure math is locked in calendar-posted.test.ts. What only the real
 * loaders can prove is that `getPostedCalendarRows` and `getTransactions`
 * query the SAME rows: one shared where-clause (spending account types, USD,
 * split parents excluded) and the same reconciliation keep. So this file
 * drives BOTH loaders over one seeded corpus that contains a row for every
 * basis rule, and asserts the posted window's summary equals the register's
 * summary for the identical date window — money figures AND row count. A
 * second copy of the where-clause that drifts (a new account type, a dropped
 * split-parent guard) fails here and nowhere else.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getPostedCalendarRows, getTransactions } from '@/server/transactions';
import { buildPostedCalendarMonth } from '@/lib/engine/calendar/posted';
import { isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';

const USER = `calposted-${Date.now()}-${process.pid}`;

async function wipe() {
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
}

let checkingId = '';
let brokerageId = '';

async function txn(
  id: string,
  accountId: string,
  date: string,
  amountCents: number,
  over: { isTransfer?: boolean; excludeFromTotals?: boolean; isSplitParent?: boolean; status?: string } = {},
) {
  await prisma.transaction.create({
    data: {
      id: `${id}-${process.pid}`,
      accountId,
      date,
      amountCents,
      rawDescriptor: `ROW ${id}`,
      categoryId: 'uncategorized',
      confidenceBps: 4000,
      needsReview: true,
      ...over,
    },
  });
}

describe('K.1 gate — posted calendar rows and the register are one row set', () => {
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const checking = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'simplefin',
        providerRef: 'kp-chk',
        name: 'Checking',
        type: 'CHECKING',
        currentBalanceCents: 500_000,
        currency: 'USD',
      },
    });
    checkingId = checking.id;
    const brokerage = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'simplefin',
        providerRef: 'kp-inv',
        name: 'Brokerage',
        type: 'INVESTMENT',
        currentBalanceCents: 1_000_000,
        currency: 'USD',
      },
    });
    brokerageId = brokerage.id;

    // The July 2026 window, one row per basis rule:
    await txn('pay', checkingId, '2026-07-03', 245_000); // counted income
    await txn('rent', checkingId, '2026-07-05', -180_000); // counted spend
    await txn('xfer', checkingId, '2026-07-05', -50_000, { isTransfer: true }); // listed, not money
    await txn('excl', checkingId, '2026-07-10', -7_500, { excludeFromTotals: true }); // listed, not money
    await txn('splitp', checkingId, '2026-07-12', -9_000, { isSplitParent: true }); // NOT listed anywhere
    await txn('pend', checkingId, '2026-07-20', -4_400, { status: 'PENDING' }); // in figures, NAMED (F-1)
    await txn('divid', brokerageId, '2026-07-15', 3_300); // brokerage activity: not spending, not listed
    // Outside the window, to make the bounds distinct from it:
    await txn('old', checkingId, '2026-03-25', -1_000);
    await txn('new', checkingId, '2026-08-02', -1_000);
  });
  afterAll(wipe);

  it('the posted window summarized equals the register summary for the same window — money AND count', async () => {
    const posted = await getPostedCalendarRows(USER, '2026-07-01', '2026-07-31');
    const month = buildPostedCalendarMonth({
      month: '2026-07',
      today: isoDate('2026-08-04'),
      rows: posted.rows,
      oldestPostedDate: posted.oldestPostedDate ? isoDate(posted.oldestPostedDate) : null,
      newestPostedDate: posted.newestPostedDate ? isoDate(posted.newestPostedDate) : null,
    });
    const register = await getTransactions(USER, { from: '2026-07-01', to: '2026-07-31' });
    expect(month.totalInCents).toBe(register.summary.inflowCents);
    expect(month.totalOutCents).toBe(register.summary.outflowCents);
    expect(month.rowCount).toBe(register.summary.count);
    expect(month.excludedCount).toBe(register.summary.excludedCount);
    // And the hand-verified values, so a shared bug cannot hide behind agreement:
    expect(month.totalInCents).toBe(245_000);
    expect(month.totalOutCents).toBe(184_400); // rent + the pending charge — transfer + excluded leave the money
    expect(month.rowCount).toBe(5); // pay, rent, xfer, excl, pend — split parent and brokerage rows never listed
    // Critic F-1: the pending row is IN the figures (the register counts it too — the equality
    // above proves that) and NAMED, so the surface never says "posted" over it unqualified.
    expect(month.pendingCount).toBe(1);
    expect(month.days.find((d) => d.date === '2026-07-20')!.pendingCount).toBe(1);
  });

  it('a day link’s window agrees too: one day, both loaders', async () => {
    const posted = await getPostedCalendarRows(USER, '2026-07-01', '2026-07-31');
    const month = buildPostedCalendarMonth({
      month: '2026-07',
      today: isoDate('2026-08-04'),
      rows: posted.rows,
      oldestPostedDate: posted.oldestPostedDate ? isoDate(posted.oldestPostedDate) : null,
      newestPostedDate: posted.newestPostedDate ? isoDate(posted.newestPostedDate) : null,
    });
    const day5 = month.days.find((d) => d.date === '2026-07-05')!;
    const register = await getTransactions(USER, { from: '2026-07-05', to: '2026-07-05' });
    expect(day5.inCents).toBe(register.summary.inflowCents);
    expect(day5.outCents).toBe(register.summary.outflowCents);
    expect(day5.netCents).toBe(register.summary.netCents);
    expect(day5.count).toBe(register.summary.count);
    expect(day5.count).toBe(2); // rent + the transfer; the transfer is listed, not money
    expect(day5.outCents).toBe(180_000);
  });

  it('the bounds come off the kept register set, spanning ALL history, matching the register’s own', async () => {
    const posted = await getPostedCalendarRows(USER, '2026-07-01', '2026-07-31');
    const register = await getTransactions(USER);
    expect(posted.oldestPostedDate).toBe('2026-03-25');
    expect(posted.newestPostedDate).toBe('2026-08-02');
    expect(posted.oldestPostedDate).toBe(register.oldestDate);
    expect(posted.newestPostedDate).toBe(register.newestDate);
  });
});
