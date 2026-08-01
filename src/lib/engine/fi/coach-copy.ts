/**
 * EVERY user-facing FI-Coach string lives here, so coach-copy.test.ts can scan
 * them exhaustively for the guardrails:
 *  - educational, never advisory; no security/ticker recommendations
 *  - zero shame language (no "you wasted", "stop buying", "guilty", …)
 *  - every projection states its assumptions inline
 *  - spending on the user's money dials is encouraged, not policed
 */

import { formatCents, type Cents } from '@/lib/money';
import { formatISODate, formatMonth, type ISODate } from '@/lib/dates';
import type { FrozenFunding } from '@/lib/engine/account/feed-dropped-view';
import type { Opportunity, CreepResult, MonthlyFlow } from './insights';
// The basis sentence decides WHICH claim to make from the same engine the figures come from —
// a guard reading exactly what it guards, rather than a second rule about the dials that can
// drift from the arithmetic (it already had, by 1,579 horizon-cases).
import { OPPORTUNITY_HORIZON_MONTHS, opportunityValueTrailsContributions } from './fi';

/**
 * The cash-needed cover transfer, as the Money Review consumes it.
 *
 * Declared ONCE and imported by `money-review.ts` rather than re-declared there (TASKS L.18): both
 * composers emit the same instruction through `nextActionTransfer`, and two structurally-identical
 * local types are how one of them gains a required disclosure field and the other silently does not
 * (`dedup-must-diff-the-copies-first.md` — here the copies were genuinely identical, so sharing is
 * safe and the shared shape is what makes the new field unforgettable).
 */
export interface PendingTransfer {
  amountCents: Cents;
  byDate: string;
  /**
   * The funding account behind the amount, when its bank has stopped sharing it (TASKS L.18).
   * REQUIRED so neither composer can omit it: a transfer figure derived from a balance that stopped
   * updating is a floor, and this instruction is both printed on /coach and mailed in the digest.
   */
  frozenFunding: FrozenFunding | null;
}

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const pct1 = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export const COACH_COPY = {
  savingsRateHeadline: (rateBps: number, monthLabel: string) =>
    rateBps >= 0
      ? `You kept ${pct1(rateBps)} of your after-tax income in ${monthLabel} — savings rate, not returns, is what moves your FI date.`
      : `Spending outpaced income in ${monthLabel}. One month is weather, not climate — the trend below is what matters.`,

  savingsRateNoIncome: (monthLabel: string) =>
    `No income landed in ${monthLabel}, so there's no savings rate to compute — the trend below still tells the story.`,

  fiNumber: (fi: Cents, swrBps: number, annualExpenses: Cents) =>
    `Your FI number is ${formatCents(fi)}, assuming a ${pct(swrBps)} safe withdrawal rate on ${formatCents(annualExpenses)}/yr of spending — estimated from your last 6 full months × 2, so an unusual month moves it.`,

  // ---- W.2 · the FI projections' basis --------------------------------------------------
  // Every projection on this card compounds at the REAL return, because the FI number it is
  // aiming at is built from TODAY'S spending. The three sentences below therefore say "after
  // inflation" and are handed the REAL rate; `fiProjectionBasis` is where that rate's origin
  // is shown, once, rather than three times.

  yearsToFI: (years: number, months: number, realReturnBps: number) =>
    `At your current savings rate you'd reach it in about ${years} years${months > 0 ? ` ${months} months` : ''}, assuming ${pct(realReturnBps)} average annual growth after inflation. Markets wobble — reasonable beats rational, and this number will too.`,

  /**
   * The provenance line for the rate the three projections above and below compound at.
   *
   * The floored branch may NOT print the subtraction — `pct(nominal)` less `pct(inflation)`
   * is not 0.00%, and a reader can do that arithmetic in their head and get a different
   * answer (`the-arithmetic-was-never-the-risk`). It says what the floor MEANS and which
   * direction it errs in instead, because a clamp that flatters is the expensive one.
   *
   * `inflationIsDefault` decides a possessive, not a decoration: `User.inflationBps` is
   * nullable, and /settings calls the same 2.50% "our defaults", so the card may not call it
   * "yours" until the reader has set one.
   */
  fiProjectionBasis: (
    realReturnBps: number,
    nominalBps: number,
    inflationBps: number,
    realReturnFloored: boolean,
    inflationIsDefault: boolean,
  ) => {
    const infl = inflationIsDefault
      ? `our default ${pct(inflationBps)} inflation assumption`
      : `your ${pct(inflationBps)} inflation assumption`;
    // The monthly figures on this card are LEVEL contributions compounded at a REAL rate,
    // which by the engine's own convention (`retirement.ts`) means they are today's dollars
    // and a standing order left alone falls behind. The sibling wealth card says so about its
    // own instalment; before W.2 this card's figure was nominal and needed no such clause, and
    // changing the rate silently changed what the dollars MEAN. Said once here, for every
    // figure on the card, rather than bolted onto each sentence.
    const money = `Dollar figures here are in today's money too, so a standing order set once and left alone would need to rise with inflation to keep the pace they describe.`;
    if (realReturnFloored) {
      // Equal dials are not "at or below" in a reader's ear — "7.00% is at or below 7.00%"
      // reads as a bug. Same clamp, same silence about the subtraction, honest wording.
      const relation =
        nominalBps === inflationBps
          ? `Your ${pct(nominalBps)} return assumption exactly matches ${infl}`
          : `Your ${pct(nominalBps)} return assumption is below ${infl}`;
      return `Dates on this card are in today's money. ${relation}, so they are worked out assuming no growth after inflation at all — and if inflation really did outrun returns, they would arrive later than they say, not sooner. ${money}`;
    }
    // NO "years earlier": the gap between the two bases is months for a reader near their
    // number and exactly zero for one a month out — both critics measured it independently.
    // The card has no cheap access to the true gap, so it states the DIRECTION, which is
    // always true, instead of a magnitude that is often false.
    return `Dates on this card are in today's money: your FI number is built from what you spend now, so the portfolio is grown at ${pct(realReturnBps)} — your ${pct(nominalBps)} return assumption less ${infl}. A date at the full ${pct(nominalBps)} would arrive sooner and buy less than it looks like. ${money}`;
  },

  /**
   * `monthsToFI` returns `null` for TWO different reasons — savings at or below zero, and
   * positive savings that do not clear the target inside the engine's 1200-month cap — and
   * this sentence asserts the first one as fact. Both W.2 critics found the same consequence
   * independently: at a low or floored real rate a reader saving $500/month is told
   * "contributions aren't outpacing spending", because the cap now binds on a clean threshold
   * (savings below `fiTarget / 1200`). W.2 did not create the overload, but it WIDENED the set
   * of readers who land in it, so the states get separated here.
   *
   * Three facts, three sentences (`an-answer-is-only-as-believable-as-its-visible-inputs`:
   * count the states before choosing the type — a two-state model locks the missing third).
   */
  notOnTrack: () =>
    `Contributions aren't outpacing spending yet, so a projection date wouldn't be honest. The opportunities below are the highest-impact places to look — no small-pleasures audit required.`,

  /**
   * Not saving, but the portfolio alone already gets there — so the flat "a projection date
   * wouldn't be honest" sits directly above a Coast line handing the reader a date. Two
   * sentences that contradict each other on one card; this is the reconciling one.
   */
  notOnTrackButCoasting: () =>
    `Contributions aren't outpacing spending right now, so there's no date to project from your saving. What you've already invested is a different story — see the Coast line below.`,

  /**
   * Saving, but not fast enough to land inside the projection horizon. The honest answer is
   * the horizon, not a claim about the reader's behaviour.
   */
  beyondProjectionHorizon: (realReturnBps: number) =>
    `You are saving, but at this pace and ${pct(realReturnBps)} growth after inflation the finish line sits beyond the 100 years we're willing to project — so we won't put a date on it. The opportunities below move it more than any market assumption will.`,

  /**
   * WHICH of the four sentences above the FI card's headline slot gets — the selection itself,
   * not just the strings.
   *
   * Exported as one function because the alternative is a ternary chain living in the
   * component and a COPY of that chain living in the test, which is a lock that passes while
   * the card regresses. The card renders what this returns; the test calls this; there is one
   * definition of the mapping and both read it.
   */
  fiHeadline: (input: {
    monthsToFI: number | null;
    monthlySavingsCents: number;
    coastIsCoast: boolean;
    projectionReturnBps: number;
  }): string => {
    if (input.monthsToFI !== null) {
      return COACH_COPY.yearsToFI(
        Math.floor(input.monthsToFI / 12),
        input.monthsToFI % 12,
        input.projectionReturnBps,
      );
    }
    // Saving, but the engine's 1200-month cap bound — NOT the same fact as "not saving".
    if (input.monthlySavingsCents > 0) {
      return COACH_COPY.beyondProjectionHorizon(input.projectionReturnBps);
    }
    // Not saving, but already coasting — the flat refusal would contradict the Coast line.
    if (input.coastIsCoast) return COACH_COPY.notOnTrackButCoasting();
    return COACH_COPY.notOnTrack();
  },

  /**
   * W.9 — `targetYearsIsAppDefault` says who chose the horizon. `COAST_TARGET_YEARS` is the
   * app's 25, no control sets it, and an unlabelled constant printed beside a monthly dollar
   * figure reads as arbitrary — which is precisely what the owner said about the wealth card
   * one slice earlier ("arbitrary savings for arbitrary time").
   */
  coastFI: (targetYears: number, realReturnBps: number, targetYearsIsAppDefault: boolean) =>
    `You're already Coast FI: assuming ${pct(realReturnBps)} average growth after inflation, what you've invested would grow to your FI number within ${targetYears} years without another dollar added${targetYearsIsAppDefault ? ` — ${targetYears} years being the working lifetime we picked to measure against, not a date you set` : ''}.`,

  notCoastFI: (
    requiredMonthly: Cents,
    targetYears: number,
    realReturnBps: number,
    targetYearsIsAppDefault: boolean,
  ) =>
    `To be on pace over the next ${targetYears} years — ${targetYearsIsAppDefault ? `a working lifetime we picked to measure against, not a date you set` : `the horizon you set`} — it takes about ${formatCents(requiredMonthly)}/month in today's money, assuming ${pct(realReturnBps)} average growth after inflation.`,

  sliderCaption: (fromBps: number, toBps: number, fromYears: number, toYears: number) => {
    if (toBps === fromBps) {
      return `This is your current pace (${pct1(fromBps)} average over 6 months) — drag to see your FI date move. Same return assumptions throughout.`;
    }
    const direction = toBps > fromBps ? 'Raising' : 'Lowering';
    return `${direction} your savings rate from ${pct1(fromBps)} to ${pct1(toBps)} moves FI from ~${fromYears} years out to ~${toYears} years — return assumptions unchanged.`;
  },

  sliderContext: (avgBps: number, latestBps: number | null, latestMonthLabel?: string) =>
    latestBps !== null && Math.abs(latestBps - avgBps) >= 300
      ? `The slider uses your 6-month average pace (${pct1(avgBps)}); ${latestMonthLabel ?? 'your latest full month'} alone was ${pct1(latestBps)}.`
      : `The slider uses your 6-month average pace (${pct1(avgBps)}).`,

  // ---- Wealth target ("I want $10M — what do I need to do?") --------------------------
  // Every string here carries TWO assumptions, not one: the return rate AND the fact that
  // the target is read in today's dollars. Both are load-bearing — a $10M answer at a
  // nominal rate against a present-value goal would be optimistic by decades — so neither
  // is ever left to a footnote the reader might not open.

  wealthTargetBasis: (
    targetCents: Cents,
    realBps: number,
    nominalBps: number,
    inflationBps: number,
    realReturnFloored: boolean,
  ) =>
    // The floored branch may NOT print the subtraction: 7.00% less 10.00% is not 0.00%, and
    // a reader can do that arithmetic in their head. It says what the floor means instead.
    realReturnFloored
      ? `${formatCents(targetCents)} in today's money. Your ${pct(nominalBps)} return assumption is at or below your ${pct(inflationBps)} inflation assumption, so this is worked out assuming no growth after inflation at all — and if inflation really did outrun returns, anything below would arrive later than it says, not sooner.`
      : `${formatCents(targetCents)} in today's money, assuming ${pct(realBps)} growth after inflation — your ${pct(nominalBps)} return assumption less ${pct(inflationBps)} inflation. Every figure below is in today's dollars, so the target means what it means to you now.`,

  /**
   * The reconciliation sentence. /coach stacks this card under the FI card, and stacking two
   * cards that both print a date is the invitation to compare them.
   *
   * REWRITTEN by W.2, because what it used to say stopped being true. It read: "The
   * financial-independence card above assumes 7.00% before inflation, so its date is earlier
   * than anything here; this card takes your 2.50% inflation assumption off first." That
   * sentence existed to disclose a contradiction W.1 deliberately declined to fix — the FI
   * card grew the portfolio at the NOMINAL dial toward a present-value target — and W.2 has
   * now fixed it, so both cards run on the same rate in the same dollars. Leaving the old
   * words in place would have left the card asserting a difference that no longer exists, and
   * pointing at a card whose date had moved the other way.
   *
   * What remains different is the TARGET, not the basis, so that is what this now names. It
   * takes the real rate because that is the one both cards use; a sentence about agreement
   * should print the number they agree on.
   */
  wealthTargetVsFiCard: (realReturnBps: number) =>
    `The financial-independence card above is on the same footing as this one: both are in today's dollars, assuming the same ${pct(realReturnBps)} growth after inflation. What differs is the destination — that card aims at a number built from what you already spend, this one at the number you typed.`,

  /**
   * The STARTING BALANCE, printed for every outcome rather than only the already-there one.
   *
   * This is the figure whose absence made the card read as arbitrary (owner, 2026-07-31: "I set
   * 10 mil and it gave me some arbitrary savings for arbitrary time"). Both answers on the card
   * are computed FROM it — at $1.48M invested, $10M in 25 years genuinely needs a few hundred a
   * month, and a reader who cannot see the $1.48M has no way to believe the $349. A projection
   * that prints its destination and its instalment and hides its origin is asking to be trusted
   * on one of the three numbers that decide it.
   *
   * It also names what the balance COUNTS, because `getCoachData` sums `type === 'INVESTMENT'`
   * only — checking and savings are NOT in it, while the owner's own question said "from my
   * current investments and savings". Silently excluding a whole account class from a figure the
   * reader states a goal against is the `an-empty-set-is-not-a-fact-about-money` shape: the
   * exclusion is defensible (cash does not earn this return) and it is not self-evident, so it
   * is said rather than assumed.
   */
  wealthTargetStartingFrom: (portfolioCents: Cents) =>
    // Three claims, each independently checked (`a-disclosure-is-several-claims-in-one-sentence`):
    //  · the FIGURE and where it lives — `getCoachData` sums `type === 'INVESTMENT'` only;
    //  · its SCOPE — "every projection on this card" is true of the sensitivity rows too, which
    //    grow this same balance at ±2pp. An earlier draft said the balance grows "at 7.50% in
    //    everything below", which those three rows falsify, and which is positional besides —
    //    a sentence naming a position goes stale the moment the card is reordered;
    //  · the ASSUMPTION that makes the model coherent. Excluding cash on the ground that the
    //    rate is "a return on invested money, not on cash" read as a rule the very next sentence
    //    breaks, since the monthly figure it compounds IS the reader's leftover cash. The
    //    assumption was always there — the engine adds contributions to an invested balance —
    //    and it was the one thing the card never said.
    portfolioCents > 0
      ? `Starting from the ${formatCents(portfolioCents)} in your investment accounts today — the balance every projection on this card grows. Everyday checking and savings balances are not among them, and every figure here is worked out assuming what you put away each month is invested too rather than left as cash.`
      : `Starting from $0.00, because nothing in an investment account is counted toward this yet — so the whole target has to come from what you put away. Checking and savings balances are not counted in it, and every figure here is worked out assuming what you put away each month is invested rather than left as cash.`,

  /**
   * The pace figure, named rather than asserted. It was "Saving $23,888.10/month", which reads as
   * an instruction the app is giving and gives the reader nothing to check it against; it is in
   * fact `(income − expenses) / 6` over their last six COMPLETE months, i.e. what was left over,
   * not money observed moving into an investment account.
   */
  wealthTargetAtCurrentPace: (
    years: number,
    months: number,
    monthlyCents: Cents,
    realBps: number,
    averagedOverMonths: number,
  ) =>
    // The window is deliberately NOT given a count. `monthlySavings` divides by
    // `Math.max(1, last6.length)` over `fullFlows.slice(-6)`, and `monthlyFlows` only emits
    // months that HAVE qualifying rows — so the divisor is 3 for a reader three months in, and
    // the span can cover eight calendar months when two of them are empty. "Your last 6 complete
    // months" would be false in both, which is the #252 critic's finding one card over (see
    // `signatureSaving*` below, and `a-borrowed-total-imports-its-window`): the sentence added to
    // make a figure checkable is the sentence that makes it uncheckable.
    `At ${formatCents(monthlyCents)}/month — what was left after spending, averaged over the ${averagedOverMonths} month${averagedOverMonths === 1 ? '' : 's'} of yours Aimplifi has — you'd get there in about ${years} year${years === 1 ? '' : 's'}${months > 0 ? ` ${months} month${months === 1 ? '' : 's'}` : ''}, assuming ${pct(realBps)} growth after inflation and that what you put away keeps pace with inflation.`,

  /**
   * Where the horizon slider's OPENING position came from. Two branches, because a seeded
   * position and a fallback default are different claims: one is a fact about the reader's own
   * trajectory, the other is a number nobody chose. The old card printed "25 years" in the same
   * weight as the answer with no way to tell which it was.
   */
  // THREE states, not two. A boolean covered "seeded" and "fell back" and silently gave the
  // reader who had just DRAGGED the control the fallback sentence — "Nothing has picked this
  // date for you", printed one line under the thing they had picked it with.
  wealthTargetHorizonBasis: (basis: 'seeded' | 'chosen' | 'fallback') => {
    switch (basis) {
      case 'seeded':
        return `Set to the first whole year your current pace lands it — drag to see what moving the date does to the monthly figure.`;
      case 'chosen':
        return `This is the date you picked — the monthly figure is what it takes to land the target by then.`;
      case 'fallback':
        return `Nothing has picked this date for you — drag it to the year you actually want and the monthly figure follows.`;
    }
  },

  /**
   * The dials, named and pointed at. Two things this sentence may NOT say:
   *
   *  · **"your own settings"**, unqualified. `User.inflationBps` is nullable and /coach falls
   *    back to `RETIREMENT_ASSUMPTIONS.inflationBps`, so for a reader who never opened the
   *    retirement fieldset this card would call 2.50% "yours" while the page it links to calls
   *    the same number "our defaults" in as many words. The possessive is exactly the claim the
   *    owner asked to be made true, so it is the one that must not be faked.
   *  · **"every figure on this card moves"**. The target, the starting balance, the pace figure
   *    and the guilt-free figure are all inputs from elsewhere and move for none of it — an
   *    enumeration is a claim, and this one was false four times over.
   */
  wealthTargetDials: (nominalBps: number, inflationBps: number, inflationIsDefault: boolean) =>
    inflationIsDefault
      ? `${pct(nominalBps)} return is your setting; ${pct(inflationBps)} inflation is Aimplifi's default, which you haven't changed. How long the target takes, and what it costs a month, are worked out from these two.`
      : `Both rates are yours to change — ${pct(nominalBps)} return and ${pct(inflationBps)} inflation. How long the target takes, and what it costs a month, are worked out from these two.`,

  /**
   * The FI card's refusal, in this card's words: nothing is going in, so no date is honest.
   *
   * TWO reasons produce a floored contribution and they are not the same fact. Zero complete
   * months of activity divides 0 by 1 and floors exactly like real overspending does, so a
   * reader who linked an account yesterday was told their spending is running ahead of their
   * income — a claim about behaviour derived from an empty set, which is the one thing
   * `an-empty-set-is-not-a-fact-about-money` exists to forbid.
   */
  wealthTargetNotSaving: (averagedOverMonths: number) =>
    averagedOverMonths <= 0
      ? `There isn't a complete month of activity here yet, so there's nothing to work a pace out from — this fills in once a full month has gone by. What the target needs is below either way.`
      : `Spending is running ahead of income right now, so there's nothing going in to project from — a date here wouldn't be honest. What the target needs is below; the gap between that and today is the real answer.`,

  wealthTargetAlreadyThere: (portfolioCents: Cents, targetCents: Cents) =>
    `You have ${formatCents(portfolioCents)}, which is already past the ${formatCents(targetCents)} you named. Worth deciding what the number is for — a target you've passed is a good moment to name the next one.`,

  wealthTargetBeyondHorizon: (realBps: number) =>
    `At what's going in now, this target doesn't arrive within 100 years, assuming ${pct(realBps)} growth after inflation. The two levers are the amount you add each month and the number itself.`,

  wealthTargetOutOfRange: () =>
    `Enter a target between $0.01 and $100,000,000,000,000 and the plan fills in.`,

  wealthTargetNoAmount: () =>
    `Enter a target amount and this fills in. Nothing below describes a number until there's one to describe.`,

  wealthTargetRequired: (
    requiredMonthlyCents: Cents,
    years: number,
    realBps: number,
    inflationBps: number,
    /** W.2 critic P2 — this sentence called the inflation dial "your own assumption" while
     *  `wealthTargetDials`, 633px up the same card, called the same number "Aimplifi's
     *  default, which you haven't changed". A possessive is a claim, and it was false on the
     *  shared demo. Required, so no caller can go on omitting the question. */
    inflationIsDefault: boolean,
  ) =>
    // "In today's money" is the load-bearing clause. The simulation adds a LEVEL REAL
    // contribution, so a flat standing order set once loses ground every year and lands
    // short — the card says "every figure is in today's dollars" directly above, which
    // makes the omission worse by implying it is already handled.
    `To land it in ${years} year${years === 1 ? '' : 's'} it takes about ${formatCents(requiredMonthlyCents)}/month in today's money, assuming ${pct(realBps)} growth after inflation. A standing order set once and left alone would need to rise with inflation — ${pct(inflationBps)} a year ${inflationIsDefault ? 'on our default assumption' : 'on your own assumption'} — to keep that pace.`,

  /** The share of income, split out so it can be withheld when the denominator can't carry it. */
  wealthTargetRequiredShare: (rateBps: number) =>
    `That's ${pct1(rateBps)} of your average monthly income over the last 6 months.`,

  wealthTargetRequiredExceedsIncome: () =>
    `That's more than your whole average monthly income, so this pairing of number and date isn't a plan yet — one of the two has to move.`,

  wealthTargetAdditional: (
    additionalCents: Cents,
    safeToSpendCents: Cents,
    withinSafeToSpend: boolean | null,
  ) =>
    additionalCents <= 0
      ? `That's at or below what you're already putting away, so the plan is to keep going.`
      : // `null` means the engine could not judge affordability — there is no positive
        // guilt-free figure to compare against. It must NOT fall through to the "more than
        // you have" branch, which would format a negative or absent pool as money the reader
        // has ("more than the -$2,432.33 of monthly guilt-free spending you have").
        withinSafeToSpend === null
        ? `That's ${formatCents(additionalCents)}/month more than you save today. There's no guilt-free figure to weigh it against this month, so whether it fits is a question your spending plan answers, not this card.`
        : withinSafeToSpend
          ? `That's ${formatCents(additionalCents)}/month more than you save today, and it fits inside your ${formatCents(safeToSpendCents)} of monthly guilt-free spending.`
          : `That's ${formatCents(additionalCents)}/month more than you save today — more than the ${formatCents(safeToSpendCents)} of monthly guilt-free spending you have, so the date or the number has to move.`,

  wealthTargetDeadlineTooSoon: () =>
    `That's less than a month away, so there's no contribution schedule to work out.`,

  /**
   * Two intros, because the claim about spread is FALSE of a degenerate table. When every
   * row floors to the same real rate the three lines are identical, and a sentence promising
   * "the spread is wider than any budgeting change you could make" sits directly above three
   * rows with no spread at all.
   */
  wealthTargetSensitivityIntro: (hasSpread: boolean) =>
    hasSpread
      ? `The same target at three return assumptions, all at what you're putting away today — the horizon above doesn't change these. Nobody knows which one you'll get, and the spread between them is usually wider than any budgeting change you could make, which is why the assumption is worth seeing rather than trusting.`
      : `The same target at three return assumptions, all at what you're putting away today. They agree here only because your return assumption is at or below your inflation assumption, so all three floor to no real growth — the spread reappears as soon as the return assumption clears inflation.`,

  wealthTargetSensitivityRow: (nominalBps: number, realBps: number, years: number | null) =>
    years === null
      ? `Assuming ${pct(nominalBps)} returns (${pct(realBps)} after inflation): not within 100 years.`
      : `Assuming ${pct(nominalBps)} returns (${pct(realBps)} after inflation): about ${years} years.`,

  /**
   * W.10 — the three figures are in TODAY'S money. They used to be nominal 30-year future
   * values printed one scroll below a card stating that inflation takes its cut: at the shipped
   * defaults $500/mo over 30 years read as $609,985.50 where it buys $290,806.13 of today's
   * goods (both computed), and no reader could tell the two units apart.
   *
   * The rate named here is the reader's own RETURN dial, because that is the rate the money
   * grows at; `opportunityBasis` carries the deflation the total then goes through, once for
   * the whole list. Two rates in every row would state the same two dials N times, which is the
   * accretion W.12 is open about.
   *
   * `nominalReturnBps === 0` is its own branch, and not a decorative one. "Compounding does the
   * work, not willpower" is the persuasive payload of this sentence and it is FALSE when
   * nothing compounds — the figure is then the reader's own deposits, minus what inflation
   * takes. Both critics found this independently in the first draft (which had the same hole
   * one rate further along, at a floored real return).
   */
  opportunity: (o: Opportunity, nominalReturnBps: number) => {
    const monthly = formatCents(o.monthlyCents);
    const horizons = `${formatCents(o.todayValue30Cents)} in today's money over 30 years (${formatCents(o.todayValue20Cents)} over 20, ${formatCents(o.todayValue10Cents)} over 10)`;
    const fv =
      nominalReturnBps === 0
        ? `is ${horizons}, assuming your 0.00% return assumption — no growth at all, so that is the money itself with inflation taken off.`
        : `is ${horizons}, assuming ${pct(nominalReturnBps)} average annual returns — compounding does the work, not willpower.`;
    switch (o.kind) {
      case 'unused-subscription':
        return `Still using it? ${o.merchant}: ${monthly}/mo ${fv}`;
      case 'price-increase':
        return `Quiet price increase — the extra ${monthly} at ${o.merchant} ${fv}`;
      // Both estimate branches used to run a colon straight into "is $X", leaving a verb with
      // no subject ("…assuming a standard offer): is $15,187.72…"). The copy sweeps scan for
      // shame words and assumption clauses, not grammar, so two of the four kinds never parsed.
      case 'insurance-reshop':
        return `Re-shopping ${o.merchant} typically saves ~15% (an estimate, assuming typical quotes) — about ${monthly}/mo, which ${fv}`;
      case 'negotiable-bill':
        return `A retention call to ${o.merchant} often lands ~${monthly}/mo (an estimate, assuming a standard offer), which ${fv}`;
    }
  },

  /**
   * W.10 — how the figures in the list were worked out, said ONCE for the list rather than
   * twice per row.
   *
   * The subject is "the figures in this list", never "those totals above/below": a sentence
   * that points at a screen position is false the moment the grid reflows, which W.2 already
   * had to retire from `volatilityPrice` (UI-8/UI-9), and a demonstrative with three candidate
   * referents on one card is the same bug wearing a shorter word.
   *
   * It states the mechanism it actually performs — grow at the reader's return dial, then take
   * inflation off for every year of the horizon — and NOT a single blended "real" rate. The
   * blended version was the first draft; it is a different arithmetic (a stream level in
   * today's dollars) and describing this one with it would have been a stated derivation the
   * code does not do.
   *
   * Four branches, because a claim that is safe at the defaults is a lie at the edges of the
   * two dials `validateDials` actually permits (return 0–15.00%, inflation 0–10.00%). With no
   * inflation nothing is taken off at all. And a figure can land BELOW the dollars the reader
   * hands over, which reads as a bug unless the card says otherwise — so that sentence is
   * gated on `opportunityValueTrailsContributions`, the computed relation, PER HORIZON.
   *
   * The first version guessed that relation from the dials (`inflation >= return`). Sweeping
   * every pair the dials permit says otherwise: 1,579 horizon-cases have inflation strictly
   * below the return assumption and still trail, and 149 pairs trail at 10 or 20 years and not
   * at 30 — so "all of them" and "the shorter ones" are genuinely different sentences, not one
   * sentence with a loose edge.
   *
   * "at or below", not "below", because the predicate is exact and the DISPLAY is rounded: at
   * 14.00%/8.00% over 10 years the value trails by 0.0008%, which for a $2.50/mo row is less
   * than a cent, so the figure prints as exactly what was paid in. One word rather than a
   * per-row predicate inside a sentence that qualifies the whole list.
   *
   * The closing clause names the direction this model errs in. It assumes a flat contribution,
   * so a reader whose freed-up money grows (a subscription price usually does) ends up with
   * more than the figure. Saying that is what lets the printed number stay the conservative
   * one — the alternative was to compound the optimism in and disclose nothing.
   */
  opportunityBasis: (nominalBps: number, inflationBps: number, inflationIsDefault: boolean) => {
    const infl = inflationIsDefault
      ? `our default ${pct(inflationBps)} inflation assumption`
      : `your ${pct(inflationBps)} inflation assumption`;
    const flat = `They assume you invest that amount every month and never raise it; if what you free up grows over the years, as a subscription price usually does, you would end up with more than they say.`;
    if (inflationBps === 0) {
      return `The figures in this list grow the monthly amount at your ${pct(nominalBps)} return assumption. ${infl.charAt(0).toUpperCase()}${infl.slice(1)} is ${pct(0)}, so nothing is taken off for inflation and today's money and future dollars are the same thing here. ${flat}`;
    }
    const mechanism = `The figures in this list grow the monthly amount at your ${pct(nominalBps)} return assumption, then take ${infl} off for every year of the horizon — so each one is what the total would buy today, not what it would say on a statement.`;
    const trails = OPPORTUNITY_HORIZON_MONTHS.map((months) =>
      opportunityValueTrailsContributions(months, nominalBps, inflationBps),
    );
    if (trails.every(Boolean)) {
      return `${mechanism} At those two assumptions inflation takes more than the growth adds, so every figure lands at or below the dollars you would pay in over the same years: that is the assumptions working, not an error. ${flat}`;
    }
    if (trails.some(Boolean)) {
      return `${mechanism} At those two assumptions the shorter horizons land at or below the dollars you would pay in over the same years — inflation takes more than the growth has had time to add: that is the assumptions working, not an error. ${flat}`;
    }
    return `${mechanism} ${flat}`;
  },

  moneyDials: (dials: string[]) =>
    `Your money dials — ${dials.join(' and ')} — are where spending buys you the most life. Spend there proudly; the engine only hunts savings everywhere else.`,

  creepFlagged: (c: CreepResult) =>
    `Heads up, not a verdict: typical discretionary spending grew ~${pct1(c.spendGrowthBps)} across the last ${c.windowMonths} months while income grew ${pct1(c.incomeGrowthBps)}. If that's deliberate (a money dial turning up), carry on — if it's drift, it's easier to steer now than later.`,

  creepClear: (c: CreepResult) =>
    `Spending growth is tracking income growth over the last ${c.windowMonths} months — no lifestyle drift detected.`,

  runway: (months: number) =>
    Number.isFinite(months)
      ? `Room for error: ${months} months of expenses in cash. The richest feeling money buys is not needing the next paycheck.`
      : `Room for error: you have cash and no recorded expenses yet — your runway fills in as spending is tracked.`,

  lifeEnergy: (amount: Cents, hours: number) =>
    `${formatCents(amount)} ≈ ${hours} hours of your working life, assuming your after-tax hourly wage. A lens, not a judgment.`,

  lifeEnergyFootnote: (wageCents: Cents) =>
    `Hours are computed assuming your after-tax wage of ${formatCents(wageCents)}/hr. A lens, not a judgment.`,

  reviewImprovement: (monthLabel: string, fromBps: number, toBps: number) =>
    `What improved in ${monthLabel}: savings rate moved from ${pct1(fromBps)} to ${pct1(toBps)}.`,

  reviewImprovementRunway: (months: number) =>
    Number.isFinite(months)
      ? `What held steady: your cash runway covers ${months} months of expenses — room for error is wealth working quietly.`
      : `What held steady: once a few weeks of spending land, your cash runway will show here — room for error is wealth working quietly.`,

  reviewCreep: (merchant: string, delta: Cents) =>
    `What crept: ${merchant} now costs ${formatCents(delta)}/mo more than it used to.`,

  reviewCreepSpending: (growthBps: number) =>
    `What crept: typical discretionary spending is up ~${pct1(growthBps)} over the recent window while income is flat.`,

  reviewNextAction: (action: string) => `One next action: ${action}.`,

  // §2.4: shown only when the optional LLM reordered the recap (key-gated). Every recap LINE
  // is still a verbatim COACH_COPY string; this badge just discloses that the order was
  // AI-personalized this render — it asserts no fact about the user's money.
  reviewPersonalizedBadge: () => `Personalized`,

  nextActionCancelSub: (merchant: string, monthly: Cents) =>
    `decide on ${merchant} — if it's not earning its ${formatCents(monthly)}/mo, one cancellation beats a month of small sacrifices`,

  // "every card" is a claim about ALL of them, and the transfer figure only ever
  // covers the cards the engine could date (critic F-10, same class as the
  // dashboard's "all N cards"). Scoped wording keeps it true either way.
  // TASKS L.18: `frozenFunding` is REQUIRED, and it lives on THIS string rather than on the two
  // composers that build it. `generateMoneyReview` and `buildReviewCandidates` both emit this
  // instruction, and it is printed by /coach's review card AND mailed in the weekly digest — a
  // qualification added at either composer would cover half the surfaces, which is the
  // fence-copied-per-call-site failure. Owned by the sentence, every reader inherits it.
  //
  // The amount is a floor when the balance behind it stopped updating: the shortfall it comes from
  // is the difference between the cards due and a balance we can no longer see.
  nextActionTransfer: (amount: Cents, byDate: string, frozenFunding: FrozenFunding | null) =>
    `move ${formatCents(amount)} to checking by ${byDate} so the cards due this cycle clear in full${
      frozenFunding
        ? ` — though ${frozenFunding.label}'s balance stopped updating on ${formatISODate(
            frozenFunding.frozenSince as ISODate,
            'long',
          )}, when your bank stopped sharing it, so treat this amount as a floor and check the account first`
        : ''
    }`,

  nextActionAutomate: () =>
    `automate one transfer on payday — pay yourself first and the streak takes care of itself`,

  disclaimer: () =>
    `Educational, not financial advice. Every projection assumes the rates shown and never recommends specific investments.`,

  // ── Wave 1: principle captions (9 books) ───────────────────────────────────
  // C1+C2 · Housel — the unspent gap IS net worth ("wealth is what you don't see")
  invisibleWealth: (savedCents: Cents, monthLabel: string) =>
    `You didn't spend ${formatCents(savedCents)} in ${monthLabel} — that gap, not the things you could have bought, is what your net worth is made of. Wealth is the money you don't see.`,

  // C2 · Housel, Babylon — room for error, banded against the classic 3–6 month range
  runwayBanded: (months: number, band: 'below' | 'in' | 'above') =>
    `Room for error: ${months} months of expenses in cash — you're ${band === 'below' ? 'approaching' : band === 'in' ? 'inside' : 'past'} the classic 3–6 month range. The richest feeling money buys is not needing the next paycheck.`,

  // C13 · Housel, Sethi, Perkins — years-to-FI reframed as time bought back (sibling to yearsToFI)
  // W.2 names the rate rather than pointing at it: "the return rate above" was unambiguous
  // when one rate appeared above this line, and there are now two (the nominal dial and the
  // real rate derived from it) with the paragraph directly above saying the higher one is NOT
  // what the projections use.
  freedomDividend: (years: number, realReturnBps: number) =>
    `That's about ${years} years until your time becomes fully yours — the highest dividend money pays, assuming the ${pct(realReturnBps)} after inflation above holds. Every point of savings rate buys some of it back sooner.`,

  // C13 · Housel, Stanley & Danko — the FI number is anchored to your life, never the feed
  yourEnough: () =>
    `Your FI number is built from your spending, not anyone else's — that's the point. The goalpost stops moving when "enough" is defined by your life, not the feed.`,

  // C4+C5 · Sethi, Housel — the #1 opportunity is the big win
  biggestLever: () =>
    `Your biggest lever — fix this and the small stuff barely matters.`,

  // C5 · Sethi, Housel — a category that matches a money dial is protected, not policed
  dialTag: (category: string) =>
    `${category} is one of your money dials — spend there proudly; we only hunt savings elsewhere.`,

  // C10 (behavioral) · Housel — volatility is the price of the returns, not a malfunction
  /**
   * W.2 — takes BOTH rates, because they are the price of two different things and collapsing
   * them into one number makes the sentence false either way. Volatility is what the market
   * charges for the NOMINAL return; the real rate is what is left to compound after inflation,
   * and it is what every projection on this card actually uses. Handing this the real rate
   * alone would attribute market volatility to a number the market never quotes.
   */
  volatilityPrice: (nominalBps: number, realReturnBps: number) =>
    // "the dates ABOVE" was false: this sits in a disclosure between the years-to-FI line and
    // both the Coast line and the slider, so two of the three projections it describes are
    // BELOW it. Naming the card instead of a position also survives the card being reordered
    // — the same hazard `coach/page.tsx` already documents for the frozen-balance note.
    `Those ${pct(nominalBps)} returns aren't free — the price is volatility along the way, and the average is never the experience. Staying invested through the dips is the assumption behind every projection here; inflation then takes its cut, which is why the projections on this card compound at ${pct(realReturnBps)} rather than ${pct(nominalBps)}. A fee for admission, not a fine.`,

  // C9 · Ramsey BS4 — a 15% reference point on the savings-rate trend, never a grade
  fifteenPercentReference: () =>
    `The dashed line marks 15% — a common savings-rate reference point for retirement, not a rule you're failing if you're under it.`,

  // Wave 1.4 · habit mechanics — streak / personal best (educational, not a grade)
  savingsStreak: (months: number, latestRateBps: number) =>
    `${months} months in a row with a positive savings rate (latest ${pct1(latestRateBps)}). Consistency compounds — one month is weather; a streak is climate.`,

  savingsPersonalBest: (rateBps: number, monthLabel: string) =>
    `${monthLabel} is a personal best so far at ${pct1(rateBps)} — worth noticing, not a grade.`,

  // ── #254: Habit streaks (AI plan §Later #17 streaks half) ───────────────────
  // Basis inline everywhere: "cleared" means paid in full BY the due date (read
  // from statement + payment history); the creep walk covers FULL months only
  // and its window cap is disclosed. Broken-state copy is shame-free by the
  // standing scan; the money-bearing increase line has an exact rendered lock.
  streaksTitle: () => `Habit streaks`,
  streaksBasis: () =>
    `Cleared means the statement balance was fully paid by its due date, read from your statement and payment history. Subscription prices are watched on recurring charges with a steady amount, over full months only.`,
  cardClearedStreak: (months: number, cards: number, statements: number, throughMonthLabel: string) =>
    `${months} month${months === 1 ? '' : 's'} in a row with every card statement paid in full by its due date, through ${throughMonthLabel} (${cards} card${cards === 1 ? '' : 's'}, ${statements} statement${statements === 1 ? '' : 's'}). Paying in full by the due date is the habit that keeps purchase interest off your statements.`,
  cardClearedBroken: (monthLabel: string) =>
    `A statement due in ${monthLabel} wasn't fully paid by its due date, so this streak is starting over — one cleared cycle begins a new one.`,
  cardClearedNoHistory: () =>
    `No card statement has come due yet — this streak starts with your first due date.`,
  cardClearedForming: () =>
    `Your first statement cycle resolved this month — streaks count full months, so this month shows once it completes.`,
  noCreepStreak: (months: number, windowMonths: number, subCount: number) =>
    months >= windowMonths
      ? `No subscription price increases in the last ${windowMonths} full months — as far back as this check looks — across your ${subCount} tracked subscription${subCount === 1 ? '' : 's'}.`
      : `${months} full month${months === 1 ? '' : 's'} with no subscription price increases across your ${subCount} tracked subscription${subCount === 1 ? '' : 's'}.`,
  noCreepLastIncrease: (merchant: string, fromCents: Cents, toCents: Cents, monthLabel: string) =>
    `The last increase: ${merchant}, ${formatCents(fromCents)} → ${formatCents(toCents)} in ${monthLabel}.`,
  noCreepBrokenNow: (merchant: string, fromCents: Cents, toCents: Cents, monthLabel: string) =>
    `${merchant} went ${formatCents(fromCents)} → ${formatCents(toCents)} in ${monthLabel}. The count restarts with the next full month at steady prices.`,
  noCreepNoSubs: () =>
    `No steady-amount subscriptions detected yet, so there's no price creep to track.`,

  // C2 · Housel — saving for its own sake is a goal; the cushion is room for error
  cushionIsAGoal: () =>
    `Saving with no specific goal is still a goal — an unallocated cushion is room for error, and room for error is wealth working quietly.`,

  // Housel — assumptions change; play your own game
  assumptionsChange: () =>
    `These rates are assumptions, and assumptions change — revisit them as your life does. Play your own game; someone else's numbers don't have to be yours.`,

  // ── Wave 2: P0.4 Conscious-spending lens (C6 · Sethi) ──────────────────────
  // Investing is folded into savings (no per-month contribution flow in the data); stated inline.
  // L.22: the fixed bucket is recurring bills at a monthly rate + card payments — no cash
  // spending term exists in the plan any longer, so the caption must not name one.
  consciousSpending: (fixedPct: number, savePct: number, funPct: number) =>
    `This month, about ${fixedPct}% is going to recurring bills and card payments, ${savePct}% to savings and investing goals, and ${funPct}% is guilt-free to spend. A rough target is 50–60% / 15–20% / 20–35% — a lens on where your money goes, not a rule. Investing contributions aren't tracked separately yet, so they sit with savings.`,

  consciousOverspent: () =>
    `Fixed costs, card payments, and savings have outpaced this month's income pattern, so guilt-free has gone negative — one month is weather, not climate. The trend is what matters.`,

  // ── Wave 2: P0.5 Automation blueprint (C7 · Sethi, Babylon, Ramsey) ────────
  automationBlueprintBanner: () =>
    `Set these up once at your bank — Aimplifi reminds, it never moves your money. Then the system runs itself.`,
  automationSavingsStep: (day: string, amount: Cents, goal: string) =>
    `On ${day}: move ${formatCents(amount)} to ${goal}.`,
  automationCardStep: (cardName: string, amount: Cents, byDate: string) =>
    `${cardName}: set autopay to the statement balance and keep ${formatCents(amount)} in checking before ${byDate}, so it always clears in full.`,

  // ── Wave 3: Debt Freedom planner (C9 · Ramsey; Conflict A) ─────────────────
  debtFreeHero: (monthLabel: string) =>
    `You'd be debt-free around ${monthLabel}, assuming you keep these payments going at the current pace.`,
  debtNotClearing: () =>
    `At these payments alone the balances don't fully clear — adding even a small extra each month is what changes that.`,
  debtStrategyAvalanche: () =>
    `Highest rate first: costs the least interest. The recommended default — honest math, no artificial wins needed.`,
  debtStrategySnowball: () =>
    `Smallest balance first: you clear that first debt soonest. If momentum keeps you going, that counts too.`,
  debtTradeoff: (firstWinMonths: number, interestSavedLabel: string) =>
    `Quick wins clear your first debt in about ${firstWinMonths} months; least-interest saves roughly ${interestSavedLabel} over the full payoff — both assuming you keep payments steady at the current pace. Momentum or math — your call.`,
  debtStarterBuffer: () =>
    `A common first step (Ramsey): set aside about $1,000 as a starter buffer before throwing extra at debt, so a surprise doesn't send you back to the cards.`,
  debtAskAnswer: (monthLabel: string, strategyLabel: string) =>
    `On the ${strategyLabel} plan, you'd be debt-free around ${monthLabel}, assuming you keep the payments steady.`,

  // ── Wave 4: book-coverage completion — surface the last two of the nine books ──
  // C11 · Kiyosaki (Rich Dad Poor Dad) — assets vs liabilities, shown on /accounts.
  assetsVsLiabilities: () =>
    `Assets put money in your pocket; liabilities take it out. Your net worth is what's left once the liabilities are subtracted — that's the number this app is built to grow.`,
  // C16 · Aliche (Get Good with Money) + Sethi (your money rules) — shown on /coach.
  moneyRules: (dials: string[]) =>
    `The few rules this app is built around: pay every card in full, pay yourself first before you spend, and ${dials.length ? `spend on ${dials.join(', ')} without guilt` : 'spend on the few things you value without guilt'}. Getting good with money is mostly a short list of rules you actually keep — they beat a perfect plan you won't.`,

  // ── Wave 1.3: value receipts — "what Aimplifi caught" (TASKS 1.3) ───────────
  // HONESTY RULE: these state what was SURFACED (reminders delivered, warnings shown,
  // increases flagged) and never claim an outcome or savings — Aimplifi can't know
  // what the user did next, so "we saved you $X" would be a fabricated causation.
  receiptsHeadline: (total: number) =>
    total === 1
      ? `1 catch so far — a moment Aimplifi flagged something so you could decide.`
      : `${total} catches so far — moments Aimplifi flagged something so you could decide.`,
  receiptsReminders: (count: number, coveredCents: Cents) =>
    `${count} payment reminder${count === 1 ? '' : 's'} delivered, covering ${formatCents(coveredCents)} in payments due.`,
  receiptsRadar: (count: number) =>
    `${count} early warning${count === 1 ? '' : 's'} before checking was projected to dip below $0.`,
  receiptsPriceIncreases: (count: number, monthlyCents: Cents) =>
    `${count} quiet price increase${count === 1 ? '' : 's'} flagged — ${formatCents(monthlyCents)}/mo in total.`,
  receiptsFooter: () =>
    `A running tally of what Aimplifi surfaced, not a score: it counts the reminders, warnings, and flags themselves — what you did next stays yours, and it never moves your money.`,
  digestCaughtHeader: () => `The running tally of what Aimplifi has caught for you:`,

  // ── Gap 2 §3: weekly digest email (composes the Money Review + the week's dues) ──
  digestSubject: () => `Your week with Aimplifi`,
  digestIntro: (todayLong: string) =>
    `Your weekly check-in as of ${todayLong} — a quick look at what changed and what's coming up.`,
  digestPaymentsHeader: () => `Coming up in the next 7 days:`,
  digestNothingDue: () => `Nothing due in the next 7 days — a clear week ahead.`,
  /**
   * The same week, but with cards we could not date. "A clear week ahead" would be
   * a false all-clear: a reminder can only exist for a card that HAS a due date, so
   * an empty reminder set with undated cards outstanding means we don't know, not
   * that nothing is owed (owner-reported 2026-07-23). The email is the one surface
   * where the user cannot see the in-app panel that says so.
   */
  digestNothingDueWithUndated: (undatedCount: number) =>
    `Nothing due in the next 7 days on the cards we can date. ${
      undatedCount === 1
        ? `One card has no statement or due date yet, so it isn't included`
        : `${undatedCount} cards have no statement or due date yet, so they aren't included`
    } — open Aimplifi to see which.`,
  /** The same caveat when there IS a due list — a list reads as complete without it. */
  digestUndatedAlongsideDues: (undatedCount: number) =>
    `Not shown above: ${
      undatedCount === 1
        ? `one card has no statement or due date yet`
        : `${undatedCount} cards have no statement or due date yet`
    }, so nothing about ${undatedCount === 1 ? 'it' : 'them'} is included here.`,
  digestOutro: () => `That's your week. Aimplifi reminds you; it never moves your money.`,

  // ── #252: Money Signature (AI plan §Later #11 reworked) ─────────────────────
  // HABIT framing, never identity: every label ships with the fact it's read
  // from, and the basis line discloses the 3-month persistence rule. The
  // weather line is explicitly "this month" — a flip there is information,
  // not an identity change. Signature-copy locks live in
  // tests/unit/money-signature-copy.test.ts (identity-lexicon ban included).
  signatureTitle: () => `Your money habits`,
  signatureBasis: () =>
    `Habit lines move only after a new pattern holds for 3 months in a row — one unusual month never rewrites them. The weather line is only about this month.`,

  signatureWeather: (
    state: 'strained' | 'tight' | 'calm' | 'bright',
    runwayMonths: number,
    latestRateBps: number | null,
    monthLabel: string | null,
  ) => {
    const cushion = Number.isFinite(runwayMonths)
      ? `about ${runwayMonths} month${runwayMonths === 1 ? '' : 's'} of typical spending on hand (cash ÷ your 6-month average expenses)`
      : `cash on hand and no recorded average expenses yet`;
    switch (state) {
      case 'strained':
        return `This month's money weather: strained — ${cushion}. Tight stretches happen; the habits below are the long game, and one hard month doesn't reset them.`;
      case 'tight':
        return latestRateBps !== null && latestRateBps < 0
          ? `This month's money weather: tight — spending outpaced income in ${monthLabel ?? 'the latest full month'}, with ${cushion}. One month is weather, not climate.`
          : `This month's money weather: tight — ${cushion}. One month is weather, not climate.`;
      case 'bright':
        return `This month's money weather: bright — ${monthLabel ?? 'the latest full month'} was your best savings rate on record (${pct1(latestRateBps ?? 0)}), with ${cushion}. Worth noticing.`;
      case 'calm':
        return `This month's money weather: calm — ${cushion}.`;
    }
  },

  // "full months with income" everywhere the count renders (#252 critic P1-2):
  // the eligible window SKIPS no-income months, so "your last N full months"
  // without the qualifier is false whenever such months sit inside the span.
  signatureSavingSteady: (savedMonths: number, eligibleMonths: number, sinceLabel: string) =>
    `Saving is a steady habit here: a positive savings rate in ${savedMonths} of your last ${eligibleMonths} full months with income (a pattern that's held since ${sinceLabel}).`,
  signatureSavingVariable: (savedMonths: number, eligibleMonths: number) =>
    `Saving comes and goes right now: a positive savings rate in ${savedMonths} of your last ${eligibleMonths} full months with income. That's a pattern, not a verdict — patterns move.`,
  signatureSavingForming: (eligibleMonths: number, neededMonths: number) =>
    `Your saving pattern is still taking shape — ${eligibleMonths} of the ${neededMonths} full months with income needed to read it.`,
  signatureSavingMixed: (savedMonths: number, eligibleMonths: number) =>
    `A positive savings rate in ${savedMonths} of your last ${eligibleMonths} full months with income — a mixed pattern so far, and that's all it is.`,
  // Lag-honest variants (#252 critic P1-1): rendered when the latest month's
  // banded signal is the OPPOSITE of the confirmed label — the unqualified
  // label copy would assert a falsehood against its own inline facts.
  signatureSavingShiftingFromSteady: (savedMonths: number, eligibleMonths: number, sinceLabel: string) =>
    `Saving had been a steady habit since ${sinceLabel}, but recent months look different: a positive savings rate in ${savedMonths} of your last ${eligibleMonths} full months with income. If the new pattern holds for 3 months in a row, this line will move with it.`,
  signatureSavingShiftingFromVariable: (savedMonths: number, eligibleMonths: number) =>
    `Saving has been picking up lately: a positive savings rate in ${savedMonths} of your last ${eligibleMonths} full months with income. If that holds for 3 months in a row, this line will move with it.`,

  signatureSteadinessSteady: (spreadBps: number) =>
    `Month-to-month spending runs steady: typical variation about ${pct1(spreadBps)} of a typical month, measured on the median so one big month doesn't skew it.`,
  signatureSteadinessVariable: (spreadBps: number) =>
    `Month-to-month spending swings: typical variation about ${pct1(spreadBps)} of a typical month, measured on the median. Swings aren't a problem by themselves — lumpy months (travel, annual bills) are often the plan working.`,
  signatureSteadinessForming: (neededMonths: number) =>
    `Spending steadiness needs ${neededMonths} full months of history to read.`,
  signatureSteadinessMixed: (spreadBps: number) =>
    `Typical month-to-month variation is about ${pct1(spreadBps)} of a typical month right now — in-between territory, so there's no label to pin on it.`,
  signatureSteadinessShiftingFromSteady: (spreadBps: number) =>
    `Spending had been running steady, but recent months vary more: typical variation about ${pct1(spreadBps)} of a typical month, measured on the median. If the new pattern holds for 3 months in a row, this line will move with it.`,
  signatureSteadinessShiftingFromVariable: (spreadBps: number) =>
    `Spending swings have been settling down: typical variation about ${pct1(spreadBps)} of a typical month, measured on the median. If that holds for 3 months in a row, this line will move with it.`,
  // #252 critic P2-1: spreadBps can be null with ABUNDANT history (the recent
  // 6-month window has a zero median — no readable spending); saying "needs 6
  // full months of history" there would be false.
  signatureSteadinessUnreadable: (windowMonths: number) =>
    `Most of the last ${windowMonths} full months show no recorded spending, so there's no steadiness reading right now.`,
} as const;

// ── Monthly Money Review (generated from real data) ──────────────────────────

export interface MoneyReview {
  month: string;
  improvement: string;
  creep: string;
  nextAction: string;
}

export function generateMoneyReview(input: {
  flows: MonthlyFlow[]; // ascending months
  creep: CreepResult;
  opportunities: Opportunity[];
  runwayMonths: number;
  pendingTransfer?: PendingTransfer | null;
}): MoneyReview {
  const { flows, creep, opportunities } = input;
  const last = flows[flows.length - 1];
  const prev = flows[flows.length - 2];

  const improvement =
    last && prev && last.savingsRateBps !== null && prev.savingsRateBps !== null && last.savingsRateBps > prev.savingsRateBps
      ? COACH_COPY.reviewImprovement(formatMonth(last.month), prev.savingsRateBps, last.savingsRateBps)
      : COACH_COPY.reviewImprovementRunway(input.runwayMonths);

  const priceIncrease = opportunities.find((o) => o.kind === 'price-increase');
  const creepLine = priceIncrease
    ? COACH_COPY.reviewCreep(priceIncrease.merchant, priceIncrease.monthlyCents)
    : creep.flagged
      ? COACH_COPY.reviewCreepSpending(creep.spendGrowthBps)
      : COACH_COPY.creepClear(creep);

  const unused = opportunities.find((o) => o.kind === 'unused-subscription');
  const nextAction = input.pendingTransfer
    ? COACH_COPY.reviewNextAction(
        COACH_COPY.nextActionTransfer(
          input.pendingTransfer.amountCents,
          input.pendingTransfer.byDate,
          input.pendingTransfer.frozenFunding,
        ),
      )
    : unused
      ? COACH_COPY.reviewNextAction(COACH_COPY.nextActionCancelSub(unused.merchant, unused.monthlyCents))
      : COACH_COPY.reviewNextAction(COACH_COPY.nextActionAutomate());

  return { month: last?.month ?? '', improvement, creep: creepLine, nextAction };
}
