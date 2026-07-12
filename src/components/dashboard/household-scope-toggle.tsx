/**
 * Joint cash-needed scope toggle (TASKS 4.2 slice 4, HOUSEHOLD_ARCHITECTURE §4.4).
 * Plain Links (no client JS) so the toggle survives with JS disabled; renders
 * only when the viewer has a household with at least one live partner —
 * otherwise there is nothing a "household" scope could ever add.
 *
 * The assumptions line is the honesty guardrail (§4.4): the joint number must
 * never silently imply completeness. A partner's UNSHARED card debt is
 * invisible by design, and the copy says so on every render of this scope.
 *
 * `basePath` + `extraParams` (TASKS 4.2 slice 5): shared verbatim across
 * /dashboard, /cards, and /calendar — /calendar also carries its `month`
 * searchParam through both links so switching scope never resets navigation.
 */
import Link from 'next/link';
import { HOUSEHOLD_COPY } from '@/lib/copy/household-copy';
import { cn } from '@/lib/utils';

function hrefFor(basePath: string, extraParams: Record<string, string>, scope?: 'household') {
  const params = new URLSearchParams(extraParams);
  if (scope) params.set('scope', scope);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function HouseholdScopeToggle({
  scope,
  householdName,
  basePath,
  extraParams = {},
}: {
  scope: 'mine' | 'household';
  householdName: string;
  basePath: string;
  extraParams?: Record<string, string>;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="household-scope-toggle">
      <div className="inline-flex w-fit rounded-md border p-0.5" role="group" aria-label="Cash-needed scope">
        <Link
          href={hrefFor(basePath, extraParams)}
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
          href={hrefFor(basePath, extraParams, 'household')}
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
          {HOUSEHOLD_COPY.scopeAssumptions()}
        </p>
      )}
    </div>
  );
}
