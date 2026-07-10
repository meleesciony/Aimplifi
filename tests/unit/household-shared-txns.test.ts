/**
 * Household shared transactions in the register — TASKS 4.2 slice 3
 * (HOUSEHOLD_ARCHITECTURE §4.5 / §5.3). Locks:
 *  - T1: partner UNSHARED-account transactions never appear.
 *  - T2: non-member / post-leave rows invisible even with the share flag.
 *  - T3: partner cannot mutate a shared-account transaction (recategorize
 *    ownership scope — until slice 6 widens this deliberately).
 *  - F3: category names resolve via scoped-ids lookup; getCategoryMeta for the
 *    viewer does NOT gain the partner's custom category vocabulary.
 *  - Personal getTransactions stays OWNED-only (summary/picker isolation).
 *  - T6: no household → kind 'none' (demo/golden safe).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { leaveHousehold } from '@/server/household-actions';
import { getSharedTransactionsView } from '@/server/household';
import { categoryNamesByIds, getCategoryMeta } from '@/server/category-meta';
import { getTransactions } from '@/server/transactions';
import { recategorize } from '@/server/triage-actions';

const stamp = `${Date.now()}-${process.pid}`;
const uid = (slug: string) => `hht-${slug}-${stamp}`;
const emailOf = (id: string) => `${id}@test.local`;

const ALL_IDS: string[] = [];
async function seedUser(slug: string, name?: string): Promise<string> {
  const id = uid(slug);
  ALL_IDS.push(id);
  await prisma.user.create({ data: { id, email: emailOf(id), name: name ?? slug } });
  return id;
}
function actAs(userId: string) {
  vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);
}
async function wipe() {
  const memberships = await prisma.householdMember.findMany({
    where: { userId: { in: ALL_IDS } },
    select: { householdId: true },
  });
  await prisma.household.deleteMany({
    where: { id: { in: memberships.map((m) => m.householdId) } },
  });
  await prisma.user.deleteMany({ where: { id: { in: ALL_IDS } } });
}

describe('categoryNamesByIds (scoped lookup — F3)', () => {
  it('resolves system ids from the static map without inventing partner vocabulary', async () => {
    const map = await categoryNamesByIds(['groceries', 'dining', null, 'uncategorized', '']);
    expect(map.get('groceries')).toBe('Groceries');
    expect(map.get('dining')).toBe('Dining Out');
    expect(map.has('uncategorized')).toBe(false); // caller falls back via categoryName()
  });

  it('resolves ONLY the requested custom ids — not every custom the owner owns', async () => {
    const owner = await seedUser('cat-owner');
    const visible = await prisma.category.create({
      data: {
        id: `cat-vis-${stamp}`,
        userId: owner,
        name: 'Partner Golf',
        group: 'Entertainment',
        discretionary: true,
        isSystem: false,
      },
    });
    const hidden = await prisma.category.create({
      data: {
        id: `cat-hid-${stamp}`,
        userId: owner,
        name: 'Secret Therapy',
        group: 'Health',
        discretionary: true,
        isSystem: false,
      },
    });
    try {
      const map = await categoryNamesByIds([visible.id]);
      expect(map.get(visible.id)).toBe('Partner Golf');
      expect(map.has(hidden.id)).toBe(false); // never loaded — vocabulary stays private
    } finally {
      await prisma.category.deleteMany({ where: { id: { in: [visible.id, hidden.id] } } });
      await prisma.user.delete({ where: { id: owner } });
      ALL_IDS.splice(ALL_IDS.indexOf(owner), 1);
    }
  });
});

describe('household shared transactions (integration)', () => {
  let ownerId = ''; // viewer under test
  let partnerId = '';
  let strangerId = '';
  let ownAcct = '';
  let sharedAcct = '';
  let privateAcct = '';
  let eurSharedAcct = '';
  let ownTxn = '';
  let sharedTxn = '';
  let sharedCustomTxn = '';
  let privateTxn = '';
  let eurTxn = '';
  let partnerCustomCat = '';
  let partnerHiddenCat = '';

  beforeAll(async () => {
    await wipe().catch(() => {});
    ownerId = await seedUser('owner');
    partnerId = await seedUser('partner', 'Pat Partner');
    strangerId = await seedUser('stranger');
    await prisma.household.create({
      data: {
        name: 'Casa Txn',
        members: {
          create: [
            { userId: ownerId, role: 'owner' },
            { userId: partnerId, role: 'partner' },
          ],
        },
      },
    });

    ownAcct = (
      await prisma.account.create({
        data: {
          userId: ownerId,
          provider: 'manual',
          name: 'My Checking',
          type: 'CHECKING',
          currentBalanceCents: 10000,
          currency: 'USD',
        },
      })
    ).id;
    sharedAcct = (
      await prisma.account.create({
        data: {
          userId: partnerId,
          provider: 'manual',
          name: 'Pat Checking',
          type: 'CHECKING',
          currentBalanceCents: 20000,
          currency: 'USD',
          sharedToHousehold: true,
        },
      })
    ).id;
    privateAcct = (
      await prisma.account.create({
        data: {
          userId: partnerId,
          provider: 'manual',
          name: 'Pat Private',
          type: 'SAVINGS',
          currentBalanceCents: 999999,
          currency: 'USD',
          sharedToHousehold: false,
        },
      })
    ).id;
    eurSharedAcct = (
      await prisma.account.create({
        data: {
          userId: partnerId,
          provider: 'manual',
          name: 'Pat Euro',
          type: 'CHECKING',
          currentBalanceCents: 5000,
          currency: 'EUR',
          sharedToHousehold: true,
        },
      })
    ).id;

    partnerCustomCat = (
      await prisma.category.create({
        data: {
          id: `pat-golf-${stamp}`,
          userId: partnerId,
          name: 'Partner Golf',
          group: 'Entertainment',
          discretionary: true,
          isSystem: false,
        },
      })
    ).id;
    partnerHiddenCat = (
      await prisma.category.create({
        data: {
          id: `pat-secret-${stamp}`,
          userId: partnerId,
          name: 'Secret Therapy',
          group: 'Health',
          discretionary: true,
          isSystem: false,
        },
      })
    ).id;

    const mkTxn = (data: Parameters<typeof prisma.transaction.create>[0]['data']) =>
      prisma.transaction.create({ data });

    ownTxn = (
      await mkTxn({
        accountId: ownAcct,
        date: '2026-07-01',
        amountCents: -1200,
        rawDescriptor: 'MY COFFEE',
        categoryId: 'dining',
        status: 'POSTED',
        isTransfer: false,
        isSplitParent: false,
      })
    ).id;
    sharedTxn = (
      await mkTxn({
        accountId: sharedAcct,
        date: '2026-07-02',
        amountCents: -4500,
        rawDescriptor: 'PAT GROCERY',
        categoryId: 'groceries',
        status: 'POSTED',
        isTransfer: false,
        isSplitParent: false,
      })
    ).id;
    sharedCustomTxn = (
      await mkTxn({
        accountId: sharedAcct,
        date: '2026-07-03',
        amountCents: -8000,
        rawDescriptor: 'PAT GOLF CLUB',
        categoryId: partnerCustomCat,
        status: 'POSTED',
        isTransfer: false,
        isSplitParent: false,
      })
    ).id;
    privateTxn = (
      await mkTxn({
        accountId: privateAcct,
        date: '2026-07-04',
        amountCents: -99900,
        rawDescriptor: 'PRIVATE SPEND',
        categoryId: partnerHiddenCat, // vocabulary that must NOT leak via getCategoryMeta
        status: 'POSTED',
        isTransfer: false,
        isSplitParent: false,
      })
    ).id;
    eurTxn = (
      await mkTxn({
        accountId: eurSharedAcct,
        date: '2026-07-05',
        amountCents: -1000,
        rawDescriptor: 'EURO CAFE',
        categoryId: 'dining',
        status: 'POSTED',
        isTransfer: false,
        isSplitParent: false,
      })
    ).id;
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T6: no household → kind none (nothing rendered — golden/demo safe)', async () => {
    actAs(strangerId);
    expect(await getSharedTransactionsView()).toEqual({ kind: 'none' });
  });

  it('T1: shared view shows partner-SHARED spending rows only — private + EUR absent; owner-badged', async () => {
    actAs(ownerId);
    const view = await getSharedTransactionsView();
    expect(view.kind).toBe('member');
    if (view.kind !== 'member') return;
    expect(view.householdName).toBe('Casa Txn');
    const ids = view.rows.map((r) => r.id);
    expect(ids).toContain(sharedTxn);
    expect(ids).toContain(sharedCustomTxn);
    expect(ids).not.toContain(privateTxn); // T1
    expect(ids).not.toContain(eurTxn); // currency guard
    expect(ids).not.toContain(ownTxn); // own rows stay in getTransactions
    const grocery = view.rows.find((r) => r.id === sharedTxn)!;
    expect(grocery).toMatchObject({
      categoryName: 'Groceries',
      ownerLabel: 'Pat Partner',
      accountName: 'Pat Checking',
      amountCents: -4500,
    });
    // Custom category on a SHARED row resolves by scoped id — visible label only.
    const golf = view.rows.find((r) => r.id === sharedCustomTxn)!;
    expect(golf.categoryName).toBe('Partner Golf');
    expect(golf.ownerLabel).toBe('Pat Partner');
  });

  it('personal getTransactions stays OWNED-only — shared partner rows never enter summary', async () => {
    const result = await getTransactions(ownerId);
    const ids = new Set(result.rows.map((r) => r.id));
    expect(ids.has(ownTxn)).toBe(true);
    expect(ids.has(sharedTxn)).toBe(false);
    expect(ids.has(privateTxn)).toBe(false);
  });

  it('F3: getCategoryMeta(viewer) does NOT gain the partner custom vocabulary', async () => {
    const meta = await getCategoryMeta(ownerId);
    expect(meta.has(partnerCustomCat)).toBe(false);
    expect(meta.has(partnerHiddenCat)).toBe(false);
    // The shared-row label still resolves via the scoped helper alone.
    const names = await categoryNamesByIds([partnerCustomCat, partnerHiddenCat]);
    expect(names.get(partnerCustomCat)).toBe('Partner Golf');
    // Hidden id is only resolvable if asked — the shared view never asks for it
    // (locked by the T1 absence of privateTxn above). Asking here proves the
    // helper itself is id-scoped, not "load all partner customs".
    expect(names.get(partnerHiddenCat)).toBe('Secret Therapy');
  });

  it('T3: partner cannot recategorize a shared-account transaction (owner scope)', async () => {
    actAs(ownerId);
    await expect(
      recategorize({ transactionId: sharedTxn, categoryId: 'dining', scope: 'one' }),
    ).rejects.toThrow(/Transaction not found/);
    // Row untouched.
    const row = await prisma.transaction.findUnique({ where: { id: sharedTxn } });
    expect(row?.categoryId).toBe('groceries');
  });

  it('T2/T4: after leave, shared transactions vanish immediately', async () => {
    actAs(ownerId);
    expect((await getSharedTransactionsView()).kind).toBe('member');
    // Leave as the partner so the owner's household still exists but has no
    // partners → partnerSharedAccountsWhere returns null → empty rows.
    actAs(partnerId);
    expect(await leaveHousehold()).toEqual({ ok: true });
    actAs(ownerId);
    const view = await getSharedTransactionsView();
    expect(view.kind).toBe('member');
    if (view.kind !== 'member') return;
    expect(view.rows).toEqual([]);
  });
});
