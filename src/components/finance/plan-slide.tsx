/**
 * Slide vs intention (DECISIONS #373): when categorized data differs from a
 * locked plan figure, show the variance — do not rewrite the plan.
 */
import { cents, formatCents } from '@/lib/money';

export function PlanSlideNotice({
  hasSlide,
  incomeSlideCents,
  fixedSlideCents,
  suggestedIncomeCents,
  suggestedFixedCents,
  incomeLocked,
  fixedLocked,
}: {
  hasSlide: boolean;
  incomeSlideCents: number;
  fixedSlideCents: number;
  suggestedIncomeCents: number;
  suggestedFixedCents: number;
  incomeLocked: boolean;
  fixedLocked: boolean;
}) {
  if (!hasSlide) return null;

  const lines: string[] = [];
  if (incomeLocked && incomeSlideCents !== 0) {
    const abs = formatCents(cents(Math.abs(incomeSlideCents)));
    lines.push(
      incomeSlideCents > 0
        ? `Income from categories is ${abs} above your intention (${formatCents(cents(suggestedIncomeCents))} from data).`
        : `Income from categories is ${abs} below your intention (${formatCents(cents(suggestedIncomeCents))} from data).`,
    );
  }
  if (fixedLocked && fixedSlideCents !== 0) {
    const abs = formatCents(cents(Math.abs(fixedSlideCents)));
    if (fixedSlideCents > 0) {
      lines.push(
        `Fixed costs from categories are ${abs} above your intention (${formatCents(cents(suggestedFixedCents))} from data) — a slide / overspend vs your plan before guilt-free.`,
      );
    } else {
      lines.push(
        `Fixed costs from categories are ${abs} below your intention (${formatCents(cents(suggestedFixedCents))} from data).`,
      );
    }
  }

  return (
    <div
      className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
      data-testid="plan-slide"
      role="status"
    >
      <p className="font-medium">Slide vs your intention</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-4">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="mt-2 text-muted-foreground dark:text-amber-200/80">
        Guilt-free still uses your locked intention. Clear a lock below to follow categories
        again.
      </p>
    </div>
  );
}
