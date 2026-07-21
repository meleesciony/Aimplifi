'use server';

/**
 * Client-callable income-pause confirmation (#251). Ownership via requireUserId;
 * persistence via the demo-fenced store (server/income-pause.ts). On a persisted
 * change, re-runs refreshRecurringForUser so the projection exclusion (or its undo)
 * applies IMMEDIATELY — the user who just said "this income stopped" must see
 * cash-needed stop counting it on the next render, not after the next provider sync.
 *
 * The merchant name is the engine-minted Proposal.merchant passed back verbatim; it
 * only ever affects THIS user's own confirmations and projections. A merchant string
 * that matches no detected series is inert by construction (the exclusion recomputes
 * lapse from the series itself), so no validation beyond the length cap is needed.
 */
import { isoDate } from '@/lib/dates';
import { getProvider } from '@/lib/providers/demo';
import { requireUserId, rateLimitDurable } from '@/server/authz';
import { confirmIncomePause, undoIncomePause } from '@/server/income-pause';
import { refreshRecurringForUser } from '@/server/recurring';

// Bound the write path (repo rule: every request path uses rateLimitDurable). Each
// accepted call triggers a full recurring refresh, so the ceiling is deliberately
// tighter than nudge dismissal's.
const PAUSE_LIMIT = 10;
const PAUSE_WINDOW_MS = 60_000;

async function applyAndRefresh(
  action: (userId: string, merchant: string) => Promise<boolean>,
  merchantCanonical: string,
): Promise<boolean> {
  try {
    const userId = await requireUserId();
    if (!(await rateLimitDurable(`income-pause:${userId}`, PAUSE_LIMIT, PAUSE_WINDOW_MS))) {
      return false;
    }
    const persisted = await action(userId, merchantCanonical);
    if (persisted) {
      const today = isoDate(getProvider().today(userId));
      await refreshRecurringForUser(userId, today);
    }
    return persisted;
  } catch {
    return false;
  }
}

/** Confirm "this income has genuinely paused" — gates the projection exclusion. */
export async function confirmIncomePauseAction(merchantCanonical: string): Promise<boolean> {
  return applyAndRefresh(confirmIncomePause, merchantCanonical);
}

/** Withdraw the confirmation — projections count the series again on the next refresh. */
export async function undoIncomePauseAction(merchantCanonical: string): Promise<boolean> {
  return applyAndRefresh(undoIncomePause, merchantCanonical);
}
