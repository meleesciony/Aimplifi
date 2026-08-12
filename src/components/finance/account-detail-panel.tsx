/**
 * The in-place answer to clicking a LOAN / MORTGAGE / other non-register
 * account on /accounts (owner, 2026-08-11: his mortgage's row landed on an
 * empty /transactions — the U.3 slice). Renders ONLY facts the app holds: the
 * account's role in net worth, the loan terms the feed supplied (each line
 * absent when the fact is), and the recorded balance history — the same
 * BalanceSnapshot store the page's net-worth trend is drawn from. Balances
 * are painted with the SAME sign convention as the row's own figure
 * (`isLiability` → −), so the panel can never call the balance a different
 * number than the line the reader tapped.
 *
 * Its own module rather than a corner of accounts-list.tsx so the REAL-user
 * shape (no snapshots — only the seed writes them, TASKS U.4 — and no loan
 * facts) is renderable under test without that file's server-action import
 * graph (U.3 critic, finding #3's lock).
 */
import { cents, formatCents } from '@/lib/money';
import { formatISODate, isoDate } from '@/lib/dates';
import { accountTypeLabel } from '@/lib/engine/account/type-label';
import type { AccountView } from '@/lib/engine/transactions/query';
import type { AccountDetailView } from '@/server/transactions';

export function AccountDetailPanel({
  account,
  isLiability,
  detail,
}: {
  account: AccountView;
  isLiability: boolean;
  detail: AccountDetailView;
}) {
  const loanFacts: string[] = [];
  if (detail.aprBps !== null) loanFacts.push(`APR ${(detail.aprBps / 100).toFixed(2)}%`);
  if (detail.minimumPaymentCents !== null)
    loanFacts.push(`minimum payment ${formatCents(cents(detail.minimumPaymentCents))}`);
  if (detail.dueDayOfMonth !== null) loanFacts.push(`due on day ${detail.dueDayOfMonth} of the month`);
  // Newest first: the reader's question is "where is it NOW and how has it
  // moved" — and the full recorded set renders (scroll past ten), never a
  // silently-capped slice (the O.20f no-silent-caps rule).
  const history = [...detail.history].reverse();
  return (
    <div
      id={`account-detail-${account.id}`}
      data-testid="account-detail-panel"
      className="mx-3 mb-2 space-y-2 rounded-md border bg-accent/30 p-3 text-sm"
    >
      <p className="text-muted-foreground">
        {accountTypeLabel(account.type)} — counts toward your net worth as money you{' '}
        {isLiability ? 'owe' : 'own'}. Day-to-day transactions come from checking, savings, and
        card accounts, so this account is tracked by its balance instead of an activity feed.
      </p>
      {loanFacts.length > 0 && (
        <p data-testid="account-detail-loan-facts">
          {/* Capitalize the first fact; the rest read as a sentence. */}
          {loanFacts.join(' · ').replace(/^./, (c) => c.toUpperCase())}.
        </p>
      )}
      {history.length > 0 ? (
        <div data-testid="account-detail-history">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Recorded balance history</p>
          <ul className="max-h-48 divide-y overflow-y-auto rounded border">
            {history.map((h) => (
              <li key={h.date} className="flex items-center justify-between px-2 py-1 text-xs">
                <span>{formatISODate(isoDate(h.date), 'long')}</span>
                <span className={`tabular-nums ${isLiability ? 'text-red-400' : ''}`}>
                  {isLiability ? '−' : ''}
                  {formatCents(cents(h.balanceCents))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        // A fact, not a promise: today only the seed writes balance
        // snapshots, so a live synced account truthfully has none recorded.
        <p data-testid="account-detail-no-history" className="text-xs text-muted-foreground">
          No balance history recorded for this account yet.
        </p>
      )}
    </div>
  );
}
