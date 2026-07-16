/**
 * Nudge "Today" feed persistence (NUDGE_PLAN slice 2, DECISIONS #237). Thin I/O
 * around the DEDICATED nudge suppression store (`NudgeDismissal`) that feeds
 * `NudgeInput.dismissedKeys`. Kept separate from EngagementEvent on purpose: the
 * keys stored here embed a merchant and cents (the engine's `dismissKey`), which
 * EngagementEvent's closed-set, no-money contract forbids (DECISIONS #236 P1-1).
 *
 * Never throws — a suppression-store fault must never break the dashboard; on any
 * fault the feed simply behaves as if nothing were dismissed (fail-OPEN, i.e. it
 * shows MORE, never hides a warning). This module does NO money arithmetic; it only
 * reads/writes opaque keys minted by the pure engine.
 *
 * DEMO FENCE (shared-demo-account-must-not-learn): every anonymous visitor is the one
 * shared `user-demo` row, so a persisted dismissal would leak one stranger's
 * "hide this" to the next visitor. The demo user therefore NEVER writes here and its
 * read always returns the empty set — dismissal is session-only (client collapse) for
 * demo, exactly like the return-moment card.
 */
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';

// Every engine-minted dismissKey is short (kind + ids + a date, e.g.
// `price-increase:Netflix:1799->1999`). Cap the accepted length so a forged client
// can't store megabyte keys, and cap the read so a user who somehow accumulated many
// rows never loads an unbounded set into every dashboard render.
const MAX_DISMISS_KEY_LEN = 200;
const MAX_DISMISSED_KEYS_READ = 500;

/**
 * The set of `dismissKey`s this user has dismissed — read into
 * `NudgeInput.dismissedKeys` at feed-build time. Empty for the shared demo user (the
 * fence) and empty on any DB fault (fail-open). This set is NEVER routed into
 * `selectPaymentReminders`' upstream `dismissedKeys` — see the NudgeDismissal model
 * comment and NUDGE_PLAN slice-2 guardrail.
 */
export async function getNudgeDismissedKeys(userId: string): Promise<ReadonlySet<string>> {
  if (userId === DEMO_USER_ID) return new Set();
  try {
    const rows = await prisma.nudgeDismissal.findMany({
      where: { userId },
      select: { dismissKey: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_DISMISSED_KEYS_READ,
    });
    return new Set(rows.map((r) => r.dismissKey));
  } catch {
    return new Set();
  }
}

/**
 * Persist one dismissal. Idempotent (unique [userId, dismissKey] → upsert-noop on
 * repeat). No-op for the demo user (the fence). Returns false on the demo no-op or a
 * DB fault; the caller treats the dismissal as session-only in that case.
 */
export async function recordNudgeDismissal(userId: string, dismissKey: string): Promise<boolean> {
  if (userId === DEMO_USER_ID) return false;
  if (!dismissKey || dismissKey.length > MAX_DISMISS_KEY_LEN) return false;
  try {
    // Bump createdAt on a repeat dismissal so re-dismissing a key that had aged out of
    // the bounded read window (take: MAX_DISMISSED_KEYS_READ, newest-first) brings it
    // back into effect — otherwise a re-dismiss would be a silent no-op while returning
    // true. createdAt is the recency anchor the read orders by, so this is a
    // last-dismissed-at bump, not a false creation time.
    await prisma.nudgeDismissal.upsert({
      where: { userId_dismissKey: { userId, dismissKey } },
      create: { userId, dismissKey },
      update: { createdAt: new Date() },
    });
    return true;
  } catch {
    return false;
  }
}
