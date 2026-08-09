/**
 * Merchant Pattern Lens — templated narration (AI plan §Later #19, DECISIONS
 * #250). Pure presentation strings over MerchantProfile figures — the same
 * deliberate formatting-inside-engine exemption as coach-copy.ts (DECISIONS
 * #19). NO LLM anywhere: every line is a fixed template; every dollar figure
 * goes through formatCents; divided figures carry "about"; estimated dates
 * carry "around".
 *
 * Guardrails (locked by merchant-lens-copy.test.ts):
 *   • descriptive, never advisory — the lens reports what happened, it never
 *     tells the user what to do about it;
 *   • no shame lexicon;
 *   • NO time-of-day or day-of-week PATTERN vocabulary (morning/weekend/
 *     "usually on Fridays"…) — Transaction.date is date-only, so such claims
 *     cannot be grounded (the §19 verdict's flagship failure). Date STAMPS
 *     rendered by formatISODate ("Wed, Jun 3, 2026") are facts, not patterns,
 *     and remain allowed.
 */
import { cents, formatCents } from '@/lib/money';
import { formatISODate, formatMonth, isoDate } from '@/lib/dates';
import { LENS_MIN_PATTERN_SAMPLE, type MerchantProfile, type LensWindow } from './profile';
import type { Cadence } from '@/lib/engine/recurring/detect';

/** Cadence input the server maps from an ACTIVE RecurringItem. Was a narrowed
 *  copy of the union; L.24 pointed it at `Cadence` itself so a new cadence can
 *  never be silently unassignable here. */
export interface LensCadence {
  cadence: Cadence;
  /** SIGNED, as detectRecurring emits it (negative for expense series). The
   *  copy renders the MAGNITUDE — a lens describing charges must never print
   *  "typically −$1,800.00" against the typical line's positive figure
   *  (#250 critic F1). */
  typicalAmountCents: number;
  nextExpectedAt: string; // YYYY-MM-DD
  active: boolean;
}

export interface MerchantLensCopy {
  heading: string;
  /** Always present: count, span, total, last charge. */
  factsLine: string;
  /** Median with its basis disclosed; null below the pattern floor. */
  typicalLine: string | null;
  /** Full-month averages; null when no window rendered. */
  trendLine: string | null;
  /** Basis note; present iff trendLine is. */
  windowNote: string | null;
  /** Recurring-series line; null unless active and non-IRREGULAR. */
  cadenceLine: string | null;
}

const CADENCE_WORD: Record<Exclude<LensCadence['cadence'], 'IRREGULAR'>, string> = {
  WEEKLY: 'weekly',
  BIWEEKLY: 'every two weeks',
  MONTHLY: 'monthly',
  QUARTERLY: 'every three months',
  SEMIANNUAL: 'twice a year',
  ANNUAL: 'yearly',
};

function windowLabel(w: LensWindow): string {
  return `${formatMonth(w.fromYm)}–${formatMonth(w.toYm)}`;
}

/** Render the lens narration for a non-null profile. */
export function merchantLensCopy(
  profile: MerchantProfile,
  recurring: LensCadence | null = null,
): MerchantLensCopy {
  const p = profile;
  const one = p.chargeCount === 1;

  const factsLine = one
    ? `1 charge, ${formatCents(p.totalCents)}, on ${formatISODate(p.firstSeen, 'long')}.`
    : `${p.chargeCount} charges since ${formatMonth(p.firstSeen.slice(0, 7))} — ` +
      `${formatCents(p.totalCents)} in all; the last was ${formatISODate(p.lastSeen, 'long')}.`;

  const typicalLine =
    p.typicalCents === null
      ? null
      : `Typically ${formatCents(p.typicalCents)} a charge (median of ${p.chargeCount} posted charges).`;

  let trendLine: string | null = null;
  if (p.recentWindow) {
    const r = p.recentWindow;
    trendLine =
      r.chargeCount === 0
        ? `No charges in ${windowLabel(r)}`
        : `${windowLabel(r)}: ${r.chargeCount} charge${r.chargeCount === 1 ? '' : 's'}, ` +
          `about ${formatCents(r.avgPerMonthCents)}/mo`;
    // The comparison clause needs a signal on at least one side: "no charges
    // vs $0.00/mo" would be a true but empty sentence.
    trendLine +=
      p.priorWindow && (p.priorWindow.chargeCount > 0 || r.chargeCount > 0)
        ? ` — vs about ${formatCents(p.priorWindow.avgPerMonthCents)}/mo in ${windowLabel(p.priorWindow)}.`
        : '.';
  }

  const windowNote = trendLine
    ? `Averages use full calendar months; the current month isn't counted.`
    : null;

  let cadenceLine: string | null = null;
  if (recurring && recurring.active && recurring.cadence !== 'IRREGULAR') {
    cadenceLine =
      `Looks recurring: ${CADENCE_WORD[recurring.cadence]}, typically ` +
      `${formatCents(cents(Math.abs(recurring.typicalAmountCents)))}, next expected around ` +
      `${formatISODate(isoDate(recurring.nextExpectedAt), 'long')}.`;
  }

  return {
    heading: `Your pattern at ${p.merchant}`,
    factsLine,
    typicalLine,
    trendLine,
    windowNote,
    cadenceLine,
  };
}

/** Shown instead of pattern claims when history is below the floor. */
export function thinHistoryNote(chargeCount: number): string | null {
  return chargeCount < LENS_MIN_PATTERN_SAMPLE
    ? `Not enough history for a pattern — figures appear after ${LENS_MIN_PATTERN_SAMPLE} posted charges.`
    : null;
}

/** Always shown on the card (#250 critic F5): the profile is full-history by
 *  design, while the list below may be date-filtered, type-filtered, or just
 *  page 1 of N — the card must say which set its figures describe. Audit P2:
 *  the note also states the FIGURE'S basis, because the register summary beside
 *  it nets refunds and includes pending — three figures, one merchant, one
 *  screen. The lens total is GROSS posted charges: refunds (positive rows) are
 *  never subtracted, and nothing pending is in it. */
export const LENS_SCOPE_NOTE =
  'Covers every posted charge at this merchant across your history — gross, refunds not netted, nothing pending. The summary below nets refunds and includes pending; the list may show only a slice.';
