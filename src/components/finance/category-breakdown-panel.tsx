'use client';

/**
 * The expandable half of a category row — "show me what is in this bucket".
 *
 * Owner request, 2026-07-31: *"I've asked you many times to make rows expandable
 * so I can see what exactly system is classifying spending as. Not just the
 * stuff in the photo but every table."*
 *
 * Why this exists when every one of those rows ALREADY links to the register
 * (O.5/O.6): a link is a different gesture with a different cost. It leaves the
 * page, loses the table the reader was comparing rows in, and answers the
 * question one category at a time. The question being asked here — "is this
 * bucket right?" — is answered by scanning several buckets in a row, which only
 * works if the answer opens in place. Both affordances ship: the panel shows
 * what is inside, its footer still offers the register, which is where a row can
 * be re-filed.
 *
 * The rendering moved to `BreakdownPanel` when the /reports chart needed the
 * same panel for a DIFFERENT predicate (the flows basis is posted-only; this one
 * counts pending). This file is now the category-shaped wrapper: it owns the
 * category basis sentence and the category wording, and its props and test ids
 * are unchanged, so every caller and every existing lock still reads the same
 * strings.
 */
import {
  breakdownEmptyCopy,
  categoryPanelBasis,
  windowLabelSoFar,
  breakdownNetRefundCopy,
  type CategoryBreakdown,
} from '@/lib/engine/glass-box/category-breakdown';
import { BreakdownPanel } from '@/components/finance/breakdown-panel';
import { formatCents } from '@/lib/money';

export function CategoryBreakdownPanel({
  breakdown,
  categoryName,
  /**
   * The period these rows cover, as the reader would say it ("Jul 2026").
   *
   * REQUIRED. Two independent critics found the same defect here: the copy used
   * to say "this month", which is true on /budgets and /reports and false on
   * /trends, whose panels describe the last COMPLETE month while the card above
   * them is headed with the current one. The window is a fact about the surface,
   * so the surface has to say it.
   */
  windowLabel,
  /** Where "open these in the register" goes, or null where O.5 refuses a link. */
  registerHref,
  /** Distinguishes this panel's test ids on pages that render several tables. */
  testIdPrefix = 'breakdown',
  /**
   * EXTRA sentences for this surface only. The shared category basis
   * (`BREAKDOWN_BASIS`) is prepended here rather than taken from a caller, so a
   * surface cannot ship a panel with no disclosure by forgetting the prop.
   */
  basis = [],
}: {
  breakdown: CategoryBreakdown;
  categoryName: string;
  windowLabel: string;
  registerHref?: string | null;
  testIdPrefix?: string;
  basis?: readonly string[];
}) {
  // C.26 (critic cycle 1): "June 2026" is a false label for a figure that stops
  // on the 10th once something is dated later in the month, and both sentences
  // below interpolate it.
  const label = windowLabelSoFar(windowLabel, breakdown.notCountedYetCents);
  return (
    <BreakdownPanel
      subject={{
        id: breakdown.categoryId,
        name: categoryName,
        headlineCents: breakdown.headlineCents,
        rows: breakdown.rows,
        sumCents: breakdown.sumCents,
        reconciles: breakdown.reconciles,
        clampedByNetRefund: breakdown.clampedByNetRefund,
      }}
      emptyCopy={breakdownEmptyCopy(label)}
      netRefundCopy={breakdownNetRefundCopy(formatCents(breakdown.sumCents), label)}
      // C.26 (critic cycle 1, P1-2): composed by the ENGINE, not here. The
      // first cycle assembled this array in the component and a critic deleted
      // the clamp clause with 5964/5964 tests green — this repo has no
      // component-rendering harness, so a rule that lives in a .tsx cannot be
      // locked. `categoryPanelBasis` still prepends the shared sentence for the
      // original reason: a disclosure a surface has to remember is one a
      // surface can forget.
      basis={categoryPanelBasis(breakdown, basis)}
      registerHref={registerHref}
      testIdPrefix={testIdPrefix}
    />
  );
}
