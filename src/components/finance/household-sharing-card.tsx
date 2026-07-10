'use client';

/**
 * /accounts → Household sharing (TASKS 4.2 slice 2). Two sections:
 *  - "Shared with you": READ-ONLY partner accounts (name, type, balance, owner
 *    badge). No link, no controls — partner transactions live on /transactions
 *    (slice 3); no connection/sync affordance ever appears here (T5).
 *  - "Share your accounts": per-account share toggle on the viewer's OWN
 *    accounts via `setAccountShared` (#167 reliable-mutation recipe: plain
 *    pending, deadline-bounded await, full reload on success).
 *
 * Honesty guardrails: copy states exactly what sharing reveals (name, type,
 * last 4, balance, and read-only transactions on /transactions, owner-labeled)
 * and that the partner list here shows ONLY what partners chose to share.
 * Rendered ONLY for household members — solo and demo users never see it.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { setAccountShared } from '@/server/household-actions';
import type { AccountSharingView } from '@/server/household';
import { formatCents, cents } from '@/lib/money';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

const TYPE_LABEL: Record<string, string> = {
  CHECKING: 'Checking',
  SAVINGS: 'Savings',
  CREDIT: 'Credit card',
  INVESTMENT: 'Investment',
  LOAN: 'Loan',
  REAL_ESTATE: 'Real estate',
  VEHICLE: 'Vehicle',
  CASH: 'Cash',
  OTHER_ASSET: 'Other asset',
  MORTGAGE: 'Mortgage',
  OTHER_LIABILITY: 'Other debt',
};
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t;

export function HouseholdSharingCard({
  view,
}: {
  view: Extract<AccountSharingView, { kind: 'member' }>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(accountId: string, shared: boolean) {
    if (pendingId) return;
    setError(null);
    setPendingId(accountId);
    void (async () => {
      try {
        const res = await withDeadline(setAccountShared(accountId, shared), FORM_ACTION_DEADLINE_MS);
        if (!res.ok) {
          setError(res.error);
          setPendingId(null);
          return;
        }
        window.location.reload(); // pending stays set until the new page
      } catch (e) {
        if (e instanceof ActionDeadline) {
          window.location.reload();
          return;
        }
        setError('Could not update sharing. Please try again.');
        setPendingId(null);
      }
    })();
  }

  return (
    <Card data-testid="household-sharing-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Household sharing — {view.householdName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {view.sharedWithMe.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Shared with you
            </h3>
            <ul className="mt-1 divide-y">
              {view.sharedWithMe.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 py-2"
                  data-testid="shared-account-row"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{a.name}</span>
                      <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {a.ownerLabel}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {typeLabel(a.type)}
                      {a.mask ? ` ····${a.mask}` : ''}
                    </div>
                  </div>
                  <div className={`shrink-0 tabular-nums ${a.isLiability ? 'text-red-400' : 'text-foreground'}`}>
                    {a.isLiability ? '−' : ''}
                    {formatCents(cents(a.currentBalanceCents))}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">
              Read-only balances your partner chose to share. Anything they haven&apos;t
              shared isn&apos;t shown — this is not their full picture.
            </p>
          </div>
        )}

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Share your accounts
          </h3>
          {view.mine.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Connect or add an account first — then you can share it here.
            </p>
          ) : (
            <ul className="mt-1 divide-y">
              {view.mine.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                  data-testid="own-share-row"
                >
                  <div className="min-w-0">
                    <span className="truncate text-sm font-medium">{a.name}</span>
                    <div className="text-xs text-muted-foreground">
                      {typeLabel(a.type)}
                      {a.mask ? ` ····${a.mask}` : ''}
                      {a.sharedToHousehold ? ' · shared' : ''}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={a.sharedToHousehold ? 'outline' : 'default'}
                    disabled={pendingId !== null}
                    data-testid={`account-share-toggle-${a.id}`}
                    onClick={() => toggle(a.id, !a.sharedToHousehold)}
                  >
                    {a.sharedToHousehold ? 'Stop sharing' : 'Share'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Sharing shows an account&apos;s name, type, last 4 digits, balance, and
            transactions (read-only, labeled with your name on their register) to
            everyone in your household, updated as it syncs. You can stop sharing
            anytime, and leaving the household unshares everything.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="household-sharing-error">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
