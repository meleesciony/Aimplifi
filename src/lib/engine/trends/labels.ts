/**
 * Shared Trends copy helpers — pure, no React. The dashboard summary card and
 * the /trends page must describe the same windows with the same words; a local
 * copy of either label is how they drift (CALC_AUDIT 2026-08-02 P1-2 / P1-5).
 */
import { formatMonth } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import type { SpendingPace } from '@/lib/engine/trends/trends';

const money = (n: number) => formatCents(cents(n));

/** Short month name for a YYYY-MM (e.g. "Jun"). */
export function shortMonth(ym: string): string {
  return formatMonth(ym, 'short');
}

/**
 * Baseline window for category movers. `months` is most-recent-first (the
 * engine's order); the label reads oldest→newest so a 3-month average becomes
 * "Apr–Jun", not "Jun–Apr".
 *
 * Note (C.17 / audit P2): a gapped set still prints as a contiguous range.
 * That is a separate finding; this helper matches the shipped /trends wording.
 */
export function baselineLabel(months: string[]): string {
  if (months.length === 0) return 'earlier months';
  if (months.length === 1) return shortMonth(months[0]!);
  const oldest = shortMonth(months[months.length - 1]!);
  const newest = shortMonth(months[0]!);
  return `${oldest}–${newest}`;
}

/** "in the first 2 days" — the divisor the pace projection hides when omitted. */
export function paceDaysPhrase(daysElapsed: number): string {
  return `in the first ${daysElapsed} day${daysElapsed === 1 ? '' : 's'}`;
}

/**
 * How the projected month compares to last month. A zero delta is its own
 * relation — "on pace for $0.00 less" with a green tint was the P1-3 lie.
 */
export function paceDeltaRelation(
  deltaVsPriorCents: number,
): { absCents: number; relation: 'more' | 'less' | 'same' } {
  if (deltaVsPriorCents === 0) return { absCents: 0, relation: 'same' };
  return {
    absCents: Math.abs(deltaVsPriorCents),
    relation: deltaVsPriorCents > 0 ? 'more' : 'less',
  };
}

/** How many bills are named before the phrase falls back to a count. */
export const PACE_BILLS_NAMED = 2;

/**
 * The bills the projection added, named — null when it added none, so a surface
 * cannot render an empty list as a fact (`an-empty-set-is-not-a-fact-about-money`)
 * and there is ONE decision point instead of a guard per call site.
 *
 * Naming them is the point: the owner's report was "$8,971.25 makes no sense
 * since our mortgage is ~6200", and a corrected figure with the same hidden
 * inputs invites exactly the same reply (`an-answer-is-only-as-believable-as-
 * its-visible-inputs`).
 */
export function paceBillsPhrase(
  pace: Pick<SpendingPace, 'billsStillDueCents' | 'billsStillDue'>,
): string | null {
  const names = pace.billsStillDue.map((b) => b.merchant);
  if (names.length === 0) return null;
  const shown = names.slice(0, PACE_BILLS_NAMED);
  const rest = names.length - shown.length;
  const list =
    rest > 0
      ? `${shown.join(', ')} and ${rest} more`
      : shown.length === 1
        ? shown[0]!
        : shown.join(' and ');
  return `${money(pace.billsStillDueCents)} of bills still due: ${list}`;
}

/**
 * Assumption stated beside every pace figure (dashboard + /trends).
 *
 * C.2 split it into three branches, because the projection stopped being one
 * model. It is now `spent so far + bills still due + discretionary × days left`,
 * and a sentence that describes only the daily rate would be describing a term
 * the reader cannot find in the figure: the mortgage is counted once, at its
 * amount, not extrapolated — and the daily rate is taken over what is LEFT after
 * the bill money, so `spentSoFar / daysElapsed` no longer reproduces it.
 *
 * The third clause of branch B is the completeness hedge, and it is the reason
 * this may not be shortened to "we counted your bills": a bill charged to a
 * credit card produces no scheduled row at all (the series is 'on-card'), and a
 * bill the detector has not spotted produces none either. Both are still being
 * extrapolated by the rate, exactly as the whole month used to be.
 */
export function paceAssumption(
  pace: Pick<SpendingPace, 'spentSoFarCents' | 'billsStillDueCents' | 'discretionarySoFarCents'>,
): string {
  const other = money(pace.discretionarySoFarCents);
  if (pace.billsStillDueCents > 0) {
    const bills = money(pace.billsStillDueCents);
    return (
      `Adds ${bills} of bills we can see still due, then assumes the other ${other} ` +
      `continues at its current daily rate — a projection, not a prediction. ` +
      `Bills charged to a card, and any we have not spotted, are not in that ${bills}.`
    );
  }
  if (pace.discretionarySoFarCents < pace.spentSoFarCents) {
    return (
      `The bills we can see for this month have already been charged; the other ${other} ` +
      `is what continues at its current daily rate — a projection, not a prediction.`
    );
  }
  return 'Assumes spending continues at the current daily rate — a projection, not a prediction.';
}

/**
 * Shown in place of the pace figure when `computePace` abstains (C.1). That
 * happens on exactly one condition — nothing counted in the in-progress month —
 * so this sentence states the condition rather than guessing at a cause.
 *
 * "Counted", not "spent": a zero here can equally be a feed that has not
 * delivered yet or a charge netted out by its own refund, and the app can only
 * prove what it counted (`a-zero-is-a-claim-and-must-name-which-zero`). It
 * replaces the dashboard's older "Not enough activity yet to spot trends",
 * which this fix would have made false on the first days of most months — the
 * biggest-change row beneath it is drawn from completed months and goes on
 * rendering.
 */
export const PACE_NO_SPEND_YET =
  'No spending counted yet this month — there is no daily rate to project from.';

/**
 * Window the top mover describes. Null when movers have no compared month
 * (not enough history) — the caller must not invent an "this month" label.
 */
export function moverWindowLabel(
  comparedYm: string | null,
  baselineMonths: string[],
): string | null {
  if (comparedYm === null) return null;
  return `${shortMonth(comparedYm)} vs ${baselineLabel(baselineMonths)} average`;
}
