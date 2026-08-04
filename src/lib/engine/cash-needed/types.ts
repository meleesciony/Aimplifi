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
  /**
   * TRUE when `statement` is null because every generated statement is PAID and
   * past due — not because the issuer has never generated one.
   *
   * Both facts arrive here as `statement: null`, and the engine's "unless there
   * is no generated statement at all" rule reads that null as the second. Before
   * C.6 the first was unreachable in production (nothing wrote `CardPayment`, so
   * no real card was ever fully paid); detecting payments makes it reachable
   * every month, in the days between a bill being settled and the next statement
   * issuing. Without this flag the reader who has just paid everything off is
   * handed his whole current balance as THIS cycle's headline — a bill the
   * issuer has not sent yet, dated a month out, replacing one phantom demand
   * with another.
   *
   * Absent/false on every hand-built fixture, so the partition is unchanged for
   * a card that genuinely has no statement.
   */
  hasSettledStatement?: boolean;
  /** A refund/credit that posted after statement close (informational; does not reduce this statement). */
  postCloseCreditCents?: Cents;
  /** YYYY-MM-DD the bank stopped sharing this card, else null/absent (TASKS L.14).
   *
   *  The original of this comment claimed the engine's `assumptions` are rendered by "/cards, the
   *  dashboard hero, the calendar, the Ask answer and the weekly digest". Only the hero and the
   *  radar card render that array; the other four were the surfaces that stayed SILENT, which is
   *  what L.18 exists to fix (critic P3-1 — the correction was written in engine.ts and this copy
   *  of the false claim was left standing). Each surface now carries its own sentence, and
   *  `CardObligation.frozenSince` is what lets them. The engine adjusts nothing either way. */
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
  /**
   * YYYY-MM-DD the bank stopped sharing this card, else null (TASKS L.18).
   *
   * Rides the OBLIGATION rather than being re-queried per surface, because every surface that
   * prints one of the amounts above reads it from here: /cards, the payment reminders card, the
   * reminder email, the weekly digest, web push and the radar's projected cycles. L.14 disclosed
   * the same fact once in `assumptions` and assumed that reached them; only the dashboard hero
   * renders `assumptions`, so the fact has to travel with the money.
   *
   * REQUIRED, never optional: a caller that forgets it gets silence at exactly the moment the
   * number is least trustworthy (the L.15 defaulted-argument lesson, and L.14's own reason for
   * making `RadarAccountLike.feedDroppedAt` required).
   */
  frozenSince: string | null;
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
  /** YYYY-MM-DD the bank stopped sharing this card, else null (TASKS L.18). The surfaces that
   *  list these cards print `currentBalanceCents` verbatim, so on a frozen card they are quoting
   *  a number that stopped moving — the one figure here that is purely a balance. */
  frozenSince: string | null;
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
  /**
   * YYYY-MM-DD the bank stopped sharing the FUNDING account this projection walks from, else null
   * (TASKS L.18, from L.14 critic F-1). Carried on the result because the shortfall, the by-date,
   * the transfer recommendation and the "you're covered" verdict all rest on that one balance, and
   * the surfaces that state them — the Ask answer, the reminder email, the weekly digest, push —
   * compose their own copy and never read `assumptions`.
   *
   * The account's NAME is deliberately not carried: every surface already prints its own label for
   * it (`paymentAccountName`), and a disclosure must name the row the way the reader sees it named.
   * The frozen BALANCE is carried, because a surface that does not otherwise print it can then say
   * WHICH number stopped moving instead of merely that one did — and one nullable object keeps the
   * date and the amount from ever disagreeing about whether there is anything to disclose.
   */
  fundingFrozen: { readonly frozenSince: string; readonly balanceCents: Cents } | null;
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
