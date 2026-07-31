import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { RecurringView } from '@/components/finance/recurring-view';
import { PROJECTIONS_STALE_PARAM } from '@/components/finance/transaction-detail-params';
import { getRecurring } from '@/server/recurring';
import { listRecurringOverrideRows } from '@/server/recurring-overrides';
import { overrideKey, verdictEffect } from '@/lib/engine/recurring/override';
import { getWithheldAccountSummary } from '@/server/transactions';
import { prisma } from '@/lib/db';

export const metadata = { title: "Recurring" };

export default async function RecurringPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  const [data, withheld, overrides, query] = await Promise.all([
    getRecurring(userId),
    getWithheldAccountSummary(userId),
    listRecurringOverrideRows(userId),
    searchParams,
  ]);
  // What each instruction is actually DOING, decided by the engine against the
  // SAME list this page renders — so "this is doing nothing" can never be claimed
  // about a payee visible three inches above it, and a declaration that detection
  // has since overtaken says so instead of claiming the reader's cadence is the
  // one being projected.
  const byKey = new Map(data.summary.items.map((i) => [overrideKey(i.merchantCanonical), i]));
  const instructions = overrides.map((o) => ({
    merchantCanonical: o.merchantCanonical,
    decision: o.decision,
    cadence: o.cadence,
    effect: verdictEffect(o.decision, o.merchantCanonical, data.summary.items),
    /** The cadence actually in force, when there is a series. */
    effectiveCadence: byKey.get(overrideKey(o.merchantCanonical))?.cadence ?? null,
  }));
  // withheld threads into the view (the #141/#145 convention) so the banner sits inside
  // the view's own max-w-xl column — no redundant wrapper, all-USD DOM byte-identical.
  return (
    <RecurringView
      data={data}
      withheld={withheld}
      instructions={instructions}
      projectionsStale={query[PROJECTIONS_STALE_PARAM] === '1'}
    />
  );
}
