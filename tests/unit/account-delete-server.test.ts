/**
 * Disconnected-synced-account deletion (#253 SimpleFIN, #256 Plaid) — drives the
 * REAL guarded core
 * (deleteDisconnectedSyncedAccountFor) against throwaway users and the real
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isoDate } from '@/lib/dates';
import { deleteDisconnectedSyncedAccountFor, syncedDeleteBlockReason } from '@/server/account-delete';
import { DEMO_ENTRY_BLOCKED, DEMO_USER_ID } from '@/lib/demo-user';
import { prisma } from '@/lib/db';
import { getAccountsView } from '@/server/transactions';

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
    const res = await deleteDisconnectedSyncedAccountFor(USER, checkingId, TODAY);
    expect(res.ok).toBe(false);
    expect(res.errors?.join(' ')).toMatch(/[Dd]isconnect the bank first/);
    expect(await prisma.account.count({ where: { id: checkingId } })).toBe(1);
  });

  it('4. provider guard: a manual row is refused through this path', async () => {
    const res = await deleteDisconnectedSyncedAccountFor(USER, manualId, TODAY);
    expect(res.ok).toBe(false);
    expect(res.errors?.join(' ')).toMatch(/Only bank-synced/);
    expect(await prisma.account.count({ where: { id: manualId } })).toBe(1);
  });

  it('5. ownership: another user’s account reads as not-found', async () => {
    const res = await deleteDisconnectedSyncedAccountFor(USER, otherAcctId, TODAY);
    expect(res.ok).toBe(false);
    expect(res.errors?.join(' ')).toMatch(/not found/i);
    expect(await prisma.account.count({ where: { id: otherAcctId } })).toBe(1);
  });

  it('6. demo fence: the shared demo row can never delete', async () => {
    const res = await deleteDisconnectedSyncedAccountFor(DEMO_USER_ID, checkingId, TODAY);
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual([DEMO_ENTRY_BLOCKED]);
    expect(await prisma.account.count({ where: { id: checkingId } })).toBe(1);
  });

  it('2+3. after disconnect: payment-account delete cascades its history and clears the dial', async () => {
    await prisma.simpleFinConnection.deleteMany({ where: { userId: USER } });
    const res = await deleteDisconnectedSyncedAccountFor(USER, checkingId, TODAY);
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
    const res = await deleteDisconnectedSyncedAccountFor(USER, savingsId, TODAY);
    expect(res.ok).toBe(true);
    expect(await prisma.account.count({ where: { id: savingsId } })).toBe(0);
    const user = await prisma.user.findUnique({ where: { id: USER }, select: { paymentAccountId: true } });
    expect(user!.paymentAccountId).toBe(manualId);
  });
});

describe('disconnected-Plaid account deletion (#256)', () => {
  const USER = `plaid-delete-${Date.now()}-${process.pid}`;
  const ITEM_A = `${USER}-item-a`;
  const ITEM_B = `${USER}-item-b`;
  let linkedToA = ''; // plaidItemId = ITEM_A
  let unlinked = ''; // plaidItemId null (pre-#256 row never re-synced)

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const a = await prisma.account.create({
      data: { userId: USER, provider: 'plaid', providerRef: 'pl-a', plaidItemId: ITEM_A, name: 'Plaid checking', type: 'CHECKING', currentBalanceCents: 100_000 },
    });
    linkedToA = a.id;
    const u = await prisma.account.create({
      data: { userId: USER, provider: 'plaid', providerRef: 'pl-u', plaidItemId: null, name: 'Plaid legacy card', type: 'CREDIT', currentBalanceCents: 50_000 },
    });
    unlinked = u.id;
    await prisma.transaction.create({
      data: { accountId: linkedToA, date: '2026-06-01', amountCents: -900, rawDescriptor: 'PLAID COFFEE', categoryId: null, status: 'POSTED' },
    });
    // Two live items: A owns linkedToA; B stands in for "some other bank".
    for (const itemId of [ITEM_A, ITEM_B]) {
      await prisma.plaidItem.create({ data: { userId: USER, itemId, accessToken: 'test-ciphertext' } });
    }
  });
  afterAll(wipe);

  it('P1. refused while the OWNING item is live — its next sync would resurrect the row', async () => {
    const res = await deleteDisconnectedSyncedAccountFor(USER, linkedToA, TODAY);
    expect(res.ok).toBe(false);
    expect(res.errors?.join(' ')).toMatch(/[Dd]isconnect the bank first/);
    expect(await prisma.account.count({ where: { id: linkedToA } })).toBe(1);
  });

  it('P2. a LINKED row deletes once ITS item is gone, even while another bank stays connected', async () => {
    await prisma.plaidItem.deleteMany({ where: { userId: USER, itemId: ITEM_A } });
    const res = await deleteDisconnectedSyncedAccountFor(USER, linkedToA, TODAY);
    expect(res.ok).toBe(true);
    expect(await prisma.account.count({ where: { id: linkedToA } })).toBe(0);
    expect(await prisma.transaction.count({ where: { accountId: linkedToA } })).toBe(0);
    // ITEM_B is still connected — precision comes from the linkage, not a blanket rule.
    expect(await prisma.plaidItem.count({ where: { userId: USER } })).toBe(1);
  });

  it('P3. an UNLINKED row is conservatively refused while ANY item remains (unknown owner)', async () => {
    const res = await deleteDisconnectedSyncedAccountFor(USER, unlinked, TODAY);
    expect(res.ok).toBe(false);
    expect(res.errors?.join(' ')).toMatch(/[Dd]isconnect the bank first/);
    expect(await prisma.account.count({ where: { id: unlinked } })).toBe(1);
  });

  it('P4. the unlinked row deletes once every item is gone', async () => {
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
    const res = await deleteDisconnectedSyncedAccountFor(USER, unlinked, TODAY);
    expect(res.ok).toBe(true);
    expect(await prisma.account.count({ where: { id: unlinked } })).toBe(0);
  });
});

describe('test_regression__plaid-linkage-read-inside-tx (#256 critic P1-1)', () => {
  const USER = `plaid-toctou-${Date.now()}-${process.pid}`;
  const DEAD = `${USER}-item-dead`;
  const LIVE = `${USER}-item-live`;

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('a row re-stamped to a LIVE item after the pre-tx read is REFUSED, not deleted', async () => {
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const row = await prisma.account.create({
      data: { userId: USER, provider: 'plaid', providerRef: 'pl-toctou', plaidItemId: DEAD, name: 'Racy checking', type: 'CHECKING', currentBalanceCents: 1_000 },
    });
    await prisma.plaidItem.create({ data: { userId: USER, itemId: LIVE, accessToken: 'test-ciphertext' } });

    // Interleave: let the guard's FIRST (pre-transaction) account read see the
    // stale DEAD linkage, then stamp the row to the LIVE item before the
    // transaction runs — the re-link-mid-gap race the #253 F2 fix exists for.
    // The fixed guard re-reads the row INSIDE the transaction and must refuse;
    // the pre-fix guard judged the stale snapshot and deleted (critic-executed).
    const realFindFirst = prisma.account.findFirst.bind(prisma.account);
    const spy = vi.spyOn(prisma.account, 'findFirst').mockImplementation((async (args: unknown) => {
      spy.mockRestore(); // only the first (outside) read is interleaved
      const stale = await realFindFirst(args as never);
      await prisma.account.update({ where: { id: row.id }, data: { plaidItemId: LIVE } });
      return stale;
    }) as never);

    const res = await deleteDisconnectedSyncedAccountFor(USER, row.id, TODAY);
    expect(res.ok).toBe(false);
    expect(res.errors?.join(' ')).toMatch(/[Dd]isconnect the bank first/);
    expect(await prisma.account.count({ where: { id: row.id } })).toBe(1);
  });
});

describe('getAccountsView deletable matrix (#256 critic P2-2 — the affordance never promises what the guard refuses)', () => {
  const USER = `view-deletable-${Date.now()}-${process.pid}`;
  const LIVE = `${USER}-live-item`;
  const ids: Record<string, string> = {};

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it('server-computed deletable matches the guard predicate for every provider state', async () => {
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    await prisma.plaidItem.create({ data: { userId: USER, itemId: LIVE, accessToken: 'test-ciphertext' } });
    // NO SimpleFinConnection row → simplefin rows are in the disconnected state.
    const mk = async (key: string, data: Record<string, unknown>) => {
      const a = await prisma.account.create({
        data: { userId: USER, name: key, type: 'CHECKING', currentBalanceCents: 1_000, ...data } as never,
      });
      ids[key] = a.id;
    };
    await mk('manual', { provider: 'manual' });
    await mk('sf-disconnected', { provider: 'simplefin', providerRef: 'sf-1' });
    await mk('plaid-live', { provider: 'plaid', providerRef: 'pl-1', plaidItemId: LIVE });
    await mk('plaid-dead', { provider: 'plaid', providerRef: 'pl-2', plaidItemId: `${USER}-gone` });
    await mk('plaid-unstamped', { provider: 'plaid', providerRef: 'pl-3', plaidItemId: null });

    const view = await getAccountsView(USER);
    const byName = new Map(
      [...view.assets.accounts, ...view.liabilities.accounts].map((a) => [a.name, a.deletable ?? false]),
    );
    expect(byName.get('manual')).toBe(false); // manual rows use their own delete path
    expect(byName.get('sf-disconnected')).toBe(true); // no SimpleFIN connection
    expect(byName.get('plaid-live')).toBe(false); // its item would resurrect it
    expect(byName.get('plaid-dead')).toBe(true); // owning item gone; other bank irrelevant
    expect(byName.get('plaid-unstamped')).toBe(false); // conservative while ANY item lives
    // The Plaid connections list feeds the Disconnect UI.
    expect(view.plaid.items.map((i) => i.itemId)).toEqual([LIVE]);
  });
});

describe('syncedDeleteBlockReason — the one predicate both the view and the guard read', () => {
  const sf = { provider: 'simplefin', plaidItemId: null };
  const plaidLinked = { provider: 'plaid', plaidItemId: 'item-1' };
  const plaidUnlinked = { provider: 'plaid', plaidItemId: null };

  it('simplefin: blocked by the (single) connection, indifferent to Plaid items', () => {
    expect(syncedDeleteBlockReason(sf, { simplefinConnected: true, plaidItemIds: [] })).toMatch(/Disconnect/);
    expect(syncedDeleteBlockReason(sf, { simplefinConnected: false, plaidItemIds: ['item-1'] })).toBeNull();
  });

  it('plaid linked: blocked only by ITS OWN item', () => {
    expect(syncedDeleteBlockReason(plaidLinked, { simplefinConnected: false, plaidItemIds: ['item-1', 'item-2'] })).toMatch(/Disconnect/);
    expect(syncedDeleteBlockReason(plaidLinked, { simplefinConnected: true, plaidItemIds: ['item-2'] })).toBeNull();
  });

  it('plaid unlinked: blocked while ANY item remains', () => {
    expect(syncedDeleteBlockReason(plaidUnlinked, { simplefinConnected: false, plaidItemIds: ['item-2'] })).toMatch(/Disconnect/);
    expect(syncedDeleteBlockReason(plaidUnlinked, { simplefinConnected: false, plaidItemIds: [] })).toBeNull();
  });

  it('non-synced providers are refused outright', () => {
    for (const provider of ['manual', 'demo']) {
      expect(syncedDeleteBlockReason({ provider, plaidItemId: null }, { simplefinConnected: false, plaidItemIds: [] })).toMatch(/Only bank-synced/);
    }
  });
});
