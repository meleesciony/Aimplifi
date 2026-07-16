'use server';

/**
 * Client-callable nudge-feed dismissal (NUDGE_PLAN slice 2). Ownership via
 * requireUserId; delegates persistence to recordNudgeDismissal (demo-fenced,
 * never-throws). Returns whether the dismissal PERSISTED — false for the demo user
 * (session-only) or a store fault; the client collapses optimistically either way,
 * so a false return degrades to "reappears on reload", never a broken UI.
 *
 * The `dismissKey` is minted by the pure engine (Proposal.dismissKey) and passed
 * back verbatim. It only ever suppresses THIS user's own feed, and CRITICAL
 * proposals are never suppressed by the engine regardless of dismissal — so a
 * dismissKey for a material warning is inert for suppression by construction.
 */
import { requireUserId, rateLimitDurable } from '@/server/authz';
import { recordNudgeDismissal } from '@/server/nudge';

// Bound the write path (the repo rule: every request path uses rateLimitDurable). A
// generous ceiling — a real user dismisses a handful of nudges — that still caps a
// scripted `dismissNudge(randomUUID())` flood well before it can bloat the table.
const DISMISS_LIMIT = 40;
const DISMISS_WINDOW_MS = 60_000;

export async function dismissNudge(dismissKey: string): Promise<boolean> {
  try {
    const userId = await requireUserId();
    if (!(await rateLimitDurable(`nudge-dismiss:${userId}`, DISMISS_LIMIT, DISMISS_WINDOW_MS))) {
      return false;
    }
    return await recordNudgeDismissal(userId, dismissKey);
  } catch {
    return false;
  }
}
