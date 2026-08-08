/**
 * The sentence a connection's history depth renders as (TASKS H.1(b)).
 *
 * A pure module and not a helper inside `plaid-connections.tsx`, for the reason
 * the copy critic executed: importing that component under vitest fails outright
 * (`Cannot find module 'next/server'` via next-auth) unless the whole server
 * action module is stubbed, so a sentence living there is invisible to the
 * ~6,000-test unit gate and only `VERIFY_E2E=1` can ever catch a wrong one. The
 * repo already has three precedents for putting connection copy in `src/lib`
 * (`continued-accounts-view.ts`, `combine-connections-copy.ts`,
 * `account-cleanup.ts`); this follows them.
 *
 * Every sentence here is a CLAIM, and each was rewritten after a critic proved
 * the obvious phrasing false — see the notes on each branch.
 */
import { ACCOUNT_CLEANUP_HEADING } from '@/lib/engine/account/account-cleanup';
import type { ConnectionDepth } from '@/lib/engine/account/connection-depth';
import { formatISODate, isoDate } from '@/lib/dates';

export function connectionDepthSentence(depth: ConnectionDepth): string {
  switch (depth.state) {
    case 'reaches':
      // "History available from" — the register's own words for the same kind of
      // claim (`transaction-filters.tsx`), not a second phrasing for it. The date
      // shape is `formatISODate(_, 'long')`, the app's one UI-boundary formatter;
      // its weekday is redundant here, but 'short' drops the YEAR, which is the
      // one part a depth claim cannot lose, and a fourth date format two lines
      // from the register's would be the worse defect.
      return `History available from ${formatISODate(isoDate(depth.earliest), 'long')}.`;
    case 'counted-elsewhere':
      // Says the DATES belong elsewhere, not that the transactions are counted
      // elsewhere. R1 is a calendar-window rule, so a dropped row need not have a
      // counterpart on the other side — the data-integrity critic executed the
      // case where the register showed the row on neither account, which "counted
      // on the other account" would have claimed falsely.
      //
      // "another account", unnamed and singular-by-distribution, because the copy
      // critic executed three shapes where a named singular is wrong: a mid-chain
      // account whose rows go to two DIFFERENT accounts in opposite directions,
      // two sibling predecessors claiming one successor, and a multi-account
      // connection each of whose accounts was combined with a different one.
      //
      // It points at "Account cleanup" because that disclosure is the only place
      // the pairing is named — and it renders COLLAPSED, so without this pointer
      // the sentence uses a word ("combined") the visible page never defines.
      return `No history of its own — every date it covers belongs to another account. See "${ACCOUNT_CLEANUP_HEADING}" on this page.`;
    case 'balances-only':
      // Investment, loan and mortgage accounts never send transactions — no
      // `/investments/transactions` ingest exists in the app at all. Four of the
      // owner's thirteen live connections are exactly this, and every one of them
      // was being told "No transactions yet." while syncing cleanly that morning.
      return "Balances only — investment, loan and mortgage accounts don't send transactions.";
    case 'not-counted':
      // The currency guard (#135) withholds non-USD accounts from every figure on
      // this page. Matches the wording the withheld-accounts disclosure already
      // uses, and never denies rows the card names one line above.
      return "Not counted here — these accounts aren't in U.S. dollars.";
    case 'no-rows':
      // Now literally true: a spending account, in a counted currency, that has
      // not delivered a transaction yet. "Yet" is a promise, and it only appears
      // where something can actually arrive.
      return 'No transactions yet.';
  }
}
