/**
 * "Did this sync change the accounts themselves?" (L.28 critic P0-1.)
 *
 * The first cut of L.28 answered "did anything change?" by summing the counters each
 * half of a sync returns, and a hostile critic proved by probe that the single biggest
 * writer in the sync reports no counter at all: `syncAccountsForItem` rewrites
 * `currentBalanceCents`, `availableBalanceCents`, `creditLimitCents`, `name`, `type`,
 * `mask`, `subtype` and `currency` on EVERY sync, and creates whole new `Account` rows,
 * and returns `void`. `syncLiabilities` likewise writes `aprBps`, `dueDayOfMonth`,
 * `cycleCloseDayOfMonth` and `minimumPaymentCents` while reporting only how many
 * STATEMENTS it wrote — and a card whose issuer sends a due date but has generated no
 * statement takes exactly that path.
 *
 * The consequence was sharpest on an INVESTMENT or LOAN account, which has no
 * transactions at all: its balance is the only thing that ever moves, so net worth,
 * /dashboard, /accounts, /trends and /reports would all have stayed stale for a full
 * page load — the same user-visible failure L.28 exists to end.
 *
 * So this does not count writers. It reads the stored rows before and after and asks
 * whether they differ, which is the same technique `derivedProjectionDigest` uses on
 * the projections, and for the same reason: an enumeration of writers is something a
 * person has to remember, and this slice began as proof that they do not.
 *
 * NO `select`, deliberately. Every column of `Account` is meaningful to some surface
 * and the model carries no `updatedAt`/`lastSyncedAt`-style column that churns on every
 * sync regardless (verified against prisma/schema.prisma), so there is nothing to
 * exclude — and a column added to the model later is covered without anyone
 * remembering this file. `id` is INCLUDED, unlike in the projection digest: account
 * rows are upserted in place rather than deleted and recreated, so an id here is stable
 * for an existing account and a new one is exactly the change we want to report.
 */
import { prisma } from '@/lib/db';

export async function accountShapeDigest(userId: string): Promise<string> {
  // Ordered by id so the comparison is over the rows, never over their arrival order.
  const accounts = await prisma.account.findMany({ where: { userId }, orderBy: { id: 'asc' } });
  return JSON.stringify(accounts);
}
