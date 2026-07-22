import { Gauge } from 'lucide-react';
import { cents, formatCents } from '@/lib/money';
import type { SpendingPlan } from '@/lib/engine/spending-plan/plan';
import { TrackedActedLink } from '@/components/engagement/tracked-acted-link';
import { SURFACE_LINK_CARD_CLASS } from '@/components/finance/surface-card-styles';

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
    <TrackedActedLink
      href="/spending-plan"
      subjectKey="safe-to-spend"
      data-testid="dashboard-safe-to-spend"
      className={SURFACE_LINK_CARD_CLASS}
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Gauge className="size-3.5" aria-hidden />
        {/* ROADMAP COPY-1 / #186: when overspent, the header itself must not
            still say "Safe to spend" above an overage — reframe both label and amount. */}
        {ok || noData ? 'Safe to spend' : 'Over plan'}
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
            {ok ? (
              formatCents(cents(plan.leftToSpendCents))
            ) : (
              <>Over plan by {formatCents(cents(-plan.leftToSpendCents))}</>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ok ? (
              <>
                ≈ {formatCents(cents(plan.perDayCents))}/day · {plan.daysLeftInMonth} day
                {plan.daysLeftInMonth === 1 ? '' : 's'} left
              </>
            ) : (
              <>safe to spend is $0 · {plan.daysLeftInMonth} day{plan.daysLeftInMonth === 1 ? '' : 's'} left</>
            )}
          </p>
        </>
      )}
    </TrackedActedLink>
  );
}
