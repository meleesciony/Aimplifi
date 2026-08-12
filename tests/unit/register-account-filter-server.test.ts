/**
 * `getTransactions`'s account axis + `getAccountDetail` — integration against
 * the real loader (the mortgage dead-end slice, U.3 critic finding #4).
 *
 * Why a server test: the unit locks feed `registerEmptyReason` a SYNTHETIC
 * accountFilter, so the resolution that builds it — and both docblocks'
 * authz claims ("scoped to userId … never another user's balances") — were
 * hypotheses no test could fail. The sabotage these kill: delete `userId`
 * from either `where` and the cross-user cases below go red.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getAccountDetail, getTransactions } from '@/server/transactions';
import { prisma } from '@/lib/db';

const USER = `acctfilter-${Date.now()}-${process.pid}`;
const STRANGER = `${USER}-stranger`;

const ids = {
  checkingWithRows: `${USER}-chk`,
  checkingNoRows: `${USER}-chk-empty`,
  mortgage: `${USER}-mort`,
  eurChecking: `${USER}-eur`,
  strangersAccount: `${STRANGER}-chk`,
};

async function wipe() {
  await prisma.account.deleteMany({ where: { userId: { in: [USER, STRANGER] } } });
  await prisma.user.deleteMany({ where: { id: { in: [USER, STRANGER] } } });
}

describe('the register resolves its ?account= axis against the reader’s own accounts', () => {
  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    await prisma.user.create({ data: { id: STRANGER, email: `${STRANGER}@test.local` } });
    await prisma.account.createMany({
      data: [
        { id: ids.checkingWithRows, userId: USER, provider: 'simplefin', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 100_000, currency: 'USD' },
        { id: ids.checkingNoRows, userId: USER, provider: 'simplefin', name: 'New Checking', type: 'CHECKING', currentBalanceCents: 50_000, currency: 'USD' },
        // displayName set: the resolution must paint the reader's own name
        // for it, same `accountLabel` as every surface (L.7).
        { id: ids.mortgage, userId: USER, provider: 'plaid', name: 'WF HOME MTG', displayName: 'Home Mortgage', type: 'MORTGAGE', currentBalanceCents: 41_230_000, currency: 'USD', aprBps: 512, minimumPaymentCents: 210_000, dueDayOfMonth: 1 },
        { id: ids.eurChecking, userId: USER, provider: 'simplefin', name: 'Chequing (EUR)', type: 'CHECKING', currentBalanceCents: 80_000, currency: 'EUR' },
        { id: ids.strangersAccount, userId: STRANGER, provider: 'simplefin', name: 'Stranger Checking', type: 'CHECKING', currentBalanceCents: 999_999, currency: 'USD' },
      ],
    });
    await prisma.transaction.create({
      data: {
        id: `${USER}-t1`,
        accountId: ids.checkingWithRows,
        date: '2026-06-01',
        amountCents: -1_500,
        rawDescriptor: 'COFFEE',
        categoryId: 'uncategorized',
        confidenceBps: 4000,
        needsReview: true,
      },
    });
    await prisma.balanceSnapshot.createMany({
      data: [
        { accountId: ids.mortgage, date: '2026-05-31', balanceCents: 41_500_000 },
        { accountId: ids.mortgage, date: '2026-04-30', balanceCents: 41_800_000 },
      ],
    });
  });
  afterAll(wipe);

  it('the dropdown lists the FILTERABLE SET — zero-row spending accounts included, non-spending and non-USD excluded', async () => {
    const r = await getTransactions(USER);
    const ids_ = r.accountOptions.map((a) => a.id);
    expect(ids_).toContain(ids.checkingWithRows);
    // The headline change: rows-present no longer decides membership.
    expect(ids_).toContain(ids.checkingNoRows);
    expect(ids_).not.toContain(ids.mortgage);
    expect(ids_).not.toContain(ids.eurChecking);
    expect(ids_).not.toContain(ids.strangersAccount);
  });

  it('an in-basis account WITH rows resolves null — its zeros belong to the other branches', async () => {
    const r = await getTransactions(USER, { accountId: ids.checkingWithRows });
    expect(r.accountFilter).toBeNull();
  });

  it('an in-basis account with NO rows resolves no-rows with its painted name', async () => {
    const r = await getTransactions(USER, { accountId: ids.checkingNoRows });
    expect(r.accountFilter).toEqual({ kind: 'no-rows', name: 'New Checking' });
  });

  it("the owner's mortgage resolves not-here, carrying the READER'S name for it and the raw type", async () => {
    const r = await getTransactions(USER, { accountId: ids.mortgage });
    expect(r.accountFilter).toEqual({
      kind: 'not-here',
      id: ids.mortgage,
      name: 'Home Mortgage', // displayName, via accountLabel — never the feed string
      type: 'MORTGAGE',
    });
  });

  it('a non-USD spending account resolves not-here with its spending TYPE — the copy layer derives the currency story from it', async () => {
    const r = await getTransactions(USER, { accountId: ids.eurChecking });
    expect(r.accountFilter).toEqual({
      kind: 'not-here',
      id: ids.eurChecking,
      name: 'Chequing (EUR)',
      type: 'CHECKING',
    });
  });

  it("ANOTHER USER'S account id resolves unknown — never a name, never a type (the authz lock)", async () => {
    const r = await getTransactions(USER, { accountId: ids.strangersAccount });
    expect(r.accountFilter).toEqual({ kind: 'unknown' });
  });

  it('an id that matches nothing anywhere resolves unknown', async () => {
    const r = await getTransactions(USER, { accountId: 'no-such-account' });
    expect(r.accountFilter).toEqual({ kind: 'unknown' });
  });

  it('getAccountDetail returns the OWNER’s history oldest-first with the loan facts', async () => {
    const d = await getAccountDetail(USER, ids.mortgage);
    expect(d).not.toBeNull();
    expect(d!.history.map((h) => h.date)).toEqual(['2026-04-30', '2026-05-31']);
    expect(d!.history.map((h) => h.balanceCents)).toEqual([41_800_000, 41_500_000]);
    expect(d!.aprBps).toBe(512);
    expect(d!.minimumPaymentCents).toBe(210_000);
    expect(d!.dueDayOfMonth).toBe(1);
  });

  it("getAccountDetail refuses ANOTHER USER'S id with null — the second authz lock", async () => {
    expect(await getAccountDetail(USER, ids.strangersAccount)).toBeNull();
    expect(await getAccountDetail(STRANGER, ids.mortgage)).toBeNull();
  });

  it('getAccountDetail on an owned account with no snapshots returns the empty-history shape, not an error', async () => {
    const d = await getAccountDetail(USER, ids.checkingNoRows);
    // `feedDroppedAt` joined the view in U.4: the panel needs it to mark rows
    // recorded AFTER the feed went quiet as carried forward rather than read.
    expect(d).toEqual({
      id: ids.checkingNoRows,
      history: [],
      aprBps: null,
      minimumPaymentCents: null,
      dueDayOfMonth: null,
      feedDroppedAt: null,
    });
  });
});
