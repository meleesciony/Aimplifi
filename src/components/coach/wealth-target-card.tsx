'use client';

/**
 * Wealth-target card — "I want $10M. What do I need to do?"
 *
 * The reader states a number and a horizon; the card answers in both directions at once
 * (when the current pace arrives, and what a chosen date would require) and shows how much
 * of the answer is the return assumption rather than the saving.
 *
 * Every figure comes from `solveWealthTarget`, the pure engine imported client-side — the
 * same module and the same inputs the server would use, so dragging a control cannot drift
 * from a server-rendered figure (the FI slider's idiom, #3).
 *
 * THE INPUT IS A BOUNDARY, AND IT REFUSES. The amount box is UNCONTROLLED (`defaultValue`
 * + onChange mirroring into state) so text typed before hydration is not blanked by the
 * first render — the #216 half of the mutation-form lesson, which applies to any text box.
 * But an uncontrolled box that only updates state on a SUCCESSFUL parse leaves the card
 * answering a target the reader can no longer see: clear the box, or type "ten million",
 * and every figure below goes on describing the previous number with nothing marking it
 * stale. So the parse result is held as `number | null`, null is a first-class state, and
 * in it the card says it has no target rather than printing an answer to a question nobody
 * asked. `aria-invalid` carries the same fact to a screen reader.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import {
  FALLBACK_HORIZON_YEARS,
  MAX_HORIZON_YEARS,
  MIN_HORIZON_YEARS,
  seededHorizon,
  solveWealthTarget,
} from '@/lib/engine/solve/wealth-target';
import { type Cents, formatCents, parseDollarInput } from '@/lib/money';

/** A round, widely-held starting point. The reader replaces it; nothing here is a suggestion. */
const DEFAULT_TARGET_CENTS = 1_000_000_00;

/** Whole years, rounded rather than truncated, so a summary line never reads LOWER than the
 *  years-and-months line describing the same month count ("about 8 years" beside "8 years
 *  9 months"). */
const wholeYears = (months: number) => Math.round(months / 12);

export function WealthTargetCard({
  portfolioCents,
  monthlySavingsCents,
  monthlyIncomeCents,
  safeToSpendCents,
  expectedReturnBps,
  inflationBps,
  inflationIsDefault,
  monthlySavingsMonths,
  frozenPortfolioNote,
  currencyNote,
}: {
  portfolioCents: Cents;
  monthlySavingsCents: Cents;
  /**
   * The 6-month MEAN of categorized monthly income (`server/coach.ts`), which is NOT the
   * spending plan's income (a 3-month median over non-credit accounts). The two differ, so
   * the share-of-income sentence names its own window rather than saying "your income" and
   * letting the reader assume it matches the guilt-free figure in the next sentence.
   */
  monthlyIncomeCents: Cents;
  safeToSpendCents: Cents;
  expectedReturnBps: number;
  inflationBps: number;
  /**
   * True when `inflationBps` is `RETIREMENT_ASSUMPTIONS.inflationBps` rather than a value the
   * reader stored — `User.inflationBps` is nullable and /coach falls back. Required, not
   * defaulted: the dials sentence claims ownership of these numbers, and a defaulted parameter
   * fails silent (the repo has a written lesson about exactly that). /settings calls this same
   * 2.50% "our defaults", so a card calling it "yours" would contradict the page it links to.
   */
  inflationIsDefault: boolean;
  /**
   * How many months `monthlySavingsCents` was averaged over — the actual divisor, which is
   * `Math.max(1, last6.length)` and is 3 for a reader three months in. The pace sentence names
   * this number; asserting "6" was false for every short history and for any span containing a
   * month with no activity, and it was the sentence added to make the figure checkable.
   */
  monthlySavingsMonths: number;
  /**
   * Set when an INVESTMENT account the bank stopped sharing is inside `portfolioCents`.
   * Every PROJECTION here starts from that balance — including the required-contribution
   * line, which is an instruction rather than a figure: a balance frozen HIGH makes the
   * instruction too small and the reader under-saves.
   */
  frozenPortfolioNote?: string | null;
  /**
   * Set when a non-USD account was withheld by the currency guard (`isSupportedCurrency` runs
   * inside the snapshot reader, so a CAD brokerage never reaches `portfolioCents` at all).
   *
   * REQUIRED here in spirit and taken from the same `withheldInlineNote(withheld)` the FI card
   * one component up already receives: the starting-balance sentence ENUMERATES what the figure
   * leaves out, and an enumeration that names everyday cash while silently dropping a whole
   * investment account describes a set the figure does not contain — the exact rule
   * `server/coach.ts` cites for its own frozen-balance disclosure.
   */
  currencyNote?: string | null;
}) {
  const [targetCents, setTargetCents] = useState<number | null>(DEFAULT_TARGET_CENTS);
  /**
   * The slider is the reader's ONLY once they have moved it. Until then it follows the target
   * they are typing, so pasting "10000000" re-seeds the horizon to the arrival for $10M instead
   * of leaving a 25 that was chosen for a different number. After a drag it stops following:
   * re-seeding on every keystroke would take back a choice they had just made.
   */
  const [chosenHorizonYears, setChosenHorizonYears] = useState<number | null>(null);

  const { result, horizonYears, horizonBasis } = useMemo(() => {
    if (targetCents === null) {
      return { result: null, horizonYears: FALLBACK_HORIZON_YEARS, horizonBasis: 'fallback' as const };
    }
    const shared = {
      targetAmountCents: targetCents,
      currentPortfolioCents: portfolioCents,
      currentMonthlyContributionCents: monthlySavingsCents,
      nominalReturnBps: expectedReturnBps,
      inflationBps,
      monthlyIncomeCents,
      safeToSpendCents,
    };
    // Pass 1 asks only "when does the current pace arrive?", which the engine answers
    // independently of any deadline: `monthsAtCurrentRate` is computed before every branch that
    // reads `deadlineMonths`, so the seed can never come from a number pass 2 does not print.
    //
    // COST, measured rather than assumed — an earlier version of this comment claimed "one
    // monthsToFI walk and no bisection" and was wrong: `solveWealthTarget` builds the three-row
    // sensitivity table BEFORE the open-ended return, so pass 1 is four walks and three of them
    // are discarded. No bisection (that is `coastFI`, past the branch), and four bounded walks
    // per keystroke is still far cheaper than the render around it — but the honest figure is
    // four, and a comment nobody checked is how a wrong one survives.
    const pace = solveWealthTarget({ ...shared, deadlineMonths: null });
    const seed = seededHorizon(pace.monthsAtCurrentRate, pace.contributionFloored);
    const years = chosenHorizonYears ?? seed.years;
    return {
      result: solveWealthTarget({ ...shared, deadlineMonths: years * 12 }),
      horizonYears: years,
      // Three states, kept distinct here rather than collapsed to a boolean: a reader who has
      // dragged the control owns the date whether or not a seed was available, and telling them
      // "nothing has picked this date for you" one line under the control they just moved is the
      // card denying their own action.
      horizonBasis: (chosenHorizonYears !== null
        ? 'chosen'
        : seed.seeded
          ? 'seeded'
          : 'fallback') as 'seeded' | 'chosen' | 'fallback',
    };
  }, [
    targetCents,
    chosenHorizonYears,
    portfolioCents,
    monthlySavingsCents,
    monthlyIncomeCents,
    safeToSpendCents,
    expectedReturnBps,
    inflationBps,
  ]);

  const basisLine =
    result === null
      ? COACH_COPY.wealthTargetNoAmount()
      : result.unreachableReason === 'target-out-of-range'
        ? COACH_COPY.wealthTargetOutOfRange()
        : COACH_COPY.wealthTargetBasis(
            result.targetAmountCents as Cents,
            result.realReturnBps,
            expectedReturnBps,
            inflationBps,
            result.realReturnFloored,
          );

  const paceLine = (() => {
    if (result === null || result.unreachableReason === 'target-out-of-range') return null;
    if (result.outcome === 'already-there') {
      return COACH_COPY.wealthTargetAlreadyThere(
        result.currentPortfolioCents as Cents,
        result.targetAmountCents as Cents,
      );
    }
    // Nothing is going in. The FI card refuses to project here and so does this one — a
    // date computed from a floored $0 would turn that refusal into a number.
    if (result.contributionFloored) return COACH_COPY.wealthTargetNotSaving(monthlySavingsMonths);
    if (result.monthsAtCurrentRate === null) {
      return COACH_COPY.wealthTargetBeyondHorizon(result.realReturnBps);
    }
    return COACH_COPY.wealthTargetAtCurrentPace(
      Math.floor(result.monthsAtCurrentRate / 12),
      result.monthsAtCurrentRate % 12,
      result.currentMonthlyContributionCents as Cents,
      result.realReturnBps,
      monthlySavingsMonths,
    );
  })();

  const requiredLine = (() => {
    if (result === null || result.unreachableReason === 'target-out-of-range') return null;
    // The already-there sentence belongs to the pace slot; repeating it verbatim here said
    // the same thing twice on one card.
    if (result.outcome === 'already-there') return null;
    if (result.requiredMonthlyCents === null) return COACH_COPY.wealthTargetDeadlineTooSoon();
    return COACH_COPY.wealthTargetRequired(
      result.requiredMonthlyCents as Cents,
      horizonYears,
      result.realReturnBps,
      inflationBps,
      inflationIsDefault,
    );
  })();

  // The share of income is withheld above 100%: a near-zero denominator turns it into the
  // "−855105.8%" class of figure the FI engine has a written lesson about, and a reader
  // learns nothing from a six-digit percentage that the sentence doesn't say in words.
  const shareLine =
    result === null || result.requiredSavingsRateBps === null || result.outcome === 'already-there'
      ? null
      : result.requiredSavingsRateBps > 10000
        ? COACH_COPY.wealthTargetRequiredExceedsIncome()
        : COACH_COPY.wealthTargetRequiredShare(result.requiredSavingsRateBps);

  const hasSpread =
    result !== null &&
    new Set(result.sensitivity.map((s) => s.realReturnBps)).size > 1;

  return (
    <Card data-testid="wealth-target-card">
      <CardHeader className="pb-2">
        <CardDescription>Wealth target</CardDescription>
        <CardTitle as="div" className="text-2xl tabular-nums">
          <label htmlFor="wealth-target-amount" className="sr-only">
            Target amount in dollars
          </label>
          <input
            id="wealth-target-amount"
            type="text"
            inputMode="decimal"
            defaultValue={formatCents(DEFAULT_TARGET_CENTS as Cents)}
            onChange={(e) => setTargetCents(parseDollarInput(e.target.value))}
            aria-describedby="wealth-target-basis"
            aria-invalid={targetCents === null}
            className="w-full max-w-[14ch] rounded-md border bg-transparent px-2 py-1 tabular-nums aria-[invalid=true]:border-amber-500"
            data-testid="wealth-target-amount"
          />
        </CardTitle>
        <p className="text-sm text-muted-foreground" id="wealth-target-basis" data-testid="wealth-target-basis">
          {basisLine}
        </p>
        {result !== null && result.unreachableReason !== 'target-out-of-range' ? (
          <>
            <p className="text-xs text-muted-foreground" data-testid="wealth-target-dials">
              {COACH_COPY.wealthTargetDials(expectedReturnBps, inflationBps, inflationIsDefault)}{' '}
            </p>
            {/* The card's only call to action. It was inline `text-xs` — a ~16px tap target, the
                smallest thing on the card — so it gets its own row and a 44px minimum instead. */}
            <Link
              href="/settings#money-dials"
              data-testid="wealth-target-dials-link"
              className="inline-flex min-h-11 items-center text-sm font-medium text-emerald-600 underline underline-offset-4 dark:text-emerald-400"
            >
              Change your assumptions
            </Link>
            <p className="text-xs text-muted-foreground" data-testid="wealth-target-vs-fi">
              {/* W.2 — the rate BOTH cards now compound at, read off this card's own solved
                  result rather than re-derived, so the sentence claiming agreement is printed
                  from the number it claims agreement about. */}
              {COACH_COPY.wealthTargetVsFiCard(result.realReturnBps)}
            </p>
          </>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* The starting balance sits OUTSIDE the live region: it does not change as the reader
            types a target, and re-announcing it on every keystroke would bury the answer that
            did change. It sits above the pace line because it is what the pace line grows.
            Suppressed in `already-there`, where `wealthTargetAlreadyThere` prints the SAME
            portfolio figure one line down — the card said one number twice, adjacently, which is
            the duplication a W.1 critic already removed once from this card. */}
        {result !== null &&
        result.unreachableReason !== 'target-out-of-range' &&
        result.outcome !== 'already-there' ? (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground" data-testid="wealth-target-starting-from">
              {COACH_COPY.wealthTargetStartingFrom(result.currentPortfolioCents as Cents)}
            </p>
            {/* Both caveats ride the BALANCE they qualify, not a position further down the card.
                A frozen investment feed leaves this figure stale-HIGH, which makes the required
                contribution too small — the failure direction is under-saving — and until now
                the note sat two sentences below the number it was about. The currency note is
                here for the same reason: the sentence above enumerates what the figure excludes,
                and a withheld non-USD brokerage is an exclusion it does not name. */}
            {frozenPortfolioNote ? (
              <p className="text-xs text-amber-500" data-testid="wealth-target-frozen-note">
                {frozenPortfolioNote}
              </p>
            ) : null}
            {currencyNote ? (
              <p className="text-xs text-amber-500" data-testid="wealth-target-currency-note">
                {currencyNote}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* One live region for the whole answer: two separate polite regions re-announced
            two full sentences on every keystroke. */}
        <div aria-live="polite" className="space-y-4">
          {paceLine ? (
            <p className="text-sm" data-testid="wealth-target-pace">
              {paceLine}
            </p>
          ) : null}
          {requiredLine ? (
            <div className="space-y-2 rounded-lg border p-3">
              <label htmlFor="wealth-target-horizon" className="flex justify-between text-sm">
                <span>I want it in…</span>
                <span className="font-semibold tabular-nums" data-testid="wealth-target-horizon-value">
                  {horizonYears} year{horizonYears === 1 ? '' : 's'}
                </span>
              </label>
              <input
                id="wealth-target-horizon"
                type="range"
                min={MIN_HORIZON_YEARS}
                max={MAX_HORIZON_YEARS}
                step={1}
                value={horizonYears}
                aria-valuetext={`${horizonYears} year${horizonYears === 1 ? '' : 's'}`}
                onChange={(e) => setChosenHorizonYears(Number(e.target.value))}
                className="w-full accent-emerald-500"
                data-testid="wealth-target-horizon"
              />
              <p className="text-xs text-muted-foreground" data-testid="wealth-target-horizon-basis">
                {COACH_COPY.wealthTargetHorizonBasis(horizonBasis)}
              </p>
              <p className="text-sm" data-testid="wealth-target-required">
                {requiredLine}
              </p>
              {shareLine ? (
                <p className="text-sm text-muted-foreground" data-testid="wealth-target-share">
                  {shareLine}
                </p>
              ) : null}
              {result !== null && result.requiredAdditionalMonthlyCents !== null ? (
                <p className="text-sm text-muted-foreground" data-testid="wealth-target-additional">
                  {COACH_COPY.wealthTargetAdditional(
                    result.requiredAdditionalMonthlyCents as Cents,
                    safeToSpendCents,
                    result.withinSafeToSpend,
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {result !== null && result.sensitivity.length > 0 ? (
          <details className="text-xs text-muted-foreground" data-testid="wealth-target-sensitivity">
            {/* 44px minimum, matching the dials link below — a bare `text-xs` summary measures
                ~16px tall, under the 24px WCAG 2.5.8 floor and well under this repo's own
                standard (a W.2 critic measured 314×16 on both cards' disclosures). */}
            <summary className="flex min-h-11 cursor-pointer select-none items-center">
              How much of this is the return assumption?
            </summary>
            <p className="mt-1">{COACH_COPY.wealthTargetSensitivityIntro(hasSpread)}</p>
            <ul className="mt-2 space-y-1">
              {result.sensitivity.map((s, idx) => (
                // Keyed by position, not by rate: two rows can share a nominal rate once the
                // ±2pp spread is clamped at 0 (a return dial of 0 gives [0, 0, 200]).
                <li key={idx} data-testid="wealth-target-sensitivity-row">
                  {COACH_COPY.wealthTargetSensitivityRow(
                    s.nominalReturnBps,
                    s.realReturnBps,
                    s.monthsAtCurrentRate === null ? null : wholeYears(s.monthsAtCurrentRate),
                  )}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
