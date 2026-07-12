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

/** Partner slice fixture — nothing currency-withheld unless a test says so (slice 8). */
function partnerSlice(accounts: AccountLike[], today: ReturnType<typeof isoDate>): PartnerSnapshotSlice {
  return { ...emptySlice(accounts), today, withheldAccountCount: 0 };
}

describe('mergeSnapshots (pure)', () => {
  const TODAY = isoDate('2026-07-10');

  it('unions disjoint accounts from the viewer + N partners', () => {
    const mine = emptySlice([account('mine-1')]);
    const p1: PartnerSnapshotSlice = partnerSlice([account('p1-1')], TODAY);
    const p2: PartnerSnapshotSlice = partnerSlice([account('p2-1'), account('p2-2')], TODAY);
    const merged = mergeSnapshots(TODAY, mine, [p1, p2]);
    expect(merged.accounts.map((a) => a.id)).toEqual(['mine-1', 'p1-1', 'p2-1', 'p2-2']);
  });

  it('no partners → merged equals mine verbatim', () => {
    const mine = emptySlice([account('mine-1')]);
    expect(mergeSnapshots(TODAY, mine, [])).toEqual(mine);
  });

  it('T9: the SAME account id in both the viewer slice and a partner slice fails loudly (never silently double-counts)', () => {
    const mine = emptySlice([account('shared-oops')]);
    const partner: PartnerSnapshotSlice = partnerSlice([account('shared-oops')], TODAY);
    expect(() => mergeSnapshots(TODAY, mine, [partner])).toThrow(/more than one household member/);
  });

  it('T9: the SAME account id across two different partner slices fails loudly', () => {
    const mine = emptySlice();
    const p1: PartnerSnapshotSlice = partnerSlice([account('dup')], TODAY);
    const p2: PartnerSnapshotSlice = partnerSlice([account('dup')], TODAY);
    expect(() => mergeSnapshots(TODAY, mine, [p1, p2])).toThrow(/more than one household member/);
  });

  it('drift guard: a partner slice computed for a different business day fails loudly', () => {
    const mine = emptySlice();
    const partner: PartnerSnapshotSlice = partnerSlice([account('p1')], isoDate('2026-07-09'));
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
      withheldAccountCount: 0,
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

  it("TASKS 4.2 slice 5: getCashNeeded exposes household/scope like getDashboardData, so /calendar can offer the toggle", async () => {
    const mine = await getCashNeeded(ownerId, 'PAY_IN_FULL', 'mine');
    expect(mine.scope).toBe('mine');
    expect(mine.household).toEqual({ name: 'Casa CashNeeded', hasPartners: true });

    const household = await getCashNeeded(ownerId, 'PAY_IN_FULL', 'household');
    expect(household.scope).toBe('household');
    expect(household.household).toEqual({ name: 'Casa CashNeeded', hasPartners: true });
  });

  it("TASKS 4.2 slice 5: getDashboardData's accountOwnerLabel badges only the partner's SHARED card, empty in 'mine' scope (T6)", async () => {
    const mineView = await getDashboardData(ownerId, 'mine');
    expect(mineView.accountOwnerLabel).toEqual({});

    const householdView = await getDashboardData(ownerId, 'household');
    expect(householdView.accountOwnerLabel).toEqual({ [partnerSharedCard]: 'partner' });
    // The private card never entered the merge, so it can never get a label either.
    expect(householdView.accountOwnerLabel[partnerPrivateCard]).toBeUndefined();
    expect(householdView.accountOwnerLabel[ownerCard]).toBeUndefined();
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
    expect(data.accountOwnerLabel).toEqual({});

    // TASKS 4.2 slice 5: getCashNeeded degenerates the same way for a solo user.
    const cashNeeded = await getCashNeeded(solo, 'PAY_IN_FULL', 'household');
    expect(cashNeeded.scope).toBe('mine');
    expect(cashNeeded.household).toBeNull();
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

/**
 * TASKS 4.2 slice 8 — critic F-5 (T9(b)) + F-6. The same real joint account
 * connected by BOTH partners mints two Account rows with different ids: the
 * merge cannot catch it and every household figure counts the money twice.
 * The mitigation is DISCLOSURE (advisory pairs on the toggle + digest), never
 * adjustment — a heuristic false positive silently dropping a real account
 * would be worse than a disclosed possible double-count. F-6: a partner's
 * non-USD shared account is withheld from household figures but COUNTED, so
 * the interactive surfaces can disclose it like the digest already does.
 */
describe('household duplicate + withheld disclosures (slice 8 — F-5/F-6)', () => {
  let aId: string; // viewer
  let bId: string; // partner
  let twinA = ''; // viewer's plaid connection of the joint account
  let twinB = ''; // partner's SHARED simplefin connection of the SAME real account

  beforeAll(async () => {
    aId = await seedUser('dupA');
    bId = await seedUser('dupB');
    await prisma.household.create({
      data: {
        name: 'Casa Dup',
        members: {
          create: [
            { userId: aId, role: 'owner' },
            { userId: bId, role: 'partner' },
          ],
        },
      },
    });
    twinA = (
      await prisma.account.create({
        data: {
          userId: aId, provider: 'plaid', name: 'Chase Joint Checking', type: 'CHECKING',
          mask: '1234', currentBalanceCents: 512_345, currency: 'USD',
        },
      })
    ).id;
    await prisma.user.update({ where: { id: aId }, data: { paymentAccountId: twinA } });
    twinB = (
      await prisma.account.create({
        data: {
          userId: bId, provider: 'simplefin', name: 'CHASE Joint Checking', type: 'CHECKING',
          currentBalanceCents: 512_345, currency: 'USD', sharedToHousehold: true,
        },
      })
    ).id;
    // F-6: the partner also shares a EUR card — withheld from figures, disclosed.
    await prisma.account.create({
      data: {
        userId: bId, provider: 'simplefin', name: 'Partner Euro Card', type: 'CREDIT',
        currentBalanceCents: 30_000, currency: 'EUR', sharedToHousehold: true,
      },
    });
  });
  afterAll(wipe);

  it('household scope surfaces exactly one cross-owner pair, owner-labeled for display', async () => {
    const data = await getDashboardData(aId, 'household');
    expect(data.householdDuplicates).toHaveLength(1);
    const [pair] = data.householdDuplicates;
    // plaid sorts before simplefin: a = the viewer's row, b = the partner's.
    expect(pair.a).toEqual({ name: 'Chase Joint Checking', ownerLabel: 'yours' });
    expect(pair.b).toEqual({ name: 'CHASE Joint Checking', ownerLabel: "dupB's" });
    expect(pair.confidence).toBe('high'); // identical non-zero balance
  });

  it("'mine' scope and getCashNeeded parity: disclosures empty at 'mine' (T6), populated at household", async () => {
    const mine = await getDashboardData(aId, 'mine');
    expect(mine.householdDuplicates).toEqual([]);
    expect(mine.householdWithheldCount).toBe(0);

    const cn = await getCashNeeded(aId, 'PAY_IN_FULL', 'household');
    expect(cn.householdDuplicates).toHaveLength(1);
    expect(cn.householdWithheldCount).toBe(1);
    const cnMine = await getCashNeeded(aId, 'PAY_IN_FULL', 'mine');
    expect(cnMine.householdDuplicates).toEqual([]);
    expect(cnMine.householdWithheldCount).toBe(0);
  });

  it("the personal #192 detector is UNCHANGED by the household fixture — its input stays the viewer's owned set (T9(c))", async () => {
    const view = await getAccountsView(aId);
    expect(view.duplicates).toEqual([]);
  });

  it('F-6: the withheld EUR share is counted for disclosure and absent from the merged figures', async () => {
    const data = await getDashboardData(aId, 'household');
    expect(data.householdWithheldCount).toBe(1);
    expect(data.payInFull.cards.map((c) => c.cardName)).not.toContain('Partner Euro Card');
  });

  it('DOCUMENTED, not fixed: the merged snapshot still contains both twins — the double-count is disclosed, never silently adjusted', async () => {
    const cn = await getCashNeeded(aId, 'PAY_IN_FULL', 'household');
    const ids = cn.snap.accounts.map((a) => a.id);
    expect(ids).toContain(twinA);
    expect(ids).toContain(twinB); // fail-old for any future "auto-dedup" that silently drops a real account
  });
});
