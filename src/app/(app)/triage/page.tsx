import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { TriageInbox } from '@/components/triage/triage-inbox';
import { ALL_CATEGORIES, getTriageItems } from '@/server/triage';

export default async function TriagePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const items = await getTriageItems(session.user.id);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Only genuinely ambiguous transactions land here — everything else is
          filed automatically.
        </p>
      </div>
      <div className="mx-auto max-w-md">
        <TriageInbox initialItems={items} categories={ALL_CATEGORIES} />
      </div>
    </div>
  );
}
