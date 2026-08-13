/**
 * U.31 — `getReconciliationBoundary` reads the link table ONCE and returns both the keep
 * filter and the handover-key set from that single read, replacing the sequential
 * `getReconciliationTxnKeep` + `getReconciliationHandoverKeys` pair three loaders used to
 * call (`getTransactions`, `getPostedCalendarRows`, `getTransactionDetail` in transactions.ts,
 * and `getDashboardRecent`) — the exact shape `getAccountsView` (transactions.ts, critic F-4)
 * already argued against in writing: two independent reads of the link table leave a window
 * where a confirm/undo landing between them desyncs whatever each read derives.
 *
 * This file proves two things a type-level refactor cannot: (1) the combined function's two
 * outputs agree EXACTLY with what the two standalone functions would have separately computed
 * over the identical fixture (no behavior change), and (2) both outputs are scoped to the same
 * (account, day) pair — same fixture shape as U.24's calendar-posted-server test.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
import { prisma } from '@/lib/db';
import {
  getReconciliationBoundary,
  getReconciliationHandoverKeys,
  getReconciliationTxnKeep,
} from '@/server/reconciliation';

const USER = `recon-boundary-${Date.now()}-${process.pid}`;
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

describe('U.31 — getReconciliationBoundary matches the two standalone reads, from one fetch', () => {
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
    predId = await mk('rbsr-pred', 'Everyday Card');
    succId = await mk('rbsr-succ', 'Everyday Card');
    otherId = await mk('rbsr-other', 'Household Checking');
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

    await txn('rbsr-p', predId, CUTOVER, -5_000);
    await txn('rbsr-s', succId, CUTOVER, -5_000);
    await txn('rbsr-other', otherId, CUTOVER, -2_500);
    await txn('rbsr-early', predId, '2026-07-02', -3_000);
  });
  afterAll(wipe);

  it('the combined keep filter agrees with the standalone getReconciliationTxnKeep on every row', async () => {
    const standalone = await getReconciliationTxnKeep(USER);
    const { keepsReconciled } = await getReconciliationBoundary(USER);
    const rows = [
      [predId, CUTOVER],
      [succId, CUTOVER],
      [otherId, CUTOVER],
      [predId, '2026-07-02'],
      [succId, '2026-07-02'], // successor has no row here — the point is the FILTER agrees, not the data
    ] as const;
    for (const [accountId, date] of rows) {
      expect(keepsReconciled(accountId, date)).toBe(standalone(accountId, date));
    }
  });

  it('the combined handover-key set agrees with the standalone getReconciliationHandoverKeys', async () => {
    const standalone = await getReconciliationHandoverKeys(USER);
    const { handoverKeys } = await getReconciliationBoundary(USER);
    expect([...handoverKeys].sort()).toEqual([...standalone].sort());
    // And the fixture's own (account, day)-scoping shape: both pair sides flagged on the
    // cutover, the unrelated account on the same date is not, and the off-cutover row is not.
    expect(handoverKeys.has(handoverKey(predId, CUTOVER))).toBe(true);
    expect(handoverKeys.has(handoverKey(succId, CUTOVER))).toBe(true);
    expect(handoverKeys.has(handoverKey(otherId, CUTOVER))).toBe(false);
    expect(handoverKeys.has(handoverKey(predId, '2026-07-02'))).toBe(false);
  });

  it('with no active links, both outputs are the unconditional fast path', async () => {
    const NO_LINKS = `${USER}-nolinks`;
    await prisma.user.create({ data: { id: NO_LINKS, email: `${NO_LINKS}@test.local` } });
    try {
      const { keepsReconciled, handoverKeys } = await getReconciliationBoundary(NO_LINKS);
      expect(keepsReconciled('anything', '2026-01-01')).toBe(true);
      expect(handoverKeys.size).toBe(0);
    } finally {
      await prisma.user.deleteMany({ where: { id: NO_LINKS } });
    }
  });
});
