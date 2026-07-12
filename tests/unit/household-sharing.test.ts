/**
 * Household account sharing — TASKS 4.2 slice 2 (HOUSEHOLD_ARCHITECTURE §4.3).
 * Locks:
 *  - T6 degeneracy: `visibleAccountsWhere` deep-equals EXACTLY `{ userId }`
 *    with no household / no partners — solo and demo semantics byte-identical.
 *  - T1: a partner's UNSHARED account is invisible through the widened scope.
 *  - T2: a non-member's rows are invisible even with the share flag set, and
 *    visibility ends immediately after leaveHousehold.
 *  - T9 (detector input): the #192 duplicate detector sees ONLY the viewer's
 *    owned accounts — a partner-shared twin that WOULD pair never enters it.
 *  - setAccountShared authz: owner-only by row scope, membership required to
 *    share ON, share OFF always allowed, demo user refused.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import {
  partnerIdsOf,
  partnerSharedAccountsWhere,
  requireViewer,
  visibleAccountsWhere,
  type Viewer,
} from '@/server/authz';
import {
  acceptInvite,
  createHousehold,
  inviteToHousehold,
  leaveHousehold,
  setAccountShared,
} from '@/server/household-actions';
import { getAccountSharingView, getHouseholdView } from '@/server/household';
import { getAccountsView } from '@/server/transactions';
import { detectDuplicateAccounts } from '@/lib/engine/account/duplicates';
import { DEMO_USER_ID } from '@/auth.config';

// ---------------------------------------------------------------------------
// Pure where-builder units (no DB) — the T6 degeneracy lock.
// ---------------------------------------------------------------------------

function viewer(userId: string, memberIds: string[] | null): Viewer {
  return {
    userId,
    household: memberIds
      ? { id: 'hh-1', name: 'Casa', role: 'owner', memberIds, memberNames: {} }
      : null,
  };
}

describe('visibleAccountsWhere / partnerSharedAccountsWhere (pure)', () => {
  it('no household → EXACTLY { userId } (deep equality, not just equivalent)', () => {
    expect(visibleAccountsWhere(viewer('u1', null))).toEqual({ userId: 'u1' });
  });

  it('household with no partners (single member) → EXACTLY { userId }', () => {
    expect(visibleAccountsWhere(viewer('u1', ['u1']))).toEqual({ userId: 'u1' });
  });

  it('two-member household → own rows OR partner rows flagged shared', () => {
    expect(visibleAccountsWhere(viewer('u1', ['u1', 'u2']))).toEqual({
      OR: [{ userId: 'u1' }, { sharedToHousehold: true, userId: { in: ['u2'] } }],
    });
  });

  it('partnerSharedAccountsWhere is null without partners (unqueryable by accident)', () => {
    expect(partnerSharedAccountsWhere(viewer('u1', null))).toBeNull();
    expect(partnerSharedAccountsWhere(viewer('u1', ['u1']))).toBeNull();
  });

  it('partner list excludes self and keeps every other member', () => {
    expect(partnerIdsOf(viewer('u1', ['u1', 'u2', 'u3']))).toEqual(['u2', 'u3']);
    expect(partnerSharedAccountsWhere(viewer('u1', ['u1', 'u2', 'u3']))).toEqual({
      sharedToHousehold: true,
      userId: { in: ['u2', 'u3'] },
    });
  });
});

// ---------------------------------------------------------------------------
// Integration — real DB, real actions, throwaway users.
// ---------------------------------------------------------------------------

const stamp = `${Date.now()}-${process.pid}`;
const uid = (slug: string) => `hhs-${slug}-${stamp}`;
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

describe('household sharing (integration — real scope, real actions)', () => {
  let ownerId: string; // viewer under test
  let partnerId: string;
  let strangerId: string; // never a member; flag set anyway (T2)
  let o1 = ''; // owner's own plaid account — the detector-twin anchor
  let o2 = ''; // owner's own EUR account — money surfaces withhold it, consent list must NOT (F3)
  let p1 = ''; // partner's SHARED simplefin twin (would pair with o1)
  // (partner's PRIVATE account is seeded but never captured — its absence from
  //  every result set IS the T1 assertion)
  let p3 = ''; // partner's shared but unsupported-currency account
  let s1 = ''; // stranger's shared-flagged account (T2)

  beforeAll(async () => {
    await wipe().catch(() => {});
    ownerId = await seedUser('owner');
    partnerId = await seedUser('partner', 'Pat Partner');
    strangerId = await seedUser('stranger');
    // Membership rows created directly — the invite→code→accept ceremony is
    // slice-1's lock (household-actions.test.ts); this file tests read scope.
    await prisma.household.create({
      data: {
        name: 'Casa Test',
        members: {
          create: [
            { userId: ownerId, role: 'owner' },
            { userId: partnerId, role: 'partner' },
          ],
        },
      },
    });
    const mk = (data: Parameters<typeof prisma.account.create>[0]['data']) =>
      prisma.account.create({ data });
    o1 = (await mk({
      userId: ownerId, provider: 'plaid', name: 'Chase Total Checking', type: 'CHECKING',
      mask: '1234', currentBalanceCents: 50000, currency: 'USD',
    })).id;
    o2 = (await mk({
      userId: ownerId, provider: 'simplefin', name: 'Euro Own Savings', type: 'SAVINGS',
      currentBalanceCents: 9999, currency: 'EUR',
    })).id;
    p1 = (await mk({
      userId: partnerId, provider: 'simplefin', name: 'CHASE Checking', type: 'CHECKING',
      currentBalanceCents: 48000, currency: 'USD', sharedToHousehold: true,
    })).id;
    await mk({
      userId: partnerId, provider: 'simplefin', name: 'Private Savings', type: 'SAVINGS',
      currentBalanceCents: 700000, currency: 'USD', sharedToHousehold: false,
    });
    p3 = (await mk({
      userId: partnerId, provider: 'simplefin', name: 'Euro Shared', type: 'CHECKING',
      currentBalanceCents: 12345, currency: 'EUR', sharedToHousehold: true,
    })).id;
    s1 = (await mk({
      userId: strangerId, provider: 'simplefin', name: 'CHASE Checking', type: 'CHECKING',
      currentBalanceCents: 50000, currency: 'USD', sharedToHousehold: true,
    })).id;
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T1/T2: widened scope returns own + partner-SHARED rows only — private and non-member rows absent', async () => {
    actAs(ownerId);
    const v = await requireViewer();
    const rows = await prisma.account.findMany({
      where: visibleAccountsWhere(v),
      select: { id: true },
    });
    const ids = new Set(rows.map((r) => r.id));
    expect(ids).toEqual(new Set([o1, o2, p1, p3])); // partner-private and non-member rows absent
  });

  it('T9: the #192 detector input stays the OWNED set — a partner-shared twin that WOULD pair never trips it', async () => {
    // Prove the fixture is trip-worthy: fed BOTH rows, the pure detector pairs them.
    const wouldPair = detectDuplicateAccounts([
      { id: o1, provider: 'plaid', name: 'Chase Total Checking', type: 'CHECKING', mask: '1234', currentBalanceCents: 50000, currency: 'USD' },
      { id: p1, provider: 'simplefin', name: 'CHASE Checking', type: 'CHECKING', mask: null, currentBalanceCents: 48000, currency: 'USD' },
    ]);
    expect(wouldPair).toHaveLength(1);
    // The real view for a HOUSEHOLD viewer: no false duplicate warning.
    const view = await getAccountsView(ownerId);
    expect(view.duplicates).toEqual([]);
    // And its account set is exactly the owned set (the shared twin is not in it).
    const viewIds = new Set(
      [...view.assets.accounts, ...view.liabilities.accounts].map((a) => a.id),
    );
    expect(viewIds).toEqual(new Set([o1]));
  });

  it('getAccountSharingView: partner-shared rows owner-badged, currency-guarded; own toggle list; separate from getAccountsView', async () => {
    actAs(ownerId);
    const view = await getAccountSharingView();
    expect(view.kind).toBe('member');
    if (view.kind !== 'member') return;
    expect(view.householdName).toBe('Casa Test');
    expect(view.sharedWithMe.map((r) => r.id)).toEqual([p1]); // EUR row filtered, private absent
    expect(view.sharedWithMe[0]).toMatchObject({
      name: 'CHASE Checking',
      currentBalanceCents: 48000, // verbatim copy of the owner's row
      isLiability: false,
      ownerLabel: 'Pat Partner',
    });
    // F3: the consent list is NOT currency-filtered — the owner must always be
    // able to see and revoke a share flag, even on an account the money
    // surfaces withhold (o2 is EUR).
    expect(view.mine.map((r) => r.id)).toEqual([o1, o2]);
    expect(view.mine[0].sharedToHousehold).toBe(false);
  });

  it('getAccountSharingView: no household → kind none (nothing rendered — golden/demo safe)', async () => {
    actAs(strangerId);
    expect(await getAccountSharingView()).toEqual({ kind: 'none' });
  });

  it("setAccountShared: cannot touch a partner's account — scoped update matches zero rows, flag untouched", async () => {
    actAs(ownerId);
    const res = await setAccountShared(p1, false);
    expect(res).toEqual({ ok: false, error: 'Account not found.' });
    const row = await prisma.account.findUnique({ where: { id: p1 } });
    expect(row?.sharedToHousehold).toBe(true);
  });

  it('setAccountShared: owner shares own account (flag + audit), membership required to share ON, OFF always allowed', async () => {
    // ON with membership → ok, flag set, audited.
    actAs(ownerId);
    expect(await setAccountShared(o1, true)).toEqual({ ok: true });
    expect((await prisma.account.findUnique({ where: { id: o1 } }))?.sharedToHousehold).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { userId: ownerId, action: 'account.share' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    // Restore for other tests.
    expect(await setAccountShared(o1, false)).toEqual({ ok: true });

    // ON without membership → refused; OFF without membership → allowed (cleanup).
    actAs(strangerId);
    expect(await setAccountShared(s1, true)).toEqual({
      ok: false,
      error: 'Join a household before sharing an account.',
    });
    expect(await setAccountShared(s1, false)).toEqual({ ok: true });
    expect((await prisma.account.findUnique({ where: { id: s1 } }))?.sharedToHousehold).toBe(false);
  });

  it('setAccountShared: demo user refused (T6 guard parity with every membership entry point)', async () => {
    actAs(DEMO_USER_ID);
    const res = await setAccountShared(o1, true);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/demo/i);
  });

  it('T2: leaveHousehold ends visibility on the very next read (scope re-degenerates)', async () => {
    actAs(partnerId);
    expect(await leaveHousehold()).toEqual({ ok: true });

    actAs(ownerId);
    const v = await requireViewer();
    // Solo again → EXACT degeneracy, and the query returns only owned rows.
    expect(visibleAccountsWhere(v)).toEqual({ userId: ownerId });
    const rows = await prisma.account.findMany({
      where: visibleAccountsWhere(v),
      select: { id: true },
    });
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set([o1, o2]));
    // Slice-1 invariant still holds: the departed partner's flags were reset.
    expect((await prisma.account.findUnique({ where: { id: p1 } }))?.sharedToHousehold).toBe(false);
  });
});

/**
 * Critic slice-2 F1 lock: "consent never survives the relationship that
 * granted it" (§4.1). Even if a share flag is somehow stranded true with no
 * membership (e.g. the setAccountShared-vs-leave write race the self-guarding
 * where also closes), JOINING a household — by creating one or accepting an
 * invite — resets the joiner's flags atomically, so a stale flag can never
 * auto-share an account into a household the owner never consented to.
 */
describe('joining a household resets stale share flags (F1)', () => {
  afterAll(wipe); // its own hook — the earlier describe's afterAll fires before these users exist
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function staleFlaggedAccount(userId: string): Promise<string> {
    const a = await prisma.account.create({
      data: {
        userId, provider: 'demo', name: 'Stale Flag', type: 'CHECKING',
        currentBalanceCents: 0, currency: 'USD', sharedToHousehold: true,
      },
    });
    return a.id;
  }

  it('createHousehold clears any pre-existing sharedToHousehold flags atomically', async () => {
    const u = await seedUser('join-create');
    const acc = await staleFlaggedAccount(u);
    actAs(u);
    expect(await createHousehold('Casa Nueva')).toEqual({ ok: true });
    expect((await prisma.account.findUnique({ where: { id: acc } }))?.sharedToHousehold).toBe(false);
  });

  it("acceptInvite clears the joiner's stale flags in the same transaction as the membership", async () => {
    const owner = await seedUser('join-owner');
    const joiner = await seedUser('join-joiner');
    const acc = await staleFlaggedAccount(joiner);

    actAs(owner);
    expect(await createHousehold('Casa Invite')).toEqual({ ok: true });
    const inv = await inviteToHousehold(emailOf(joiner));
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;

    actAs(joiner);
    const view = await getHouseholdView();
    expect(view.kind).toBe('none');
    if (view.kind !== 'none') return;
    expect(await acceptInvite(view.invites[0].id, inv.code)).toEqual({ ok: true });
    expect((await prisma.account.findUnique({ where: { id: acc } }))?.sharedToHousehold).toBe(false);
  });
});
