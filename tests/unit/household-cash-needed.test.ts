/**
 * Joint cash-needed — TASKS 4.2 slice 4 (HOUSEHOLD_ARCHITECTURE §4.4). Locks:
 *  - Pure `mergeSnapshots`: disjoint-by-account-id union; duplicate account id
 *    across slices fails loudly (T9); today-mismatch across slices fails loudly
 *    (drift guard).
 *  - `getSharedSnapshotSlice`: partner's UNSHARED card is absent; shared card's
 *    statement/cardPayment/transaction rows travel with it.
 *  - `getCashNeeded`/`getDashboardData` 'mine' scope byte-identical to no-household
 *    (T6); 'household' scope folds the partner's shared card into the headline;
 *    net worth stays PERSONAL in household scope (§4.5: analysis is personal,
 *    obligations are shared); a solo/no-partner request for 'household' silently
 *    degenerates to 'mine'.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import type { AccountLike } from '@/lib/engine/cash-needed/assemble';
import { mergeSnapshots, type CashNeededSnapshotSlice, type PartnerSnapshotSlice } from '@/lib/engine/household/merge-snapshot';
import { getSharedSnapshotSlice } from '@/server/household-finance';
import { getCashNeeded, getDashboardData } from '@/server/finance';
import { getAccountsView } from '@/server/transactions';

// ---------------------------------------------------------------------------
// Pure mergeSnapshots — no DB.
// ---------------------------------------------------------------------------

function account(id: string, over: Partial<AccountLike> = {}): AccountLike {
  return {
    id,
    name: id,
    type: 'CREDIT',
    currentBalanceCents: 0,
    aprBps: 0,
    dueDayOfMonth: null,
    cycleCloseDayOfMonth: null,
    ...over,
  };
}

function emptySlice(accounts: AccountLike[] = []): CashNeededSnapshotSlice {
  return { accounts, autopays: [], statements: [], cardPayments: [], transactions: [], scheduled: [] };
}

describe('mergeSnapshots (pure)', () => {
  const TODAY = isoDate('2026-07-10');

  it('unions disjoint accounts from the viewer + N partners', () => {
    const mine = emptySlice([account('mine-1')]);
    const p1: PartnerSnapshotSlice = { ...emptySlice([account('p1-1')]), today: TODAY };
    const p2: PartnerSnapshotSlice = { ...emptySlice([account('p2-1'), account('p2-2')]), today: TODAY };
    const merged = mergeSnapshots(TODAY, mine, [p1, p2]);
    expect(merged.accounts.map((a) => a.id)).toEqual(['mine-1', 'p1-1', 'p2-1', 'p2-2']);
  });

  it('no partners → merged equals mine verbatim', () => {
    const mine = emptySlice([account('mine-1')]);
    expect(mergeSnapshots(TODAY, mine, [])).toEqual(mine);
  });

  it('T9: the SAME account id in both the viewer slice and a partner slice fails loudly (never silently double-counts)', () => {
    const mine = emptySlice([account('shared-oops')]);
    const partner: PartnerSnapshotSlice = { ...emptySlice([account('shared-oops')]), today: TODAY };
    expect(() => mergeSnapshots(TODAY, mine, [partner])).toThrow(/more than one household member/);
  });

  it('T9: the SAME account id across two different partner slices fails loudly', () => {
    const mine = emptySlice();
    const p1: PartnerSnapshotSlice = { ...emptySlice([account('dup')]), today: TODAY };
    const p2: PartnerSnapshotSlice = { ...emptySlice([account('dup')]), today: TODAY };
    expect(() => mergeSnapshots(TODAY, mine, [p1, p2])).toThrow(/more than one household member/);
  });

  it('drift guard: a partner slice computed for a different business day fails loudly', () => {
    const mine = emptySlice();
    const partner: PartnerSnapshotSlice = { ...emptySlice([account('p1')]), today: isoDate('2026-07-09') };
    expect(() => mergeSnapshots(TODAY, mine, [partner])).toThrow(/today mismatch|partner slice computed for/);
  });

  it('merges every field, not just accounts', () => {
    const mine: CashNeededSnapshotSlice = {
      accounts: [account('mine-card')],
      autopays: [{ accountId: 'mine-card', mode: 'MINIMUM', fixedAmountCents: null }],
      statements: [{ id: 's-mine', accountId: 'mine-card', cycleEnd: '2026-06-18', dueDate: '2026-07-01', statementBalanceCents: 1000, minimumPaymentCents: 35 }],
      cardPayments: [{ statementId: 's-mine', date: '2026-06-20', amountCents: 500 }],
      transactions: [{ accountId: 'mine-card', date: '2026-06-19', amountCents: -50, rawDescriptor: 'coffee', status: 'POSTED', isTransfer: false }],
      scheduled: [{ accountId: 'mine-checking', description: 'rent', amountCents: -150000, nextDate: '2026-07-01', cadence: 'MONTHLY' }],
    };
    const partner: PartnerSnapshotSlice = {
      today: TODAY,
      accounts: [account('partner-card')],
      autopays: [{ accountId: 'partner-card', mode: 'STATEMENT_BALANCE', fixedAmountCents: null }],
      statements: [{ id: 's-partner', accountId: 'partner-card', cycleEnd: '2026-06-18', dueDate: '2026-07-01', statementBalanceCents: 2000, minimumPaymentCents: 70 }],
      cardPayments: [{ statementId: 's-partner', date: '2026-06-21', amountCents: 300 }],
      transactions: [{ accountId: 'partner-card', date: '2026-06-19', amountCents: -75, rawDescriptor: 'gas', status: 'POSTED', isTransfer: false }],
      scheduled: [],
    };
    const merged = mergeSnapshots(TODAY, mine, [partner]);
    expect(merged.autopays).toHaveLength(2);
    expect(merged.statements.map((s) => s.id)).toEqual(['s-mine', 's-partner']);
    expect(merged.cardPayments.map((c) => c.statementId)).toEqual(['s-mine', 's-partner']);
    expect(merged.transactions.map((t) => t.rawDescriptor)).toEqual(['coffee', 'gas']);
    expect(merged.scheduled).toEqual(mine.scheduled); // partner's scheduled was empty
  });
});

// ---------------------------------------------------------------------------
// Integration — real DB, real household, real accounts.
// ---------------------------------------------------------------------------

const stamp = `${Date.now()}-${process.pid}`;
const uid = (slug: string) => `hhcn-${slug}-${stamp}`;
const emailOf = (id: string) => `${id}@test.local`;

const ALL_IDS: string[] = [];
async function seedUser(slug: string): Promise<string> {
  const id = uid(slug);
  ALL_IDS.push(id);
  await prisma.user.create({ data: { id, email: emailOf(id), name: slug } });
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
  await prisma.household.deleteMany({ where: { id: { in: memberships.map((m) => m.householdId) } } });
  await prisma.user.deleteMany({ where: { id: { in: ALL_IDS } } });
}

describe('household cash-needed (integration)', () => {
  let ownerId: string;
  let partnerId: string;
  let ownerChecking = '';
  let ownerCard = '';
  let partnerSharedCard = ''; // shared — must appear in household scope
  let partnerPrivateCard = ''; // NOT shared — must never appear anywhere

  beforeAll(async () => {
    await wipe().catch(() => {});
    ownerId = await seedUser('owner');
    partnerId = await seedUser('partner');
    await prisma.household.create({
      data: {
        name: 'Casa CashNeeded',
        members: {
          create: [
            { userId: ownerId, role: 'owner' },
            { userId: partnerId, role: 'partner' },
          ],
        },
      },
    });

    ownerChecking = (
      await prisma.account.create({
        data: {
          userId: ownerId, provider: 'demo', name: 'Owner Checking', type: 'CHECKING',
          currentBalanceCents: 500000, currency: 'USD',
        },
      })
    ).id;
    await prisma.user.update({ where: { id: ownerId }, data: { paymentAccountId: ownerChecking } });

    ownerCard = (
      await prisma.account.create({
        data: {
          userId: ownerId, provider: 'demo', name: 'Owner Visa', type: 'CREDIT',
          currentBalanceCents: 20000, currency: 'USD', dueDayOfMonth: 15, cycleCloseDayOfMonth: 1,
        },
      })
    ).id;
    await prisma.statement.create({
      data: { accountId: ownerCard, cycleStart: '2026-06-01', cycleEnd: '2026-06-01', dueDate: '2026-07-15', statementBalanceCents: 20000, minimumPaymentCents: 3500 },
    });

    partnerSharedCard = (
      await prisma.account.create({
        data: {
          userId: partnerId, provider: 'demo', name: 'Partner Shared Amex', type: 'CREDIT',
          currentBalanceCents: 40000, currency: 'USD', dueDayOfMonth: 20, cycleCloseDayOfMonth: 1,
          sharedToHousehold: true,
        },
      })
    ).id;
    await prisma.statement.create({
      data: { accountId: partnerSharedCard, cycleStart: '2026-06-01', cycleEnd: '2026-06-01', dueDate: '2026-07-20', statementBalanceCents: 40000, minimumPaymentCents: 4000 },
    });

    partnerPrivateCard = (
      await prisma.account.create({
        data: {
          userId: partnerId, provider: 'demo', name: 'Partner Private Discover', type: 'CREDIT',
          currentBalanceCents: 99999, currency: 'USD', dueDayOfMonth: 10, cycleCloseDayOfMonth: 1,
          sharedToHousehold: false,
        },
      })
    ).id;
    await prisma.statement.create({
      data: { accountId: partnerPrivateCard, cycleStart: '2026-06-01', cycleEnd: '2026-06-01', dueDate: '2026-07-10', statementBalanceCents: 99999, minimumPaymentCents: 5000 },
    });
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getSharedSnapshotSlice: only the SHARED card travels — private card absent', async () => {
    const slice = await getSharedSnapshotSlice(partnerId);
    expect(slice.accounts.map((a) => a.id)).toEqual([partnerSharedCard]);
    expect(slice.statements.map((s) => s.accountId)).toEqual([partnerSharedCard]);
    expect(slice.accounts.find((a) => a.id === partnerPrivateCard)).toBeUndefined();
  });

  it("getCashNeeded 'mine' scope never includes the partner's shared card (T6 byte-identical)", async () => {
    const mine = await getCashNeeded(ownerId, 'PAY_IN_FULL', 'mine');
    const cardIds = mine.result.cards.map((c) => c.cardId);
    expect(cardIds).toEqual([ownerCard]);
    // Requesting 'household' scope with the same inputs is a DIFFERENT call —
    // confirm 'mine' truly never touches partner data even when a household exists.
    const mineDefault = await getCashNeeded(ownerId, 'PAY_IN_FULL');
    expect(mineDefault.result.cards.map((c) => c.cardId)).toEqual([ownerCard]);
  });

  it("getCashNeeded 'household' scope folds in the partner's SHARED card only", async () => {
    const household = await getCashNeeded(ownerId, 'PAY_IN_FULL', 'household');
    const cardIds = household.result.cards.map((c) => c.cardId).sort();
    expect(cardIds).toEqual([ownerCard, partnerSharedCard].sort());
    expect(cardIds).not.toContain(partnerPrivateCard);
    expect('householdName' in household ? household.householdName : null).toBe('Casa CashNeeded');
  });

  it("getDashboardData: 'household' request folds in the shared card into cash-needed but net worth stays PERSONAL", async () => {
    const mineView = await getDashboardData(ownerId, 'mine');
    expect(mineView.scope).toBe('mine');
    expect(mineView.household).toEqual({ name: 'Casa CashNeeded', hasPartners: true });
    expect(mineView.payInFull.cards.map((c) => c.cardId)).toEqual([ownerCard]);

    const householdView = await getDashboardData(ownerId, 'household');
    expect(householdView.scope).toBe('household');
    const hhCardIds = householdView.payInFull.cards.map((c) => c.cardId).sort();
    expect(hhCardIds).toEqual([ownerCard, partnerSharedCard].sort());

    // §4.5: analysis (net worth) is personal — the partner's shared card debt
    // must NOT enter the owner's net worth even while it's counted as a joint obligation.
    expect(householdView.netWorthCents).toBe(mineView.netWorthCents);
    expect(householdView.accounts.map((a) => a.id)).toEqual(mineView.accounts.map((a) => a.id));
  });

  it('T9: household cash-needed merge does not perturb the #192 duplicate detector (still owner-owned-only)', async () => {
    const view = await getAccountsView(ownerId);
    const viewIds = new Set([...view.assets.accounts, ...view.liabilities.accounts].map((a) => a.id));
    expect(viewIds.has(partnerSharedCard)).toBe(false);
    expect(viewIds.has(partnerPrivateCard)).toBe(false);
  });

  it('solo user requesting "household" scope silently degenerates to "mine" (no partners)', async () => {
    const solo = await seedUser('solo');
    await prisma.account.create({
      data: { userId: solo, provider: 'demo', name: 'Solo Checking', type: 'CHECKING', currentBalanceCents: 100000, currency: 'USD' },
    });
    await prisma.user.update({ where: { id: solo }, data: { paymentAccountId: null } });
    actAs(solo);
    const data = await getDashboardData(solo, 'household');
    expect(data.scope).toBe('mine');
    expect(data.household).toBeNull();
  });
});

/**
 * Regression (hostile-critic P0, TASKS 4.2 slice 4 cycle 1): a viewer with NO
 * checking/savings account of their own and no stored `paymentAccountId` would
 * have `resolvePaymentAccount`'s CHECKING/first-account fallback re-derive from
 * the MERGED household snapshot in the original implementation — silently
 * funding (and revealing the balance of) the PARTNER's shared checking account.
 * `cashNeededFromSnapshot` now takes an explicit `paymentAccountIdOverride`
 * resolved from the viewer's OWN pre-merge snapshot; this proves it stays
 * theirs even when their own accounts contain no CHECKING row at all.
 */
describe('regression: household scope never funds from a partner\'s shared checking (critic P0)', () => {
  let ownerId: string;
  let partnerId: string;

  beforeAll(async () => {
    ownerId = await seedUser('p0-owner');
    partnerId = await seedUser('p0-partner');
    await prisma.household.create({
      data: {
        name: 'Casa P0',
        members: {
          create: [
            { userId: ownerId, role: 'owner' },
            { userId: partnerId, role: 'partner' },
          ],
        },
      },
    });
    await prisma.account.create({
      data: {
        userId: ownerId, provider: 'demo', name: 'Owner-Only Visa', type: 'CREDIT',
        currentBalanceCents: 15000, currency: 'USD', dueDayOfMonth: 12, cycleCloseDayOfMonth: 1,
      },
    });
    // Owner has NO checking/savings and no stored paymentAccountId — the exact
    // pre-onboarding gap the critic flagged.
    await prisma.user.update({ where: { id: ownerId }, data: { paymentAccountId: null } });

    await prisma.account.create({
      data: {
        userId: partnerId, provider: 'demo', name: 'Partner Rich Checking', type: 'CHECKING',
        currentBalanceCents: 9_999_999, currency: 'USD', sharedToHousehold: true,
      },
    });
  });
  afterAll(wipe);

  it("getCashNeeded 'household': funding account resolves to the owner's own account, never the partner's checking", async () => {
    const household = await getCashNeeded(ownerId, 'PAY_IN_FULL', 'household');
    const fundingAccount = household.input.paymentAccount;
    // The partner's checking balance ($99,999.99) must never leak into "the
    // account the answer is computed against" — fail-old: this WAS partnerChecking.
    expect(fundingAccount.name).not.toBe('Partner Rich Checking');
    expect(fundingAccount.balanceCents).not.toBe(9_999_999);
    expect(fundingAccount.name).toBe('Owner-Only Visa');
    expect(fundingAccount.balanceCents).toBe(15000);
  });

  it("getDashboardData 'household': paymentAccountName always matches the account the math actually used", async () => {
    const data = await getDashboardData(ownerId, 'household');
    expect(data.scope).toBe('household');
    expect(data.paymentAccountName).toBe('Owner-Only Visa');
    expect(data.paymentAccountName).not.toBe('Partner Rich Checking');
  });
});
