/**
 * Cash-Needed Engine — THE killer feature.
 *
 * Pure function: typed snapshot in, typed answer out. No I/O, no Date.now(),
 * no floats for money. Every rule here is pinned by a named unit test in
 * tests/unit/cash-needed.test.ts against the hand-computed values in
 * docs/EDGE_CASES.md §Cash-Needed.
 *
 * Binding rules (docs/PHASE_0_ARCHITECTURE.md §4, docs/DECISIONS.md):
 *  - Effective due date = issuer due date walked BACK to the prior business day
 *    when it falls on a weekend/holiday (conservative: funds early, never late).
 *  - Autopay cards are INCLUDED in cash required (money must be present) but
 *    EXCLUDED from "you must act" amounts; the autopay mode sets the amount.
 *    A card is never double-counted: cash required = max(scenario amount, autopay amount).
 *  - Mid-cycle payments reduce remaining due, floored at 0.
 *  - No statement yet → obligation estimated from current balance, labeled.
 *    Estimated obligations belong to the NEXT cycle (their close date is in the
 *    future) and are excluded from this cycle's headline & projection — unless
 *    there are no generated statements at all, in which case they ARE the answer.
 *  - The projection walks day by day; the shortfall check is the running
 *    minimum, not just due-date endpoints. Within a day: scheduled flows post
 *    first, then card payments (documented in assumptions).
 *  - Minimum-path interest: average-daily-balance method per card (APR÷365 × the
 *    cycle's average balance), grace-gated so paid-in-full cards carry no interest.
 */

import {
  type Cents,
  ZERO,
  averageDailyBalanceInterestCents,
  cents,
  floorAtZero,
  formatCents,
  maxCents,
  minCents,
  roundHalfAwayFromZero,
  roundUpToNext50Dollars,
  subCents,
  sumCents,
} from '@/lib/money';
import {
  type ISODate,
  addDays,
  addMonthsClamped,
  compareDates,
  daysBetween,
  formatISODate,
  isWeekend,
  previousBusinessDay,
  priorBusinessDayIfNonBusiness,
} from '@/lib/dates';
import type {
  CardObligation,
  CardSnapshot,
  CashNeededInput,
  CashNeededResult,
  ObligationPoint,
  Scenario,
} from './types';

/**
 * Estimated minimum payment when a statement hasn't generated: max($35, 1% of balance).
 * Exported so the Plaid mapper can mirror this EXACT estimate when a real statement
 * arrives without a `minimum_payment_amount` (DECISIONS #132) — one definition, no drift.
 */
export function estimateMinimumPayment(balance: Cents): Cents {
  return maxCents(cents(3500), roundHalfAwayFromZero(balance / 100));
}

function buildObligation(
  card: CardSnapshot,
  scenario: Scenario,
  today: ISODate,
  holidays: readonly ISODate[],
  assumptions: Set<string>,
): CardObligation | null {
  const notes: string[] = [];
  let statementBalance: Cents;
  let minimumPayment: Cents;
  let dueDate: ISODate;
  let isEstimated: boolean;

  if (card.statement) {
    ({ statementBalanceCents: statementBalance, minimumPaymentCents: minimumPayment, dueDate } = card.statement);
    isEstimated = false;
  } else {
    if (card.nextDueDate === undefined) return null; // nothing knowable about this card
    statementBalance = card.currentBalanceCents;
    minimumPayment = card.currentBalanceCents > 0 ? estimateMinimumPayment(card.currentBalanceCents) : ZERO;
    dueDate = card.nextDueDate;
    isEstimated = true;
    if (statementBalance > 0) {
      const msg = `${card.name}: statement not generated yet — due amount estimated from the current balance (${formatCents(statementBalance)}).`;
      notes.push(msg);
      assumptions.add(msg);
    }
  }

  const remainingDue = floorAtZero(subCents(statementBalance, card.paymentsAppliedCents));
  if (card.paymentsAppliedCents > 0 && statementBalance > 0) {
    notes.push(
      `${formatCents(card.paymentsAppliedCents)} already paid this cycle — remaining due ${formatCents(remainingDue)}.`,
    );
  }
  const minimumDue = floorAtZero(
    subCents(minCents(minimumPayment, statementBalance), card.paymentsAppliedCents),
  );

  // What this scenario asks the user to pay on this card.
  const scenarioTarget = scenario === 'PAY_IN_FULL' ? remainingDue : minimumDue;

  // What autopay will actually move, regardless of scenario.
  let autopayAmount: Cents = ZERO;
  if (card.autopay) {
    switch (card.autopay.mode) {
      case 'STATEMENT_BALANCE':
        autopayAmount = remainingDue;
        break;
      case 'MINIMUM':
        autopayAmount = minimumDue;
        break;
      case 'FIXED_AMOUNT':
        autopayAmount = minCents(card.autopay.fixedAmountCents ?? ZERO, remainingDue);
        break;
    }
  }

  // The cash that must be present: the larger of what the scenario wants and
  // what autopay will pull anyway. Counted exactly once.
  const cashRequired = maxCents(scenarioTarget, autopayAmount);
  const userAction = floorAtZero(subCents(scenarioTarget, autopayAmount));

  if (card.autopay && cashRequired > 0) {
    if (userAction === 0) {
      notes.push(`Autopay handles this payment — ensure funds are present by the due date.`);
    } else {
      notes.push(
        `Autopay covers ${formatCents(autopayAmount)}; you must pay the remaining ${formatCents(userAction)} yourself.`,
      );
    }
  }

  if ((card.postCloseCreditCents ?? 0) > 0) {
    notes.push(
      `A ${formatCents(card.postCloseCreditCents as Cents)} credit posted after statement close — it reduces your next statement, not this amount due.`,
    );
  }

  // Effective due date: business-day walk-back, never before today.
  let effectiveDueDate = priorBusinessDayIfNonBusiness(dueDate, holidays);
  if (compareDates(effectiveDueDate, dueDate) !== 0) {
    const reason = isWeekend(dueDate) ? 'a weekend' : 'a holiday';
    const msg = `${card.name}: due date ${formatISODate(dueDate)} falls on ${reason} — treated as due ${formatISODate(effectiveDueDate)} (conservative: pay by the prior business day).`;
    notes.push(msg);
    assumptions.add(msg);
  }
  if (compareDates(effectiveDueDate, today) < 0) {
    if (cashRequired > 0) notes.push(`Due date has passed — treated as due today.`);
    effectiveDueDate = today;
  }

  return {
    cardId: card.id,
    cardName: card.name,
    dueDate,
    effectiveDueDate,
    cashRequiredCents: cashRequired,
    autopayCents: minCents(autopayAmount, cashRequired),
    userActionCents: userAction,
    remainingDueCents: remainingDue,
    minimumDueCents: minimumDue,
    isEstimated,
    notes,
  };
}

export function computeCashNeeded(input: CashNeededInput): CashNeededResult {
  const { today, scenario, holidayTable: holidays } = input;
  const assumptions = new Set<string>();

  const allObligations: CardObligation[] = [];
  for (const card of input.cards) {
    const ob = buildObligation(card, scenario, today, holidays, assumptions);
    if (ob) allObligations.push(ob);
  }

  // "This cycle" = generated statements. Estimated (not-yet-generated) statements
  // close in the future, so they are next cycle — informational unless there is
  // no generated statement at all.
  const real = allObligations.filter((o) => !o.isEstimated);
  const estimated = allObligations.filter((o) => o.isEstimated);
  const cycleObligations = real.length > 0 ? real : estimated;
  const upcoming = real.length > 0 ? estimated : [];

  const due = cycleObligations
    .filter((o) => o.cashRequiredCents > 0)
    .sort((a, b) => compareDates(a.effectiveDueDate, b.effectiveDueDate) || a.cardName.localeCompare(b.cardName));

  const requiredCents = sumCents(due.map((o) => o.cashRequiredCents));
  const byDate = due.length > 0 ? due[due.length - 1].effectiveDueDate : null;

  // ── Day-by-day projection from today through the last due date ──
  let startBalance = input.paymentAccount.balanceCents;
  const pendingTotal = sumCents(input.paymentAccount.pending.map((p) => p.amountCents));
  if (input.paymentAccount.pending.length > 0) {
    startBalance = cents(startBalance + pendingTotal);
    assumptions.add(
      `${input.paymentAccount.pending.length} pending transaction(s) totaling ${formatCents(pendingTotal)} applied to today's balance once (not re-counted when they post).`,
    );
  }

  const flowsByDate = new Map<ISODate, Cents>();
  if (byDate) {
    for (const s of input.scheduled) {
      if (compareDates(s.date, today) >= 0 && compareDates(s.date, byDate) <= 0) {
        flowsByDate.set(s.date, cents((flowsByDate.get(s.date) ?? 0) + s.amountCents));
      }
    }
  }
  const dueByDate = new Map<ISODate, CardObligation[]>();
  for (const o of due) {
    const list = dueByDate.get(o.effectiveDueDate) ?? [];
    list.push(o);
    dueByDate.set(o.effectiveDueDate, list);
  }

  let balance = startBalance;
  let minPoint: { date: ISODate; balanceCents: Cents } | null = null;
  let firstNegativeDate: ISODate | null = null;
  let worstDip: Cents = ZERO;
  const points: ObligationPoint[] = [];
  let cumulative: Cents = ZERO;

  if (byDate) {
    assumptions.add(
      'Within a day, scheduled deposits/withdrawals post before card payments are drawn.',
    );
    for (let d = today; compareDates(d, byDate) <= 0; d = addDays(d, 1)) {
      balance = cents(balance + (flowsByDate.get(d) ?? 0));
      const todaysCards = dueByDate.get(d);
      if (todaysCards) {
        const dayTotal = sumCents(todaysCards.map((o) => o.cashRequiredCents));
        balance = subCents(balance, dayTotal);
        cumulative = cents(cumulative + dayTotal);
        points.push({
          date: d,
          cards: todaysCards.map((o) => ({
            cardId: o.cardId,
            cardName: o.cardName,
            amountCents: o.cashRequiredCents,
            autopayCents: o.autopayCents,
            isEstimated: o.isEstimated,
          })),
          dayTotalCents: dayTotal,
          cumulativeNeedCents: cumulative,
          projectedBalanceAfterCents: balance,
          shortfallCents: floorAtZero(cents(-balance)),
        });
      }
      if (minPoint === null || balance < minPoint.balanceCents) {
        minPoint = { date: d, balanceCents: balance };
      }
      if (balance < 0) {
        if (firstNegativeDate === null) firstNegativeDate = d;
        if (cents(-balance) > worstDip) worstDip = cents(-balance);
      }
    }
  }

  let recommendation: { amountCents: Cents; byDate: ISODate } | null = null;
  if (worstDip > 0 && firstNegativeDate) {
    // One business day ahead of the first short date — but never dated in the
    // past: if the shortfall is today (or the prior business day already
    // passed), the answer is "transfer TODAY".
    const ideal = previousBusinessDay(firstNegativeDate, holidays);
    recommendation = {
      amountCents: roundUpToNext50Dollars(worstDip),
      byDate: compareDates(ideal, today) < 0 ? today : ideal,
    };
  }
  if (recommendation) {
    assumptions.add(
      'Transfer recommendation is the projected shortfall rounded UP to the next $50, timed one business day before the first short date.',
    );
  }

  // ── Minimum-path interest (average-daily-balance method — see DECISIONS #29, supersedes #5/#21) ──
  // For each card not paid in full, interest accrues on the average daily balance
  // of the NEXT cycle [statement close → next close]: the full statement balance
  // until the minimum posts on the due date, then the carried balance after, at
  // the daily periodic rate (APR ÷ 365). Paying in full (incl. STATEMENT_BALANCE
  // autopay) carries nothing → no interest (grace period preserved). New purchases
  // are not projected.
  let minimumPathInterestCents: Cents | null = null;
  if (scenario === 'MINIMUM') {
    const perCard = cycleObligations.map((o) => {
      const card = input.cards.find((c) => c.id === o.cardId);
      if (!card) return ZERO;
      const actuallyPaid = maxCents(o.minimumDueCents, o.autopayCents);
      const carried = floorAtZero(subCents(o.remainingDueCents, actuallyPaid));
      if (carried <= 0) return ZERO; // paid in full → grace period, no interest

      // Cycle bounds: the statement's close → the next close one month later.
      // Estimate path (no generated statement) uses the projected cycle dates.
      const close = card.statement?.cycleEnd ?? card.nextCycleCloseDate;
      const due = card.statement?.dueDate ?? card.nextDueDate;
      if (!close || !due) return ZERO; // can't date the cycle → no estimate
      const cycleDays = daysBetween(close, addMonthsClamped(close, 1));
      const daysAtStartBalance = daysBetween(close, due);

      return averageDailyBalanceInterestCents({
        startBalanceCents: o.remainingDueCents, // full balance until the min posts
        endBalanceCents: carried, // carried balance after the min posts
        aprBps: card.aprBps,
        cycleDays,
        daysAtStartBalance,
      });
    });
    minimumPathInterestCents = sumCents(perCard);
    assumptions.add(
      'Minimum-path interest uses the average-daily-balance method: each card’s daily periodic rate (APR ÷ 365) times its average balance over the next cycle — the full statement balance until the minimum posts on the due date, then the carried balance — summed across the cycle. New purchases are not projected, and any mid-cycle payment already made is treated as reducing the balance from the statement’s close date (its exact posting date is not modeled).',
    );
  }

  return {
    scenario,
    headline: {
      requiredCents,
      byDate,
      cardsDueCount: due.length,
      shortfallCents: worstDip,
      shortfallDate: firstNegativeDate,
      recommendation,
    },
    perDueDate: points,
    cards: allObligations,
    upcoming,
    intraPeriodMinimum: minPoint,
    minimumPathInterestCents,
    assumptions: [...assumptions],
  };
}
