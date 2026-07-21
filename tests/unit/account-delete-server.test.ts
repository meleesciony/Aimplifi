/**
 * Disconnected-SimpleFIN account deletion (#253) — drives the REAL guarded core
 * (deleteDisconnectedSimplefinAccountFor) against throwaway users and the real
 * Prisma client, mirroring the income-pause-server.test.ts pattern.
 *
 * The contract under test:
 *   1. While the SimpleFIN connection is LIVE, deletion is REFUSED — sync pass 1
 *      re-creates any feed account it doesn't find, so a "delete" would be a lie
 *      that silently resurrects on the next sync.
 *   2. After disconnect, deletion succeeds and CASCADES the account's
 *      transactions; sibling accounts and their rows are untouched.
 *   3. Deleting the designated payment account clears user.paymentAccountId in
 *      the same transaction; deleting a non-payment account leaves it alone.
 *   4. Provider guard: a manual row is refused through this path (it has its own
 *      delete), so the two paths can never cross.
 *   5. Ownership: another user's account reads as not-found.
 *   6. Demo fence: the shared demo row can never delete (fence in the CORE).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { deleteDisconnectedSimplefinAccountFor } from '@/server/account-delete';
import { DEMO_ENTRY_BLOCKED, DEMO_USER_ID } from '@/lib/demo-user';
import { prisma } from '@/lib/db';

const TODAY = isoDate('2026-07-21');

describe('disconnected-SimpleFIN account deletion (#253)', () => {
  const USER = `sf-delete-${Date.now()}-${process.pid}`;
  const OTHER = `${USER}-other`;
  let checkingId = ''; // the designated payment account
  let savingsId = '';
  let manualId = '';
  let otherAcctId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    await prisma.user.create({ data: { id: OTHER, email: `${OTHER}@test.local` } });
    const chk = await prisma.account.create({
      data: { userId: USER, provider: 'simplefin', providerRef: 'sf-chk', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500_000 },
    });
    checkingId = chk.id;
    const sav = await prisma.account.create({
      data: { userId: USER, provider: 'simplefin', providerRef: 'sf-sav', name: 'Savings', type: 'SAVINGS', currentBalanceCents: 1_000_000 },
    });
    savingsId = sav.id;
    const man = await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Car', type: 'VEHICLE', currentBalanceCents: 800_000 },
    });
    manualId = man.id;
    const oth = await prisma.account.create({
      data: { userId: OTHER, provider: 'simplefin', providerRef: 'sf-oth', name: 'Other checking', type: 'CHECKING', currentBalanceCents: 100 },
    });
    otherAcctId = oth.id;
    // History on both synced accounts — the cascade must take exactly one side.
    for (const [accountId, desc] of [
      [checkingId, 'COFFEE SHOP'],
      [savingsId, 'INTEREST PAYMENT'],
    ] as const) {
      await prisma.transaction.create({
        data: { accountId, date: '2026-06-01', amountCents: -450, rawDescriptor: desc, categoryId: null, status: 'POSTED' },
      });
    }
    // A statement and a balance snapshot on checking — the cascade must take
    // these too, not just transactions (#253 critic F6).
    await prisma.statement.create({
      data: { accountId: checkingId, cycleStart: '2026-05-01', cycleEnd: '2026-05-31', dueDate: '2026-06-25', statementBalanceCents: 12_345, minimumPaymentCents: 2_500 },
    });
    await prisma.balanceSnapshot.create({
      data: { accountId: checkingId, date: '2026-05-31', balanceCents: 500_000 },
    });
    // A STALE recurring series (its transactions live on the account being
    // deleted) — the post-delete refresh must prune it (#253 critic F3: with the
    // connection disconnected, no sync remains to ever recompute it otherwise).
    const ghostMerchant = await prisma.merchant.upsert({
      where: { canonical: `Ghost Coffee ${USER}` },
      create: { canonical: `Ghost Coffee ${USER}`, defaultCategoryId: null },
      update: {},
    });
    await prisma.recurringSeries.create({
      data: { userId: USER, merchantId: ghostMerchant.id, cadence: 'MONTHLY', typicalAmountCents: -450, lastAmountCents: -450, lastSeenAt: '2026-06-01', isSubscription: true },
    });
    // Checking is the designated payment account.
    await prisma.user.update({ where: { id: USER }, data: { paymentAccountId: checkingId } });
    // The connection starts LIVE.
    await prisma.simpleFinConnection.create({ data: { userId: USER, accessUrl: 'test-ciphertext' } });
  });
  afterAll(wipe);

  it('1. refused while the connection is live — the row would resurrect on the next sync', async () => {
    const res = await deleteDisconnectedSimplefinAccountFor(USER, checkingId, TODAY);
    expect(res.ok).toBe(false);
    expect(res.errors?.join(' ')).toMatch(/[Dd]isconnect the bank first/);
    expect(await prisma.account.count({ where: { id: checkingId } })).toBe(1);
  });

  it('4. provider guard: a manual row is refused through this path', async () => {
    const res = await deleteDisconnectedSimplefinAccountFor(USER, manualId, TODAY);
    expect(res.ok).toBe(false);
    expect(res.errors?.join(' ')).toMatch(/Only SimpleFIN-synced/);
    expect(await prisma.account.count({ where: { id: manualId } })).toBe(1);
  });

  it('5. ownership: another user’s account reads as not-found', async () => {
    const res = await deleteDisconnectedSimplefinAccountFor(USER, otherAcctId, TODAY);
    expect(res.ok).toBe(false);
    expect(res.errors?.join(' ')).toMatch(/not found/i);
    expect(await prisma.account.count({ where: { id: otherAcctId } })).toBe(1);
  });

  it('6. demo fence: the shared demo row can never delete', async () => {
    const res = await deleteDisconnectedSimplefinAccountFor(DEMO_USER_ID, checkingId, TODAY);
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual([DEMO_ENTRY_BLOCKED]);
    expect(await prisma.account.count({ where: { id: checkingId } })).toBe(1);
  });

  it('2+3. after disconnect: payment-account delete cascades its history and clears the dial', async () => {
    await prisma.simpleFinConnection.deleteMany({ where: { userId: USER } });
    const res = await deleteDisconnectedSimplefinAccountFor(USER, checkingId, TODAY);
    expect(res.ok).toBe(true);
    // The account and ITS rows are gone — transactions, statement, snapshot (F6)…
    expect(await prisma.account.count({ where: { id: checkingId } })).toBe(0);
    expect(await prisma.transaction.count({ where: { accountId: checkingId } })).toBe(0);
    expect(await prisma.statement.count({ where: { accountId: checkingId } })).toBe(0);
    expect(await prisma.balanceSnapshot.count({ where: { accountId: checkingId } })).toBe(0);
    // …the sibling synced account and its history are untouched…
    expect(await prisma.account.count({ where: { id: savingsId } })).toBe(1);
    expect(await prisma.transaction.count({ where: { accountId: savingsId } })).toBe(1);
    // …the payment-account dial no longer points at a deleted row…
    const user = await prisma.user.findUnique({ where: { id: USER }, select: { paymentAccountId: true } });
    expect(user!.paymentAccountId).toBeNull();
    // …and the post-delete refresh pruned the stale recurring series (F3): the
    // remaining single-occurrence transactions form no series, so the recompute
    // leaves zero rows — the seeded ghost is gone.
    expect(await prisma.recurringSeries.count({ where: { userId: USER } })).toBe(0);
  });

  it('3b. deleting a NON-payment account leaves the dial alone', async () => {
    // Re-point the dial at the manual account, then delete the synced savings row.
    await prisma.user.update({ where: { id: USER }, data: { paymentAccountId: manualId } });
    const res = await deleteDisconnectedSimplefinAccountFor(USER, savingsId, TODAY);
    expect(res.ok).toBe(true);
    expect(await prisma.account.count({ where: { id: savingsId } })).toBe(0);
    const user = await prisma.user.findUnique({ where: { id: USER }, select: { paymentAccountId: true } });
    expect(user!.paymentAccountId).toBe(manualId);
  });
});
