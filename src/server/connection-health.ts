/**
 * Connection-health server read (Competitive-Gap plan, Gap 1 §3–4).
 *
 * Grades how current the user's *linked* (auto-syncing) bank feed is, against business
 * "today". Manual and demo accounts are excluded — they never sync, so they can never be
 * "stale" (this is also why the seeded demo user, whose accounts are all provider 'demo',
 * never sees the banner: golden-safe by construction).
 *
 * The freshness reference is the MOST RECENT of two signals: the last time a sync RAN (the
 * SimpleFIN connection's lastSyncedAt) and the newest transaction across the linked
 * accounts. Preferring the more recent kills a false positive the newest-transaction signal
 * alone produces — a healthy feed that simply had no new activity for a while (a quiet
 * savings account) — because a recent successful sync proves the connection is live. Plaid
 * has no sync-timestamp here, so a Plaid-only user falls back to newest-transaction.
 *
 * The pure grading lives in engine/sync/health.ts; this module only supplies the
 * ownership-scoped data.
 */
import { prisma } from '@/lib/db';
import { businessToday } from '@/lib/business-today';
import { isoDate } from '@/lib/dates';
import { type DataFreshnessSummary, mostRecentDate, summarizeDataFreshness } from '@/lib/engine/sync/health';

/** Providers whose data arrives via an automated feed (so staleness is meaningful). */
const LINKED_PROVIDERS = ['plaid', 'simplefin'];

export async function getDataFreshness(userId: string): Promise<DataFreshnessSummary> {
  const today = businessToday(userId);

  const linked = await prisma.account.findMany({
    where: { userId, provider: { in: LINKED_PROVIDERS } },
    select: { id: true },
  });
  if (linked.length === 0) return summarizeDataFreshness(null, today);

  const [newest, sfConn] = await Promise.all([
    prisma.transaction.findFirst({
      where: { accountId: { in: linked.map((a) => a.id) } },
      orderBy: { date: 'desc' },
      select: { date: true },
    }),
    prisma.simpleFinConnection.findUnique({ where: { userId }, select: { lastSyncedAt: true } }),
  ]);

  const reference = mostRecentDate(
    sfConn?.lastSyncedAt ? isoDate(sfConn.lastSyncedAt) : null,
    newest ? isoDate(newest.date) : null,
  );
  return summarizeDataFreshness(reference, today);
}
