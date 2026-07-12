'use server';

/**
 * Account deletion (ROADMAP #10, docs/PRIVACY.md §Deletion). Session-verified,
 * typed-confirmation gated, and ownership-scoped: a single `prisma.user.delete`
 * cascades every user-owned row (accounts → transactions/statements/etc., plus
 * rules, corrections, recurring series, goals, budgets, audit log, Plaid items)
 * because each relation is `onDelete: Cascade`. Shared reference data (the system
 * Category set, the global Merchant table) is not user-scoped and is left intact.
 * Irreversible — and not exercised by e2e against the shared demo user.
 */
import { signOut } from '@/auth';
import { prisma } from '@/lib/db';
import { confirmationMatches } from '@/lib/engine/account/deletion';
import { hashUserRef } from '@/lib/engine/auth/session';
import { getProvider } from '@/lib/providers/demo';
import { auditLog, requireUserId } from '@/server/authz';

// Salt for the PII-free deletion-record hash. Prefer a SECRET salt so the hash of a
// low-entropy id (a Google user's id is `google:<email>`) can't be dictionary-tested
// by anyone who reads the records: DELETION_REF_SALT if set, else AUTH_SECRET (always
// present — NextAuth requires it), falling back to the engine's public default only
// in a degenerate no-secret dev env (Critic P2-1).
const deletionRefSalt = process.env.DELETION_REF_SALT ?? process.env.AUTH_SECRET;

export async function deleteMyData(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  if (!confirmationMatches(String(formData.get('confirm') ?? ''))) {
    throw new Error('Type the confirmation phrase exactly to delete your data');
  }

  // Idempotent: if the row is already gone (double-submit, a stale session after
  // a prior delete, or a migrated-but-unseeded deploy) there is nothing to wipe —
  // just sign out. This avoids an unhandled FK / record-not-found 500 on the one
  // action a worried user most needs to trust (mirrors deleteGoal's defensive
  // deleteMany), and keeps the audit write from failing the User FK.
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (exists) {
    // Best-effort: revoke any linked Plaid tokens at the source BEFORE the local
    // wipe (PRIVACY.md step 2). Demo has no PlaidItems → no-op. A Plaid failure
    // must never block the user's right to delete, so each call is try/caught.
    const items = await prisma.plaidItem.findMany({ where: { userId }, select: { itemId: true } });
    if (items.length > 0) {
      const provider = getProvider() as { removeItem?: (u: string, i: string) => Promise<void> };
      if (typeof provider.removeItem === 'function') {
        for (const it of items) {
          try {
            await provider.removeItem(userId, it.itemId);
          } catch {
            // proceed — local rows (incl. the encrypted token) are wiped below regardless
          }
        }
      }
    }

    await auditLog(userId, 'account.delete', { plaidItems: items.length });
    // PII-free deletion record (Gap 6 §3, PRIVACY.md §Deletion) + the cascade, made
    // ATOMIC (array-form $transaction — the interactive form timed out under parallel
    // SQLite, DECISIONS #46). The record holds only a one-way salted hash of the id
    // and has no relation to User, so `user.delete` does not remove it — it is the one
    // artifact that outlives the account. Atomicity guarantees the record exists IFF
    // the deletion actually committed: a failed cascade rolls the record back too, so
    // there is never a false "deleted" record nor a committed deletion with no record.
    // Capture the household BEFORE the cascade removes the membership row, so a
    // now-memberless household can be reaped after (slice-8 critic A-F1).
    const membership = await prisma.householdMember.findUnique({
      where: { userId },
      select: { householdId: true },
    });
    await prisma.$transaction([
      prisma.deletionRecord.create({
        data: { userRefHash: hashUserRef(userId, deletionRefSalt) },
      }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    // Opportunistic reap of a now-memberless household — same best-effort shape
    // as leaveHousehold. Without it, a household whose LAST member deletes their
    // data leaves a ghost Household row plus any live outgoing invites, which a
    // later accepter could still redeem into an empty household (slice-8 critic
    // A-F1). Lazy repair keeps correctness independent of this succeeding; the
    // Household delete cascades its invites.
    if (membership) {
      try {
        const remaining = await prisma.householdMember.count({
          where: { householdId: membership.householdId },
        });
        if (remaining === 0) {
          await prisma.household.delete({ where: { id: membership.householdId } });
        }
      } catch {
        // best-effort cleanup; a memberless household is unreachable regardless
      }
    }
  }

  await signOut({ redirectTo: '/sign-in' });
}

/**
 * Sign out of all devices (Gap 6 §3 — multi-device session invalidation). Bumps
 * the user's sessionEpoch, so every JWT minted before now — on this device and
 * every other — fails the Node session check on its next request. This device is
 * signed out too (honest "everywhere, including here"): with no password-change
 * flow yet, an explicit revoke is the deliberate trigger a user reaches for after
 * a lost/shared device. Ownership-scoped and audited.
 */
export async function revokeOtherSessions(): Promise<void> {
  const userId = await requireUserId();
  await prisma.user.update({
    where: { id: userId },
    data: { sessionEpoch: { increment: 1 } },
  });
  await auditLog(userId, 'session.revoke-all', {});
  await signOut({ redirectTo: '/sign-in' });
}
