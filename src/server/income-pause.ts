/**
 * Income-Pause confirmation store (#251, AI plan §Later #20). Storage-only sibling
 * of server/nudge.ts: reads/writes IncomePauseConfirmation rows, never throws to a
 * page render, and fences the shared demo account by CONSTRUCTION — every anonymous
 * visitor is the same user row, so one visitor's "yes, my income stopped" must never
 * mutate the projections every other visitor sees (the shared-demo lesson). For the
 * demo user, reads return the empty set and writes are refused.
 *
 * What a confirmation MEANS lives elsewhere, deliberately: the projection exclusion
 * is applied by refreshRecurringForUser, which recomputes lapse from the series
 * itself (engine/income/pause.ts `lapsedIncomeSeries`) — a row here is consent, not
 * evidence.
 */
import { prisma } from '@/lib/db';
import { DEMO_USER_ID } from '@/lib/demo-user';

// Canonical merchant names are short; cap accepted length so a forged client can't
// store megabyte keys (the nudge-dismissal precedent).
const MAX_MERCHANT_LEN = 200;
// A user has few income sources; cap the read defensively.
const MAX_CONFIRMATIONS_READ = 50;

/** Canonical merchants this user has confirmed as paused (empty set for demo). */
export async function getConfirmedIncomePauses(userId: string): Promise<ReadonlySet<string>> {
  if (userId === DEMO_USER_ID) return new Set();
  try {
    const rows = await prisma.incomePauseConfirmation.findMany({
      where: { userId },
      select: { merchantCanonical: true },
      take: MAX_CONFIRMATIONS_READ,
    });
    return new Set(rows.map((r) => r.merchantCanonical));
  } catch {
    // A read fault degrades to "nothing confirmed" — the conservative direction for
    // the NUDGE (it may re-show an acknowledged pause; it never hides a fresh one).
    return new Set();
  }
}

/**
 * Record the user's confirmation that this income has paused. Returns whether it
 * persisted — false for the demo user (fence) or a store fault.
 */
export async function confirmIncomePause(userId: string, merchantCanonical: string): Promise<boolean> {
  if (userId === DEMO_USER_ID) return false;
  if (!merchantCanonical || merchantCanonical.length > MAX_MERCHANT_LEN) return false;
  try {
    await prisma.incomePauseConfirmation.upsert({
      where: { userId_merchantCanonical: { userId, merchantCanonical } },
      create: { userId, merchantCanonical },
      update: {}, // idempotent — re-confirming is a no-op
    });
    return true;
  } catch {
    return false;
  }
}

/** Withdraw a confirmation (the undo). Returns whether a row was deleted. */
export async function undoIncomePause(userId: string, merchantCanonical: string): Promise<boolean> {
  if (userId === DEMO_USER_ID) return false;
  // Same input cap as confirm (#251 critic F8) — the defense applies to BOTH entry points.
  if (!merchantCanonical || merchantCanonical.length > MAX_MERCHANT_LEN) return false;
  try {
    const res = await prisma.incomePauseConfirmation.deleteMany({
      where: { userId, merchantCanonical },
    });
    return res.count > 0;
  } catch {
    return false;
  }
}
