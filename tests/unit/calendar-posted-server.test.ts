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

/**
 * U.24 — the released handover day reaches the calendar's figures, and the flag that lets the
 * page say so is resolved HERE, at the only layer that holds `accountId`.
 *
 * Two properties only the real loader can prove, and the second is the one U.16's second critic
 * cycle found by executing it: the unit of the claim is the (account, day) PAIR. An unscoped
 * date set marks ordinary rows on every other account the reader owns — a released day is an
 * ordinary shopping day everywhere else — so this fixture deliberately puts a row on a THIRD
 * account on the very same date and asserts it is not flagged.
 */
describe('U.24 — onHandoverDay is resolved at the server, scoped to (account, day)', () => {
  const HO_USER = `calho-${Date.now()}-${process.pid}`;
  const CUTOVER = '2026-07-08';
  let predId = '';
  let succId = '';
  let otherId = '';

  async function wipeHo() {
    await prisma.accountReconciliation.deleteMany({ where: { userId: HO_USER } });
    await prisma.account.deleteMany({ where: { userId: HO_USER } });
    await prisma.user.deleteMany({ where: { id: HO_USER } });
  }

  beforeAll(async () => {
    await wipeHo();
    await prisma.user.create({ data: { id: HO_USER, email: `${HO_USER}@test.local` } });
    const mk = async (ref: string, name: string) =>
      (
        await prisma.account.create({
          data: {
            userId: HO_USER,
            provider: 'simplefin',
            providerRef: ref,
            name,
            type: 'CREDIT',
            currentBalanceCents: -120_000,
            currency: 'USD',
          },
        })
      ).id;
    predId = await mk('ho-pred', 'Everyday Card');
    succId = await mk('ho-succ', 'Everyday Card');
    otherId = await mk('ho-other', 'Household Checking');
    await prisma.accountReconciliation.create({
      data: {
        userId: HO_USER,
        predecessorAccountId: predId,
        successorAccountId: succId,
        cutoverDate: CUTOVER,
        matchSignal: 'name',
        confidence: 'high',
        confirmedByUserAt: new Date(),
      },
    });

    // The handover day itself: one real charge both connections reported, kept on both sides.
    await txn('ho-p', predId, CUTOVER, -5_000);
    await txn('ho-s', succId, CUTOVER, -5_000);
    // An ordinary shopping day on an account in NO pair, on the SAME date — the scoping control.
    await txn('ho-other', otherId, CUTOVER, -2_500);
    // A day inside the pair but off the cutover: only one side's copy survives the keep.
    await txn('ho-early-p', predId, '2026-07-02', -3_000);
  });
  afterAll(wipeHo);

  it('flags both released copies, and NOT the unrelated account’s row on the same date', async () => {
    const posted = await getPostedCalendarRows(HO_USER, '2026-07-01', '2026-07-31');
    const onCutover = posted.rows.filter((r) => r.date === CUTOVER);
    // Three rows survive the keep on that date; exactly the two in the pair are flagged.
    expect(onCutover).toHaveLength(3);
    expect(onCutover.filter((r) => r.onHandoverDay)).toHaveLength(2);
    expect(onCutover.filter((r) => r.onHandoverDay).map((r) => r.amountCents).sort()).toEqual([
      -5_000, -5_000,
    ]);
    // The control: same date, no pair, not flagged. A bare-date set would flag this row.
    expect(onCutover.find((r) => r.amountCents === -2_500)!.onHandoverDay).toBe(false);
    // And a row on a pair account OFF the cutover date is not flagged either.
    expect(posted.rows.find((r) => r.date === '2026-07-02')!.onHandoverDay).toBe(false);
  });

  it('the month’s count equals the REGISTER’s for the same window — the K.1 gate, extended', async () => {
    const posted = await getPostedCalendarRows(HO_USER, '2026-07-01', '2026-07-31');
    const month = buildPostedCalendarMonth({
      month: '2026-07',
      today: isoDate('2026-08-04'),
      rows: posted.rows,
      oldestPostedDate: posted.oldestPostedDate ? isoDate(posted.oldestPostedDate) : null,
      newestPostedDate: posted.newestPostedDate ? isoDate(posted.newestPostedDate) : null,
    });
    const register = await getTransactions(HO_USER, { from: '2026-07-01', to: '2026-07-31' });
    // The two surfaces must not disagree about how many rows their totals double-count, for the
    // same reason they must not disagree about the totals themselves.
    expect(month.countedOnHandoverDays).toBe(register.summary.countedOnHandoverDays);
    expect(month.countedOnHandoverDays).toBe(2);
    expect(month.days.find((d) => d.date === CUTOVER)!.countedOnHandoverDays).toBe(2);
    // Both copies are still in the money, exactly as the register has them.
    expect(month.totalOutCents).toBe(register.summary.outflowCents);
    // 5,000 + 5,000 (the released pair, both counted) + 2,500 (unrelated account, same date)
    // + 3,000 (the early row on the predecessor) = 15,500.
    expect(month.totalOutCents).toBe(15_500);
  });
});
