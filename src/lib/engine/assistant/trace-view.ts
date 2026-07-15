/**
 * Glass-Box trace → panel presentation (GLASSBOX_PLAN slice 2). A PURE, dependency-
 * light helper (type-only imports — no engine runtime) so the client component can
 * import it as a value without pulling the trace engine (reports/insights/answer)
 * into the browser bundle.
 */
import type { AnswerTrace, RowSumTrace, TraceGroup, TraceRow } from './trace';
import type { AssistantIntent } from './intent';

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

/**
 * The intents whose trace rows may carry the correction chip (slice 2b): the
 * category-sum family, where re-filing a row visibly moves the tapped figure.
 * merchant_spend / income / largest_purchases figures don't move under a
 * category change the same way, so offering "this should be <category>" there
 * would be a write whose effect the panel can't show. One source of truth for
 * the server action's gate AND the UI's chip visibility.
 */
export const CORRECTABLE_KINDS: ReadonlySet<AssistantIntent['kind']> = new Set<AssistantIntent['kind']>([
  'spend_total',
  'spend_by_category',
  'top_categories',
]);

/** What a tapped FACT's panel shows — the one group behind that fact's figure. */
export interface FactTraceView {
  label: string;
  amountCents: number;
  rows: readonly TraceRow[];
}

/**
 * Per-fact reconciliation gate (slice 2b). A fact is tappable ONLY when every
 * link in the chain holds, checked here rather than assumed:
 *  1. the answer carries a row-sum trace that is RECONCILED as a whole — a
 *     trace already in doubt must not green-check any of its parts;
 *  2. the fact carries a builder-set `traceKey` + `cents` (facts are TAGGED by
 *     the builders, never matched back to groups by display string — the
 *     slice-1 critic's fragility finding);
 *  3. a trace group with that exact key exists;
 *  4. the group's rows sum to the group's amount (re-checked locally so this
 *     gate stands on its own), and
 *  5. the group's amount equals the fact's OWN cents figure — the per-fact
 *     analog of `expectedHeadlineCents`: builder and trace computed their
 *     figures independently, so this equality is a real drift gate, not a
 *     self-comparison.
 * Any failure → null → the fact renders as plain text (an honest non-offer,
 * never a reconciliation the panel can't stand behind).
 */
export function factView(
  trace: AnswerTrace | undefined,
  traceKey: string | undefined,
  expectedCents: number | undefined,
): FactTraceView | null {
  if (!trace || trace.kind !== 'row_sum' || !trace.reconciled) return null;
  if (traceKey === undefined || expectedCents === undefined) return null;
  const g = trace.groups?.find((x) => x.key === traceKey);
  if (!g) return null;
  const sum = g.rows.reduce((s, r) => s + r.contributionCents, 0);
  if (sum !== g.amountCents || g.amountCents !== expectedCents) return null;
  return { label: g.label, amountCents: g.amountCents, rows: g.rows };
}
