import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AccuracyCard } from '@/components/triage/accuracy-card';
import { TriageInbox } from '@/components/triage/triage-inbox';
import { getCategorizationAccuracy } from '@/server/accuracy';
import { ALL_CATEGORIES, getTriageItems } from '@/server/triage';

export default async function TriagePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const [items, accuracy] = await Promise.all([
    getTriageItems(session.user.id),
    getCategorizationAccuracy(session.user.id),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Only genuinely ambiguous transactions land here — everything else is
          filed automatically.
        </p>
      </div>
      <div className="mx-auto max-w-md space-y-4">
        <AccuracyCard result={accuracy} />
        <TriageInbox initialItems={items} categories={ALL_CATEGORIES} />
      </div>
    </div>
  );
}
