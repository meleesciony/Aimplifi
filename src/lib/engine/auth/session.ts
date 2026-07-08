/**
 * Session-lifecycle engine (Gap 6 §3 — multi-device session invalidation +
 * PII-free deletion record). Pure, deterministic decision logic with NO DB and
 * NO NextAuth imports, so both helpers are unit-testable in isolation (LOOP §5:
 * a rule that can be written is written, not delegated to a model or buried in
 * an I/O callback).
 *
 * The invalidation model is a per-user "session epoch": an integer stamped into
 * the JWT at sign-in and re-read from the DB on every Node-side session
 * resolution. Bumping the DB epoch (revokeOtherSessions) makes every previously
 * issued token stale; deleting the user removes the row entirely. Both are
 * expressed here as a single predicate, `isSessionCurrent`, so the auth callback
 * carries no branching of its own.
 */
import { createHash } from 'node:crypto';

/**
 * Is a token's stamped epoch still current for this user?
 *
 * @param dbEpoch      the user's current `sessionEpoch`, or `null` when the user
 *                     row no longer exists (deleted account, stale token). A
 *                     missing user is never current — this is what kills a
 *                     deleted account's sessions on every device.
 * @param tokenEpoch   the epoch stamped into the JWT at sign-in. Treated as 0
 *                     when absent: tokens minted before this feature (and the
 *                     edge-minted Google path, which cannot read the DB to stamp)
 *                     validate against a default-0 user until the first bump, and
 *                     are correctly invalidated by any bump thereafter.
 */
export function isSessionCurrent(dbEpoch: number | null, tokenEpoch: number | undefined): boolean {
  if (dbEpoch === null) return false; // user gone → no session survives
  return (tokenEpoch ?? 0) === dbEpoch;
}

/**
 * Fallback salt for the PII-free deletion record, used ONLY when no salt is passed
 * (degenerate dev env). Production passes a SECRET salt (AUTH_SECRET, see
 * account-actions.ts). This matters because a user id can be low-entropy PII — a
 * Google user's id is `google:<email>` — so with a PUBLIC salt an operator reading
 * the records could dictionary-test candidate ids; a secret salt defeats that
 * (Critic P2-1). The hash always removes the id itself; the secret salt is what
 * additionally makes it non-enumerable.
 */
export const DEFAULT_DELETION_REF_SALT = 'aimplifi-deletion-v1';

/**
 * One-way salted hash of a user id for the non-cascading DeletionRecord. Proves
 * "an account with this id was deleted at time T" for audit without retaining the
 * id (or a Google user's embedded email) in recoverable form. Deterministic → an
 * operator holding a specific id can confirm its deletion. With a SECRET salt the
 * records are also non-enumerable (see DEFAULT_DELETION_REF_SALT); with the public
 * default they are pseudonymous only.
 */
export function hashUserRef(userId: string, salt: string = DEFAULT_DELETION_REF_SALT): string {
  return createHash('sha256').update(`${salt}:${userId}`).digest('hex');
}
