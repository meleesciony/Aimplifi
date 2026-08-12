/**
 * The BalanceSnapshot writer for LIVE accounts (TASKS U.4).
 *
 * The rule it applies — one dated row per account per calendar month, over EVERY
 * account the user holds — lives in `planMonthlyBalanceSnapshots`, which carries
 * the reasoning; this module is the thin DB half.
 *
 * Fenced by CONSTRUCTION rather than at each call site
 * (docs/lessons/fence-by-construction-not-per-call-site.md): the demo check is
 * here, inside the only function that writes, so no trigger added later can
 * accumulate history onto the shared demo row. `user-demo`'s snapshots are seeded
 * and must stay exactly as seeded — the golden dataset every known-answer test and
 * every anonymous visitor reads.
 *
 * Call it after a sync has had its chance to refresh balances. It is idempotent
 * within a month, so calling it from several sync paths is safe and is the point:
 * a missed trigger costs at most a month's row, never a wrong figure.
 */
import { businessToday } from '@/lib/business-today';
import { prisma, serializableTx } from '@/lib/db';
import { type ISODate, monthKey } from '@/lib/dates';
import { isDemoUser } from '@/lib/demo-user';
import { planMonthlyBalanceSnapshots } from '@/lib/engine/networth/snapshot-plan';

export interface BalanceSnapshotWriteResult {
  /** Rows created — 0 whenever this month was already recorded. */
  written: number;
  /** The date they were stamped with, or null when nothing was written. */
  date: ISODate | null;
  /** Why nothing was written, when nothing was. Named, never folded into a bare 0. */
  skipped: 'demo' | 'already-recorded-this-month' | 'no-accounts' | null;
}

export async function recordMonthlyBalanceSnapshot(
  userId: string,
): Promise<BalanceSnapshotWriteResult> {
  if (isDemoUser(userId)) return { written: 0, date: null, skipped: 'demo' };
  const today = businessToday(userId);

  // Fast path, outside any transaction: this runs on EVERY sync and writes on at
  // most one of them a month, so the ~30 no-op calls must not each open a
  // serializable transaction on the single-writer e2e SQLite file (K.8).
  // Correctness does not rest on this read — the transaction below re-reads it.
  const claimed = await prisma.balanceSnapshot.findFirst({
    where: { account: { userId }, date: { startsWith: monthKey(today) } },
    select: { id: true },
  });
  if (claimed) return { written: 0, date: null, skipped: 'already-recorded-this-month' };

  // Serializable because the plan is a read-then-insert over the whole account
  // set, and two sync paths can run concurrently (the one-button sync fans out to
  // both providers; AutoSync fires on page load). Without it, two racers could
  // each find the month unclaimed and open two buckets a moment apart. The unique
  // ([accountId, date]) index only stops the exact-duplicate half of that.
  return serializableTx(async (tx) => {
    const accounts = await tx.account.findMany({
      where: { userId },
      select: { id: true, currentBalanceCents: true },
    });
    if (accounts.length === 0) return { written: 0, date: null, skipped: 'no-accounts' as const };

    const existing = await tx.balanceSnapshot.findMany({
      where: { account: { userId }, date: { startsWith: monthKey(today) } },
      select: { date: true },
    });
    const rows = planMonthlyBalanceSnapshots({
      accounts,
      existingSnapshotDates: existing.map((e) => e.date),
      today,
    });
    if (rows.length === 0) {
      return { written: 0, date: null, skipped: 'already-recorded-this-month' as const };
    }

    // One statement, inside the transaction: a half-written bucket is exactly the
    // understated net-worth point this feature exists to avoid.
    await tx.balanceSnapshot.createMany({ data: rows });
    return { written: rows.length, date: today, skipped: null };
  });
}
