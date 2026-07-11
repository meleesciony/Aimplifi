/**
 * Joint cash-needed scope toggle (TASKS 4.2 slice 4, HOUSEHOLD_ARCHITECTURE §4.4).
 * Plain Links (no client JS) so the toggle survives with JS disabled; renders
 * only when the viewer has a household with at least one live partner —
 * otherwise there is nothing a "household" scope could ever add.
 *
 * The assumptions line is the honesty guardrail (§4.4): the joint number must
 * never silently imply completeness. A partner's UNSHARED card debt is
 * invisible by design, and the copy says so on every render of this scope.
 */
import Link from 'next/link';
import { cn } from '@/lib/utils';

export function HouseholdScopeToggle({
  scope,
  householdName,
}: {
  scope: 'mine' | 'household';
  householdName: string;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="household-scope-toggle">
      <div className="inline-flex w-fit rounded-md border p-0.5" role="group" aria-label="Cash-needed scope">
        <Link
          href="/dashboard"
          data-testid="scope-mine"
          aria-current={scope === 'mine' ? 'true' : undefined}
          className={cn(
            'rounded-sm px-2.5 py-1',
            scope === 'mine' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Just me
        </Link>
        <Link
          href="/dashboard?scope=household"
          data-testid="scope-household"
          aria-current={scope === 'household' ? 'true' : undefined}
          className={cn(
            'rounded-sm px-2.5 py-1',
            scope === 'household' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {householdName}
        </Link>
      </div>
      {scope === 'household' && (
        <p className="text-xs text-muted-foreground" data-testid="household-scope-assumptions">
          Household scope: includes your accounts and accounts your partner has shared.
          Anything not shared isn&apos;t counted.
        </p>
      )}
    </div>
  );
}
