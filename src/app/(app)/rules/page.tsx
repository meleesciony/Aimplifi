import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import {
  KeywordRuleBuilder,
  type RulePrefillView,
} from '@/components/rules/keyword-rule-builder';
import { RuleInventoryList } from '@/components/rules/rule-inventory-list';
import { isInventoryListed } from '@/lib/engine/categorize/rule-inventory';
import { suggestRuleKeywords } from '@/lib/engine/categorize/rule-prefill';
import { prisma } from '@/lib/db';
import { accountLabel } from '@/lib/engine/account/display-name';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import {
  activityReturnFromBack,
  REGISTER_PATH,
  withForwardedReturn,
} from '@/lib/engine/transactions/links';
import { getVisibleGroups } from '@/server/categories';
import { getCategoryMeta } from '@/server/category-meta';
import { getRuleSourceTransaction, listKeywordRules } from '@/server/keyword-rules';
import { listRuleInventory } from '@/server/rule-inventory';
import { activeSupersededPredecessorIds } from '@/server/reconciliation';
import { HOME_NEEDS_FILE_HREF } from '@/lib/copy/home-needs-file-copy';

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
  searchParams: Promise<{ from?: string; back?: string; via?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  // O.13b — arriving from a transaction: `?from=<id>` pre-fills the key with
  // that row's own statement text. Owner: *"Having to remember which transaction
  // and how to populate them exactly as written is too cumbersome."* An id that
  // is not this reader's resolves to null and the page renders the blank builder,
  // so a guessed id leaks nothing and breaks nothing.
  // O.16 — and WHERE he was standing when he left it. Owner: *"Right now I have
  // to click activity again and needs category."* `?back=` carries the
  // register's own filter params.
  const { from, back, via } = await searchParams;
  // `?from=` only prefills. List place rides `?back=`. `via=row` means he left
  // a single-row detail page — primary Return goes there; Activity is always offered.
  const activityReturn = activityReturnFromBack(back);
  // C.15 (audit F1): the row return is a TRANSACTION destination — the id is
  // percent-encoded so a hostile `?from=` cannot inject path segments, and the
  // place the reader came from rides forward VERBATIM through
  // `withForwardedReturn` (gated: only a value that decodes gets forwarded), so
  // a triage or dashboard place survives the /rules hop into the transaction.
  const rowReturn =
    from && via === 'row'
      ? {
          href: withForwardedReturn(`/transactions/${encodeURIComponent(from)}`, back),
          label: 'this transaction',
        }
      : null;
  const source = from ? await getRuleSourceTransaction(from) : null;
  const prefill: RulePrefillView | null = source
    ? { ...source, transactionId: source.id, ...suggestRuleKeywords(source.rawDescriptor) }
    : null;

  const [categoryGroups, categoryMeta, rules, inventory, allAccounts, superseded] = await Promise.all([
    getVisibleGroups(session.user.id),
    getCategoryMeta(session.user.id),
    listKeywordRules(),
    // O.15 slice 3 — the rules the reader did NOT type: every one minted by tapping
    // "Always" while filing a transaction, plus any stored row the engine has
    // stopped running. Both were invisible and undeletable before this page read
    // them, while the engine went on loading every one of them.
    listRuleInventory(),
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

  // One name lookup for both the rule list and the confirmation sentence.
  //
  // Built from the picker set PLUS the reader's full per-user meta. The picker
  // alone was the original rule ("a rule can never display a name the reader
  // could not have chosen") and it broke the moment a category could be REMOVED:
  // a still-firing rule pointing at a removed category fell through to the raw
  // slug, so /rules read "Always file STARBUCKS as dining-out". A rule that is
  // filing money must name its destination in words, whether or not that
  // category is still offered in a picker — the meta is the reader's own
  // vocabulary either way, so this cannot show a name they never saw.
  const categoryNameById = Object.fromEntries([
    ...[...categoryMeta].map(([id, m]) => [id, m.name] as const),
    ...categoryGroups.flatMap((g) => g.categories.map((c) => [c.id, c.name] as const)),
  ]);

  return (
    <div className="space-y-4">
      {/*
        Owner 2026-08-03: if he was on a single row, Return goes there; there is
        always also a button to the Activity list for that place. Deliberately
        not a redirect on save — confirmation stays on screen.
      */}
      <div className="flex flex-wrap items-center gap-2">
        {rowReturn ? (
          <>
            <Link
              href={rowReturn.href}
              data-testid="rules-return-link"
              className="tap-target inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <span aria-hidden="true">&larr;</span> Return to {rowReturn.label}
            </Link>
            <Link
              href={activityReturn.href}
              data-testid="rules-return-activity-link"
              className="tap-target inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Return to {activityReturn.label}
            </Link>
          </>
        ) : (
          <Link
            href={activityReturn.href}
            data-testid="rules-return-link"
            className="tap-target inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <span aria-hidden="true">&larr;</span> Return to {activityReturn.label}
          </Link>
        )}
        {activityReturn.href !== REGISTER_PATH && (
          <Link
            href={REGISTER_PATH}
            data-testid="rules-return-activity-home"
            className="tap-target inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            All Activity
          </Link>
        )}
      </div>

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

      {/*
        The partition between the two lists is ONE predicate in the engine
        (`isInventoryListed`), not a filter written here: the builder above renders
        the reader's active typed rules, this renders everything else, and an
        integration test proves the union is exactly the set the categorizer loads.
      */}
      <RuleInventoryList
        entries={inventory.entries.filter(isInventoryListed)}
        categoryNameById={categoryNameById}
        accountNameById={inventory.accountNameById}
        hasLearnedRules={inventory.hasLearnedRules}
        isDemo={inventory.isDemo}
      />

      <p className="text-xs text-muted-foreground">
        Looking for a single transaction instead?{' '}
        <Link href="/transactions" className="underline underline-offset-2 hover:text-foreground">
          The transaction list
        </Link>{' '}
        still lets you file one row at a time.{' '}
        <Link href={HOME_NEEDS_FILE_HREF} className="underline underline-offset-2 hover:text-foreground">
          Needs a category
        </Link>{' '}
        lists rows with no category.{' '}
        <Link href="/triage" className="underline underline-offset-2 hover:text-foreground">
          Inbox
        </Link>{' '}
        groups merchants the auto-file was unsure about.
      </p>
    </div>
  );
}
