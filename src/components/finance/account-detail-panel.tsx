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
 * shape (no loan facts, and — until U.4's writer records its first month — no
 * snapshots) is renderable under test without that file's server-action import
 * graph (U.3 critic, finding #3's lock).
 *
 * CARRIED-FORWARD ROWS. U.4 records one row per account per month over EVERY
 * account, including one whose feed has gone quiet, because the trend's totals
 * must keep counting it (L.14: only the reader knows whether the account still
 * exists). That makes the list here a mix of two different things: balances the
 * bank actually sent, and the last such balance repeated monthly since. The
 * amber note above this panel already says the balance "has not changed since"
 * — printed beside an unmarked monthly list of identical dated figures, it
 * reads as evidence the app has been checking all along, which is the exact
 * inverse of the truth. So the distinction rides the ROW (the
 * a-disclosure-is-several-claims rule: carry the fact with the money), not a
 * sentence somewhere else on the page.
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
  // A row dated after the feed stopped sharing the account is the last balance
  // the bank sent, repeated — not a reading taken that day.
  const dropped = detail.feedDroppedAt;
  const carriedCount = dropped === null ? 0 : history.filter((h) => h.date > dropped).length;
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
            {history.map((h) => {
              const carriedForward = dropped !== null && h.date > dropped;
              return (
                <li key={h.date} className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
                  <span>
                    {formatISODate(isoDate(h.date), 'long')}
                    {carriedForward && (
                      <span className="ml-1 text-amber-500" data-testid="account-detail-carried">
                        carried forward
                      </span>
                    )}
                  </span>
                  <span className={`tabular-nums ${isLiability ? 'text-red-400' : ''}`}>
                    {isLiability ? '−' : ''}
                    {formatCents(cents(h.balanceCents))}
                  </span>
                </li>
              );
            })}
          </ul>
          {carriedCount > 0 && (
            <p className="mt-1 text-xs text-amber-500" data-testid="account-detail-carried-note">
              {carriedCount === 1 ? 'One row repeats' : `${carriedCount} rows repeat`} the last
              balance your bank sent, on {formatISODate(isoDate(dropped as string), 'long')} —
              nothing has been read from this account since.
            </p>
          )}
        </div>
      ) : (
        // "yet" is a real promise now, but it needs its SCOPE: U.4 claims a
        // month with the first sync in it, so an account added after that has
        // to wait for the next month — up to 31 days on the very account this
        // panel was built for (a hand-added mortgage). State the rule, not just
        // the absence (closing-a-gap rule 3).
        <p data-testid="account-detail-no-history" className="text-xs text-muted-foreground">
          No balance history recorded for this account yet — Aimplifi records one balance per
          account each month.
        </p>
      )}
    </div>
  );
}
