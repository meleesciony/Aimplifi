/**
 * Glass-Box trace → panel presentation (GLASSBOX_PLAN slice 2). A PURE, dependency-
 * light helper (type-only imports — no engine runtime) so the client component can
 * import it as a value without pulling the trace engine (reports/insights/answer)
 * into the browser bundle.
 */
import type { RowSumTrace, TraceGroup, TraceRow } from './trace';

/**
 * The rows the UI may show UNDER the reconciled check, and the group breakdown to
 * show them in — but ONLY when the groups partition exactly that reconciled set.
 *
 * `rows` always sum to `headlineCents` (asserted in the engine), so they are the
 * honest content of the panel. `groups` is returned non-null ONLY when the group
 * amounts sum to `sumCents` — i.e. the groups ARE the headline's breakdown, true
 * for `spend_total` and the umbrella `spend_by_category`. For `top_categories` the
 * headline is the TOP category alone while `trace.groups` lists EVERY top-N
 * category, so the group sum exceeds the headline → `groups: null` and the panel
 * shows the flat top-category rows. This is what stops the panel from green-checking
 * a transaction count/sum drawn from categories that are NOT behind the tapped
 * figure (slice-2 hostile-critic P1-1): everything under the ✓ sums to the headline.
 */
export function reconciledView(
  trace: RowSumTrace,
): { rows: readonly TraceRow[]; groups: readonly TraceGroup[] | null } {
  const groupsSum = trace.groups?.reduce((s, g) => s + g.amountCents, 0);
  const groups = trace.groups && groupsSum === trace.sumCents ? trace.groups : null;
  return { rows: trace.rows, groups };
}
