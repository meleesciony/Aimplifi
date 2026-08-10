/**
 * Shared Trends copy helpers — pure, no React. The dashboard summary card and
 * the /trends page must describe the same windows with the same words; a local
 * copy of either label is how they drift (CALC_AUDIT 2026-08-02 P1-2 / P1-5).
 */
import { addMonthsToMonthKey, formatMonth } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { BREAKDOWN_BASIS, breakdownNotCountedYetCopy } from '@/lib/engine/glass-box/category-breakdown';
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
 * A GAPPED set (audit P2 — the mover baseline skips months with no spend, so
 * the set is not always contiguous) must not print as a range: "Mar–Jun"
 * claims four months when only three were averaged, and the balance-move
 * sentence beside it says "your 3-month average" — two labels for one window,
 * disagreeing about its size 40px apart. The gapped form states the COUNT and
 * the newest month, which is exactly the form the balance-move sentence uses.
 */
export function baselineLabel(months: string[]): string {
  if (months.length === 0) return 'earlier months';
  if (months.length === 1) return shortMonth(months[0]!);
  if (!isContiguousDescending(months)) {
    return `${months.length} months through ${shortMonth(months[0]!)}`;
  }
  const oldest = shortMonth(months[months.length - 1]!);
  const newest = shortMonth(months[0]!);
  return `${oldest}–${newest}`;
}

/** True when each month is exactly one month after the next (most-recent-first). */
function isContiguousDescending(months: string[]): boolean {
  for (let i = 0; i < months.length - 1; i += 1) {
    if (addMonthsToMonthKey(months[i + 1]!, 1) !== months[i]) return false;
  }
  return true;
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

/**
 * The tie phrase, authored once (C.2 critic P1-4).
 *
 * `paceDeltaRelation` was shared but its RENDERING was not: both surfaces
 * hard-coded this sentence, in a module whose own header says a local copy is
 * exactly how two labels drift apart. Sharing the helper that decides WHICH
 * branch to take, while copying the words in the branch, leaves the drift
 * surface untouched — the decision was never the part that varies.
 */
export const PACE_DELTA_SAME = 'on pace with last month';

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
  // Singular when there is one (C.2 critic P2): "$1,800.00 of bills still due:
  // Mr Cooper" names one merchant and calls it plural in the same breath.
  const noun = names.length === 1 ? 'bill' : 'bills';
  return `${money(pace.billsStillDueCents)} of ${noun} still due: ${list}`;
}

/**
 * What the projection can and cannot see — stated POSITIVELY, and on purpose.
 *
 * The first version of this clause ENUMERATED exclusions ("Bills charged to a
 * card, and any we have not spotted, are not in that $6,200.00"), and an
 * enumeration beside a money figure is a claim to be complete. It was not. The
 * engine also refuses a scheduled row whose merchant it has never counted as
 * spending (the auto-loan ACH, a savings sweep), an aggregate pseudo-merchant
 * ("Zelle Payment" is a pattern, not an identity), and a hand-authored label no
 * merchant string can match ("Rent — Peachtree Properties"). Every one of those
 * rows is rendered as a bill still due by /calendar, one click away, off the
 * same `snap.scheduled` array — so a reader whose landlord is paid by Zelle read
 * a two-item list, found that neither item applied to them, and concluded their
 * rent was inside the figure.
 *
 * `closing-a-gap-shrinks-the-disclosure-that-described-it` is the rule that was
 * broken: re-derive the remaining set by EXECUTING the classifier over its whole
 * input domain, never by editing the old sentence to remove what you fixed. A
 * positive statement of the admission rule cannot decay that way — it says what
 * IS counted, so every refusal the engine makes, including ones added later, is
 * covered by construction rather than by an author remembering to extend a list.
 *
 * It also says what a reader can DO about it, which an exclusion list cannot:
 * the rule is about matching a merchant, and the reader is the one who knows
 * whether they have spent there.
 */
const PACE_BILL_COVERAGE =
  'Only bills we can match to a merchant you have spent at are counted here — ' +
  'one charged to a card, paid as a transfer, or that we have not spotted is not.';

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
 * Branches A and B both carry `PACE_BILL_COVERAGE`, and neither may be shortened
 * to "we counted your bills": the projection sees a strict subset of the bills
 * the app can see, and the reader is one click from the rest of them.
 */
export function paceAssumption(
  pace: Pick<SpendingPace, 'spentSoFarCents' | 'billsStillDueCents' | 'discretionarySoFarCents'>,
): string {
  const other = money(pace.discretionarySoFarCents);
  if (pace.billsStillDueCents > 0) {
    const bills = money(pace.billsStillDueCents);
    return (
      `Adds ${bills} of bills still due, then assumes the other ${other} ` +
      `continues at its current daily rate — a projection, not a prediction. ${PACE_BILL_COVERAGE}`
    );
  }
  if (pace.discretionarySoFarCents < pace.spentSoFarCents) {
    return (
      `Every bill we could match to this month's charges is already counted; the other ${other} ` +
      `is what continues at its current daily rate — a projection, not a prediction. ${PACE_BILL_COVERAGE}`
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

/**
 * The O.18e panel basis for ONE new-merchant row (merchant scope, /trends).
 *
 * S1 names the window the merchant's figure actually sums — this month THROUGH
 * the as-of date. The card's neighbours on the same page sum COMPLETE months
 * (the movers below compare finished months), and /budgets sums the whole
 * month, so a bare "$80.00" under a "New this month" card would read as the
 * whole month when the figure stopped on the 10th (C.26's lesson — a
 * stop-at-today figure must never be labeled as the whole month). /reports
 * shares this stop-at-today basis (it clamps at today too, C.26) — the
 * through-date sentence is what makes THIS in-progress aggregate checkable
 * beside its complete-month neighbours.
 *
 * The through date is RENDERED, never the word "today", because the demo and
 * e2e builds pin DEMO_TODAY: "through today" would be false on the pinned demo
 * and true for visitors — one sentence, two readings. The figure is likewise
 * the RENDERED string the card prints (O.18c), so the sentence cannot disagree
 * with the row it describes.
 *
 * S2 (only when the merchant has money dated after today) discloses it via the
 * C.26 sentence — a future-dated row the panel does NOT list, because the
 * figure does not count it, and a panel that claims "these are the rows"
 * without naming it would be complete-sounding and false.
 */
export function newMerchantPanelBasis(input: {
  /** The RENDERED figure the card prints for this merchant. */
  figure: string;
  /** The month the card describes, as the reader says it ("Jun"). */
  monthLabel: string;
  /** The RENDERED as-of date the figure stops at ("Wed, Jun 10, 2026"). */
  throughLabel: string;
  /** This merchant's spend rows dated after today this month, floored at 0. */
  futureDatedCents: number;
}): [string, ...string[]] {
  return [
    `The ${input.figure} above is this merchant's spending in ${input.monthLabel} through ${input.throughLabel}.`,
    ...(input.futureDatedCents > 0
      ? [breakdownNotCountedYetCopy(money(input.futureDatedCents))]
      : []),
    BREAKDOWN_BASIS,
  ];
}
