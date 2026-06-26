import Link from 'next/link';
import { Gauge } from 'lucide-react';
import { cents, formatCents } from '@/lib/money';
import type { SpendingPlan } from '@/lib/engine/spending-plan/plan';

/**
 * Dashboard summary of the Spending Plan (DECISIONS #66) — the "safe to spend"
 * number at a glance, linking through to the full plan. Tappable card, so the
 * whole thing is the affordance (no nested interactive elements).
 */
export function SafeToSpendCard({ plan }: { plan: SpendingPlan }) {
  // "No data yet" only when the month has NO financial activity at all — never
  // mislabel a real $0-left (overspent / fully committed) as empty.
  const noData =
    plan.expectedIncomeCents === 0 &&
    plan.spentSoFarCents === 0 &&
    plan.upcomingBillsCents === 0 &&
    plan.plannedSavingsCents === 0;
  const ok = !plan.overspent;
  return (
    <Link
      href="/spending-plan"
      data-testid="dashboard-safe-to-spend"
      className="block rounded-2xl border bg-card p-4 shadow-sm transition hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Gauge className="size-3.5" aria-hidden /> Safe to spend
      </div>
      {noData ? (
        <p className="mt-1.5 text-sm text-muted-foreground" data-testid="dashboard-safe-to-spend-empty">
          Once this month has some income and spending, your safe-to-spend amount shows up here.
        </p>
      ) : (
        <>
          <p
            className={`mt-1.5 text-2xl font-bold tabular-nums ${ok ? 'text-foreground' : 'text-rose-500'}`}
            data-testid="dashboard-safe-to-spend-amount"
          >
            {formatCents(cents(plan.leftToSpendCents))}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ok ? (
              <>
                ≈ {formatCents(cents(plan.perDayCents))}/day · {plan.daysLeftInMonth} day
                {plan.daysLeftInMonth === 1 ? '' : 's'} left
              </>
            ) : (
              <>over plan · {plan.daysLeftInMonth} day{plan.daysLeftInMonth === 1 ? '' : 's'} left</>
            )}
          </p>
        </>
      )}
    </Link>
  );
}
