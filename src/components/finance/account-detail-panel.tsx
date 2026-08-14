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
 * COUNTED vs RECORDED (U.5). The list is every balance RECORDED for this
 * account; the trend on the same page counts a subset, because combining two
 * accounts drops one side of each same-dated pair. The server decides which
 * subset with the trend's own boundary and hands each row
 * `countsInNetWorth` plus the balance counted instead — this file never
 * re-derives either. Every claim about COUNTING (the reclassified note, the
 * pre-U.6 note, and the "counted as" wording of the class marker) is therefore
 * scoped to the counting rows, while the rows themselves name the figure the
 * trend used for their date. Showing an uncounted row unmarked was the U.5
 * defect; hiding it would delete a balance the bank really did send for this
 * account, and dropping its class marker would re-open the unexplained sign
 * flip U.6 closed.
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
import {
  uncountedBalanceMarker,
  uncountedBalancesNote,
} from '@/lib/engine/account/balance-history-view';
import { isCarriedForwardSnapshot } from '@/lib/engine/account/reconcile-boundary';
import { isLiabilityType, type AccountView } from '@/lib/engine/transactions/query';
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
  //
  // Each row is signed by the class IT was recorded under (U.6), never by what
  // the account is today: the providers rewrite `Account.type` on every ordinary
  // sync, and the trend on this same page counts these rows the same way. A row
  // written before that column existed (`accountType: null`) has nothing better
  // than the account's current class — the behaviour that shipped before.
  // A row dated after the feed stopped sharing the account is the last balance
  // the bank sent, repeated — not a reading taken that day.
  const dropped = detail.feedDroppedAt;
  const history = [...detail.history].reverse().map((h) => ({
    ...h,
    rowIsLiability: h.accountType === null ? isLiability : isLiabilityType(h.accountType),
    carriedForward: isCarriedForwardSnapshot(h.date, dropped),
  }));
  const carriedCount = history.filter((h) => h.carriedForward).length;
  // A row counted under a different class than the account's current one is the
  // only reason two rows here can carry different signs, so it says so on the
  // row — the unexplained sign flip is what a reader would otherwise have to
  // invent a story for (the U.4 "the fact rides the row" rule).
  //
  // The NOTE below counts only rows the app actually READ. A carried-forward row
  // is the last real reading repeated, so calling it a balance that "was
  // recorded" on its own date would attribute an observation to a day the panel
  // says — four lines away — that nothing was read on. Its marker still renders,
  // because its SIGN still needs explaining; the two markers say different
  // things and are separated so neither the eye nor a screen reader runs them
  // together.
  // U.5: the NOTES below are COUNTING claims — they say which side of net worth
  // a date lands on. A row the reconciliation boundary drops lands on NEITHER:
  // the account this one was combined with owns that date. So every counting
  // claim is scoped to the rows that count.
  //
  // The per-row class MARKER is not scoped, because it is not a counting claim:
  // it explains the row's SIGN, and an uncounted row's sign still needs
  // explaining (it says "recorded as", not "counted as"). Nor is the
  // carried-forward marker — that describes how the balance was obtained, which
  // stays true of a row nothing counts.
  const counted = history.filter((h) => h.countsInNetWorth);
  const uncounted = history.filter((h) => !h.countsInNetWorth);
  // Every row that RENDERS a class marker, counted or not — the gate for the
  // pre-U.6 note below, which exists to stop unmarked older rows reading as
  // confirmed beside visible class instability. Scoping that gate to counted
  // rows would have hidden the note on exactly the panel that shows the
  // instability on a dropped row.
  const classMarked = history.filter((h) => h.accountType !== null && h.rowIsLiability !== isLiability);
  const reclassifiedRead = classMarked.filter((h) => h.countsInNetWorth && !h.carriedForward);
  // Rows written before U.6 added the class column. They are signed by what the
  // account is TODAY — there is nothing better — and the note must not let the
  // sentence above it claim the trend is faithful to every recording when these
  // are present. An absolute is exactly what `netWorthPointBasis` was rewritten
  // to stop asserting; it must not come back one file over.
  const unrecordedClass = counted.filter((h) => h.accountType === null);
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
                <li key={h.date} className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
                  <span>
                    {formatISODate(isoDate(h.date), 'long')}
                    {h.carriedForward && (
                      <span className="ml-1 text-warning-600 dark:text-warning-400" data-testid="account-detail-carried">
                        · carried forward
                      </span>
                    )}
                    {!h.countsInNetWorth && (
                      <span
                        className="ml-1 text-muted-foreground"
                        data-testid="account-detail-not-counted"
                      >
                        {/* Deliberately NOT amber. The other two markers flag
                            something the reader may need to act on or doubt;
                            this one reports a correct de-duplication of an
                            account they themselves combined. */}
                        · {uncountedBalanceMarker(h.countedInstead)}
                      </span>
                    )}
                    {h.accountType !== null && h.rowIsLiability !== isLiability && (
                      <span className="ml-1 text-warning-600 dark:text-warning-400" data-testid="account-detail-reclassified">
                        {/* The separator is real content, not an `ml-1` margin: two
                            adjacent markers otherwise read out as one run-on token
                            ("carried forwardrecorded as checking"). `accountTypeLabel`
                            returns its input for a type it has no label for, so an
                            unrecognised value says "another type" rather than
                            printing a raw enum at the reader.

                            "counted as" vs "recorded as" (U.5): this marker
                            exists to explain the row's SIGN, which is not a
                            counting claim — deleting it from an uncounted row
                            re-opened the unexplained sign flip U.6 closed (a
                            positive figure inside a liability account's history
                            with no story). So it still renders; it just stops
                            saying the trend counts a row the trend drops. */}
                        · {h.countsInNetWorth ? 'counted' : 'recorded'} as{' '}
                        {accountTypeLabel(h.accountType) === h.accountType
                          ? 'another type'
                          : accountTypeLabel(h.accountType).toLowerCase()}
                      </span>
                    )}
                  </span>
                  <span className={`tabular-nums ${h.rowIsLiability ? 'text-red-400' : ''}`}>
                    {h.rowIsLiability ? '−' : ''}
                    {formatCents(cents(h.balanceCents))}
                  </span>
                </li>
              ))}
          </ul>
          {carriedCount > 0 && (
            <p className="mt-1 text-xs text-warning-500" data-testid="account-detail-carried-note">
              {carriedCount === 1 ? 'One row repeats' : `${carriedCount} rows repeat`} the last
              balance your bank sent, on {formatISODate(isoDate(dropped as string), 'long')} —
              nothing has been read from this account since.
            </p>
          )}
          {uncounted.length > 0 && (
            <p
              className="mt-1 break-words text-xs text-muted-foreground"
              data-testid="account-detail-not-counted-note"
            >
              {/* The mechanism once, here; the FIGURES on the rows (each dropped
                  date has its own counterpart balance — the two sides of a
                  combined pair disagree, which is why one has to win). The
                  sentence also names where the pair can be seen: the combined
                  account is folded out of the groups on this page, so its name
                  on those rows is otherwise one a reader cannot find. */}
              {uncountedBalancesNote(uncounted.length)}
            </p>
          )}
          {reclassifiedRead.length > 0 && (
            <p
              className="mt-1 text-xs text-warning-600 dark:text-warning-400"
              data-testid="account-detail-reclassified-note"
            >
              {/* What the APP did, never what was true in the world. A feed that
                  re-classes an account may be CORRECTING itself, so "you owned it
                  then" would assert the very thing in doubt; Aimplifi can only
                  say which side it counted the balance on, and who could settle
                  it. There is no control anywhere to change an existing
                  account's type, so pointing at one would be a remedy that does
                  not exist. */}
              {reclassifiedRead.length === 1
                ? 'One balance here was read'
                : `${reclassifiedRead.length} balances here were read`}{' '}
              while Aimplifi had this account classed differently, so for{' '}
              {reclassifiedRead.length === 1 ? 'that date it counts' : 'those dates they count'} on
              the {isLiability ? 'own' : 'owe'} side of your net worth instead of the{' '}
              {isLiability ? 'owe' : 'own'} side. The balance is what your bank sent; only your bank
              can say which description of the account was right at the time.
            </p>
          )}
          {/* Only alongside a known reclassification. On its own this account has
              shown no class instability, so a permanent "we don't know what these
              were read under" would fire on every live panel until a year of rows
              accrues — the note-blindness that makes the ones that matter
              invisible. Beside a reclassification it is load-bearing: THAT is
              when a reader would otherwise read the unmarked older rows as
              confirmed. */}
          {unrecordedClass.length > 0 && classMarked.length > 0 && (
            <p
              className="mt-1 text-xs text-muted-foreground"
              data-testid="account-detail-unrecorded-class-note"
            >
              {/* Named, never silent: these rows are counted by what the account
                  is TODAY, and if it has been re-classed since, that is not what
                  they were read under. Saying "the trend counts every balance the
                  way it was recorded" while these exist would be false — the
                  absolute `netWorthPointBasis` was rewritten to stop asserting. */}
              {unrecordedClass.length === 1
                ? 'One balance predates'
                : `${unrecordedClass.length} balances predate`}{' '}
              Aimplifi recording which side of your net worth an account was counted on, so{' '}
              {unrecordedClass.length === 1 ? 'it is counted' : 'they are counted'} as{' '}
              {accountTypeLabel(account.type).toLowerCase()} — the same as today.
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
