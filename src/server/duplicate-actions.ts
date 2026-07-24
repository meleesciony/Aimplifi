'use server';

/**
 * Duplicate-warning dismissal action (owner-reported 2026-07-23). Marks an account PAIR as
 * "not a duplicate" so the #192 advisory warning stops surfacing it. Persists via the
 * NudgeDismissal store under the `dup:` namespace (see duplicate-dismissal.ts). Advisory only:
 * never merges or deletes an account.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { DEMO_CONNECT_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { requireUserId } from '@/server/authz';
import { recordNudgeDismissal } from '@/server/nudge';
import { duplicatePairDismissKey } from '@/server/duplicate-dismissal';

export interface DismissDuplicateResult {
  ok: boolean;
  error?: string;
}

export async function dismissDuplicatePair(aId: string, bId: string): Promise<DismissDuplicateResult> {
  try {
    const userId = await requireUserId();
    if (isDemoUser(userId)) return { ok: false, error: DEMO_CONNECT_BLOCKED };
    // Scalar-validate the attacker-controllable server-action args (the #271/#279 lesson): a
    // non-string would otherwise reach the key builder / Prisma verbatim.
    if (typeof aId !== 'string' || typeof bId !== 'string' || !aId.trim() || !bId.trim() || aId === bId) {
      return { ok: false, error: 'That isn’t a valid pair of accounts.' };
    }
    // Only dismiss a pair whose BOTH accounts the user owns — a forged pair of ids can't write
    // junk suppression keys, and can't reference someone else's accounts.
    const owned = await prisma.account.count({ where: { userId, id: { in: [aId, bId] } } });
    if (owned < 2) return { ok: false, error: 'Those accounts aren’t both connected to your account.' };
    // recordNudgeDismissal catches its own DB faults and returns false rather than throwing. The
    // demo path is already refused above and the dup: key is well under the length cap, so a false
    // here means the write was LOST — report it instead of a "Dismissed" confirmation the next
    // /accounts load would contradict when the warning reappears (dup-veto critic F2).
    const saved = await recordNudgeDismissal(userId, duplicatePairDismissKey(aId, bId));
    if (!saved) return { ok: false, error: 'Could not save that just now — please try again in a minute.' };
    revalidatePath('/accounts');
    return { ok: true };
  } catch {
    // Fixed string — a Prisma/validation error can embed server paths + the userId.
    return { ok: false, error: 'Could not dismiss that — please try again in a minute.' };
  }
}

/**
 * Undo a "not a duplicate" dismissal (TASKS L.6, owner-reported 2026-07-24 "Not there").
 *
 * A dismissal suppresses the advisory warning AND the one-tap Combine offer, which is right —
 * an explicit judgment should bind every surface. But it made the dismissal permanent and
 * invisible: a user who dismissed the pair before the Combine flow existed had no way back, and
 * no way to even learn that was why nothing was offered. The /accounts card now states the
 * reason and offers this.
 */
export async function reconsiderDuplicatePair(aId: string, bId: string): Promise<DismissDuplicateResult> {
  try {
    const userId = await requireUserId();
    if (isDemoUser(userId)) return { ok: false, error: DEMO_CONNECT_BLOCKED };
    if (typeof aId !== 'string' || typeof bId !== 'string' || !aId.trim() || !bId.trim() || aId === bId) {
      return { ok: false, error: 'That isn’t a valid pair of accounts.' };
    }
    const owned = await prisma.account.count({ where: { userId, id: { in: [aId, bId] } } });
    if (owned < 2) return { ok: false, error: 'Those accounts aren’t both connected to your account.' };
    await prisma.nudgeDismissal.deleteMany({
      where: { userId, dismissKey: duplicatePairDismissKey(aId, bId) },
    });
    revalidatePath('/accounts');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not undo that — please try again in a minute.' };
  }
}
