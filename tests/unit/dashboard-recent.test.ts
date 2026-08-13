/**
 * U.30 — the home screen's Recent transactions strip marks the released
 * handover day too, at the server layer that holds `accountId`.
 *
 * Same shape as U.24's `calendar-posted-server.test.ts`: the flag is a fact
 * about the (account, day) pair, never the bare date, so this fixture puts an
 * ordinary row on a third account on the SAME date and asserts it is not
 * flagged, and a row on a pair account off the cutover date is not flagged
 * either.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getDashboardRecent } from '@/server/dashboard-recent';
import { prisma } from '@/lib/db';

const USER = `dashrecent-ho-${Date.now()}-${process.pid}`;
const CUTOVER = '2026-07-08';
let predId = '';
let succId = '';
let otherId = '';

async function txn(id: string, accountId: string, date: string, amountCents: number) {
  await prisma.transaction.create({
    data: {
      id: `${id}-${process.pid}`,
      accountId,
      date,
      amountCents,
      rawDescriptor: `ROW ${id}`,
      categoryId: 'groceries',
      status: 'POSTED',
    },
  });
}

async function wipe() {
  await prisma.accountReconciliation.deleteMany({ where: { userId: USER } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
}

describe('U.30 — dashboard Recent transactions resolves onHandoverDay, scoped to (account, day)', () => {
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const mk = async (ref: string, name: string) =>
      (
        await prisma.account.create({
          data: {
            userId: USER,
            provider: 'simplefin',
            providerRef: ref,
            name,
            type: 'CREDIT',
            currentBalanceCents: -120_000,
            currency: 'USD',
          },
        })
      ).id;
    predId = await mk('drh-pred', 'Everyday Card');
    succId = await mk('drh-succ', 'Everyday Card');
    otherId = await mk('drh-other', 'Household Checking');
    await prisma.accountReconciliation.create({
      data: {
        userId: USER,
        predecessorAccountId: predId,
        successorAccountId: succId,
        cutoverDate: CUTOVER,
        matchSignal: 'name',
        confidence: 'high',
        confirmedByUserAt: new Date(),
      },
    });

    // The handover day itself: one real charge both connections reported, kept on both sides.
    await txn('drh-p', predId, CUTOVER, -5_000);
    await txn('drh-s', succId, CUTOVER, -5_000);
    // An ordinary shopping day on an account in NO pair, same date — the scoping control.
    await txn('drh-other', otherId, CUTOVER, -2_500);
    // A day inside the pair but off the cutover: not flagged.
    await txn('drh-early', predId, '2026-07-02', -3_000);
  });
  afterAll(wipe);

  it('flags both released copies, not the unrelated row on the same date, not the off-cutover row', async () => {
    const { rows } = await getDashboardRecent(USER, 10);
    expect(rows).toHaveLength(4);

    const onCutover = rows.filter((r) => r.date === CUTOVER);
    expect(onCutover).toHaveLength(3);
    expect(onCutover.filter((r) => r.onHandoverDay)).toHaveLength(2);
    expect(onCutover.filter((r) => r.onHandoverDay).map((r) => r.amountCents).sort()).toEqual([
      -5_000, -5_000,
    ]);
    expect(onCutover.find((r) => r.amountCents === -2_500)!.onHandoverDay).toBe(false);
    expect(rows.find((r) => r.date === '2026-07-02')!.onHandoverDay).toBe(false);
  });
});
