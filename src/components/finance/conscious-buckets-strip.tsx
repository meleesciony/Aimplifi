/**
 * Conscious Spending strip (P0.4, DECISIONS #93) — Sethi's bucket lens over the
 * existing spending plan. Pure render of the engine's re-partition
 * (`mapToConsciousBuckets`); no spend math here. Per the guardrail, NO segment
 * is ever colored red — this is a lens, not a guilt meter.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConsciousBucketRow } from '@/components/finance/conscious-bucket-row';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { traceConsciousBuckets } from '@/lib/engine/glass-box/trace';
import {
  CONSCIOUS_BUCKET_LABELS,
  mapToConsciousBuckets,
  type ConsciousBucketKey,
} from '@/lib/engine/spending-plan/conscious';
import type { SpendingPlan, SpendingPlanDisclosures } from '@/lib/engine/spending-plan/plan';
import { uncountedFixedNote } from '@/lib/engine/spending-plan/row-labels';
import { cents, formatCents } from '@/lib/money';

const META: Record<ConsciousBucketKey, { label: string; bar: string; text: string }> = {
  // #295: the fixed bucket now also holds this month's card payments, so the
  // label must not claim bills+spending alone (critic P3-13). Labels come from
  // the engine's one-author record (O.18b): the legend, the panel share text
  // and any future surface must not spell a bucket two ways.
  fixed: { label: CONSCIOUS_BUCKET_LABELS.fixed, bar: 'bg-slate-400/80 dark:bg-slate-500/80', text: 'text-slate-600 dark:text-slate-300' },
  savings: { label: CONSCIOUS_BUCKET_LABELS.savings, bar: 'bg-sky-400/80', text: 'text-sky-600 dark:text-sky-400' },
  guiltFree: { label: CONSCIOUS_BUCKET_LABELS.guiltFree, bar: 'bg-emerald-500/80', text: 'text-emerald-600 dark:text-emerald-400' },
};

/** Kebab-case testid prefixes — three panels share this card. */
const TESTID: Record<ConsciousBucketKey, string> = {
  fixed: 'conscious-fixed',
  savings: 'conscious-savings',
  guiltFree: 'conscious-guilt-free',
};

/** Display percent of a bps share, clamped to a renderable [0, 100]. */
const clampPct = (bps: number) => Math.min(100, Math.max(0, Math.round(bps / 100)));
const pctLabel = (bps: number) => Math.round(bps / 100);

export function ConsciousBucketsStrip({
  plan,
  disclosures,
}: {
  plan: SpendingPlan;
  /**
   * REQUIRED (L.30, and the L.15 defaulted-argument rule). This strip
   * re-partitions the SAME plan, so a repeating bill the projection lost makes the
   * fixed bucket too small and the guilt-free bucket too big HERE TOO — and a
   * percentage split is read as a verdict on how the reader is doing. Optional,
   * this argument would have been forgotten at exactly the caller that needed it.
   */
  disclosures: SpendingPlanDisclosures;
}) {
  const { buckets, patternIncomeCents, overspent } = mapToConsciousBuckets(plan);
  // 'left-to-spend' UNCONDITIONALLY, and 'your fixed costs' for the noun. This
  // strip renders `plan.leftToSpendCents` itself — sign and all, "-$1,000.00 · -20%"
  // in an overspent month — so it never shows an overage, and `overspent` is not the
  // discriminator. WHICH FIGURE THE SURFACE PRINTS is. Passing Ask's rule here told
  // an overspent reader a number was bigger than a figure that in fact gets smaller
  // (critic P1-1, executed): the same direction defect I had just fixed in Ask,
  // reintroduced one caller later.
  const fixedShortfall = uncountedFixedNote(disclosures, 'left-to-spend', 'your fixed costs');
  // No income pattern → a percentage-of-income lens has nothing meaningful to show.
  if (patternIncomeCents <= 0) return null;

  // O.18b: each legend amount expands to the plan's own rows for that bucket,
  // reshaped from the safe-to-spend identity and reconciled against the very
  // figure the legend prints — see traceConsciousBuckets. Built here, once,
  // from the same plan object the figures above came from.
  const traces = traceConsciousBuckets(plan, disclosures);

  const share = (k: ConsciousBucketKey) => buckets.find((b) => b.key === k)!.shareBps;

  // Bar widths come from NON-NEGATIVE bucket magnitudes normalized to sum to
  // exactly 100% — so an overspent month (guilt-free negative) can't overflow the
  // track or clip a neighbour, and rounding can't leave a sliver. The labels below
  // still show each bucket's true (signed) share of income.
  const widthBasis = buckets.reduce((s, b) => s + Math.max(0, b.cents), 0) || 1;
  const barPct = (b: { cents: number }) => (Math.max(0, b.cents) / widthBasis) * 100;

  return (
    <Card data-testid="conscious-buckets">
      <CardHeader className="pb-2">
        <CardDescription>Conscious spending · this month</CardDescription>
        <CardTitle className="text-base">Where your money is going</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Spending split into buckets">
          {buckets.map((b) => (
            <div
              key={b.key}
              className={META[b.key].bar}
              style={{ width: `${barPct(b)}%` }}
              title={`${META[b.key].label}: ${formatCents(cents(b.cents))}`}
            />
          ))}
        </div>
        <ul className="space-y-1 text-xs">
          {buckets.map((b) => (
            <ConsciousBucketRow
              key={b.key}
              label={META[b.key].label}
              swatchClass={META[b.key].bar}
              textClass={META[b.key].text}
              trace={traces[b.key]}
              testIdPrefix={TESTID[b.key]}
              shareLabel={
                <>
                  · {pctLabel(b.shareBps)}%{' '}
                  <span className="text-[10px]">
                    (target {b.targetLoBps / 100}–{b.targetHiBps / 100}%)
                  </span>
                </>
              }
            />
          ))}
        </ul>
        {/* L.29 (critic P2-4: a surface the first sweep did not visit). This strip
            re-partitions the SAME plan, so its savings bucket prints the same $0.00
            the breakdown panel now explains — "$0.00 · 0% (target 5–10%)" beside a
            target the reader never set reads as a shortfall he is failing at, not as
            a control he has not used. No plumbing needed: the fact rides the plan. */}
        {plan.plannedSavingsCents === 0 && plan.savingsTargetBps == null && (
          <p className="text-xs text-muted-foreground" data-testid="conscious-savings-unset">
            Savings is $0 because no savings target and no monthly goal amount is set yet — not
            because nothing was saved. Set a target in Settings and this bucket fills in.
          </p>
        )}
        {/* L.30. A bill the projection lost shrinks the FIXED bucket and inflates
            GUILT-FREE, and this strip states each as a percentage against a target
            — so silence here does not merely omit a figure, it certifies a split.
            Same author as the /spending-plan basis line and the Ask qualifier; the
            direction follows THIS surface's overspent state. */}
        {fixedShortfall && (
          <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="conscious-fixed-uncounted">
            {fixedShortfall}
          </p>
        )}
        {overspent && (
          <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="conscious-overspent">
            {COACH_COPY.consciousOverspent()}
          </p>
        )}
        <p className="text-xs text-muted-foreground" data-testid="conscious-caption">
          {COACH_COPY.consciousSpending(
            clampPct(share('fixed')),
            clampPct(share('savings')),
            clampPct(share('guiltFree')),
          )}
        </p>
      </CardContent>
    </Card>
  );
}
