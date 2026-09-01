import { Gauge } from 'lucide-react';
import { cents, formatCents } from '@/lib/money';
import type { SpendingPlan, SpendingPlanDisclosures } from '@/lib/engine/spending-plan/plan';
import { LONG_CADENCE_WORDS, longCadencesInTerm } from '@/lib/engine/spending-plan/plan';
import { TrackedActedLink } from '@/components/engagement/tracked-acted-link';
import { SURFACE_LINK_CARD_CLASS } from '@/components/finance/surface-card-styles';

/**
 * Dashboard summary of the Spending Plan — guilt-free spending at a glance.
 * Formula (owner 2026-08-01): income − savings − fixed. Card payments are
 * settlement of spend and live under Cash needed, not inside this number.
 */
export function SafeToSpendCard({
  plan,
  disclosures: _disclosures,
}: {
  plan: SpendingPlan;
  /** Kept required so callers cannot omit the plan's disclosure payload. */
  disclosures: SpendingPlanDisclosures;
}) {
  void _disclosures;
  // "No data yet" only when there is NO pattern and NO fixed/savings commitments —
  // never mislabel a real $0-left (overspent / fully committed) as empty.
  // Card fields do not create a plan figure (they are not subtracted).
  const noData =
    plan.patternIncomeCents === 0 &&
    plan.fixedExpensesCents === 0 &&
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
        {ok || noData ? 'Guilt-free to spend' : 'Over plan'}
      </div>
      {noData ? (
        <p className="mt-1.5 text-sm text-muted-foreground" data-testid="dashboard-safe-to-spend-empty">
          Once we can see your income — a complete month posted, or a recurring paycheck
          detected — your guilt-free spending amount shows up here.
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
              <>monthly allocation after fixed costs &amp; savings</>
            ) : (
              <>Your income pattern is more than spoken for by fixed costs and savings</>
            )}
          </p>
          {longCadencesInTerm(plan.scheduledFixed).map((c) => (
            <p
              key={c}
              className="mt-1 text-xs text-muted-foreground"
              data-testid="safe-to-spend-annual-note"
              data-cadence={c}
            >
              A {LONG_CADENCE_WORDS[c].adjective} bill is counted here {LONG_CADENCE_WORDS[c].share}{' '}
              at a time, so {LONG_CADENCE_WORDS[c].cardLanding} will cost more than this figure
              allows for.
            </p>
          ))}
        </>
      )}
    </TrackedActedLink>
  );
}
