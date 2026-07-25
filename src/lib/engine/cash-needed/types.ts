import type { Cents } from '@/lib/money';
import type { ISODate } from '@/lib/dates';

export type Scenario = 'PAY_IN_FULL' | 'MINIMUM';
export type AutopayMode = 'STATEMENT_BALANCE' | 'MINIMUM' | 'FIXED_AMOUNT';

export interface StatementInfo {
  statementBalanceCents: Cents;
  minimumPaymentCents: Cents;
  /** Raw issuer due date — weekend/holiday adjustment happens in the engine. */
  dueDate: ISODate;
  cycleEnd: ISODate;
}

export interface CardSnapshot {
  id: string;
  name: string;
  aprBps: number;
  autopay: { mode: AutopayMode; fixedAmountCents?: Cents } | null;
  /** The current generated statement; null = statement not yet generated. */
  statement: StatementInfo | null;
  currentBalanceCents: Cents;
  /** Estimate path (statement null): when the open cycle closes and when it would be due. */
  nextCycleCloseDate?: ISODate;
  nextDueDate?: ISODate;
  /** Σ payments already applied against the current statement (mid-cycle payments). */
  paymentsAppliedCents: Cents;
  /** A refund/credit that posted after statement close (informational; does not reduce this statement). */
  postCloseCreditCents?: Cents;
  /** YYYY-MM-DD the bank stopped sharing this card, else null/absent (TASKS L.14). Carried so the
   *  engine's `assumptions` — which /cards, the dashboard hero, the calendar, the Ask answer and
   *  the weekly digest all render — can say that a card's figures come from a balance that has
   *  stopped moving. The engine adjusts nothing; it stops the number being quoted as current. */
  frozenSince?: string | null;
}

export interface ScheduledItem {
  date: ISODate;
  amountCents: Cents; // signed: outflow negative, inflow positive
  description: string;
}

export interface PendingTx {
  amountCents: Cents; // signed
  description: string;
}

export interface CashNeededInput {
  today: ISODate;
  paymentAccount: {
    name: string;
    balanceCents: Cents;
    pending: PendingTx[];
    /**
     * YYYY-MM-DD the bank stopped sharing THIS account, else null (TASKS L.14, critic F-1).
     *
     * The entire projection starts from `balanceCents` — it is not one number among many, it is
     * the base of the shortfall. The L.14 slice argued its "keep counting, just say so" stance
     * over LIABILITIES, where a stale card balance merely over-funds. For the funding ASSET the
     * direction inverts: a balance frozen high while the real one fell reports shortfall $0 and no
     * transfer recommendation, and the autopay bounces — the exact missed payment that reasoning
     * set out to avoid.
     *
     * REQUIRED, never defaulted, because a caller that forgets it gets silence at precisely the
     * moment the number is least trustworthy (the L.15 defaulted-argument lesson).
     */
    frozenSince: string | null;
  };
  cards: CardSnapshot[];
  /** Explicit dated occurrences within the projection window (cadences pre-expanded). */
  scheduled: ScheduledItem[];
  scenario: Scenario;
  /** US federal holidays (observed), injected for testability. */
  holidayTable: ISODate[];
}

export type ActionKind = 'pay' | 'autopay-covered' | 'autopay-topup';

export interface CardObligation {
  cardId: string;
  cardName: string;
  dueDate: ISODate; // raw issuer date
  effectiveDueDate: ISODate; // business-day adjusted (and never before `today`)
  /** Money that must be PRESENT in the payment account on the effective due date. */
  cashRequiredCents: Cents;
  /** Portion autopay will move automatically. */
  autopayCents: Cents;
  /** Portion the user must act on themselves. */
  userActionCents: Cents;
  /** Remaining statement due in the PAY_IN_FULL sense (after mid-cycle payments). */
  remainingDueCents: Cents;
  minimumDueCents: Cents;
  isEstimated: boolean;
  notes: string[];
}

/**
 * A card with a balance but nothing the engine can date. See
 * `CashNeededResult.unknownDueDateCards`.
 */
export interface UnknownDueDateCard {
  cardId: string;
  cardName: string;
  /** The card's current balance — stated as a balance, never as an amount "due". */
  currentBalanceCents: Cents;
}

export interface ObligationPoint {
  date: ISODate; // effective due date
  cards: { cardId: string; cardName: string; amountCents: Cents; autopayCents: Cents; isEstimated: boolean }[];
  dayTotalCents: Cents;
  cumulativeNeedCents: Cents;
  /** Projected payment-account balance after this day's flows AND card payments. */
  projectedBalanceAfterCents: Cents;
  shortfallCents: Cents; // max(0, −projectedBalanceAfter)
}

export interface CashNeededResult {
  scenario: Scenario;
  headline: {
    /** Total cash needed across all cards due this cycle. */
    requiredCents: Cents;
    /** Last effective due date this cycle (null when nothing is due). */
    byDate: ISODate | null;
    cardsDueCount: number;
    /** Worst projected dip below $0 across the whole window (0 if always covered). */
    shortfallCents: Cents;
    /** First date the projected balance goes negative (null if never). */
    shortfallDate: ISODate | null;
    /** Transfer suggestion: shortfall rounded UP to the next $50, one business day early. */
    recommendation: { amountCents: Cents; byDate: ISODate } | null;
  };
  perDueDate: ObligationPoint[];
  /** Every card, including $0-due and estimated ones (for the /cards page). */
  cards: CardObligation[];
  /**
   * Cards the engine could place NOTHING on: no generated statement AND no cycle
   * days to estimate from (a Plaid card whose issuer never returned liabilities is
   * the common case — nothing but this list distinguishes it from a card that is
   * genuinely paid off). These carry a real balance the user owes, so their absence
   * must never be rendered as "nothing is due": the honest claim is that we do not
   * know when they are due. Kept OUT of `cards`, every total, and every projection —
   * a figure we cannot support is never invented (#221 class).
   */
  unknownDueDateCards: UnknownDueDateCard[];
  /** Estimated next-cycle obligations (statement not yet generated) — informational. */
  upcoming: CardObligation[];
  intraPeriodMinimum: { date: ISODate; balanceCents: Cents } | null;
  /** Estimated next-cycle interest cost of the minimum path via the
   *  average-daily-balance method (MINIMUM scenario only; new purchases not projected). */
  minimumPathInterestCents: Cents | null;
  assumptions: string[];
}

/**
 * The undatable cards a user-facing surface should mention as an EXCLUDED
 * OBLIGATION — i.e. those carrying a non-zero balance. A $0 paid-off card is
 * undatable too (it lands in `unknownDueDateCards`, and /cards still lists it so
 * a connected card is never invisible — #277), but it owes nothing, so framing
 * it as "a card we're leaving out of what you owe" is a false alarm — the mirror
 * of the false all-clear the whole feature exists to prevent.
 *
 * ONE definition of that fence: the hero-null branch, the number/mixed branch,
 * the nudge, the payment-reminders count and the weekly digest all read it here,
 * so they cannot drift into disagreeing on one dashboard (the L.4 #277-critic
 * finding: three surfaces had). A NEGATIVE (credit / overpaid) balance is still
 * a real card we cannot date and IS mentioned, matching the hero panel's own
 * `!== 0` threshold. Pure; no allocation when nothing qualifies.
 */
export function undatedCardsWithBalance(result: CashNeededResult): UnknownDueDateCard[] {
  return result.unknownDueDateCards.filter((c) => c.currentBalanceCents !== 0);
}
