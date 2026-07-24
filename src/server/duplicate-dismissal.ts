/**
 * Duplicate-warning dismissal (owner-reported 2026-07-23: the "possible duplicate accounts"
 * card was permanent, with no way to say "these are not duplicates"). Server-side read + key
 * helper; the `'use server'` action lives in duplicate-actions.ts (the repo's pure-util vs
 * action-file split — mirrors nudge.ts / plaid-actions.ts).
 *
 * Reuses the NudgeDismissal store under a `dup:` namespace instead of adding a table: that
 * store is already the repo's per-user suppression primitive (demo-fenced, fail-OPEN, length-
 * capped), and a `dup:` key is inert to the nudge feed (it matches no nudge item key). The key
 * is the SORTED pair of account ids, so it is order-independent and stable across re-detection.
 *
 * Advisory only — dismissing never merges or deletes an account; it hides a warning the user
 * has judged wrong (two same-named cards they know are different). If either account is later
 * disconnected + reconnected (new id) the key no longer matches, so the pair is re-evaluated.
 */
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';

/** Stable, order-independent dismissal key for an account pair (the same sort as `pairKey`). */
export function duplicatePairDismissKey(aId: string, bId: string): string {
  return `dup:${aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`}`;
}

/**
 * The set of `dup:` pair-keys this user has dismissed, read at /accounts build time to filter
 * the advisory duplicate warning. Demo-fenced (the shared `user-demo` row must never persist
 * one visitor's dismissal for the next) and fail-OPEN (on any DB fault it returns empty, so a
 * fault shows MORE warnings, never HIDES a real duplicate — the nudge-store contract).
 */
export async function getDismissedDuplicateKeys(userId: string): Promise<ReadonlySet<string>> {
  if (userId === DEMO_USER_ID) return new Set();
  try {
    const rows = await prisma.nudgeDismissal.findMany({
      where: { userId, dismissKey: { startsWith: 'dup:' } },
      select: { dismissKey: true },
      take: 500,
    });
    return new Set(rows.map((r) => r.dismissKey));
  } catch {
    return new Set();
  }
}
