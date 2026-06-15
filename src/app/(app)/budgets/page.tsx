import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CATEGORY_BY_ID, categoryName } from '@/lib/engine/categorize/categories';
import { parseStoredDials } from '@/lib/engine/settings/dials';
import { cents, formatCents } from '@/lib/money';
import { getProvider } from '@/lib/providers/demo';
import { prisma } from '@/lib/db';

/**
 * Budgets (Phase 4) — conscious-spending style: actuals by category for the
 * current month against optional targets. No guilt meters; money-dial
 * categories are labeled, not policed.
 */
export default async function BudgetsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  const provider = getProvider();
  const today = provider.today();
  const month = today.slice(0, 7);

  const [txns, budgets, user] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        account: { userId },
        date: { startsWith: month },
        isTransfer: false,
        isSplitParent: false,
        status: 'POSTED', // same inclusion rule as every other aggregation
        amountCents: { lt: 0 },
      },
    }),
    prisma.budget.findMany({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);

  const dials = new Set<string>(parseStoredDials(user?.moneyDials));
  const budgetByCategory = new Map(budgets.map((b) => [b.categoryId, b.monthCents]));

  const spendByCategory = new Map<string, number>();
  for (const t of txns) {
    const cat = t.categoryId ?? 'uncategorized';
    spendByCategory.set(cat, (spendByCategory.get(cat) ?? 0) - t.amountCents);
  }
  const rows = [...spendByCategory.entries()]
    .map(([categoryId, spentCents]) => ({
      categoryId,
      name: categoryName(categoryId),
      spentCents,
      budgetCents: budgetByCategory.get(categoryId) ?? null,
      isDial: dials.has(categoryName(categoryId)),
    }))
    .sort((a, b) => b.spentCents - a.spentCents);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Spending this month</h1>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{month} · transfers excluded</CardDescription>
          <CardTitle className="text-base">By category</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2" data-testid="budget-list">
            {rows.map((row) => {
              const over = row.budgetCents !== null && row.spentCents > row.budgetCents;
              const pct =
                row.budgetCents !== null
                  ? Math.min(100, Math.round((row.spentCents / row.budgetCents) * 100))
                  : null;
              return (
                <li key={row.categoryId} className="space-y-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span>
                      {row.name}
                      {row.isDial && (
                        <span className="ml-1 text-xs text-emerald-500" title="A money dial — spend here proudly">
                          ◉ dial
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">
                      {formatCents(cents(row.spentCents))}
                      {row.budgetCents !== null && (
                        <span className="text-muted-foreground"> / {formatCents(cents(row.budgetCents))}</span>
                      )}
                    </span>
                  </div>
                  {pct !== null && (
                    <div className="h-1.5 w-full rounded-full bg-accent">
                      <div
                        className={`h-1.5 rounded-full ${over ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground">No spending recorded yet this month.</p>
            )}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            {CATEGORY_BY_ID.size > 0 &&
              'A conscious-spending view, not a guilt meter: money-dial categories are where spending buys you the most life.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
