import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AccuracyCard } from '@/components/triage/accuracy-card';
import { BackfillButton } from '@/components/triage/backfill-button';
import { TriageInbox } from '@/components/triage/triage-inbox';
import { getCategorizationAccuracy } from '@/server/accuracy';
import { getTriageGroups } from '@/server/triage';
import { getVisibleCategories } from '@/server/categories';

export const metadata = { title: "Review" };

export default async function TriagePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const [groups, accuracy, categories] = await Promise.all([
    getTriageGroups(session.user.id), // merchant-group queue (Phase 3c, DECISIONS #143)
    getCategorizationAccuracy(session.user.id),
    getVisibleCategories(session.user.id),
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
      <div className="mx-auto max-w-md space-y-4">
        <AccuracyCard result={accuracy} />
        <TriageInbox initialGroups={groups} categories={categories} />
      </div>
    </div>
  );
}
