import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { TransactionDetailView } from '@/components/finance/transaction-detail-view';
// From a plain module, never from the `'use client'` view: a client module's
// exports are reference stubs on the server, so importing it there silently
// yields a non-string key (critic cycle 2, F1).
import { PROJECTIONS_STALE_PARAM, UNCONFIRMED_PARAM } from '@/components/finance/transaction-detail-params';
import { getVisibleGroups } from '@/server/categories';
import { getRuleSourceTransaction } from '@/server/keyword-rules';
import { getTransactionDetail } from '@/server/transactions';
import { getRecurringVerdictForTransaction } from '@/server/recurring-overrides';
import { listAttachmentsForTransaction } from '@/server/attachments';
import { listTxnMoveAccounts } from '@/server/txn-move-accounts';
import { RETURN_PARAM, returnFromBack } from '@/lib/engine/transactions/links';
import { isDemoUser } from '@/lib/demo-user';

export const metadata = { title: 'Transaction' };

/**
 * One transaction, in one place (TASKS O.13b) — the acute half of the owner's
 * complaint: *"Currently we can't even solve the transaction list."*
 *
 * Until this page, a row's fields were spread across surfaces that could not all
 * be reached from the register: category and note/tax through inline popovers,
 * SPLIT only from the triage inbox, and the raw statement text — the string a
 * rule matches against — on no reachable screen at all for an already-filed row.
 *
 * `/transactions/new` and `/transactions/import` are static segments and so
 * still win over this dynamic one; a cuid can never collide with them.
 */
export default async function TransactionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const [{ id }, query] = await Promise.all([params, searchParams]);
  // The raw `?back=` this page was entered with — the source for both the
  // named return (below) and the waypoint links the view forwards.
  const rawBack = Array.isArray(query[RETURN_PARAM])
    ? query[RETURN_PARAM][0]
    : (query[RETURN_PARAM] ?? null);
  const detail = await getTransactionDetail(session.user.id, id);
  // An id that is not this reader's is indistinguishable from one that does not
  // exist — the same refusal `getRuleSourceTransaction` makes, so a guessed id
  // confirms nothing about whether someone else's transaction exists.
  if (!detail) notFound();

  const [categoryGroups, ruleSource, recurringVerdict, attachments, accounts] = await Promise.all([
    getVisibleGroups(session.user.id),
    // Asked rather than re-derived: the sentence explaining why a rule cannot be
    // written from this row is the rule builder's OWN predicate, which mirrors
    // `matchableWhere` field for field. A second copy here would drift the day
    // that scope changes.
    getRuleSourceTransaction(id),
    // O.13f: what the reader has already said about this payee, read back through
    // the engine's own parser so the screen cannot show an instruction the
    // detector would ignore.
    getRecurringVerdictForTransaction(session.user.id, id),
    // O.13h — METADATA only; the files themselves are fetched one at a time by
    // `/api/attachments/<id>`, so opening this page never reads a byte of one.
    listAttachmentsForTransaction(session.user.id, id),
    listTxnMoveAccounts(session.user.id, detail.row.accountId),
  ]);

  return (
    <TransactionDetailView
      detail={detail}
      categoryGroups={categoryGroups}
      ruleExcludedReason={ruleSource?.excludedReason ?? null}
      // Set by the client when a write outran its deadline: the reload that
      // follows must not look identical to a successful save.
      unconfirmed={query[UNCONFIRMED_PARAM] === '1'}
      recurringVerdict={recurringVerdict}
      // The verdict saved, but the rebuild that carries it to the cash surfaces
      // did not run — so this page may not promise that they moved.
      projectionsStale={query[PROJECTIONS_STALE_PARAM] === '1'}
      // O.16 / C.15 — the reader's place rides `?back=`: a register view
      // (sentinel when unfiltered), a NAMED page (triage, dashboard, an
      // expander's host), or a transaction id. Always a named return — never
      // null — so the detail page always offers the way back for that row's
      // context (owner 2026-08-03).
      //
      // The RAW value is passed down as well: the detail page's waypoint links
      // (rules, rename, split parent) forward it VERBATIM, and it must be a
      // server-side prop — a `window.location` read renders the Activity
      // sentinel on first paint and a fast click carries it (measured: the
      // O.16 e2e caught exactly that race on C.15's first gate run).
      returnTo={returnFromBack(rawBack)}
      rawBack={rawBack}
      attachments={attachments}
      accounts={accounts}
      canEditSpendClass={!isDemoUser(session.user.id)}
    />
  );
}
