/**
 * Node-side session-epoch enforcement (Gap 6 §3). Called from the Node session
 * callback in src/auth.ts (never the edge middleware config, which must stay
 * Prisma-free). Reads the user's current epoch and delegates the decision to the
 * pure `isSessionCurrent` predicate, so all branching stays in the tested engine.
 *
 * Deliberately in its own module — importing prisma only — so auth.ts can use it
 * without the import cycle a dependency on authz.ts (which imports `@/auth`) would
 * create.
 */
import { isSessionCurrent } from '@/lib/engine/auth/session';
import { prisma } from '@/lib/db';

/**
 * The user's current session epoch, or `undefined` if the user no longer exists.
 * Read at SIGN-IN by the Node jwt override to stamp the token (so a fresh sign-in
 * after a revoke re-reads the current value — the fix for the demo/Google lock-out)
 * AND at REQUEST time by isSessionEpochCurrent. One source, so stamp and check can
 * never diverge.
 */
export async function currentSessionEpoch(userId: string): Promise<number | undefined> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionEpoch: true },
  });
  return user?.sessionEpoch;
}

/**
 * True when a token minted with `tokenEpoch` is still valid for `userId`:
 * the user must still exist AND its current sessionEpoch must equal the stamped
 * epoch. A missing user (deleted account) or a bumped epoch (revokeOtherSessions)
 * yields false, invalidating the session on this device and every other.
 */
export async function isSessionEpochCurrent(
  userId: string,
  tokenEpoch: number | undefined,
): Promise<boolean> {
  return isSessionCurrent((await currentSessionEpoch(userId)) ?? null, tokenEpoch);
}
