import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { TransactionDetailView } from '@/components/finance/transaction-detail-view';
// From a plain module, never from the `'use client'` view: a client module's
// exports are reference stubs on the server, so importing it there silently
// yields a non-string key (critic cycle 2, F1).
import { UNCONFIRMED_PARAM } from '@/components/finance/transaction-detail-params';
import { getVisibleGroups } from '@/server/categories';
import { getRuleSourceTransaction } from '@/server/keyword-rules';
import { getTransactionDetail } from '@/server/transactions';

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
  const detail = await getTransactionDetail(session.user.id, id);
  // An id that is not this reader's is indistinguishable from one that does not
  // exist — the same refusal `getRuleSourceTransaction` makes, so a guessed id
  // confirms nothing about whether someone else's transaction exists.
  if (!detail) notFound();

  const [categoryGroups, ruleSource] = await Promise.all([
    getVisibleGroups(session.user.id),
    // Asked rather than re-derived: the sentence explaining why a rule cannot be
    // written from this row is the rule builder's OWN predicate, which mirrors
    // `matchableWhere` field for field. A second copy here would drift the day
    // that scope changes.
    getRuleSourceTransaction(id),
  ]);

  return (
    <TransactionDetailView
      detail={detail}
      categoryGroups={categoryGroups}
      ruleExcludedReason={ruleSource?.excludedReason ?? null}
      // Set by the client when a write outran its deadline: the reload that
      // follows must not look identical to a successful save.
      unconfirmed={query[UNCONFIRMED_PARAM] === '1'}
    />
  );
}
