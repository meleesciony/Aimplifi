/**
 * Cash Flow Radar engine (DECISIONS #172 — AI plan §1.2, adjudicated build-now;
 * Competitive-Gap plan Gap 2 §1, the "commit-only alarm variant").
 *
 * Forward-simulates the payment (checking) account across the horizon by
 * merging the SAME inputs the existing surfaces already trust:
 *   - committed scheduled flows + loan payments (exactly /forecast's events), and
 *   - card payment obligations from the cash-needed engine (this cycle's real
 *     statements, plus future cycles estimated from this cycle and LABELED so —
 *     adjudicated condition 3).
 * It reports the first projected dip below $0, names the card obligation the
 * dip follows, and proposes the minimum timed cover-transfer — deposit accounts
 * only (adjudicated condition 2). The AI does ZERO math anywhere here.
 *
 * The alarm `status` is computed from the COMMITTED line alone. The burn-rate
 * band (typical / heavy day-to-day spend pace) is a separately-labeled
 * estimate and can at most raise `watch`, never `alert` (adjudicated
 * condition 1 — alarm trust must not rest on the un-back-testable burn model).
 *
 * Differences from the cash-needed headline are deliberate and disclosed: the
 * radar walk ADDS loan payments (#134 keeps those out of the card-framed
 * headline), estimated future card cycles, and a longer horizon. Where both
 * model the same event they read identical inputs, so they cannot contradict.
 *
 * Pure: integer cents, ISO-date strings, no I/O, no `new Date()`.
 */
import {
  type ISODate,
  addDays,
  addMonthsClamped,
  compareDates,
  daysBetween,
  priorBusinessDayIfNonBusiness,
  previousBusinessDay,
} from '@/lib/dates';
import { type Cents, ZERO, cents, roundUpToNext50Dollars } from '@/lib/money';
import { computeForecast, type ForecastEvent } from '@/lib/engine/forecast/forecast';
import type { CardObligation } from '@/lib/engine/cash-needed/types';
import type { BurnRates } from './burn';

/** Committed-only first-negative within this many days ⇒ push-worthy (AI plan §1.2 guardrail). */
export const RADAR_PUSH_WINDOW_DAYS = 7;
/** Account types a cover transfer may be sourced from (adjudicated condition 2). */
export const TRANSFER_SOURCE_TYPES = new Set(['CHECKING', 'SAVINGS']);

export interface RadarCardDue {
  cardId: string;
  cardName: string;
  /** Effective (business-day adjusted) date the money must be present. */
  dueDate: ISODate;
  amountCents: Cents;
  /** True for not-yet-generated statements AND all synthesized future cycles. */
  isEstimated: boolean;
}

export interface RadarAccountLike {
  id: string;
  name: string;
  type: string;
  currentBalanceCents: number;
  /** YYYY-MM-DD the bank stopped sharing this account (Account.feedDroppedAt), else null.
   *  REQUIRED, not optional: a defaulted disclosure argument fails silent, and the cost of a
   *  caller forgetting it is this engine naming a frozen balance as money to move (TASKS L.14). */
  feedDroppedAt: string | null;
}

export interface RadarTransferSource {
  id: string;
  name: string;
  balanceCents: number;
  /** This single account could fund the whole transfer. */
  sufficient: boolean;
}

export interface RadarBandLine {
  lowestDate: ISODate;
  lowestCents: number;
  endingCents: number;
  firstNegativeDate: ISODate | null;
}

export interface RadarResult {
  today: ISODate;
  horizonDays: number;
  /** alert = committed line dips below $0; watch = only the heavy-burn band dips; ok = neither. */
  status: 'ok' | 'watch' | 'alert';
  committed: {
    firstNegativeDate: ISODate | null;
    lowestDate: ISODate;
    lowestCents: number;
    endingCents: number;
  };
  daysUntilFirstNegative: number | null;
  /** Committed-only dip within RADAR_PUSH_WINDOW_DAYS — the Gap-2 notification hook. */
  pushWorthy: boolean;
  /** Card dues on the dip date itself, else on the most recent due date before it. */
  collidingCards: RadarCardDue[];
  /** The committed events that land ON the dip date (what tips the balance under). */
  dipEvents: { label: string; amountCents: number }[];
  coverTransfer: {
    amountCents: Cents;
    byDate: ISODate;
    sources: RadarTransferSource[];
  } | null;
  burn:
    | (BurnRates & {
        expected: RadarBandLine | null; // typical pace; null until enough history
        conservative: RadarBandLine | null; // heavy pace; null until enough history
      })
    | null;
  includesEstimatedDues: boolean;
  /**
   * Set when a suspected same-card-twice pair is inside this projection (TASKS L.15, critic P1-2).
   * Carried on the RESULT, not only in `assumptions`, because the cash_flow_alert PUSH renders its
   * own body and never reads `assumptions` — and the push is where this alert does its damage.
   */
  duplicateDisclosure?: string | null;
  assumptions: string[];
}

/**
 * A cash-needed obligation enriched with the amount a TYPICAL cycle debits
 * checking — the full statement basis, NOT this cycle's post-mid-cycle-payment
 * residual (`cashRequiredCents`). Repeating the residual would understate every
 * future cycle for anyone who part-pays mid-cycle (critic #172 P1-1: the seed's
 * Freedom card is $1,000/cycle but $600 after a $400 mid-cycle payment).
 * Optional: estimate-path obligations (no statement) already carry the full
 * current balance in cashRequiredCents.
 */
export type ProjectableObligation = CardObligation & { cycleBasisCents?: Cents };

/**
 * Card dues for the radar walk: every obligation with money due inside the
 * horizon, PLUS synthesized future cycles — each card's known obligation
 * repeated monthly from its RAW issuer due date (stepping from the effective
 * date would drag one month's weekend shift into every later month), amount
 * held at this cycle's statement basis (cycleBasisCents, falling back to
 * cashRequiredCents), re-adjusted to the prior business day per occurrence,
 * and always labeled estimated (adjudicated condition 3).
 *
 * `obligations` must be the cash-needed result's `cards` array — the COMPLETE
 * per-card set (one entry per card: real or estimated). Passing `cards`
 * concatenated with `upcoming` would double-count estimated cards.
 */
export function projectCardDues(params: {
  obligations: readonly ProjectableObligation[];
  today: ISODate;
  horizonDays: number;
  holidays: readonly ISODate[];
}): { dues: RadarCardDue[]; assumptions: string[] } {
  const { obligations, today, horizonDays, holidays } = params;
  const horizonEnd = addDays(today, horizonDays);
  const assumptions = new Set<string>();
  const dues: RadarCardDue[] = [];

  for (const o of obligations) {
    // Current cycle: only when money is actually still due.
    if (o.cashRequiredCents > 0 && compareDates(o.effectiveDueDate, horizonEnd) <= 0) {
      dues.push({
        cardId: o.cardId,
        cardName: o.cardName,
        dueDate: o.effectiveDueDate,
        amountCents: o.cashRequiredCents,
        isEstimated: o.isEstimated,
      });
    }

    // Future cycles: monthly repeats of this card's typical-cycle amount.
    const futureAmount = o.cycleBasisCents ?? o.cashRequiredCents;
    if (futureAmount <= 0) continue; // a credit-balance statement is not a recurring debit
    for (let k = 1; ; k++) {
      const raw = addMonthsClamped(o.dueDate, k);
      if (compareDates(raw, horizonEnd) > 0) break;
      const effective = priorBusinessDayIfNonBusiness(raw, holidays);
      if (compareDates(effective, today) <= 0) continue; // stale anchor from a long-passed due date
      dues.push({
        cardId: o.cardId,
        cardName: o.cardName,
        dueDate: effective,
        amountCents: futureAmount,
        isEstimated: true,
      });
      assumptions.add(
        `Future card cycles are estimates: each card's next statements are assumed similar to this cycle's statement (statements not generated yet).`,
      );
    }
  }

  dues.sort(
    (a, b) => compareDates(a.dueDate, b.dueDate) || a.cardName.localeCompare(b.cardName),
  );
  return { dues, assumptions: [...assumptions] };
}

export interface RadarInput {
  today: ISODate;
  horizonDays: number;
  /** Payment-account balance with pending applied once (mirrors cash-needed). */
  startingBalanceCents: Cents;
  /** Scheduled income/bills + loan payments, already expanded — exactly /forecast's events. */
  committedEvents: readonly ForecastEvent[];
  cardDues: readonly RadarCardDue[];
  /** ALL accounts — the engine itself enforces the deposit-only source guardrail. */
  accounts: readonly RadarAccountLike[];
  paymentAccountId: string;
  holidays: readonly ISODate[];
  burn: BurnRates | null;
  /** Caller-supplied assumption lines (e.g. projectCardDues + pending-applied notes). */
  assumptions?: readonly string[];
}

/** Walk the committed daily path with a constant extra daily outflow applied from day 1. */
function bandLine(
  days: readonly { date: string; balanceCents: number }[],
  dailyCents: number,
): RadarBandLine {
  let lowest = { date: days[0].date as ISODate, balanceCents: days[0].balanceCents };
  let firstNegativeDate: ISODate | null = days[0].balanceCents < 0 ? (days[0].date as ISODate) : null;
  let ending = days[0].balanceCents;
  for (let d = 1; d < days.length; d++) {
    const bal = days[d].balanceCents - dailyCents * d;
    ending = bal;
    if (bal < lowest.balanceCents) lowest = { date: days[d].date as ISODate, balanceCents: bal };
    if (firstNegativeDate === null && bal < 0) firstNegativeDate = days[d].date as ISODate;
  }
  return {
    lowestDate: lowest.date,
    lowestCents: lowest.balanceCents,
    endingCents: ending,
    firstNegativeDate,
  };
}

export function computeRadar(input: RadarInput): RadarResult {
  const { today, horizonDays, holidays } = input;
  const assumptions = new Set<string>([
    'The committed line is your scheduled income and bills, loan payments, and card payment obligations — no spending estimate is mixed into it.',
    ...(input.assumptions ?? []),
  ]);

  // computeForecast anchors day 0 on the starting balance and applies only
  // future-dated events, so a card due TODAY must come off the anchor itself
  // (the cash-needed walk includes today the same way).
  let starting = input.startingBalanceCents;
  const dueToday = input.cardDues.filter((d) => compareDates(d.dueDate, today) === 0);
  const futureDues = input.cardDues.filter((d) => compareDates(d.dueDate, today) > 0);
  if (dueToday.length > 0) {
    for (const d of dueToday) starting = cents(starting - d.amountCents);
    assumptions.add(
      'A card payment due today is subtracted from today’s balance up front.',
    );
  }

  const dueEvents: ForecastEvent[] = futureDues.map((d) => ({
    date: d.dueDate,
    amountCents: -d.amountCents,
    label: d.isEstimated ? `${d.cardName} payment (estimated)` : `${d.cardName} payment`,
  }));

  const committed = computeForecast({
    today,
    startingBalanceCents: starting,
    horizonDays,
    events: [...input.committedEvents, ...dueEvents],
  });

  const firstNegativeDate = (committed.firstNegativeDate as ISODate | null) ?? null;

  // ── Attribution: which card does the dip follow, and what tips it under? ──
  let collidingCards: RadarCardDue[] = [];
  let dipEvents: { label: string; amountCents: number }[] = [];
  if (firstNegativeDate) {
    dipEvents =
      committed.days.find((day) => day.date === firstNegativeDate)?.events.filter((e) => e.amountCents < 0) ?? [];
    const onDipDate = input.cardDues.filter(
      (d) => compareDates(d.dueDate, firstNegativeDate) === 0,
    );
    if (onDipDate.length > 0) {
      collidingCards = onDipDate;
    } else {
      const before = input.cardDues.filter((d) => compareDates(d.dueDate, firstNegativeDate) < 0);
      if (before.length > 0) {
        const lastDate = before.reduce((m, d) => (compareDates(d.dueDate, m) > 0 ? d.dueDate : m), before[0].dueDate);
        collidingCards = before.filter((d) => compareDates(d.dueDate, lastDate) === 0);
      }
    }
  }

  // ── Minimum timed cover transfer (deposit accounts only) ──
  const worstDip: Cents = committed.lowest.balanceCents < 0 ? cents(-committed.lowest.balanceCents) : ZERO;
  let coverTransfer: RadarResult['coverTransfer'] = null;
  if (worstDip > 0 && firstNegativeDate) {
    const amountCents = roundUpToNext50Dollars(worstDip);
    const ideal = previousBusinessDay(firstNegativeDate, holidays);
    const byDate = compareDates(ideal, today) < 0 ? today : ideal;
    // A FROZEN account is never offered as a funding source (TASKS L.14, critic P0-2). Everywhere
    // else in the app a dropped account keeps counting and the app merely says so — only the user
    // knows whether it still exists. This is the one place that rule inverts, and the reason is
    // the failure direction, not consistency: a total that includes a stale balance is a figure
    // the reader can weigh, but "move $2,900 from Rainy Day Savings" is an INSTRUCTION, and the
    // frozen row sorts FIRST here because it is sorted by balance. Acting on it means a transfer
    // that bounces or never happens, and the card payment overdrafts. A fabricated instruction is
    // worse than an honest gap (the an-empty-set-is-not-a-fact lesson): with no eligible source
    // the engine already says so in `assumptions`.
    const sources: RadarTransferSource[] = input.accounts
      .filter(
        (a) =>
          a.id !== input.paymentAccountId &&
          TRANSFER_SOURCE_TYPES.has(a.type) &&
          a.currentBalanceCents > 0 &&
          a.feedDroppedAt == null,
      )
      .map((a) => ({
        id: a.id,
        name: a.name,
        balanceCents: a.currentBalanceCents,
        sufficient: a.currentBalanceCents >= amountCents,
      }))
      .sort((a, b) => b.balanceCents - a.balanceCents || a.name.localeCompare(b.name));
    coverTransfer = { amountCents, byDate, sources };
    assumptions.add(
      'Transfer proposal is the worst projected dip rounded UP to the next $50, timed one business day before the first short date. Sources are checking/savings accounts only.',
    );
    // Withholding a source silently would be its own defect (invariant D9): the reader may know
    // perfectly well that the account is still theirs and wonder why the app is ignoring it.
    const frozenSources = input.accounts.filter(
      (a) =>
        a.id !== input.paymentAccountId &&
        TRANSFER_SOURCE_TYPES.has(a.type) &&
        a.currentBalanceCents > 0 &&
        a.feedDroppedAt != null,
    );
    if (frozenSources.length > 0) {
      assumptions.add(
        frozenSources.length === 1
          ? `${frozenSources[0].name} is not offered as a source: your bank stopped sharing it, so its balance has not updated since ${frozenSources[0].feedDroppedAt}.`
          : `${frozenSources.length} accounts are not offered as sources: your bank stopped sharing them, so their balances have not updated since it did.`,
      );
    }
    if (sources.length === 0) {
      assumptions.add('No other checking or savings account is available to fund the transfer.');
    }
  }

  // ── Burn band (labeled estimate; never feeds the alarm) ──
  let burn: RadarResult['burn'] = null;
  if (input.burn) {
    const usable = input.burn.hasEnoughHistory;
    burn = {
      ...input.burn,
      expected: usable ? bandLine(committed.days, input.burn.typicalDailyCents) : null,
      conservative: usable ? bandLine(committed.days, input.burn.heavyDailyCents) : null,
    };
    if (usable) {
      assumptions.add(
        `Spending pace is estimated from the last ${input.burn.sampleDays} days of day-to-day checking outflows (bills, transfers, and card payments excluded). It is an estimate band, not part of the committed line.`,
      );
    }
  }

  const status: RadarResult['status'] =
    firstNegativeDate !== null ? 'alert' : burn?.conservative?.firstNegativeDate ? 'watch' : 'ok';
  const daysUntilFirstNegative = firstNegativeDate ? daysBetween(today, firstNegativeDate) : null;

  return {
    today,
    horizonDays,
    status,
    committed: {
      firstNegativeDate,
      lowestDate: committed.lowest.date as ISODate,
      lowestCents: committed.lowest.balanceCents,
      endingCents: committed.endingBalanceCents,
    },
    daysUntilFirstNegative,
    pushWorthy: daysUntilFirstNegative !== null && daysUntilFirstNegative <= RADAR_PUSH_WINDOW_DAYS,
    collidingCards,
    dipEvents,
    coverTransfer,
    burn,
    includesEstimatedDues: input.cardDues.some((d) => d.isEstimated),
    assumptions: [...assumptions],
  };
}
