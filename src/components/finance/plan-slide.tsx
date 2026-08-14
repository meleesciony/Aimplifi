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
  dataFixedCents,
  incomeLocked,
  fixedLocked,
}: {
  hasSlide: boolean;
  incomeSlideCents: number;
  fixedSlideCents: number;
  suggestedIncomeCents: number;
  /**
   * The FROM-CATEGORIES fixed figure — `plan.patternFixedCents`, NOT
   * `suggestedFixedCents` (C.23/H.4 critic P1-2).
   *
   * `fixedSlideCents` is `suggested − fixed`, in which the declared reserves
   * cancel because both sides carry them, so the slide it measures is
   * `pattern − intention`. Printing the reserve-inclusive suggestion beside that
   * gap made the sentence contradict its own arithmetic: measured, a $100.00
   * reserve rendered "$40.00 BELOW your intention ($1,100.00 from data)" over an
   * intention of $1,040.00 — a figure $60.00 ABOVE it. One sentence, two
   * operands, and they have to come from the same side of the fold.
   */
  dataFixedCents: number;
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
        `Fixed costs from categories are ${abs} above your intention (${formatCents(cents(dataFixedCents))} from data) — a slide / overspend vs your plan before guilt-free.`,
      );
    } else {
      lines.push(
        `Fixed costs from categories are ${abs} below your intention (${formatCents(cents(dataFixedCents))} from data).`,
      );
    }
  }

  return (
    <div
      className="rounded-xl border border-warning-200 bg-warning-50/80 p-3 text-xs text-warning-950 dark:border-warning-900 dark:bg-warning-950/40 dark:text-warning-100"
      data-testid="plan-slide"
      role="status"
    >
      <p className="font-medium">Slide vs your intention</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-4">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="mt-2 text-muted-foreground dark:text-warning-200/80">
        Guilt-free still uses your locked intention. Clear a lock below to follow categories
        again.
      </p>
    </div>
  );
}
