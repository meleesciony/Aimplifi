import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import { EmptyTriage } from '@/components/onboarding/route-empty';
import { AccuracyCard } from '@/components/triage/accuracy-card';
import { BackfillButton } from '@/components/triage/backfill-button';
import { TriageInbox } from '@/components/triage/triage-inbox';
import { prisma } from '@/lib/db';
import { getCategorizationAccuracy } from '@/server/accuracy';
import { getTriageGroups } from '@/server/triage';
import { getVisibleCategories } from '@/server/categories';
import { getWithheldAccountSummary } from '@/server/transactions';

export const metadata = { title: "Review" };

export default async function TriagePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  // Zero-account first-run → the branded connect empty every sibling route has
  // (2026-07-21 agent review A3): a bare empty inbox reads as "nothing to do",
  // not "not set up yet". Same USD-or-null gate as cards/coach/goals/calendar.
  if ((await prisma.account.count({ where: { userId: session.user.id, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyTriage />;
  const [groups, accuracy, categories, withheld] = await Promise.all([
    getTriageGroups(session.user.id), // merchant-group queue (Phase 3c, DECISIONS #143)
    getCategorizationAccuracy(session.user.id),
    getVisibleCategories(session.user.id),
    getWithheldAccountSummary(session.user.id),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            Only genuinely ambiguous transactions land here — everything else is
            filed automatically.
          </p>
        </div>
        <BackfillButton />
      </div>
      {/* currency-guard disclosure (#135 residual): withheld non-USD accounts must not
          vanish silently. Renders nothing for all-USD users (the overwhelming case). */}
      <CurrencyExclusionBanner summary={withheld} />
      <div className="mx-auto max-w-md space-y-4">
        <AccuracyCard result={accuracy} />
        <TriageInbox initialGroups={groups} categories={categories} />
      </div>
    </div>
  );
}
