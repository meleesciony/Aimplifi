import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CATEGORIES, categoryName } from '@/lib/engine/categorize/categories';
import { isBudgetable, netSpendByCategory, summarizeBudgets } from '@/lib/engine/budgets/status';
import { parseStoredDials } from '@/lib/engine/settings/dials';
import { cents, formatCents } from '@/lib/money';
import { getProvider } from '@/lib/providers/demo';
import { prisma } from '@/lib/db';
import { clearBudget, setBudget } from '@/server/budget-actions';

const CATEGORY_OPTIONS = CATEGORIES.filter((c) => isBudgetable(c.id));

/**
 * Budgets (Phase 4 + ROADMAP #7) — conscious-spending style: actuals by category
 * for the current month against optional, user-set monthly targets. The status
 * math lives in src/lib/engine/budgets/status.ts; this page only renders it and
 * posts target edits. No guilt meters; money-dial categories are labeled, not policed.
 */
export default async function BudgetsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  const provider = getProvider();
  const today = provider.today(userId);
  const month = today.slice(0, 7);

  const [txns, budgets, user] = await Promise.all([
    // All non-transfer, non-split, posted activity this month (BOTH signs) so the
    // engine can net refunds against spend — outflow-only would overstate it.
    prisma.transaction.findMany({
      where: {
        account: { userId },
        date: { startsWith: month },
        isTransfer: false,
        isSplitParent: false,
        status: 'POSTED',
      },
      select: { categoryId: true, amountCents: true },
    }),
    prisma.budget.findMany({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);

  const dials = new Set<string>(parseStoredDials(user?.moneyDials));
  const budgetByCategory = new Map(budgets.map((b) => [b.categoryId, b.monthCents]));
  const spendByCategory = netSpendByCategory(txns);

  const rows = summarizeBudgets(spendByCategory, budgetByCategory, {
    name: categoryName,
    isDial: (id) => dials.has(categoryName(id)),
  });

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
            {rows.map((row) => (
              <li key={row.categoryId} className="space-y-1" data-testid={`budget-row-${row.categoryId}`}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    {row.name}
                    {row.isDial && (
                      <span className="ml-1 text-xs text-emerald-500" title="A money dial — spend here proudly">
                        ◉ dial
                      </span>
                    )}
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="tabular-nums">
                      {formatCents(cents(row.spentCents))}
                      {row.budgetCents !== null && (
                        <span className="text-muted-foreground"> / {formatCents(cents(row.budgetCents))}</span>
                      )}
                    </span>
                    {row.budgetCents !== null && (
                      <form
                        action={async () => {
                          'use server';
                          await clearBudget(row.categoryId);
                        }}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          type="submit"
                          aria-label={`Clear target for ${row.name}`}
                          data-testid={`budget-clear-${row.categoryId}`}
                          className="h-6 px-1 text-xs text-muted-foreground"
                        >
                          Clear
                        </Button>
                      </form>
                    )}
                  </span>
                </div>
                {row.pct !== null && row.remainingCents !== null && (
                  <>
                    <div
                      className="h-1.5 w-full rounded-full bg-accent"
                      role="progressbar"
                      aria-valuenow={row.pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${row.name} budget used`}
                    >
                      <div
                        className={`h-1.5 rounded-full ${row.over ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${row.pct}%` }}
                      />
                    </div>
                    <p className={`text-xs ${row.over ? 'text-amber-500' : 'text-muted-foreground'}`}>
                      {row.over
                        ? `${formatCents(cents(-row.remainingCents))} over target`
                        : `${formatCents(cents(row.remainingCents))} left this month`}
                    </p>
                  </>
                )}
              </li>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground">No spending recorded yet this month.</p>
            )}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            A conscious-spending view, not a guilt meter: money-dial categories are where
            spending buys you the most life.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Optional — a target you choose, not a rule imposed</CardDescription>
          <CardTitle className="text-base">Set a monthly target</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={setBudget} className="flex flex-wrap items-end gap-2" data-testid="budget-target-form">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Category
              <select
                name="categoryId"
                required
                data-testid="budget-category"
                className="h-9 w-44 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Monthly $
              <input
                name="amount"
                required
                inputMode="decimal"
                placeholder="500"
                data-testid="budget-amount"
                className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              />
            </label>
            <Button type="submit" size="sm" data-testid="budget-set">
              Set target
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Setting a target just adds a progress bar — it never blocks spending or judges a
            category. Clear it anytime.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
