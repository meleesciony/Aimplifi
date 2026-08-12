/**
 * TASKS U.4 — the BalanceSnapshot writer, driven against throwaway users and the
 * REAL Prisma client (the account-delete-server.test.ts pattern).
 *
 * What this exists to prove, beyond the pure planner's contract:
 *   1. A live user accrues history at all — the defect U.4 was opened for was
 *      that ONLY `prisma/seed.ts` ever wrote a row, so every real account's
 *      detail panel read "No balance history recorded" forever.
 *   2. The written month is COMPLETE: one row per account, all on one date,
 *      including a manual account no sync touches and one whose feed has gone
 *      quiet (`feedDroppedAt`). Those two are exactly the rows a
 *      "snapshot what the sync returned" writer would drop, and dropping a
 *      liability makes the past look better than it was.
 *   3. It is idempotent within the calendar month, so wiring it into several
 *      sync paths cannot double-write.
 *   4. The demo fence holds IN THE WRITER (fence-by-construction), so no trigger
 *      added later can accumulate history onto the shared seeded demo row.
 *   5. It is scoped to the user — another user's accounts are never recorded.
 *
 * The unit gate pins DEMO_TODAY=2026-06-10 (vitest.config.ts), so `businessToday`
 * answers a MID-MONTH date here — which is the real shape for a live user and the
 * one the "month-end" copy used to misdescribe.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { recordMonthlyBalanceSnapshot } from '@/server/balance-history';

const TODAY = '2026-06-10'; // == DEMO_TODAY, the gate's pinned clock

describe('recordMonthlyBalanceSnapshot', () => {
  const USER = `u4-snap-${Date.now()}-${process.pid}`;
  const OTHER = `${USER}-other`;
  const EMPTY = `${USER}-empty`;
  let chkId = '';
  let mortgageId = '';
  let frozenId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER, EMPTY] } } });
  }

  beforeAll(async () => {
    await wipe();
    for (const id of [USER, OTHER, EMPTY]) {
      await prisma.user.create({ data: { id, email: `${id}@test.local` } });
    }
    const chk = await prisma.account.create({
      data: { userId: USER, provider: 'plaid', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 250_000 },
    });
    chkId = chk.id;
    // A hand-added mortgage: no sync ever returns it, and it is the modal case
    // from U.3. If the writer only recorded what a feed refreshed, every
    // historical point would omit this liability.
    const mortgage = await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Mortgage', type: 'LOAN', currentBalanceCents: 31_500_000 },
    });
    mortgageId = mortgage.id;
    // A feed that stopped returning this account. Its balance keeps counting
    // everywhere by documented decision, so it belongs in the history too.
    const frozen = await prisma.account.create({
      data: {
        userId: USER,
        provider: 'plaid',
        name: 'Old Savings',
        type: 'SAVINGS',
        currentBalanceCents: 1_200,
        feedDroppedAt: '2026-03-25',
      },
    });
    frozenId = frozen.id;
    await prisma.account.create({
      data: { userId: OTHER, provider: 'plaid', name: 'Not Yours', type: 'CHECKING', currentBalanceCents: 999_999 },
    });
  });

  afterAll(wipe);

  it('records one row per account, all on today, for a live user with no history', async () => {
    const res = await recordMonthlyBalanceSnapshot(USER);
    expect(res).toEqual({ written: 3, date: TODAY, skipped: null });

    const rows = await prisma.balanceSnapshot.findMany({
      where: { account: { userId: USER } },
      select: { accountId: true, date: true, balanceCents: true },
      orderBy: { balanceCents: 'asc' },
    });
    expect(rows).toHaveLength(3);
    // One bucket: a single date across every row.
    expect(new Set(rows.map((r) => r.date))).toEqual(new Set([TODAY]));
    // Completeness: the manual mortgage and the frozen feed are both in it.
    expect(rows.map((r) => r.accountId).sort()).toEqual([chkId, frozenId, mortgageId].sort());
    // Balances carried verbatim, stored positive like Account.currentBalanceCents.
    expect(rows.find((r) => r.accountId === mortgageId)?.balanceCents).toBe(31_500_000);
    expect(rows.find((r) => r.accountId === frozenId)?.balanceCents).toBe(1_200);
  });

  it('is idempotent within the month — a second sync writes nothing', async () => {
    const before = await prisma.balanceSnapshot.count({ where: { account: { userId: USER } } });
    const res = await recordMonthlyBalanceSnapshot(USER);
    expect(res).toEqual({ written: 0, date: null, skipped: 'already-recorded-this-month' });
    expect(await prisma.balanceSnapshot.count({ where: { account: { userId: USER } } })).toBe(before);
  });

  it('does not touch another user, and records nothing for a user with no accounts', async () => {
    expect(await prisma.balanceSnapshot.count({ where: { account: { userId: OTHER } } })).toBe(0);
    const res = await recordMonthlyBalanceSnapshot(EMPTY);
    expect(res).toEqual({ written: 0, date: null, skipped: 'no-accounts' });
  });

  it('refuses the shared demo user in the WRITER, leaving the seeded history untouched', async () => {
    const before = await prisma.balanceSnapshot.count({ where: { account: { userId: DEMO_USER_ID } } });
    const res = await recordMonthlyBalanceSnapshot(DEMO_USER_ID);
    expect(res).toEqual({ written: 0, date: null, skipped: 'demo' });
    expect(await prisma.balanceSnapshot.count({ where: { account: { userId: DEMO_USER_ID } } })).toBe(
      before,
    );
  });

  it('claims the next calendar month once the current one is recorded', async () => {
    // Simulate the month having been claimed in MAY instead: delete June's rows
    // and write a May bucket, then re-run. The writer must see an unclaimed June.
    await prisma.balanceSnapshot.deleteMany({ where: { account: { userId: USER } } });
    await prisma.balanceSnapshot.createMany({
      data: [
        { accountId: chkId, date: '2026-05-31', balanceCents: 240_000 },
        { accountId: mortgageId, date: '2026-05-31', balanceCents: 31_600_000 },
        { accountId: frozenId, date: '2026-05-31', balanceCents: 1_200 },
      ],
    });
    const res = await recordMonthlyBalanceSnapshot(USER);
    expect(res).toEqual({ written: 3, date: TODAY, skipped: null });
    const dates = await prisma.balanceSnapshot.findMany({
      where: { account: { userId: USER } },
      select: { date: true },
      distinct: ['date'],
      orderBy: { date: 'asc' },
    });
    expect(dates.map((d) => d.date)).toEqual(['2026-05-31', TODAY]);
  });
});
