/**
 * Coach copy guardrails (docs/EDGE_CASES.md §Coach copy guardrails):
 *  - zero shame phrases anywhere
 *  - every projection string states its assumptions
 *  - no security/ticker recommendations
 * Scans EVERY string COACH_COPY can produce, with representative args.
 */
import { describe, expect, it } from 'vitest';
import { COACH_COPY, generateMoneyReview } from '@/lib/engine/fi/coach-copy';
import type { CreepResult, MonthlyFlow, Opportunity } from '@/lib/engine/fi/insights';
import { type PaymentReminder, reminderLine } from '@/lib/engine/reminders/select';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';

/** A representative reminder for guardrail-scanning the shared line (used by the digest). */
const sampleReminder = (over: Partial<PaymentReminder> = {}): PaymentReminder => ({
  accountId: 'a1',
  accountName: 'Sapphire',
  obligationType: 'card',
  dueDate: isoDate('2026-06-15'),
  daysUntil: 5,
  urgency: 'upcoming',
  cashRequiredCents: cents(50000),
  userActionCents: cents(50000),
  autopayCents: cents(0),
  autopayCovered: false,
  isEstimated: false,
  frozenSince: null,
  ...over,
});

const creepFlagged: CreepResult = {
  flagged: true,
  spendGrowthBps: 1240,
  incomeGrowthBps: 10,
  monthlyDiscretionaryCents: [],
  windowMonths: 6,
};
const creepClear: CreepResult = { ...creepFlagged, flagged: false, spendGrowthBps: 20 };

const opportunity = (kind: Opportunity['kind']): Opportunity => ({
  kind,
  merchant: 'LA Fitness',
  monthlyCents: cents(3499),
  fv10Cents: cents(605000),
  fv20Cents: cents(1822000),
  fv30Cents: cents(4267000),
  isEstimate: kind === 'insurance-reshop' || kind === 'negotiable-bill',
});

const flows: MonthlyFlow[] = [
  { month: '2026-04', incomeCents: cents(490000), expensesCents: cents(400000), savingsRateBps: 1836 },
  { month: '2026-05', incomeCents: cents(735000), expensesCents: cents(500000), savingsRateBps: 3197 },
];

/** Every user-facing string the coach can emit, with representative args. */
const ALL_STRINGS: { label: string; text: string; isProjection: boolean }[] = [
  { label: 'savingsRateHeadline', text: COACH_COPY.savingsRateHeadline(3197, 'May 2026'), isProjection: false },
  { label: 'savingsRateNoIncome', text: COACH_COPY.savingsRateNoIncome('May 2026'), isProjection: false },
  { label: 'fiNumber', text: COACH_COPY.fiNumber(cents(150_000_000), 400, cents(6_000_000)), isProjection: true },
  { label: 'savingsRateNegative', text: COACH_COPY.savingsRateHeadline(-2500, 'May 2026'), isProjection: false },
  { label: 'sliderContext', text: COACH_COPY.sliderContext(2330, 3734, 'May 2026'), isProjection: false },
  { label: 'yearsToFI', text: COACH_COPY.yearsToFI(17, 3, 700), isProjection: true },
  { label: 'notOnTrack', text: COACH_COPY.notOnTrack(), isProjection: false },
  { label: 'coastFI', text: COACH_COPY.coastFI(25, 700), isProjection: true },
  { label: 'notCoastFI', text: COACH_COPY.notCoastFI(cents(120000), 25, 700), isProjection: true },
  { label: 'sliderCaption', text: COACH_COPY.sliderCaption(2200, 3000, 23, 17), isProjection: true },
  { label: 'opportunity:unused', text: COACH_COPY.opportunity(opportunity('unused-subscription'), 700), isProjection: true },
  { label: 'opportunity:price', text: COACH_COPY.opportunity(opportunity('price-increase'), 700), isProjection: true },
  { label: 'opportunity:insurance', text: COACH_COPY.opportunity(opportunity('insurance-reshop'), 700), isProjection: true },
  { label: 'opportunity:bill', text: COACH_COPY.opportunity(opportunity('negotiable-bill'), 700), isProjection: true },
  // Wealth target — every projection here carries BOTH assumptions (rate + today's dollars).
  {
    label: 'wealthTargetBasis',
    text: COACH_COPY.wealthTargetBasis(cents(1_000_000_000), 450, 700, 250, false),
    isProjection: true,
  },
  {
    label: 'wealthTargetBasis:floored',
    text: COACH_COPY.wealthTargetBasis(cents(1_000_000_000), 0, 700, 1000, true),
    isProjection: true,
  },
  {
    label: 'wealthTargetVsFiCard',
    text: COACH_COPY.wealthTargetVsFiCard(700, 250),
    isProjection: true,
  },
  {
    label: 'wealthTargetAtCurrentPace',
    text: COACH_COPY.wealthTargetAtCurrentPace(44, 5, cents(500000), 450, 6),
    isProjection: true,
  },
  {
    label: 'wealthTargetNotSaving',
    text: COACH_COPY.wealthTargetNotSaving(6),
    isProjection: false,
  },
  {
    label: 'wealthTargetNotSaving:no-months',
    text: COACH_COPY.wealthTargetNotSaving(0),
    isProjection: false,
  },
  // Registered so the guardrail sweeps below actually SEE them. All three shipped invisible to
  // the scan in the first pass of this slice, and one of them ("which is what grows at 7.50%")
  // would have failed the projection-assumption sweep on the spot.
  {
    label: 'wealthTargetStartingFrom',
    text: COACH_COPY.wealthTargetStartingFrom(cents(148_000_000)),
    isProjection: true,
  },
  {
    label: 'wealthTargetStartingFrom:empty',
    text: COACH_COPY.wealthTargetStartingFrom(cents(0)),
    isProjection: true,
  },
  {
    label: 'wealthTargetHorizonBasis:seeded',
    text: COACH_COPY.wealthTargetHorizonBasis('seeded'),
    isProjection: false,
  },
  {
    label: 'wealthTargetHorizonBasis:chosen',
    text: COACH_COPY.wealthTargetHorizonBasis('chosen'),
    isProjection: false,
  },
  {
    label: 'wealthTargetHorizonBasis:fallback',
    text: COACH_COPY.wealthTargetHorizonBasis('fallback'),
    isProjection: false,
  },
  {
    label: 'wealthTargetDials',
    text: COACH_COPY.wealthTargetDials(1000, 250, false),
    isProjection: false,
  },
  {
    label: 'wealthTargetDials:default-inflation',
    text: COACH_COPY.wealthTargetDials(1000, 250, true),
    isProjection: false,
  },
  {
    label: 'wealthTargetAlreadyThere',
    text: COACH_COPY.wealthTargetAlreadyThere(cents(1_200_000_000), cents(1_000_000_000)),
    isProjection: false,
  },
  {
    label: 'wealthTargetBeyondHorizon',
    text: COACH_COPY.wealthTargetBeyondHorizon(450),
    isProjection: true,
  },
  {
    label: 'wealthTargetOutOfRange',
    text: COACH_COPY.wealthTargetOutOfRange(),
    isProjection: false,
  },
  {
    label: 'wealthTargetNoAmount',
    text: COACH_COPY.wealthTargetNoAmount(),
    isProjection: false,
  },
  {
    label: 'wealthTargetRequired',
    text: COACH_COPY.wealthTargetRequired(cents(1_250_00), 25, 450, 250),
    isProjection: true,
  },
  {
    label: 'wealthTargetRequired:oneYear',
    text: COACH_COPY.wealthTargetRequired(cents(1_250_00), 1, 450, 250),
    isProjection: true,
  },
  {
    label: 'wealthTargetRequiredShare',
    text: COACH_COPY.wealthTargetRequiredShare(3400),
    isProjection: false,
  },
  {
    label: 'wealthTargetRequiredExceedsIncome',
    text: COACH_COPY.wealthTargetRequiredExceedsIncome(),
    isProjection: false,
  },
  {
    label: 'wealthTargetAdditional:fits',
    text: COACH_COPY.wealthTargetAdditional(cents(75_000), cents(300_000), true),
    isProjection: false,
  },
  {
    label: 'wealthTargetAdditional:doesNotFit',
    text: COACH_COPY.wealthTargetAdditional(cents(900_000), cents(300_000), false),
    isProjection: false,
  },
  {
    label: 'wealthTargetAdditional:unknowable',
    text: COACH_COPY.wealthTargetAdditional(cents(900_000), cents(-243_233), null),
    isProjection: false,
  },
  {
    label: 'wealthTargetAdditional:none',
    text: COACH_COPY.wealthTargetAdditional(cents(0), cents(300_000), true),
    isProjection: false,
  },
  {
    label: 'wealthTargetDeadlineTooSoon',
    text: COACH_COPY.wealthTargetDeadlineTooSoon(),
    isProjection: false,
  },
  {
    label: 'wealthTargetSensitivityIntro:spread',
    text: COACH_COPY.wealthTargetSensitivityIntro(true),
    isProjection: false,
  },
  {
    label: 'wealthTargetSensitivityIntro:degenerate',
    text: COACH_COPY.wealthTargetSensitivityIntro(false),
    isProjection: false,
  },
  {
    label: 'wealthTargetSensitivityRow',
    text: COACH_COPY.wealthTargetSensitivityRow(700, 450, 44),
    isProjection: true,
  },
  {
    label: 'wealthTargetSensitivityRow:never',
    text: COACH_COPY.wealthTargetSensitivityRow(500, 250, null),
    isProjection: true,
  },
  { label: 'moneyDials', text: COACH_COPY.moneyDials(['Travel', 'Dining Out']), isProjection: false },
  { label: 'creepFlagged', text: COACH_COPY.creepFlagged(creepFlagged), isProjection: false },
  { label: 'creepClear', text: COACH_COPY.creepClear(creepClear), isProjection: false },
  { label: 'runway', text: COACH_COPY.runway(3.2), isProjection: false },
  { label: 'lifeEnergy', text: COACH_COPY.lifeEnergy(cents(19000), 5), isProjection: true },
  { label: 'lifeEnergyFootnote', text: COACH_COPY.lifeEnergyFootnote(cents(3800)), isProjection: true },
  { label: 'reviewImprovement', text: COACH_COPY.reviewImprovement('May 2026', 1836, 3197), isProjection: false },
  { label: 'reviewImprovementRunway', text: COACH_COPY.reviewImprovementRunway(3.2), isProjection: false },
  { label: 'reviewCreep', text: COACH_COPY.reviewCreep('Netflix', cents(250)), isProjection: false },
  { label: 'reviewCreepSpending', text: COACH_COPY.reviewCreepSpending(410), isProjection: false },
  { label: 'nextAction:cancel', text: COACH_COPY.reviewNextAction(COACH_COPY.nextActionCancelSub('LA Fitness', cents(3499))), isProjection: false },
  { label: 'nextAction:transfer', text: COACH_COPY.reviewNextAction(COACH_COPY.nextActionTransfer(cents(105000), 'Tue, Jun 23', null)), isProjection: false },
  // TASKS L.18: the frozen-funding branch is a SECOND string this function can produce, and this
  // file claims to scan every one of them. Scanned here so the new clause cannot ship past the
  // shame/assumption guardrails unread.
  {
    label: 'nextAction:transfer-frozen',
    text: COACH_COPY.reviewNextAction(
      COACH_COPY.nextActionTransfer(cents(105000), 'Tue, Jun 23', {
        label: 'Everyday Checking',
        frozenSince: '2026-06-01',
      }),
    ),
    isProjection: false,
  },
  { label: 'nextAction:automate', text: COACH_COPY.reviewNextAction(COACH_COPY.nextActionAutomate()), isProjection: false },
  { label: 'disclaimer', text: COACH_COPY.disclaimer(), isProjection: false },
  // Wave 1 principle captions
  { label: 'invisibleWealth', text: COACH_COPY.invisibleWealth(cents(235000), 'May 2026'), isProjection: false },
  { label: 'runwayBanded:below', text: COACH_COPY.runwayBanded(1.8, 'below'), isProjection: false },
  { label: 'runwayBanded:in', text: COACH_COPY.runwayBanded(4.2, 'in'), isProjection: false },
  { label: 'runwayBanded:above', text: COACH_COPY.runwayBanded(9.5, 'above'), isProjection: false },
  { label: 'freedomDividend', text: COACH_COPY.freedomDividend(17), isProjection: true },
  { label: 'yourEnough', text: COACH_COPY.yourEnough(), isProjection: false },
  { label: 'biggestLever', text: COACH_COPY.biggestLever(), isProjection: false },
  { label: 'dialTag', text: COACH_COPY.dialTag('Dining Out'), isProjection: false },
  { label: 'volatilityPrice', text: COACH_COPY.volatilityPrice(700), isProjection: true },
  { label: 'fifteenPercentReference', text: COACH_COPY.fifteenPercentReference(), isProjection: false },
  { label: 'savingsStreak:3', text: COACH_COPY.savingsStreak(3, 2653), isProjection: false },
  { label: 'savingsPersonalBest', text: COACH_COPY.savingsPersonalBest(3197, 'May 2026'), isProjection: false },
  { label: 'cushionIsAGoal', text: COACH_COPY.cushionIsAGoal(), isProjection: false },
  { label: 'assumptionsChange', text: COACH_COPY.assumptionsChange(), isProjection: false },
  { label: 'consciousSpending', text: COACH_COPY.consciousSpending(58, 14, 28), isProjection: false },
  { label: 'consciousOverspent', text: COACH_COPY.consciousOverspent(), isProjection: false },
  { label: 'automationBlueprintBanner', text: COACH_COPY.automationBlueprintBanner(), isProjection: false },
  { label: 'automationSavingsStep', text: COACH_COPY.automationSavingsStep('payday', cents(50000), 'Emergency Fund'), isProjection: false },
  { label: 'automationCardStep', text: COACH_COPY.automationCardStep('Visa', cents(120000), 'Jul 3'), isProjection: false },
  { label: 'debtFreeHero', text: COACH_COPY.debtFreeHero('Mar 2028'), isProjection: true },
  { label: 'debtNotClearing', text: COACH_COPY.debtNotClearing(), isProjection: false },
  { label: 'debtStrategyAvalanche', text: COACH_COPY.debtStrategyAvalanche(), isProjection: false },
  { label: 'debtStrategySnowball', text: COACH_COPY.debtStrategySnowball(), isProjection: false },
  { label: 'debtTradeoff', text: COACH_COPY.debtTradeoff(7, '$1,240'), isProjection: true },
  { label: 'debtStarterBuffer', text: COACH_COPY.debtStarterBuffer(), isProjection: false },
  { label: 'debtAskAnswer', text: COACH_COPY.debtAskAnswer('Mar 2028', 'least-interest'), isProjection: true },
  // Wave 4 — book-coverage completion (Kiyosaki C11, Aliche/Sethi C16)
  { label: 'assetsVsLiabilities', text: COACH_COPY.assetsVsLiabilities(), isProjection: false },
  { label: 'moneyRules:withDials', text: COACH_COPY.moneyRules(['Travel', 'Dining Out']), isProjection: false },
  { label: 'moneyRules:empty', text: COACH_COPY.moneyRules([]), isProjection: false },
  // Wave 1.3 — value receipts ("what Aimplifi caught"): counts of what was surfaced,
  // never an outcome/savings claim (the engine-side honesty rule).
  { label: 'receiptsHeadline:1', text: COACH_COPY.receiptsHeadline(1), isProjection: false },
  { label: 'receiptsHeadline:many', text: COACH_COPY.receiptsHeadline(7), isProjection: false },
  { label: 'receiptsReminders', text: COACH_COPY.receiptsReminders(3, cents(173456)), isProjection: false },
  { label: 'receiptsRadar', text: COACH_COPY.receiptsRadar(1), isProjection: false },
  { label: 'receiptsPriceIncreases', text: COACH_COPY.receiptsPriceIncreases(2, cents(1250)), isProjection: false },
  { label: 'receiptsFooter', text: COACH_COPY.receiptsFooter(), isProjection: false },
  { label: 'digestCaughtHeader', text: COACH_COPY.digestCaughtHeader(), isProjection: false },
  { label: 'digestSubject', text: COACH_COPY.digestSubject(), isProjection: false },
  { label: 'digestIntro', text: COACH_COPY.digestIntro('June 10, 2026'), isProjection: false },
  { label: 'digestPaymentsHeader', text: COACH_COPY.digestPaymentsHeader(), isProjection: false },
  { label: 'digestNothingDue', text: COACH_COPY.digestNothingDue(), isProjection: false },
  { label: 'digestOutro', text: COACH_COPY.digestOutro(), isProjection: false },
  { label: 'runway:noExpenses', text: COACH_COPY.runway(Infinity), isProjection: false },
  // #252 Money Signature — every state variant scans through the guardrails.
  { label: 'signatureTitle', text: COACH_COPY.signatureTitle(), isProjection: false },
  { label: 'signatureBasis', text: COACH_COPY.signatureBasis(), isProjection: false },
  { label: 'signatureWeather:strained', text: COACH_COPY.signatureWeather('strained', 0.8, 1200, 'May 2026'), isProjection: false },
  { label: 'signatureWeather:tight', text: COACH_COPY.signatureWeather('tight', 2.4, 300, 'May 2026'), isProjection: false },
  { label: 'signatureWeather:tightNegative', text: COACH_COPY.signatureWeather('tight', 5.1, -800, 'May 2026'), isProjection: false },
  { label: 'signatureWeather:calm', text: COACH_COPY.signatureWeather('calm', 4.2, 900, 'May 2026'), isProjection: false },
  { label: 'signatureWeather:bright', text: COACH_COPY.signatureWeather('bright', 6.5, 3197, 'May 2026'), isProjection: false },
  { label: 'signatureWeather:infiniteRunway', text: COACH_COPY.signatureWeather('calm', Infinity, null, null), isProjection: false },
  { label: 'signatureSavingSteady', text: COACH_COPY.signatureSavingSteady(10, 12, 'Aug 2025'), isProjection: false },
  { label: 'signatureSavingVariable', text: COACH_COPY.signatureSavingVariable(4, 12), isProjection: false },
  { label: 'signatureSavingForming', text: COACH_COPY.signatureSavingForming(3, 6), isProjection: false },
  { label: 'signatureSavingMixed', text: COACH_COPY.signatureSavingMixed(8, 12), isProjection: false },
  { label: 'signatureSteadinessSteady', text: COACH_COPY.signatureSteadinessSteady(450), isProjection: false },
  { label: 'signatureSteadinessVariable', text: COACH_COPY.signatureSteadinessVariable(3333), isProjection: false },
  { label: 'signatureSteadinessForming', text: COACH_COPY.signatureSteadinessForming(6), isProjection: false },
  { label: 'signatureSteadinessMixed', text: COACH_COPY.signatureSteadinessMixed(2000), isProjection: false },
  { label: 'signatureSavingShiftingFromSteady', text: COACH_COPY.signatureSavingShiftingFromSteady(5, 12, 'Jun 2025'), isProjection: false },
  { label: 'signatureSavingShiftingFromVariable', text: COACH_COPY.signatureSavingShiftingFromVariable(10, 12), isProjection: false },
  { label: 'signatureSteadinessShiftingFromSteady', text: COACH_COPY.signatureSteadinessShiftingFromSteady(5000), isProjection: false },
  { label: 'signatureSteadinessShiftingFromVariable', text: COACH_COPY.signatureSteadinessShiftingFromVariable(800), isProjection: false },
  { label: 'signatureSteadinessUnreadable', text: COACH_COPY.signatureSteadinessUnreadable(6), isProjection: false },
  // #254 Habit streaks — every state variant scans through the guardrails.
  { label: 'streaksTitle', text: COACH_COPY.streaksTitle(), isProjection: false },
  { label: 'streaksBasis', text: COACH_COPY.streaksBasis(), isProjection: false },
  { label: 'cardClearedStreak:17', text: COACH_COPY.cardClearedStreak(17, 4, 59, 'May 2026'), isProjection: false },
  { label: 'cardClearedStreak:1', text: COACH_COPY.cardClearedStreak(1, 1, 1, 'May 2026'), isProjection: false },
  { label: 'cardClearedBroken', text: COACH_COPY.cardClearedBroken('May 2026'), isProjection: false },
  { label: 'cardClearedNoHistory', text: COACH_COPY.cardClearedNoHistory(), isProjection: false },
  { label: 'cardClearedForming', text: COACH_COPY.cardClearedForming(), isProjection: false },
  { label: 'noCreepStreak:3', text: COACH_COPY.noCreepStreak(3, 12, 8), isProjection: false },
  { label: 'noCreepStreak:1sub', text: COACH_COPY.noCreepStreak(1, 12, 1), isProjection: false },
  { label: 'noCreepStreak:capped', text: COACH_COPY.noCreepStreak(12, 12, 8), isProjection: false },
  { label: 'noCreepLastIncrease', text: COACH_COPY.noCreepLastIncrease('Netflix', cents(1549), cents(1799), 'Feb 2026'), isProjection: false },
  { label: 'noCreepBrokenNow', text: COACH_COPY.noCreepBrokenNow('Netflix', cents(1549), cents(1799), 'May 2026'), isProjection: false },
  { label: 'noCreepNoSubs', text: COACH_COPY.noCreepNoSubs(), isProjection: false },
  { label: 'reviewImprovementRunway:noExpenses', text: COACH_COPY.reviewImprovementRunway(Infinity), isProjection: false },
  // The shared reminder line renders inside the digest body — scan its variants too.
  { label: 'reminderLine:selfPay', text: reminderLine(sampleReminder()), isProjection: false },
  { label: 'reminderLine:partialAutopay', text: reminderLine(sampleReminder({ userActionCents: cents(20000), autopayCents: cents(30000) })), isProjection: false },
  { label: 'reminderLine:covered', text: reminderLine(sampleReminder({ userActionCents: cents(0), autopayCents: cents(50000), autopayCovered: true })), isProjection: false },
  { label: 'reminderLine:estimated', text: reminderLine(sampleReminder({ isEstimated: true, daysUntil: 0 })), isProjection: false },
  ...(() => {
    const review = generateMoneyReview({
      flows,
      creep: creepFlagged,
      opportunities: [opportunity('unused-subscription'), opportunity('price-increase')],
      runwayMonths: 3.2,
    });
    return [
      { label: 'review.improvement', text: review.improvement, isProjection: false },
      { label: 'review.creep', text: review.creep, isProjection: false },
      { label: 'review.nextAction', text: review.nextAction, isProjection: false },
    ];
  })(),
];

const BANNED = [
  /you wasted/i,
  /stop buying/i,
  /\bguilty\b/i,
  /\bshame\b/i,
  /you should have/i,
  /\bsplurg/i,
  /cut back on your latte/i,
  /\birresponsib/i,
  /\bbad with money\b/i,
];

const TICKERS = /\b(VTSAX|VTI|VOO|SPY|AAPL|TSLA|bitcoin|crypto|buy (shares|stocks?|the dip)|ticker)\b/i;

describe('coach copy guardrails — zero shame, assumptions everywhere, no tickers', () => {
  it.each(ALL_STRINGS.map((s) => [s.label, s] as const))('%s: no shame language', (_, s) => {
    for (const banned of BANNED) {
      expect(s.text, `"${s.text}" must not match ${banned}`).not.toMatch(banned);
    }
  });

  it.each(
    ALL_STRINGS.filter((s) => s.isProjection).map((s) => [s.label, s] as const),
  )('%s: projection states its assumptions', (_, s) => {
    expect(s.text).toMatch(/assum(es|ing|ption)/i);
  });

  it.each(ALL_STRINGS.map((s) => [s.label, s] as const))('%s: no security recommendations', (_, s) => {
    expect(s.text).not.toMatch(TICKERS);
  });

  // Wave 1.3 honesty rule: the receipts tally counts what was SURFACED; it must never
  // claim an outcome — Aimplifi can't know what the user did after a reminder/flag.
  it('receipts copy never claims savings or an outcome', () => {
    const receipts = ALL_STRINGS.filter((s) => s.label.startsWith('receipts') || s.label === 'digestCaughtHeader');
    expect(receipts.length).toBeGreaterThanOrEqual(7);
    for (const s of receipts) {
      expect(s.text, s.label).not.toMatch(/\bsaved you\b|\bwe saved\b|\byou saved\b|\bearned you\b|\bmade you\b/i);
    }
  });

  it('the disclaimer marks the coach as educational, not advice', () => {
    expect(COACH_COPY.disclaimer()).toMatch(/educational/i);
    expect(COACH_COPY.disclaimer()).toMatch(/not financial advice/i);
  });

  // Critic #174 P2-1: a first-week user (empty flows) makes monthsOfRunway = Infinity;
  // the runway copy must never render the literal "Infinity" — on /coach OR in the digest.
  it('never renders "Infinity" months for a zero-expense user', () => {
    expect(COACH_COPY.runway(Infinity)).not.toMatch(/infinity/i);
    expect(COACH_COPY.reviewImprovementRunway(Infinity)).not.toMatch(/infinity/i);
    const review = generateMoneyReview({ flows: [], creep: creepClear, opportunities: [], runwayMonths: Infinity });
    expect(review.improvement).not.toMatch(/infinity/i);
    expect(review.improvement.length).toBeGreaterThan(0);
  });
});

// #254 Habit streaks — exact rendered locks for the money-bearing lines (the
// verbatim-value lesson: a template that carries cents must be locked as the
// user reads it, not just scanned for tone).
describe('habit-streaks copy — exact rendered locks (#254)', () => {
  it('noCreepLastIncrease renders both prices and the month verbatim', () => {
    expect(COACH_COPY.noCreepLastIncrease('Netflix', cents(1549), cents(1799), 'Feb 2026')).toBe(
      'The last increase: Netflix, $15.49 → $17.99 in Feb 2026.',
    );
  });

  it('noCreepBrokenNow renders the increase and a shame-free restart line', () => {
    expect(COACH_COPY.noCreepBrokenNow('Netflix', cents(1549), cents(1799), 'May 2026')).toBe(
      'Netflix went $15.49 → $17.99 in May 2026. The count restarts with the next full month at steady prices.',
    );
  });

  it('cardClearedStreak states the by-due-date basis inline, pluralizes, and discloses the statement count (critic F1)', () => {
    const many = COACH_COPY.cardClearedStreak(17, 4, 59, 'May 2026');
    expect(many).toContain('17 months in a row');
    expect(many).toContain('paid in full by its due date');
    expect(many).toContain('(4 cards, 59 statements)');
    const one = COACH_COPY.cardClearedStreak(1, 1, 1, 'May 2026');
    expect(one).toContain('1 month in a row');
    expect(one).toContain('(1 card, 1 statement)');
  });

  it('noCreepStreak pluralizes and the capped variant discloses the horizon', () => {
    expect(COACH_COPY.noCreepStreak(1, 12, 1)).toContain('1 full month with');
    expect(COACH_COPY.noCreepStreak(1, 12, 1)).toContain('1 tracked subscription.');
    expect(COACH_COPY.noCreepStreak(12, 12, 8)).toContain('as far back as this check looks');
  });
});

/**
 * Wealth-target copy — exact rendered locks for the sentences two hostile critics
 * independently broke. Each of these was a TRUE sentence printed beside a figure it was
 * not true OF, which is the defect class the lessons ledger keeps recording; a scan for
 * tone cannot see any of them, so they are pinned as the reader reads them.
 */
describe('wealth-target copy — the claims the critics broke', () => {
  it('a floored real return never prints a subtraction that does not compute', () => {
    // 7.00% − 10.00% is −3.00%, not 0.00%. The floored branch must not print both operands
    // beside the floor and invite the reader to check the arithmetic.
    const floored = COACH_COPY.wealthTargetBasis(cents(1_000_000_000), 0, 700, 1000, true);
    expect(floored).not.toMatch(/7\.00% return assumption less 10\.00% inflation/);
    expect(floored).toContain('at or below your 10.00% inflation assumption');
    // And it must state the direction of the error the floor introduces.
    expect(floored).toContain('arrive later than it says, not sooner');
    // The unfloored branch still shows its working.
    expect(COACH_COPY.wealthTargetBasis(cents(1_000_000_000), 450, 700, 250, false)).toContain(
      'your 7.00% return assumption less 2.50% inflation',
    );
  });

  it('affordability that cannot be judged names no pool at all', () => {
    // The engine returns null when there is no positive guilt-free figure. Falling through
    // to the "more than you have" branch formatted a NEGATIVE balance as money the reader
    // has ("more than the -$2,432.33 of monthly guilt-free spending you have").
    const unknowable = COACH_COPY.wealthTargetAdditional(cents(900_000), cents(-243_233), null);
    expect(unknowable).not.toMatch(/-\$/);
    expect(unknowable).not.toContain('guilt-free spending you have');
    expect(unknowable).toContain('no guilt-free figure to weigh it against');
    // The two judgeable branches still name the figure they compare against.
    expect(COACH_COPY.wealthTargetAdditional(cents(75_000), cents(300_000), true)).toContain(
      'fits inside your $3,000.00',
    );
    expect(COACH_COPY.wealthTargetAdditional(cents(900_000), cents(300_000), false)).toContain(
      'more than the $3,000.00',
    );
  });

  it('"already there" names the PORTFOLIO, not the number the reader typed', () => {
    expect(
      COACH_COPY.wealthTargetAlreadyThere(cents(1_200_000_000), cents(1_000_000_000)),
    ).toBe(
      "You have $12,000,000.00, which is already past the $10,000,000.00 you named. " +
        "Worth deciding what the number is for — a target you've passed is a good moment to name the next one.",
    );
  });

  it('the horizon copy names the 100-year cap it actually computed, not a softer paraphrase', () => {
    expect(COACH_COPY.wealthTargetBeyondHorizon(450)).toContain("doesn't arrive within 100 years");
    expect(COACH_COPY.wealthTargetSensitivityRow(500, 250, null)).toContain('not within 100 years');
    expect(COACH_COPY.wealthTargetBeyondHorizon(450)).not.toMatch(/working lifetime/i);
  });

  it('the sensitivity intro only claims a spread when the rows have one', () => {
    expect(COACH_COPY.wealthTargetSensitivityIntro(true)).toContain('the spread between them');
    const degenerate = COACH_COPY.wealthTargetSensitivityIntro(false);
    expect(degenerate).not.toMatch(/the spread between them is usually wider/);
    expect(degenerate).toContain('all three floor to no real growth');
  });

  it('the required contribution says a flat standing order will not keep pace', () => {
    const line = COACH_COPY.wealthTargetRequired(cents(183_243), 25, 450, 250);
    expect(line).toContain("in today's money");
    expect(line).toContain('would need to rise with inflation');
    expect(line).toContain('2.50% a year on your own assumption');
  });

  it('the FI-card reconciliation names both bases and which one runs earlier', () => {
    const line = COACH_COPY.wealthTargetVsFiCard(700, 250);
    expect(line).toContain('7.00% before inflation');
    expect(line).toContain('its date is earlier');
    expect(line).toContain('2.50% inflation assumption');
  });
});

/**
 * The wealth-target card's THREE invisible inputs (owner, 2026-07-31: "I set 10 mil and it gave
 * me some arbitrary savings for arbitrary time. These should be based on my dials which should
 * show directly on this page").
 *
 * The figures were never wrong — $23,888.10/month reaching $10M in 12y10m and $349.41/month
 * reaching it in 25 both imply the same ~$1.48M starting balance, so the two halves of the card
 * agreed with each other and with the arithmetic. What made them read as arbitrary is that the
 * card printed the destination and the instalment and rendered NO control and NO figure for the
 * three inputs that decide them. These lock the naming, not the maths.
 */
describe('wealth target — every figure names where it came from', () => {
  it('prints the starting balance and scopes it to the projections, not to "everything below"', () => {
    const s = COACH_COPY.wealthTargetStartingFrom(cents(1_480_000_00));
    expect(s).toContain('$1,480,000.00');
    expect(s.toLowerCase()).toContain('investment accounts');
    // The rate is NOT named here. The sensitivity rows grow this same balance at the dial ±2pp,
    // so "grows at 7.50% in everything below" was false of three of the card's own lines — and
    // positional besides, which goes stale the moment the card is reordered.
    expect(s).not.toMatch(/\d+\.\d\d%/);
    expect(s).not.toMatch(/below/i);
    // The exclusion may not read as EXHAUSTIVE: the currency guard drops non-USD investment
    // accounts before the sum, and Plaid maps HSA / cash-management / prepaid into CHECKING.
    expect(s).not.toMatch(/are not counted in it/i);
  });

  it('names the assumption that makes compounding the leftover coherent', () => {
    // Excluding cash from the BALANCE while compounding the monthly leftover — which is cash —
    // at the same rate is a contradiction the card previously supplied its own reason for.
    const s = COACH_COPY.wealthTargetStartingFrom(cents(1_480_000_00));
    expect(s).toMatch(/assuming what you put away each month is invested/i);
    expect(s).not.toMatch(/not on cash/i);
  });

  it('does not describe an empty portfolio as money the reader has', () => {
    const s = COACH_COPY.wealthTargetStartingFrom(cents(0));
    expect(s).toContain('$0.00');
    expect(s).toMatch(/whole target has to come from what you put away/i);
    expect(s).not.toMatch(/in your investment accounts today/i);
  });

  it('names the pace figure as leftover, over the window it was ACTUALLY averaged on', () => {
    // `monthlySavings` divides by `Math.max(1, last6.length)` and `monthlyFlows` emits only
    // months that contain a qualifying row — so a constant "6" is false for every short history
    // and for any span containing an empty month. Two independent critics falsified it.
    const three = COACH_COPY.wealthTargetAtCurrentPace(12, 10, cents(23_888_10), 750, 3);
    expect(three).toContain('$23,888.10');
    expect(three).toContain('12 years 10 months');
    expect(three).toMatch(/left after spending/i);
    expect(three).toContain('3 months');
    expect(three).not.toContain('6 months');
    expect(three.startsWith('Saving ')).toBe(false);
    // Singular is a reachable window, not a typo.
    expect(COACH_COPY.wealthTargetAtCurrentPace(1, 0, cents(100_00), 750, 1)).toContain('1 month ');
  });

  it('does not read an empty history as evidence of overspending', () => {
    // 0 complete months divides 0 by 1 and floors exactly as real overspending does. Telling a
    // day-one reader "spending is running ahead of income" is a behaviour claim built from an
    // empty set — the one thing `an-empty-set-is-not-a-fact-about-money` forbids.
    const none = COACH_COPY.wealthTargetNotSaving(0);
    expect(none).toMatch(/complete month/i);
    expect(none).not.toMatch(/running ahead of income/i);
    expect(COACH_COPY.wealthTargetNotSaving(6)).toMatch(/running ahead of income/i);
  });

  it('gives the horizon THREE bases, so a dragged slider is never called unchosen', () => {
    const seeded = COACH_COPY.wealthTargetHorizonBasis('seeded');
    const chosen = COACH_COPY.wealthTargetHorizonBasis('chosen');
    const fallback = COACH_COPY.wealthTargetHorizonBasis('fallback');
    expect(new Set([seeded, chosen, fallback]).size).toBe(3);
    expect(seeded).toMatch(/your current pace/i);
    // The state that was missing: the reader dragged the control and was told, one line under
    // it, that nothing had picked the date.
    expect(chosen).toMatch(/you picked/i);
    expect(chosen).not.toMatch(/nothing has picked/i);
    expect(fallback).toMatch(/nothing has picked this date for you/i);
    expect(fallback).not.toMatch(/your (current )?pace/i);
  });

  it('claims the dials are the reader’s ONLY when the reader actually set them', () => {
    // `User.inflationBps` is nullable and /coach falls back to 2.50%. /settings calls that same
    // number "our defaults" — a card calling it "yours" contradicts the page it links to, and
    // the possessive is the exact claim the owner asked to be made true.
    const set = COACH_COPY.wealthTargetDials(1000, 250, false);
    const defaulted = COACH_COPY.wealthTargetDials(1000, 250, true);
    expect(set).toContain('10.00%');
    expect(set).toContain('2.50%');
    expect(set).toMatch(/yours to change/i);
    expect(defaulted).toMatch(/Aimplifi's default/i);
    expect(defaulted).not.toMatch(/both rates are yours/i);
    // Neither may claim EVERY figure is downstream of the dials: the target, the starting
    // balance, the pace figure and the guilt-free figure are all inputs from elsewhere.
    for (const s of [set, defaulted]) {
      expect(s).not.toMatch(/every figure/i);
      expect(s).toMatch(/how long the target takes, and what it costs a month/i);
    }
  });
});

/**
 * The scan's own completeness. `ALL_STRINGS` is hand-maintained, and this slice originally added
 * three COACH_COPY entries and zero rows — so the shame sweep, the projection-assumption sweep
 * and the ticker sweep all silently skipped the new copy, and one of the three would have failed
 * on the spot. A hand-maintained list of everything is only as good as the check that it IS
 * everything.
 */
describe('the guardrail scan covers every string COACH_COPY can emit', () => {
  it('has an ALL_STRINGS row for every function-valued key', () => {
    const covered = new Set(ALL_STRINGS.map((s) => s.label.split(':')[0]));
    const emitters = Object.entries(COACH_COPY)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k);
    expect(emitters.length).toBeGreaterThan(0);
    const missing = emitters.filter((k) => !covered.has(k));
    // A pre-existing gap this check FOUND, pinned rather than quietly widened into the
    // assertion. Every one of these predates this slice; the list may only shrink, so adding a
    // new COACH_COPY key without an ALL_STRINGS row fails here, and closing one of the seven
    // means deleting a line that explains itself (TASKS W.8).
    const KNOWN_UNSCANNED = [
      'reviewNextAction',
      'reviewPersonalizedBadge',
      'nextActionCancelSub',
      'nextActionTransfer',
      'nextActionAutomate',
      'digestNothingDueWithUndated',
      'digestUndatedAlongsideDues',
    ];
    const unexpected = missing.filter((k) => !KNOWN_UNSCANNED.includes(k));
    expect(unexpected, `COACH_COPY keys with no ALL_STRINGS row: ${unexpected.join(', ')}`).toEqual(
      [],
    );
    // And the pin itself cannot rot: a key that gets registered must leave this list.
    expect(KNOWN_UNSCANNED.filter((k) => !missing.includes(k))).toEqual([]);
  });
});
