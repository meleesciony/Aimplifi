import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { KeywordRuleBuilder } from '@/components/rules/keyword-rule-builder';
import { getVisibleGroups } from '@/server/categories';
import { listKeywordRules } from '@/server/keyword-rules';

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
export default async function RulesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const [categoryGroups, rules] = await Promise.all([
    getVisibleGroups(session.user.id),
    listKeywordRules(),
  ]);

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
          Tell Aimplifi how to file a transaction and it will do exactly that — no guessing. Useful when
          the bank text changes every time: a fund name, a store number, or a transaction id that never
          repeats.
        </p>
      </div>

      <KeywordRuleBuilder
        categoryGroups={categoryGroups}
        rules={rules}
        categoryNameById={categoryNameById}
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
