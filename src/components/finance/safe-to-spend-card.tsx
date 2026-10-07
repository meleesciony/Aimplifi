import { Gauge } from 'lucide-react';
import { cents, formatCents } from '@/lib/money';
import type { SpendingPlan, SpendingPlanDisclosures } from '@/lib/engine/spending-plan/plan';
import { LONG_CADENCE_WORDS, longCadencesInTerm } from '@/lib/engine/spending-plan/plan';
import { bonusShortNote } from '@/lib/engine/spending-plan/bonus-copy';
import { TrackedActedLink } from '@/components/engagement/tracked-acted-link';
import { MONEY_NEGATIVE_CLASS, MONEY_PAIR_CLASS, PAGE_SECTION_LABEL_CLASS } from '@/components/finance/page-chrome';
import { SURFACE_LINK_CARD_CLASS } from '@/components/finance/surface-card-styles';

/**
 * Dashboard summary of the Spending Plan — guilt-free spending at a glance.
 * Formula (owner 2026-08-01): income − savings − fixed, + in a month a bonus
 * landed the part of it that paid savings (DECISIONS #784/#787). Card payments
 * are settlement of spend and live under Cash needed, not inside this number.
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
  const bonusNote = bonusShortNote(plan);
  // UI.1 — the same split of income the /spending-plan hero bar draws (its
  // `pct`, verbatim): fixed, savings this month's pay funds, guilt-free.
  // Labels only, like that legend — the figures live on the plan page.
  const total = Math.max(1, plan.patternIncomeCents);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / total) * 100))}%`;
  return (
    <TrackedActedLink
      href="/spending-plan"
      subjectKey="safe-to-spend"
      data-testid="dashboard-safe-to-spend"
      // UI.1 — fills its grid cell so the stage pair sits at one height on desktop.
      className={`${SURFACE_LINK_CARD_CLASS} flex h-full flex-col`}
    >
      <div className={PAGE_SECTION_LABEL_CLASS}>
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
            className={`mt-1.5 ${MONEY_PAIR_CLASS} ${ok ? 'text-foreground' : MONEY_NEGATIVE_CLASS}`}
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
          {bonusNote ? (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="safe-to-spend-bonus-note">
              {bonusNote}
            </p>
          ) : null}
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
          {ok ? (
            <div className="mt-auto pt-4" data-testid="dashboard-safe-to-spend-split">
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="bg-warning-400/80" style={{ width: pct(plan.fixedExpensesCents) }} />
                <div className="bg-sky-400/80" style={{ width: pct(plan.savingsFromPayCents) }} />
                <div
                  className="bg-positive-500/80"
                  style={{ width: pct(Math.max(0, plan.leftToSpendCents)) }}
                />
              </div>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-warning-400/80" aria-hidden />
                  Fixed
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-sky-400/80" aria-hidden />
                  Savings
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-positive-500/80" aria-hidden />
                  Guilt-free
                </span>
              </p>
            </div>
          ) : null}
        </>
      )}
    </TrackedActedLink>
  );
}
