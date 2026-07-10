/**
 * Household membership core — integration tests driving the REAL server
 * actions + `requireViewer` self-heal against throwaway users (TASKS 4.2
 * slice 1). Locks the state-machine T-invariants from
 * HOUSEHOLD_ARCHITECTURE.md §4.6: T2 (membership gone ⇒ no household
 * context), T4 (leave/remove resets share flags), T7 (only the addressed,
 * signed-in email + code can accept), T10 (deleteMyData cascades membership;
 * survivor's next read repairs), T11 (deterministic idempotent lazy repair),
 * T12 (code possession required; attempts cap revokes; only the hash at rest).
 *
 * Unique per-run user ids double as unique rate-limit keys, so runs are
 * deterministic and never touch the seeded demo user.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
// revalidatePath needs a Next request store absent in unit tests — no-op it.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { requireViewer } from '@/server/authz';
import {
  acceptInvite,
  createHousehold,
  declineInvite,
  inviteToHousehold,
  leaveHousehold,
  removeMember,
  revokeInvite,
} from '@/server/household-actions';
import { deleteMyData } from '@/server/account-actions';
import { getHouseholdView } from '@/server/household';
import { DEMO_USER_ID } from '@/auth.config';
import { INVITE_MAX_ATTEMPTS } from '@/lib/engine/household/membership';

const stamp = `${Date.now()}-${process.pid}`;
const uid = (slug: string) => `hh-${slug}-${stamp}`;
const emailOf = (id: string) => `${id}@test.local`;

const ALL_IDS: string[] = [];
async function seedUser(slug: string): Promise<string> {
  const id = uid(slug);
  ALL_IDS.push(id);
  await prisma.user.create({ data: { id, email: emailOf(id), name: slug } });
  return id;
}
async function seedAccount(userId: string, shared = false): Promise<string> {
  const a = await prisma.account.create({
    data: {
      userId,
      provider: 'demo',
      name: 'HH Test',
      type: 'CHECKING',
      currentBalanceCents: 0,
      sharedToHousehold: shared,
    },
  });
  return a.id;
}
function actAs(userId: string) {
  vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);
}
async function wipe() {
  // Households created by these users (memberships cascade with users; the
  // Household rows themselves have no user FK, so reap by member linkage
  // BEFORE deleting the users).
  const memberships = await prisma.householdMember.findMany({
    where: { userId: { in: ALL_IDS } },
    select: { householdId: true },
  });
  await prisma.household.deleteMany({
    where: { id: { in: memberships.map((m) => m.householdId) } },
  });
  await prisma.householdInvite.deleteMany({
    where: { email: { in: ALL_IDS.map(emailOf) } },
  });
  await prisma.user.deleteMany({ where: { id: { in: ALL_IDS } } });
}

beforeAll(wipe);
afterAll(wipe);
beforeEach(() => {
  vi.clearAllMocks();
});

/** Create a household as `ownerId` and accept `partnerId` into it via the REAL
 *  invite→code→accept flow (each caller gets its own users, so rate limits and
 *  the one-household-per-user unique never collide across tests). */
async function establishHousehold(ownerId: string, partnerId: string, name = 'Casa') {
  actAs(ownerId);
  expect(await createHousehold(name)).toEqual({ ok: true });
  const invite = await inviteToHousehold(emailOf(partnerId));
  if (!invite.ok) throw new Error(`invite failed: ${invite.error}`);
  actAs(partnerId);
  expect(await acceptInvite(await inviteIdFor(partnerId), invite.code)).toEqual({ ok: true });
}
async function inviteIdFor(userId: string): Promise<string> {
  const row = await prisma.householdInvite.findFirst({
    where: { email: emailOf(userId) },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) throw new Error('no invite row');
  return row.id;
}

describe('createHousehold', () => {
  it('creates household + owner membership; a second create is refused (unique membership)', async () => {
    const u = await seedUser('create');
    actAs(u);
    expect(await createHousehold('  Our household  ')).toEqual({ ok: true });
    const member = await prisma.householdMember.findUnique({ where: { userId: u } });
    expect(member?.role).toBe('owner');
    const hh = await prisma.household.findUnique({ where: { id: member!.householdId } });
    expect(hh?.name).toBe('Our household'); // trimmed
    expect(await createHousehold('Second')).toMatchObject({ ok: false });
    expect(await prisma.householdMember.count({ where: { userId: u } })).toBe(1);
  });
  it('rejects an empty name without writing anything', async () => {
    const u = await seedUser('create-empty');
    actAs(u);
    expect(await createHousehold('   ')).toMatchObject({ ok: false });
    expect(await prisma.householdMember.count({ where: { userId: u } })).toBe(0);
  });
});

describe('invite → accept (T7, T12)', () => {
  it('round trip: correct code + addressed signed-in email joins as partner', async () => {
    const owner = await seedUser('rt-owner');
    const partner = await seedUser('rt-partner');
    await establishHousehold(owner, partner);
    const m = await prisma.householdMember.findUnique({ where: { userId: partner } });
    expect(m?.role).toBe('partner');
    const invite = await prisma.householdInvite.findFirst({ where: { email: emailOf(partner) } });
    expect(invite?.status).toBe('accepted');
    // T12: the plaintext code exists nowhere at rest — only a 64-hex sha256.
    expect(invite?.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('wrong code burns attempts; the cap revokes; the CORRECT code then fails (T12)', async () => {
    const owner = await seedUser('cap-owner');
    const partner = await seedUser('cap-partner');
    actAs(owner);
    await createHousehold('Cap');
    const invite = await inviteToHousehold(emailOf(partner));
    if (!invite.ok) throw new Error('invite failed');
    const inviteId = await inviteIdFor(partner);

    actAs(partner);
    for (let i = 1; i <= INVITE_MAX_ATTEMPTS; i++) {
      const res = await acceptInvite(inviteId, 'WRNG-2345');
      expect(res).toMatchObject({ ok: false });
      // Generic message — no enumeration of WHY it failed.
      expect((res as { error: string }).error).toMatch(/invalid, expired, or already used/);
    }
    const row = await prisma.householdInvite.findUnique({ where: { id: inviteId } });
    expect(row?.attempts).toBe(INVITE_MAX_ATTEMPTS);
    expect(row?.status).toBe('revoked');
    // Even the right code is dead now.
    expect(await acceptInvite(inviteId, invite.code)).toMatchObject({ ok: false });
    expect(await prisma.householdMember.count({ where: { userId: partner } })).toBe(0);
  });

  it('an attacker with the right CODE but a different sign-in email cannot join (T7)', async () => {
    const owner = await seedUser('att-owner');
    const partner = await seedUser('att-partner');
    const attacker = await seedUser('att-mallory');
    actAs(owner);
    await createHousehold('Att');
    const invite = await inviteToHousehold(emailOf(partner));
    if (!invite.ok) throw new Error('invite failed');
    const inviteId = await inviteIdFor(partner);

    actAs(attacker);
    expect(await acceptInvite(inviteId, invite.code)).toMatchObject({ ok: false });
    expect(await prisma.householdMember.count({ where: { userId: attacker } })).toBe(0);
    // A stranger's probe burns NOTHING (critic #210 F2): the invite stays
    // pristine, so an attacker can't revoke a victim's invite by probing.
    const row = await prisma.householdInvite.findUnique({ where: { id: inviteId } });
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(0);
  });

  it('an expired invite is inert even with both factors correct (lazy expiry, T7)', async () => {
    const owner = await seedUser('exp-owner');
    const partner = await seedUser('exp-partner');
    actAs(owner);
    await createHousehold('Exp');
    const invite = await inviteToHousehold(emailOf(partner));
    if (!invite.ok) throw new Error('invite failed');
    const inviteId = await inviteIdFor(partner);
    await prisma.householdInvite.update({
      where: { id: inviteId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    actAs(partner);
    expect(await acceptInvite(inviteId, invite.code)).toMatchObject({ ok: false });
    // Inert failures burn no attempts.
    const row = await prisma.householdInvite.findUnique({ where: { id: inviteId } });
    expect(row?.attempts).toBe(0);
  });

  it('a user already in a household is told to leave first and no second membership appears', async () => {
    const ownerA = await seedUser('dbl-ownerA');
    const partner = await seedUser('dbl-partner');
    const ownerB = await seedUser('dbl-ownerB');
    await establishHousehold(ownerA, partner);
    actAs(ownerB);
    await createHousehold('Second house');
    const invite = await inviteToHousehold(emailOf(partner));
    if (!invite.ok) throw new Error('invite failed');
    actAs(partner);
    const res = await acceptInvite(await inviteIdFor(partner), invite.code);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/leave/i) });
    expect(await prisma.householdMember.count({ where: { userId: partner } })).toBe(1);
  });

  it('inviting your own email or a current member is refused; re-invite reissues a fresh pending invite', async () => {
    const owner = await seedUser('re-owner');
    const partner = await seedUser('re-partner');
    await establishHousehold(owner, partner);
    actAs(owner);
    expect(await inviteToHousehold(emailOf(owner))).toMatchObject({ ok: false });
    expect(await inviteToHousehold(emailOf(partner))).toMatchObject({ ok: false });
    // Re-invite a third address twice: second call resets to a fresh pending code.
    const third = await seedUser('re-third');
    const first = await inviteToHousehold(emailOf(third));
    const second = await inviteToHousehold(emailOf(third));
    if (!first.ok || !second.ok) throw new Error('invite failed');
    expect(second.code).not.toBe(first.code);
    const rows = await prisma.householdInvite.findMany({ where: { email: emailOf(third) } });
    expect(rows).toHaveLength(1); // @@unique([householdId,email]) upsert, no duplicates
    expect(rows[0].status).toBe('pending');
    expect(rows[0].attempts).toBe(0);
  });
});

describe('decline / revoke', () => {
  it('only the ADDRESSED user can decline; decline finalizes the invite', async () => {
    const owner = await seedUser('dec-owner');
    const partner = await seedUser('dec-partner');
    const stranger = await seedUser('dec-stranger');
    actAs(owner);
    await createHousehold('Dec');
    const invite = await inviteToHousehold(emailOf(partner));
    if (!invite.ok) throw new Error('invite failed');
    const inviteId = await inviteIdFor(partner);

    actAs(stranger);
    expect(await declineInvite(inviteId)).toMatchObject({ ok: false });
    actAs(partner);
    expect(await declineInvite(inviteId)).toEqual({ ok: true });
    const row = await prisma.householdInvite.findUnique({ where: { id: inviteId } });
    expect(row?.status).toBe('declined');
    // Final: the code no longer works.
    expect(await acceptInvite(inviteId, invite.code)).toMatchObject({ ok: false });
  });

  it('a declined invite is sticky: re-inviting the same address is refused while the window lives (critic #210 F4)', async () => {
    const owner = await seedUser('stk-owner');
    const invitee = await seedUser('stk-invitee');
    actAs(owner);
    await createHousehold('Sticky');
    const first = await inviteToHousehold(emailOf(invitee));
    if (!first.ok) throw new Error('invite failed');
    actAs(invitee);
    expect(await declineInvite(await inviteIdFor(invitee))).toEqual({ ok: true });
    actAs(owner);
    expect(await inviteToHousehold(emailOf(invitee))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/declined/i),
    });
    // The row stays declined — the nag does not come back.
    const row = await prisma.householdInvite.findFirst({ where: { email: emailOf(invitee) } });
    expect(row?.status).toBe('declined');
    // …but after the original window passes, a fresh invite is allowed again.
    await prisma.householdInvite.update({
      where: { id: row!.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await inviteToHousehold(emailOf(invitee))).toMatchObject({ ok: true });
  });

  it('an owner cannot revoke ANOTHER household’s invite (cross-household scope lock)', async () => {
    const ownerA = await seedUser('xrv-ownerA');
    const ownerB = await seedUser('xrv-ownerB');
    const invitee = await seedUser('xrv-invitee');
    actAs(ownerA);
    await createHousehold('House A');
    const invite = await inviteToHousehold(emailOf(invitee));
    if (!invite.ok) throw new Error('invite failed');
    const inviteId = await inviteIdFor(invitee);
    actAs(ownerB);
    await createHousehold('House B');
    expect(await revokeInvite(inviteId)).toMatchObject({ ok: false });
    expect(
      (await prisma.householdInvite.findUnique({ where: { id: inviteId } }))?.status,
    ).toBe('pending');
  });

  it('a partner cannot revoke invites; the owner can (role rule)', async () => {
    const owner = await seedUser('rev-owner');
    const partner = await seedUser('rev-partner');
    const target = await seedUser('rev-target');
    await establishHousehold(owner, partner);
    actAs(owner);
    const invite = await inviteToHousehold(emailOf(target));
    if (!invite.ok) throw new Error('invite failed');
    const inviteId = await inviteIdFor(target);

    actAs(partner);
    expect(await revokeInvite(inviteId)).toMatchObject({ ok: false });
    actAs(owner);
    expect(await revokeInvite(inviteId)).toEqual({ ok: true });
    expect(
      (await prisma.householdInvite.findUnique({ where: { id: inviteId } }))?.status,
    ).toBe('revoked');
  });
});

describe('leave / remove (T2, T4)', () => {
  it('leaving resets the departing member’s share flags, ends household context, and the last member reaps it', async () => {
    const owner = await seedUser('lv-owner');
    const partner = await seedUser('lv-partner');
    await establishHousehold(owner, partner);
    const partnerAcct = await seedAccount(partner, true);
    const ownerAcct = await seedAccount(owner, true);

    actAs(partner);
    expect(await leaveHousehold()).toEqual({ ok: true });
    // T4: consent never survives the departure.
    expect(
      (await prisma.account.findUnique({ where: { id: partnerAcct } }))?.sharedToHousehold,
    ).toBe(false);
    // The OWNER's flags are untouched by someone else's departure.
    expect(
      (await prisma.account.findUnique({ where: { id: ownerAcct } }))?.sharedToHousehold,
    ).toBe(true);
    // T2: next read resolves no household.
    expect((await requireViewer()).household).toBeNull();

    // Last member leaving reaps the household row.
    actAs(owner);
    const hhId = (await prisma.householdMember.findUnique({ where: { userId: owner } }))!
      .householdId;
    expect(await leaveHousehold()).toEqual({ ok: true });
    expect(await prisma.household.findUnique({ where: { id: hhId } })).toBeNull();
  });

  it('removeMember: owner-only, never self, resets the target’s flags, and a non-member target is untouched', async () => {
    const owner = await seedUser('rm-owner');
    const partner = await seedUser('rm-partner');
    const outsider = await seedUser('rm-outsider');
    await establishHousehold(owner, partner);
    const partnerAcct = await seedAccount(partner, true);
    const outsiderAcct = await seedAccount(outsider, true);

    actAs(partner);
    expect(await removeMember(owner)).toMatchObject({ ok: false }); // partner can't
    actAs(owner);
    expect(await removeMember(owner)).toMatchObject({ ok: false }); // not on self
    expect(await removeMember(outsider)).toMatchObject({ ok: false }); // not a member
    // The self-guarding transaction never reached the outsider's account.
    expect(
      (await prisma.account.findUnique({ where: { id: outsiderAcct } }))?.sharedToHousehold,
    ).toBe(true);

    expect(await removeMember(partner)).toEqual({ ok: true });
    expect(await prisma.householdMember.count({ where: { userId: partner } })).toBe(0);
    expect(
      (await prisma.account.findUnique({ where: { id: partnerAcct } }))?.sharedToHousehold,
    ).toBe(false);
    actAs(partner);
    expect((await requireViewer()).household).toBeNull(); // T2
  });
});

describe('demo-user guard (T6 — critic #210 F1)', () => {
  it('the shared demo account cannot create a household or redeem an invite', async () => {
    actAs(DEMO_USER_ID);
    expect(await createHousehold('Demo house')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/demo/i),
    });
    expect(await acceptInvite('any-invite-id', 'ABCD-2345')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/demo/i),
    });
    expect(await prisma.householdMember.count({ where: { userId: DEMO_USER_ID } })).toBe(0);
  });

  it('the demo user’s address cannot be invited, so no live demo invite row can exist', async () => {
    const owner = await seedUser('demo-inviter');
    actAs(owner);
    await createHousehold('Demo bait');
    const demo = await prisma.user.findUnique({
      where: { id: DEMO_USER_ID },
      select: { email: true },
    });
    expect(demo).not.toBeNull(); // seeded demo user is present in the test DB
    expect(await inviteToHousehold(demo!.email)).toMatchObject({ ok: false });
    expect(
      await prisma.householdInvite.count({ where: { email: demo!.email.toLowerCase() } }),
    ).toBe(0);
  });
});

describe('getHouseholdView (settings assembly)', () => {
  it('shows a pending incoming invite to the ADDRESSED user only, and filters expired ones lazily', async () => {
    const owner = await seedUser('view-owner');
    const invitee = await seedUser('view-invitee');
    actAs(owner);
    await createHousehold('Viewhaus');
    const invite = await inviteToHousehold(emailOf(invitee));
    if (!invite.ok) throw new Error('invite failed');

    actAs(invitee);
    let view = await getHouseholdView();
    expect(view.kind).toBe('none');
    if (view.kind !== 'none') throw new Error('unreachable');
    expect(view.invites).toHaveLength(1);
    expect(view.invites[0].householdName).toBe('Viewhaus');
    expect(view.invites[0].invitedByName).toBe('view-owner'); // inviter resolved best-effort

    // Lazy expiry: past-window invites vanish from the list with no cron.
    await prisma.householdInvite.update({
      where: { id: await inviteIdFor(invitee) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    view = await getHouseholdView();
    if (view.kind !== 'none') throw new Error('unreachable');
    expect(view.invites).toHaveLength(0);

    // The member view reconciles: owner sees the household, self-flagged.
    actAs(owner);
    const ownerView = await getHouseholdView();
    expect(ownerView.kind).toBe('member');
    if (ownerView.kind !== 'member') throw new Error('unreachable');
    expect(ownerView.role).toBe('owner');
    expect(ownerView.members).toHaveLength(1);
    expect(ownerView.members[0].isSelf).toBe(true);
  });
});

describe('lazy repair (T10, T11)', () => {
  it('an ownerless household promotes exactly the earliest-joined member at next read, idempotently', async () => {
    const owner = await seedUser('rep-owner');
    const p1 = await seedUser('rep-p1');
    const p2 = await seedUser('rep-p2');
    await establishHousehold(owner, p1);
    actAs(owner);
    const invite = await inviteToHousehold(emailOf(p2));
    if (!invite.ok) throw new Error('invite failed');
    actAs(p2);
    expect(await acceptInvite(await inviteIdFor(p2), invite.code)).toEqual({ ok: true });
    // p1 joined before p2 (strictly earlier joinedAt for a deterministic pick).
    await prisma.householdMember.update({
      where: { userId: p1 },
      data: { joinedAt: new Date('2026-01-01T00:00:00Z') },
    });
    await prisma.householdMember.update({
      where: { userId: p2 },
      data: { joinedAt: new Date('2026-01-02T00:00:00Z') },
    });

    // Simulate the owner vanishing without bookkeeping (crash-path): raw delete.
    await prisma.householdMember.delete({ where: { userId: owner } });

    actAs(p2);
    const v1 = await requireViewer(); // ANY member's read triggers the repair
    expect(v1.household?.role).toBe('partner'); // p2 is not the pick
    expect(
      (await prisma.householdMember.findUnique({ where: { userId: p1 } }))?.role,
    ).toBe('owner'); // earliest-joined promoted
    // Idempotent: a second read changes nothing.
    const v2 = await requireViewer();
    expect(v2.household?.memberIds.sort()).toEqual([p1, p2].sort());
    expect(
      await prisma.householdMember.count({ where: { role: 'owner', userId: { in: [p1, p2] } } }),
    ).toBe(1);
    actAs(p1);
    expect((await requireViewer()).household?.role).toBe('owner');
  });

  it('deleteMyData cascades the membership; the survivor’s next read self-heals to owner (T10)', async () => {
    const owner = await seedUser('del-owner');
    const partner = await seedUser('del-partner');
    await establishHousehold(owner, partner);

    actAs(owner);
    const fd = new FormData();
    fd.set('confirm', 'delete my data');
    await deleteMyData(fd);

    expect(await prisma.user.count({ where: { id: owner } })).toBe(0);
    expect(await prisma.householdMember.count({ where: { userId: owner } })).toBe(0);

    actAs(partner);
    const v = await requireViewer();
    // Survivor was promoted at read; no partner retains visibility into the
    // deleted user's data because that data no longer exists (cascade).
    expect(v.household?.role).toBe('owner');
    expect(v.household?.memberIds).toEqual([partner]);
  });
});
