/**
 * Return-moment composer (TASKS 1.1, audit idea 3) — the "Since you were away"
 * re-entry summary. Its whole job is to REWARD a return with a short story
 * instead of punishing an absence with a backlog (audit persona E).
 *
 * PURE, no I/O, and — like `buildWeeklyDigest` (the precedent it mirrors) — it
 * ORIGINATES NO NUMBER. Every value it carries is copied verbatim from an
 * already-computed, already-tested source the dashboard fetches anyway:
 *
 *   1. Cash Flow Radar (#172)  → the one-line "you're clear" / "a dip is coming".
 *   2. Auto-filed count        → how many transactions the categorizer silently
 *                                filed while the user was gone (a plain integer,
 *                                not money — counted from CategoryPrediction).
 *   3. Price increases         → recurring-series price bumps (findOpportunities
 *                                `kind: 'price-increase'`), merchant + delta cents
 *                                copied unchanged.
 *   4. Money Review highlight  → one pre-written, guardrail-scanned sentence
 *                                (`MoneyReview.improvement`), verbatim.
 *
 * No cents are formatted here — formatting is the UI's job (`formatCents` in the
 * card), per the one-boundary rule. The engine only decides WHETHER to greet
 * (a >7-day gap) and assembles the structured pieces; the card renders them.
 *
 * Returns null for anyone who is not actually returning: a first-ever visit
 * (`daysSinceLastSeen === null`) or a gap of 7 days or fewer. A returning user
 * with a truly quiet week still gets a non-null "welcome back, you're on track"
 * — that reassurance is the point, and it is honest (radar is `clear`, counts
 * are zero), not a fabricated highlight.
 */
import type { ISODate } from '@/lib/dates';
import type { Cents } from '@/lib/money';
import type { MoneyReview } from '@/lib/engine/fi/coach-copy';
import type { FrozenFundingFigure } from '@/lib/engine/account/feed-dropped-view';

/** A gap strictly greater than this many days since the last dashboard view triggers the greeting. */
export const RETURN_MOMENT_THRESHOLD_DAYS = 7;

/** Minimal radar projection the composer needs — extracted from RadarResult by the caller. */
export interface ReturnMomentRadarInput {
  firstNegativeDate: ISODate | null;
  daysUntilFirstNegative: number | null;
  collidingCardName: string | null;
  /**
   * The account the projection walks from, when the bank has stopped sending its balance
   * (L.20 critic cycle, finding B-4) — REQUIRED, because a defaulted disclosure argument fails
   * silent and this one guards the app's most confident sentence.
   *
   * This card is a hand-built payload over a closed three-field type: exactly the NARROWING L.20
   * went hunting for, and the one nobody named. `kind: 'clear'` is precisely
   * `firstNegativeDate === null`, which is precisely what a balance frozen HIGH manufactures — so
   * the card printed "Your cash flow looks clear" off a projection that could not see the account
   * it was projecting. It renders ONLY for a reader returning after more than a week away, which
   * is the population most likely to have had a feed drop while they were gone.
   */
  startingBalanceFrozen: FrozenFundingFigure | null;
}

export interface ReturnMomentPriceIncrease {
  merchant: string;
  /** Monthly increase, copied verbatim from the price-increase opportunity. */
  deltaCents: Cents;
}

export interface ReturnMomentInput {
  /** Whole calendar days since the last dashboard view; null = first-ever visit. */
  daysSinceLastSeen: number | null;
  review: MoneyReview | null;
  radar: ReturnMomentRadarInput;
  /** Count of silently auto-filed transactions since the last visit (≥ 0). */
  autoFiledCount: number;
  priceIncreases: readonly ReturnMomentPriceIncrease[];
}

/**
 * The radar line, resolved to exactly one of two honest states — each carrying the frozen starting
 * balance when there is one, so neither state can state its case without qualifying it.
 *
 * On `clear` the qualifier is the point: silence is what a frozen-HIGH balance produces. On
 * `warning` it still matters, in the other direction — the dip may come sooner and be deeper than
 * the date shown.
 */
export type ReturnMomentRadar =
  | { kind: 'clear'; frozenStart: FrozenFundingFigure | null }
  | {
      kind: 'warning';
      onDate: ISODate;
      daysUntil: number | null;
      cardName: string | null;
      frozenStart: FrozenFundingFigure | null;
    };

export interface ReturnMoment {
  daysAway: number;
  radar: ReturnMomentRadar;
  /** Verbatim count; 0 means nothing filed itself while away. */
  autoFiledCount: number;
  /** Verbatim price bumps; empty means none detected. */
  priceIncreases: ReturnMomentPriceIncrease[];
  /** One guardrail-scanned sentence from the Money Review, or null if there's no review yet. */
  reviewHighlight: string | null;
}

export function buildReturnMoment(input: ReturnMomentInput): ReturnMoment | null {
  const { daysSinceLastSeen } = input;
  // Not a return: never visited, or back within the week. No greeting.
  if (daysSinceLastSeen === null || daysSinceLastSeen <= RETURN_MOMENT_THRESHOLD_DAYS) {
    return null;
  }

  // A committed dip inside the horizon is the only thing that turns the line from
  // reassurance into a heads-up; otherwise the user is clear. (The dashboard's own
  // radar card carries the full detail — this is the one-line re-entry reference,
  // read from the SAME RadarResult so the two can never disagree.)
  const radar: ReturnMomentRadar =
    input.radar.firstNegativeDate !== null
      ? {
          kind: 'warning',
          onDate: input.radar.firstNegativeDate,
          daysUntil: input.radar.daysUntilFirstNegative,
          cardName: input.radar.collidingCardName,
          frozenStart: input.radar.startingBalanceFrozen,
        }
      : { kind: 'clear', frozenStart: input.radar.startingBalanceFrozen };

  return {
    daysAway: daysSinceLastSeen,
    radar,
    autoFiledCount: input.autoFiledCount,
    // Copy, never transform — the delta is already an exact cent value.
    priceIncreases: input.priceIncreases.map((p) => ({ merchant: p.merchant, deltaCents: p.deltaCents })),
    reviewHighlight: input.review?.improvement ?? null,
  };
}
