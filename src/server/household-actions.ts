'use server';

/**
 * Household membership actions (TASKS 4.2 slice 1 — HOUSEHOLD_ARCHITECTURE.md
 * §4.3 rule 4). The 7 actions of the membership core. Every action re-verifies
 * the session, scopes every query to the acting user's own household, and
 * audit-logs. NO existing action changes; sharing (`setAccountShared`) ships
 * with slice 2, where something first reads the flag.
 *
 * Redemption failures return ONE generic message (no invite enumeration); the
 * precise denial reason stays server-side in the engine verdict. The only
 * accepter-state exception is "already in a household", which is about the
 * caller, not the invite.
 */
import { revalidatePath } from 'next/cache';
import { randomBytes } from 'crypto';
import { prisma, serializableTx } from '@/lib/db';
import { DEMO_USER_ID } from '@/auth.config';
import { auditLog, rateLimitDurable, requireUserId, requireViewer } from '@/server/authz';
import { isValidEmail, normalizeEmail } from '@/lib/auth/validate';
import {
  INVITE_MAX_ATTEMPTS,
  INVITE_TTL_DAYS,
  canInvite,
  canRemoveMember,
  canRevokeInvite,
  codeFromBytes,
  evaluateInviteRedemption,
  hashInviteCode,
  validateHouseholdName,
} from '@/lib/engine/household/membership';

export type HouseholdActionResult = { ok: true } | { ok: false; error: string };
export type InviteCreateResult =
  | { ok: true; code: string; email: string }
  | { ok: false; error: string };

const GENERIC_REDEEM_ERROR = 'That invite code is invalid, expired, or already used.';

/** The pending→accepted claim inside the accept transaction matched no row —
 * the invite was revoked/declined/accepted concurrently. Maps to the generic
 * redemption error (no oracle). */
class InviteClaimLost extends Error {
  constructor() {
    super('invite claim lost');
  }
}
const DEMO_HOUSEHOLD_ERROR =
  'The shared demo account can’t join a household — sign up for your own account first.';

/** Salt for at-rest invite-code hashes (deletionRefSalt idiom). The code itself
 * is the high-entropy secret; the salt only blocks rainbow-table enumeration of
 * a leaked hash dump. The public dev fallback exists because demo mode must run
 * with ZERO env vars (CLAUDE.md rule 4) — in any real deployment AUTH_SECRET is
 * present (NextAuth requires it), so the fallback never engages there. */
function inviteCodeSalt(): string {
  return process.env.INVITE_CODE_SALT ?? process.env.AUTH_SECRET ?? 'aimplifi-invite-dev-v1';
}

/** T6 is a GUARD, not a seed accident (critic #210 F1): the demo user is a
 * shared, credential-free login, so a demo membership would hand every
 * anonymous visitor a seat in a real user's household and perturb the demo
 * dataset for everyone. Blocked at every entry point into membership —
 * creating, accepting, and being invited. */
function isDemoUser(userId: string): boolean {
  return userId === DEMO_USER_ID;
}

export async function createHousehold(rawName: string): Promise<HouseholdActionResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_HOUSEHOLD_ERROR };
  const v = validateHouseholdName(rawName);
  if (!v.ok) return { ok: false, error: v.error };

  try {
    // Nested create = atomic household+owner in one statement; the @@unique on
    // HouseholdMember.userId makes "already in a household" a constraint, not
    // a check-then-act race. The flag reset rides the same transaction — a new
    // household starts with zero shared accounts (§4.1 "consent never survives
    // the relationship that granted it"; critic slice-2 F1 stale-flag class).
    await prisma.$transaction([
      prisma.household.create({
        data: { name: v.name, members: { create: { userId, role: 'owner' } } },
      }),
      prisma.account.updateMany({
        where: { userId, sharedToHousehold: true },
        data: { sharedToHousehold: false },
      }),
    ]);
  } catch (e) {
    // Only the membership-unique race maps to the friendly message; any other
    // DB fault surfaces (never misreported — critic #210 F7).
    if ((e as { code?: string })?.code !== 'P2002') throw e;
    return { ok: false, error: 'You are already in a household — leave it first.' };
  }
  await auditLog(userId, 'household.create', { name: v.name });
  revalidatePath('/settings');
  return { ok: true };
}

export async function inviteToHousehold(rawEmail: string): Promise<InviteCreateResult> {
  const viewer = await requireViewer();
  if (!viewer.household) return { ok: false, error: 'Create a household first.' };
  if (!canInvite(viewer.household.role)) {
    return { ok: false, error: 'Your role cannot send invites.' };
  }

  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    return { ok: false, error: 'Enter the email your partner signs in with.' };
  }
  const me = await prisma.user.findUnique({
    where: { id: viewer.userId },
    select: { email: true },
  });
  if (me && normalizeEmail(me.email) === email) {
    return { ok: false, error: 'That is your own sign-in email.' };
  }
  const invitedUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, householdMembership: { select: { householdId: true } } },
  });
  // The shared demo account can never hold a membership (T6 guard) — refuse at
  // the invite too, so no live invite row for it ever exists.
  if (invitedUser && isDemoUser(invitedUser.id)) {
    return { ok: false, error: 'That account can’t join a household.' };
  }
  if (invitedUser?.householdMembership?.householdId === viewer.household.id) {
    return { ok: false, error: 'They are already a member of your household.' };
  }
  // A decline is STICKY for the life of the original invite window (critic
  // #210 F4): re-inviting cannot resurrect it, so "no" makes the settings-page
  // nag stop. After the declined invite's expiry date passes, a fresh invite is
  // allowed again (an accidental decline isn't a permanent dead-end).
  const existing = await prisma.householdInvite.findUnique({
    where: { householdId_email: { householdId: viewer.household.id, email } },
    select: { status: true, expiresAt: true },
  });
  if (existing?.status === 'declined' && existing.expiresAt.getTime() > Date.now()) {
    return { ok: false, error: 'They declined this invitation.' };
  }

  const allowed = await rateLimitDurable(
    `household-invite:${viewer.userId}`,
    5,
    24 * 60 * 60 * 1000,
  );
  if (!allowed) return { ok: false, error: 'Invite limit reached — try again tomorrow.' };

  // The one-time code: generated here, shown ONCE to the inviter for
  // out-of-band handoff, stored only as a salted hash (T12). Never logged.
  const code = codeFromBytes(randomBytes(16));
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.householdInvite.upsert({
    where: { householdId_email: { householdId: viewer.household.id, email } },
    create: {
      householdId: viewer.household.id,
      email,
      codeHash: hashInviteCode(code, inviteCodeSalt()),
      invitedById: viewer.userId,
      expiresAt,
    },
    // Re-invite = fresh code, fresh window, attempts reset, back to pending.
    update: {
      codeHash: hashInviteCode(code, inviteCodeSalt()),
      invitedById: viewer.userId,
      status: 'pending',
      attempts: 0,
      expiresAt,
    },
  });
  await auditLog(viewer.userId, 'household.invite.create', {
    householdId: viewer.household.id,
  });
  revalidatePath('/settings');
  return { ok: true, code, email };
}

export async function acceptInvite(
  inviteId: string,
  candidateCode: string,
): Promise<HouseholdActionResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_HOUSEHOLD_ERROR };
  const allowed = await rateLimitDurable(`household-redeem:${userId}`, 10, 60 * 60 * 1000);
  if (!allowed) return { ok: false, error: 'Too many attempts — try again in an hour.' };

  const [invite, me] = await Promise.all([
    prisma.householdInvite.findUnique({ where: { id: inviteId } }),
    // DB-row email, NEVER session claims (§4.3 F4/F6).
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, householdMembership: { select: { id: true } } },
    }),
  ]);
  if (!invite || !me) return { ok: false, error: GENERIC_REDEEM_ERROR };

  const verdict = evaluateInviteRedemption({
    invite,
    accepterEmail: me.email,
    accepterHasMembership: me.householdMembership !== null,
    candidateCode,
    codeSalt: inviteCodeSalt(),
    now: new Date(),
  });

  if (!verdict.ok) {
    if (verdict.countsAsAttempt) {
      // Burn an attempt, then revoke on the LIVE post-increment value — both
      // status-guarded so a concurrently accepted/revoked invite is never
      // overwritten, and two racing failures still converge on 'revoked'
      // (critic #210 F3-symmetric/F5): whichever failure sees attempts at or
      // past the cap flips it, and even an unflipped at-cap row is inert (the
      // engine denies at attempts >= cap before any factor).
      await prisma.$transaction([
        prisma.householdInvite.updateMany({
          where: { id: inviteId, status: 'pending' },
          data: { attempts: { increment: 1 } },
        }),
        prisma.householdInvite.updateMany({
          where: { id: inviteId, status: 'pending', attempts: { gte: INVITE_MAX_ATTEMPTS } },
          data: { status: 'revoked' },
        }),
      ]);
    }
    return verdict.reason === 'already_member'
      ? { ok: false, error: 'Leave your current household first.' }
      : { ok: false, error: GENERIC_REDEEM_ERROR };
  }

  try {
    // Serializable check-then-act (the db.ts serializableTx idiom): CLAIM the
    // invite while it is still pending, then create the membership. A revoke
    // (or cap-revocation) landing after the gate read can no longer be
    // overwritten by this commit (critic #210 F3) — the claim matches nothing
    // and the accept fails with the generic error.
    await serializableTx(async (tx) => {
      const { count } = await tx.householdInvite.updateMany({
        where: { id: inviteId, status: 'pending' },
        data: { status: 'accepted' },
      });
      if (count === 0) throw new InviteClaimLost();
      await tx.householdMember.create({
        data: { householdId: invite.householdId, userId, role: 'partner' },
      });
      // §4.1: "consent never survives the relationship that granted it" — a
      // join starts with ZERO shared accounts. This retires every stale-flag
      // path (e.g. the setAccountShared/leave write race, critic slice-2 F1):
      // whatever a flag's history, it cannot follow the user into a new
      // household. Self-scoped; atomic with the membership create.
      await tx.account.updateMany({
        where: { userId, sharedToHousehold: true },
        data: { sharedToHousehold: false },
      });
    });
  } catch (e) {
    if (e instanceof InviteClaimLost) return { ok: false, error: GENERIC_REDEEM_ERROR };
    // P2002 = the caller joined elsewhere concurrently (membership unique);
    // P2003 = the household was reaped between the gate read and the claim.
    const code = (e as { code?: string })?.code;
    if (code === 'P2002') return { ok: false, error: 'Leave your current household first.' };
    if (code === 'P2003') return { ok: false, error: GENERIC_REDEEM_ERROR };
    throw e;
  }
  await auditLog(userId, 'household.invite.accept', { householdId: invite.householdId });
  revalidatePath('/settings');
  return { ok: true };
}

export async function declineInvite(inviteId: string): Promise<HouseholdActionResult> {
  const userId = await requireUserId();
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!me) return { ok: false, error: GENERIC_REDEEM_ERROR };
  // Only the ADDRESSED user may decline; scoping the update by email keeps
  // this atomic (no check-then-act on someone else's invite).
  const { count } = await prisma.householdInvite.updateMany({
    where: { id: inviteId, email: normalizeEmail(me.email), status: 'pending' },
    data: { status: 'declined' },
  });
  if (count === 0) return { ok: false, error: GENERIC_REDEEM_ERROR };
  await auditLog(userId, 'household.invite.decline', { inviteId });
  revalidatePath('/settings');
  return { ok: true };
}

export async function revokeInvite(inviteId: string): Promise<HouseholdActionResult> {
  const viewer = await requireViewer();
  if (!viewer.household || !canRevokeInvite(viewer.household.role)) {
    return { ok: false, error: 'Only the household owner can revoke invites.' };
  }
  const { count } = await prisma.householdInvite.updateMany({
    where: { id: inviteId, householdId: viewer.household.id, status: 'pending' },
    data: { status: 'revoked' },
  });
  if (count === 0) return { ok: false, error: 'That invite is no longer pending.' };
  await auditLog(viewer.userId, 'household.invite.revoke', {
    householdId: viewer.household.id,
  });
  revalidatePath('/settings');
  return { ok: true };
}

export async function leaveHousehold(): Promise<HouseholdActionResult> {
  const viewer = await requireViewer();
  if (!viewer.household) return { ok: false, error: 'You are not in a household.' };
  const householdId = viewer.household.id;

  // Consent never survives the relationship that granted it (§4.1): reset the
  // departing member's share flags IN THE SAME transaction as the departure.
  // The flag reset is self-guarding — it applies only while the membership row
  // still exists (relation filter) — and runs BEFORE the delete (array order).
  await prisma.$transaction([
    prisma.account.updateMany({
      where: { userId: viewer.userId, user: { householdMembership: { householdId } } },
      data: { sharedToHousehold: false },
    }),
    prisma.householdMember.deleteMany({ where: { userId: viewer.userId, householdId } }),
  ]);

  // Opportunistic reap of a now-memberless household (best-effort — the
  // lazy-repair invariant makes correctness independent of this succeeding).
  try {
    const remaining = await prisma.householdMember.count({ where: { householdId } });
    if (remaining === 0) await prisma.household.delete({ where: { id: householdId } });
  } catch {
    // best-effort cleanup; a memberless household is unreachable regardless
  }

  await auditLog(viewer.userId, 'household.leave', { householdId });
  revalidatePath('/settings');
  return { ok: true };
}

export async function removeMember(targetUserId: string): Promise<HouseholdActionResult> {
  const viewer = await requireViewer();
  if (!viewer.household) return { ok: false, error: 'You are not in a household.' };
  if (!canRemoveMember(viewer.household.role, viewer.userId, targetUserId)) {
    return { ok: false, error: 'Only the household owner can remove another member.' };
  }
  const householdId = viewer.household.id;

  // Same self-guarding shape as leaveHousehold: the target's share flags reset
  // ONLY while the target is still a member of THIS household (the relation
  // filter re-checks inside the transaction — no cross-user reach on a stale
  // target), then the membership row goes. Both statements are scoped to
  // (targetUserId, THIS household), so a non-member target is a no-op.
  const [, deleted] = await prisma.$transaction([
    prisma.account.updateMany({
      where: { userId: targetUserId, user: { householdMembership: { householdId } } },
      data: { sharedToHousehold: false },
    }),
    prisma.householdMember.deleteMany({ where: { userId: targetUserId, householdId } }),
  ]);
  if (deleted.count === 0) {
    return { ok: false, error: 'They are not a member of your household.' };
  }
  await auditLog(viewer.userId, 'household.member.remove', { householdId, targetUserId });
  revalidatePath('/settings');
  return { ok: true };
}

/**
 * Share/unshare one of MY OWN accounts with my current household (TASKS 4.2
 * slice 2 — §4.3 rule 4). Owner-only by construction: the update is scoped
 * `where: { id, userId }`, so a partner's (or stranger's) accountId matches
 * zero rows and returns "not found" — no existence oracle across users.
 * Sharing ON requires a live membership; sharing OFF is always allowed (a
 * leftover flag is inert without membership, but the owner can still tidy it).
 */
export async function setAccountShared(
  accountId: string,
  shared: boolean,
): Promise<HouseholdActionResult> {
  const viewer = await requireViewer();
  if (isDemoUser(viewer.userId)) return { ok: false, error: DEMO_HOUSEHOLD_ERROR };
  // 'use server' endpoints take attacker-shaped input: refuse non-scalar args
  // (a filter object as accountId would turn the scoped update into a bulk
  // toggle — self-scoped either way, but validate at the boundary).
  if (typeof accountId !== 'string' || typeof shared !== 'boolean') {
    return { ok: false, error: 'Account not found.' };
  }
  if (shared && !viewer.household) {
    return { ok: false, error: 'Join a household before sharing an account.' };
  }
  const { count } = await prisma.account.updateMany({
    // Sharing ON is SELF-GUARDING (the leaveHousehold/removeMember idiom): the
    // write re-checks live membership in its own where, so a leave/remove
    // committing between requireViewer's read and this statement cannot strand
    // a consentless flag that would auto-share into a future household
    // (critic slice-2 F1). OFF stays unguarded — revocation is always allowed.
    where: shared
      ? { id: accountId, userId: viewer.userId, user: { householdMembership: { isNot: null } } }
      : { id: accountId, userId: viewer.userId },
    data: { sharedToHousehold: shared },
  });
  if (count === 0) {
    if (shared) {
      // Distinguish "not yours / doesn't exist" from "membership raced away"
      // honestly. The probe is scoped to the caller's own rows — no cross-user
      // existence oracle.
      const owned = await prisma.account.findFirst({
        where: { id: accountId, userId: viewer.userId },
        select: { id: true },
      });
      if (owned) return { ok: false, error: 'Join a household before sharing an account.' };
    }
    return { ok: false, error: 'Account not found.' };
  }
  await auditLog(viewer.userId, 'account.share', {
    accountId,
    shared,
    householdId: viewer.household?.id ?? null,
  });
  revalidatePath('/accounts');
  return { ok: true };
}
