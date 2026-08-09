/**
 * Glass-Box trace → panel presentation (GLASSBOX_PLAN slice 2). A PURE, dependency-
 * light helper (type-only imports — no engine runtime) so the client component can
 * import it as a value without pulling the trace engine (reports/insights/answer)
 * into the browser bundle.
 */
import type { AnswerTrace, RowSumTrace, TraceGroup, TraceRow } from './trace';
import type { DerivationTrace } from './derivation';
import type { AssistantIntent } from './intent';
// Runtime imports stay dependency-light on purpose (this module ships to the
// client): money.ts is already at the UI boundary, and fi.ts imports nothing
// but money. `savingsRateBps` here is the SAME function the engine used — the
// local recheck must not re-implement the rounding it guards (the
// guard-must-read-what-it-guards lesson).
import { cents } from '@/lib/money';
import { savingsRateBps } from '@/lib/engine/fi/fi';

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

// ─── derivation traces (slice 3) ─────────────────────────────────────────────

/** ONE formatter for a bps rate at one decimal place, shared by the
 *  savings-rate headline builder AND the derivation panel — so the two can
 *  never display different roundings of the same rate. */
export function bpsToPct1dp(bps: number): string {
  return (bps / 100).toFixed(1);
}

/**
 * Derivation-panel gate (slice 3) — the per-figure honesty check for the
 * "formula + inputs" view, mirroring `factView`'s stance: the UI opens the
 * formula panel ONLY when this gate re-verifies the whole chain LOCALLY,
 * never trusting the engine's `reconciled` flag alone:
 *  1. the trace is a derivation trace the engine already reconciled;
 *  2. the input lines re-sum to the trace's own `sumCents`;
 *  3. the formula re-run over the DISPLAYED lines lands on the DISPLAYED
 *     result — per kind: net worth = the signed row sum; cash needed = the
 *     row sum, with `byDate` matching the latest row date; savings rate =
 *     saved ≡ income − expenses AND the rate recomputed via the SAME
 *     `savingsRateBps` the engine used (integer-guarded: a corrupt payload
 *     returns null, it never throws in the component).
 * Any failure → null → the headline stays or falls back honestly — the panel
 * must never show a formula that does not produce the number on screen.
 */
export function derivationView(trace: AnswerTrace | undefined): DerivationTrace | null {
  if (!trace || trace.kind !== 'derivation' || !trace.reconciled) return null;
  // Every line must be integer cents (critic-2 P2-3): a fractional amount can
  // pass the sum equalities yet render a malformed money string under the ✓ —
  // and the savings arm's cents() below would throw instead of declining.
  if (!trace.rows.every((r) => Number.isSafeInteger(r.amountCents))) return null;
  const sum = trace.rows.reduce((s, r) => s + r.amountCents, 0);
  if (sum !== trace.sumCents) return null;
  switch (trace.intentKind) {
    case 'net_worth': {
      // No lines → no formula to show (critic F6, mirroring cash_needed below):
      // an empty two-column "$0.00 − $0.00" is a hollow reconciliation. The
      // builder already withholds the tap (no headlineCents without accounts);
      // this local guard stands on its own like every other check here.
      if (trace.rows.length === 0) return null;
      // Every line must carry its side of the formula (the panel groups by it —
      // a group-less line would silently vanish from both columns).
      if (!trace.rows.every((r) => r.group === 'asset' || r.group === 'liability')) return null;
      return sum === trace.netCents ? trace : null;
    }
    case 'cash_needed': {
      if (sum !== trace.requiredCents || trace.rows.length === 0) return null;
      if (!trace.rows.every((r) => typeof r.date === 'string')) return null;
      // The trace's by-date restates the headline's "by DATE" — the FIRST due
      // (audit P2) — so it must be backed by the EARLIEST row, not the latest.
      const earliest = trace.rows.reduce((m, r) => (r.date! < m ? r.date! : m), trace.rows[0].date!);
      return earliest === trace.byDate ? trace : null;
    }
    case 'savings_rate': {
      if (!Number.isSafeInteger(trace.incomeCents) || !Number.isSafeInteger(trace.expensesCents)) return null;
      if (trace.savedCents !== trace.incomeCents - trace.expensesCents || sum !== trace.savedCents) return null;
      const recomputed = savingsRateBps(cents(trace.incomeCents), cents(trace.expensesCents));
      return recomputed !== null && recomputed === trace.rateBps ? trace : null;
    }
  }
}
