/**
 * Wave B.2 — the budgeting identity on one screen (DECISIONS #377).
 * Income (computed), savings %, fixed, guilt-free remainder — each line states
 * whether the figure is the app's suggestion or the reader's.
 */
import Link from 'next/link';
import { cents, formatCents } from '@/lib/money';
import type { SpendingPlan } from '@/lib/engine/spending-plan/plan';

function incomeBasisNote(plan: SpendingPlan): string {
  if (plan.incomeBasis === 'user-set') return 'you locked this intention';
  if (plan.incomeBasis === 'trailing-median') {
    return `app calculated — median of last ${plan.incomeMonths} complete month${plan.incomeMonths === 1 ? '' : 's'}`;
  }
  if (plan.incomeBasis === 'detected-series') return 'app calculated — from detected paychecks';
  return 'no income pattern yet';
}

function fixedBasisNote(plan: SpendingPlan): string {
  if (plan.fixedBasis === 'user-set') return 'you locked this intention';
  if (plan.fixedBasis === 'category-designations') {
    return 'app calculated — Fixed categories (budget or typical), plus recurring bills not already in those categories';
  }
  if (plan.fixedBasis === 'non-discretionary-median') {
    return `app calculated — median of last ${plan.fixedMonths} month${plan.fixedMonths === 1 ? '' : 's'} of non-discretionary spend`;
  }
  if (plan.fixedBasis === 'detected-series') return 'app calculated — from recurring bills';
  return 'none counted yet';
}

function savingsNote(plan: SpendingPlan, savingsTargetBps: number | null): string {
  if (savingsTargetBps != null) {
    const pct = (savingsTargetBps / 100).toFixed(savingsTargetBps % 100 === 0 ? 0 : 2);
    return `you set ${pct}% of income${plan.savingsSource === 'goals' ? ' (goals are larger this month)' : ''}`;
  }
  if (plan.plannedSavingsCents > 0) return 'from monthly goal contributions (no % set yet)';
  return 'not set — set a % below so savings comes out before guilt-free';
}

export function BudgetingCompositionCard({
  plan,
  savingsTargetBps,
}: {
  plan: SpendingPlan;
  savingsTargetBps: number | null;
}) {
  const positive = !plan.overspent;
  return (
    <section
      className="rounded-2xl border bg-card p-5 shadow-sm"
      data-testid="budgeting-composition"
    >
      <h2 className="text-sm font-semibold">Your monthly plan</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Guilt-free = income − savings − fixed. Each line says whether the number is
        yours or the app&apos;s suggestion.
      </p>

      <dl className="mt-4 divide-y text-sm">
        <div className="flex items-start justify-between gap-3 py-2">
          <dt className="min-w-0 text-muted-foreground">
            <span className="text-foreground">Income</span>
            <span className="mt-0.5 block text-xs" data-testid="budgeting-income-basis">
              {incomeBasisNote(plan)}
            </span>
          </dt>
          <dd
            className="shrink-0 tabular-nums text-emerald-500"
            data-testid="budgeting-income"
          >
            + {formatCents(cents(plan.patternIncomeCents))}
          </dd>
        </div>

        <div className="flex items-start justify-between gap-3 py-2">
          <dt className="min-w-0 text-muted-foreground">
            <span className="text-foreground">Savings</span>
            <span className="mt-0.5 block text-xs" data-testid="budgeting-savings-basis">
              {savingsNote(plan, savingsTargetBps)}
            </span>
          </dt>
          <dd className="shrink-0 tabular-nums" data-testid="budgeting-savings">
            − {formatCents(cents(plan.plannedSavingsCents))}
          </dd>
        </div>

        <div className="flex items-start justify-between gap-3 py-2">
          <dt className="min-w-0 text-muted-foreground">
            <span className="text-foreground">Fixed expenses</span>
            <span className="mt-0.5 block text-xs" data-testid="budgeting-fixed-basis">
              {fixedBasisNote(plan)}
            </span>
          </dt>
          <dd className="shrink-0 tabular-nums" data-testid="budgeting-fixed">
            − {formatCents(cents(plan.fixedExpensesCents))}
          </dd>
        </div>

        <div className="flex items-start justify-between gap-3 py-2.5">
          <dt className="font-semibold">Guilt-free to spend</dt>
          <dd
            className={`shrink-0 text-base font-bold tabular-nums ${
              positive ? 'text-emerald-500' : 'text-rose-500'
            }`}
            data-testid="budgeting-guilt-free"
          >
            {positive
              ? formatCents(cents(plan.leftToSpendCents))
              : `Over by ${formatCents(cents(-plan.leftToSpendCents))}`}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-muted-foreground">
        Mark categories Fixed or Guilt-free below. Set a monthly target on a Fixed
        category to lock that line&apos;s amount; otherwise we use typical spend.
        Full Plan detail also lives on{' '}
        <Link
          href="/spending-plan"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Plan
        </Link>
        .
      </p>
    </section>
  );
}
