import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import {
  KeywordRuleBuilder,
  type RulePrefillView,
} from '@/components/rules/keyword-rule-builder';
import { suggestRuleKeywords } from '@/lib/engine/categorize/rule-prefill';
import { prisma } from '@/lib/db';
import { accountLabel } from '@/lib/engine/account/display-name';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { getVisibleGroups } from '@/server/categories';
import { getRuleSourceTransaction, listKeywordRules } from '@/server/keyword-rules';
import { activeSupersededPredecessorIds } from '@/server/reconciliation';

export const metadata = { title: 'Rules' };

/**
 * Categorization rules the reader WRITES (TASKS O.13a).
 *
 * Owner, repeatedly, most recently with a screenshot of three Cardone deposits:
 * *"Build the categorizer so I can group all 'Cardone' into income. I've clicked
 * many of these already and categorized. The system clearly isn't smart enough to
 * identify trends."*
 *
 * The reason his clicks never generalized is visible in the descriptors
 * themselves — `Cardone Eq Fund Cef Xv Ppd ~ Tran: …` and `Cardone Equity F Cef Ix
 * Ppd ~ Tran: …` are, to every DERIVED key this app has (merchant canonical,
 * descriptor signature), two unrelated payees that will each never be seen again.
 * The app was built to infer identity and had no surface for being TOLD one. This
 * page is that surface.
 */
export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  // O.13b — arriving from a transaction: `?from=<id>` pre-fills the key with
  // that row's own statement text. Owner: *"Having to remember which transaction
  // and how to populate them exactly as written is too cumbersome."* An id that
  // is not this reader's resolves to null and the page renders the blank builder,
  // so a guessed id leaks nothing and breaks nothing.
  const { from } = await searchParams;
  const source = from ? await getRuleSourceTransaction(from) : null;
  const prefill: RulePrefillView | null = source
    ? { ...source, transactionId: source.id, ...suggestRuleKeywords(source.rawDescriptor) }
    : null;

  const [categoryGroups, rules, allAccounts, superseded] = await Promise.all([
    getVisibleGroups(session.user.id),
    listKeywordRules(),
    // For the optional "only in this account" condition (O.13c) — the superseded
    // filter the add-transaction page uses, so the picker never offers a read-only
    // predecessor no new row will ever land on, AND the population
    // `matchableWhere` actually covers (critic cycle 1, P2-6): offering a
    // brokerage or a EUR account would scope a rule the preview could only ever
    // report as matching nothing, because those rows are withheld from the
    // register and the inbox by DECISIONS #135. `displayName` comes along so the
    // picker and the rule list say what the reader named the account, not what
    // the bank calls it (P2-11 — `accountLabel` is the one rule for that).
    prisma.account.findMany({
      where: {
        userId: session.user.id,
        type: { in: [...SPENDING_ACCOUNT_TYPES] },
        OR: [{ currency: 'USD' }, { currency: null }],
      },
      select: { id: true, name: true, displayName: true, type: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    activeSupersededPredecessorIds([session.user.id]),
  ]);
  const accounts = allAccounts
    .filter((a) => !superseded.has(a.id))
    .map((a) => ({ id: a.id, name: accountLabel(a) }));

  // One name lookup for both the rule list and the confirmation sentence, built
  // from the SAME set the picker offers — so a rule can never display a name the
  // reader could not have chosen.
  const categoryNameById = Object.fromEntries(
    categoryGroups.flatMap((g) => g.categories.map((c) => [c.id, c.name] as const)),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Rules</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell Aimplifi how to file a transaction and it follows the words you typed rather than
          guessing at the payee. Useful when the bank text changes every time: a fund name, a store
          number, or a transaction id that never repeats. A rule does not override a payment detected as
          a transfer between two of your own accounts.
        </p>
      </div>

      <KeywordRuleBuilder
        categoryGroups={categoryGroups}
        rules={rules}
        categoryNameById={categoryNameById}
        accounts={accounts}
        prefill={prefill}
      />

      <p className="text-xs text-muted-foreground">
        Looking for a single transaction instead?{' '}
        <Link href="/transactions" className="underline underline-offset-2 hover:text-foreground">
          The transaction list
        </Link>{' '}
        still lets you file one row at a time, and{' '}
        <Link href="/triage" className="underline underline-offset-2 hover:text-foreground">
          the inbox
        </Link>{' '}
        groups what still needs a category.
      </p>
    </div>
  );
}
