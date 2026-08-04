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
 *  - Mid-cycle payments reduce remaining due, floored at 0. They arrive from two
 *    channels: stored `CardPayment` rows (the reader's own record) and payments
 *    DERIVED from the transaction feed at read time. Nothing writes the derived
 *    ones — see `detected-payments.ts` and DECISIONS #401 for the admission rule
 *    and every refusal. Until #401 the stored channel had no production writer at
 *    all, so on a real card this line described nothing (audit P0-1).
 *  - No statement yet → obligation estimated from current balance, labeled.
 *    Estimated obligations belong to the NEXT cycle (their close date is in the
 *    future) and are excluded from this cycle's headline & projection — unless
 *    the issuer has never billed this reader at all, in which case they ARE the
 *    answer. "Never billed" is NOT the same fact as "billed and already paid off",
 *    though both arrive here as `statement: null`; `hasSettledStatement` separates
 *    them. Reading the two as one hands a reader who has just paid everything off
 *    his whole current balance as this cycle's headline, dated a month out.
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
import {
  currentCycleAmountSource,
  frozenCardsNote,
  frozenFundingNote,
} from '@/lib/engine/account/feed-dropped-view';
import type {
  CardObligation,
  CardSnapshot,
  CashNeededInput,
  CashNeededResult,
  ObligationPoint,
  Scenario,
  UnknownDueDateCard,
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
    // Rides out with the money (TASKS L.18). Every surface that prints one of the amounts above
    // reads it from this object, and none of them renders `assumptions`.
    frozenSince: card.frozenSince ?? null,
    // C.11 critic P0-1: the provenance gate must be able to see a typed figure.
    isManual: card.manual === true,
  };
}

export function computeCashNeeded(input: CashNeededInput): CashNeededResult {
  const { today, scenario, holidayTable: holidays } = input;
  const assumptions = new Set<string>();

  const allObligations: CardObligation[] = [];
  // Cards buildObligation could place nothing on. Previously these were dropped on
  // the floor, so a card whose issuer never sent a statement was INDISTINGUISHABLE
  // from a paid-off card — and the UI rendered the resulting empty set as the
  // positive claim "no card payments are due this cycle", which is a money claim
  // the data does not support. Carry them out instead, so every surface can say
  // what is actually true: we do not know when this card is due.
  const unknownDueDateCards: UnknownDueDateCard[] = [];
  for (const card of input.cards) {
    const ob = buildObligation(card, scenario, today, holidays, assumptions);
    if (ob) allObligations.push(ob);
    else
      unknownDueDateCards.push({
        cardId: card.id,
        cardName: card.name,
        currentBalanceCents: card.currentBalanceCents,
        frozenSince: card.frozenSince ?? null,
      });
  }
  if (unknownDueDateCards.length > 0) {
    // Every other exclusion in this engine states itself in `assumptions`; an
    // excluded CARD is the biggest one there is, so it belongs in the same
    // disclosure rather than only in the surfaces that opted in (critic F-16).
    assumptions.add(
      `${unknownDueDateCards.length} card(s) are excluded from every figure here — no statement and no cycle dates, so nothing about them can be dated: ${unknownDueDateCards
        .map((c) => c.cardName)
        .join(', ')}.`,
    );
  }

  // "This cycle" = generated statements. Estimated (not-yet-generated) statements
  // close in the future, so they are next cycle — informational unless there is
  // no generated statement at all.
  const real = allObligations.filter((o) => !o.isEstimated);
  const estimated = allObligations.filter((o) => o.isEstimated);
  // A card whose statements are all SETTLED has generated statements — its
  // estimate is next cycle, exactly like a card sitting beside an unpaid one.
  // Reading `real.length === 0` alone as "this issuer has never billed you"
  // hands a reader who just paid everything off his whole current balance as the
  // headline, dated a month out (C.6). Both facts reach this function as
  // `statement: null`; `hasSettledStatement` is what separates them.
  const thisCycleIsKnown = real.length > 0 || input.cards.some((c) => c.hasSettledStatement === true);
  const cycleObligations = thisCycleIsKnown ? real : estimated;
  const upcoming = thisCycleIsKnown ? estimated : [];

  const due = cycleObligations
    .filter((o) => o.cashRequiredCents > 0)
    .sort((a, b) => compareDates(a.effectiveDueDate, b.effectiveDueDate) || a.cardName.localeCompare(b.cardName));

  const requiredCents = sumCents(due.map((o) => o.cashRequiredCents));
  const byDate = due.length > 0 ? due[due.length - 1].effectiveDueDate : null;

  // ── Day-by-day projection from today through the last due date ──
  // TASKS L.14 / critic F-1. Everything below walks forward from this ONE number, so when the bank
  // has stopped sharing the funding account it is not merely stale, it is the base of every figure
  // this engine reports — the shortfall, the by-date, the transfer recommendation, and the
  // "you're covered" verdict. NOT adjusted: inventing a lower balance would fabricate. Disclosed
  // instead, on the surface that gives the instruction, because a frozen-HIGH balance reports
  // shortfall $0 and no recommendation while the real account cannot cover the autopay.
  // The CARD side of the same problem (critics P1-6/P1-7). A card whose bank stopped sharing it
  // still produces obligations here, and the surfaces that print those amounts said nothing.
  //
  // TWO CORRECTIONS TO WHAT L.14 SHIPPED HERE, both found by re-reading this function rather than
  // trusting the comment that stood in this spot (TASKS L.18):
  //
  //  1. The comment claimed `assumptions` is rendered by "/cards, the dashboard hero, the calendar,
  //     the Ask answer and the weekly digest". Only the dashboard hero renders it (plus the radar
  //     card only — /goals and /settings render a static planning string, not this array
  //     (critic P3-11). The four surfaces it named as covered were the
  //     four that were silent, and naming an unwired surface as covered is how a gap gets marked
  //     closed. Every one of them now carries its OWN sentence, resolved against the rows it prints
  //     and pointing only at what it holds; `frozenSince` rides each obligation so they can.
  //  2. The old sentence said a frozen card's "figures here are based on the last balance we saw",
  //     which is true only on the estimate path — with a statement, `buildObligation` reads the
  //     statement's balance, minimum and due date and never touches `currentBalanceCents`. It named
  //     a dependency the figure does not have while missing the two that bite: mid-cycle payments
  //     stop arriving with the feed, so money already paid is not subtracted, and no replacement
  //     statement arrives either. The copy module states the FEED stopping, which covers both paths.
  //
  // The array is rendered only in-app, so `accounts-route` is honest for every reader of it, and
  // `role` splits per what the figure is FOR: the hero's own recommendation is an instruction.
  //
  // CRITIC P0-1, and it is the mistake this slice exists to correct, one level down: the first cut
  // resolved this over `input.cards` — every card the engine was handed. A card with no statement
  // AND no cycle days produces no obligation at all (it lands in `unknownDueDateCards`, contributes
  // $0, and has its own "excluded from every figure here" assumption two lines above), yet it took
  // the ESTIMATE branch and told the reader "the amount asked for here is worked out from the last
  // balance we saw". Two assumptions in one list contradicting each other, and the louder one was
  // false. Resolve against `due` — the exact rows summed into `requiredCents` — so the sentence
  // describes the figures this array qualifies. A frozen card that is merely LISTED carries its own
  // note on the row beside its own amounts.
  //
  // CRITIC P1-4 corrects the correction: narrowing to `due` alone dropped `upcoming`, and those are
  // the ESTIMATE-path obligations whose amount IS the frozen balance verbatim. The hero prints them
  // as "est. — next cycle" beside a surviving assumption that names the frozen figure and calls it
  // "the current balance" — vouching for it. The honest set is every obligation carrying an amount
  // a surface states, this cycle or next; a $0 card and an undatable one are still excluded,
  // because neither is in any figure.
  const dueIds = new Set(
    [...due, ...upcoming.filter((o) => o.cashRequiredCents > 0)].map((o) => o.cardId),
  );
  const frozenCards = input.cards.filter((c) => c.frozenSince != null && dueIds.has(c.id));
  const frozenCardsAssumption = frozenCardsNote(
    frozenCards.map((c) => ({
      cardId: c.id,
      label: c.name,
      frozenSince: c.frozenSince as string,
      amountSource: currentCycleAmountSource(c.statement === null),
      // This engine is pure and is handed a household-MERGED account list carrying no ownership,
      // so at household scope it cannot tell whose card this is. It says "the bank" rather than
      // asserting "your bank" over a partner's (critic P1-1).
      ownership: 'unknown' as const,
    })),
    { role: 'figure', nextStep: 'accounts-route' },
  );
  if (frozenCardsAssumption) assumptions.add(frozenCardsAssumption);
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
  // The funding account's own disclosure sits HERE rather than beside the card one above, because
  // its role depends on what this run produced (critic P2-3): the first cut hardcoded
  // `'instruction'` and printed "Treat the amount as a floor and check the account first" on a
  // COVERED hero — where there is no shortfall, no transfer, and no amount on screen for "the
  // amount" to refer to. `recommendation` is the surface's own answer to "did I state one?", and it
  // is the same rule the Ask answer applies to the same result.
  if (input.paymentAccount.frozenSince != null) {
    assumptions.add(
      frozenFundingNote(
        {
          label: input.paymentAccount.name,
          frozenSince: input.paymentAccount.frozenSince,
          balanceCents: input.paymentAccount.balanceCents,
        },
        { role: recommendation ? 'instruction' : 'figure', nextStep: 'accounts-route' },
      ),
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
    unknownDueDateCards,
    upcoming,
    intraPeriodMinimum: minPoint,
    minimumPathInterestCents,
    fundingFrozen:
      input.paymentAccount.frozenSince != null
        ? {
            frozenSince: input.paymentAccount.frozenSince,
            balanceCents: input.paymentAccount.balanceCents,
          }
        : null,
    assumptions: [...assumptions],
  };
}
