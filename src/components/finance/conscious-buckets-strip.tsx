/**
 * Conscious Spending strip (P0.4, DECISIONS #93) — Sethi's bucket lens over the
 * existing spending plan. Pure render of the engine's re-partition
 * (`mapToConsciousBuckets`); no spend math here. Per the guardrail, NO segment
 * is ever colored red — this is a lens, not a guilt meter.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { mapToConsciousBuckets, type ConsciousBucketKey } from '@/lib/engine/spending-plan/conscious';
import type { SpendingPlan } from '@/lib/engine/spending-plan/plan';
import { cents, formatCents } from '@/lib/money';

const META: Record<ConsciousBucketKey, { label: string; bar: string; text: string }> = {
  fixed: { label: 'Bills & spending', bar: 'bg-slate-400/80 dark:bg-slate-500/80', text: 'text-slate-600 dark:text-slate-300' },
  savings: { label: 'Savings & investing', bar: 'bg-sky-400/80', text: 'text-sky-600 dark:text-sky-400' },
  guiltFree: { label: 'Guilt-free', bar: 'bg-emerald-500/80', text: 'text-emerald-600 dark:text-emerald-400' },
};

/** Display percent of a bps share, clamped to a renderable [0, 100]. */
const clampPct = (bps: number) => Math.min(100, Math.max(0, Math.round(bps / 100)));
const pctLabel = (bps: number) => Math.round(bps / 100);

export function ConsciousBucketsStrip({ plan }: { plan: SpendingPlan }) {
  const { buckets, expectedIncomeCents, overspent } = mapToConsciousBuckets(plan);
  // No income this month → a percentage-of-income lens has nothing meaningful to show.
  if (expectedIncomeCents <= 0) return null;

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
            <li key={b.key} className="flex items-baseline justify-between gap-2">
              <span className={`inline-flex items-center gap-1.5 font-medium ${META[b.key].text}`}>
                <span className={`size-2 rounded-full ${META[b.key].bar}`} aria-hidden />
                {META[b.key].label}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatCents(cents(b.cents))} · {pctLabel(b.shareBps)}%{' '}
                <span className="text-[10px]">
                  (target {b.targetLoBps / 100}–{b.targetHiBps / 100}%)
                </span>
              </span>
            </li>
          ))}
        </ul>
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
