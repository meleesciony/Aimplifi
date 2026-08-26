/**
 * Coach copy guardrails (docs/EDGE_CASES.md §Coach copy guardrails):
 *  - zero shame phrases anywhere
 *  - every projection string states its assumptions
 *  - no security/ticker recommendations
 * Scans EVERY string COACH_COPY can produce, with representative args.
 */
import { describe, expect, it } from 'vitest';
import { CONSCIOUS_BUCKET_COUNTS } from '@/lib/engine/spending-plan/conscious';
import { COACH_COPY, generateMoneyReview, wealthTargetPlanUnproven } from '@/lib/engine/fi/coach-copy';
import type { CreepResult, MonthlyFlow, Opportunity } from '@/lib/engine/fi/insights';
import { type PaymentReminder, reminderLine } from '@/lib/engine/reminders/select';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import type { DialOwnership } from '@/lib/engine/settings/dials';

/**
 * W.13 — who chose the two rates. Named rather than inlined as `{a, b}` at forty call sites,
 * because the two fields are both booleans and the whole point of the object was that they
 * cannot be swapped for each other by a caller who is not paying attention.
 */
const OWNS_BOTH: DialOwnership = { returnIsDefault: false, inflationIsDefault: false };
const DEFAULT_BOTH: DialOwnership = { returnIsDefault: true, inflationIsDefault: true };
const DEFAULT_INFLATION: DialOwnership = { returnIsDefault: false, inflationIsDefault: true };
const DEFAULT_RETURN: DialOwnership = { returnIsDefault: true, inflationIsDefault: false };

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
  // O.20g — a flagged window is a MEASURED window by construction (`flagged`
  // requires both sides), so the guardrail fixture says so.
  incomeMeasured: true,
  spendMeasured: true,
  incomeBaselineCents: cents(500_000),
  discretionaryBaselineCents: cents(120_000),
  monthlyDiscretionaryCents: [],
  windowMonths: 6,
  loanPaymentsExcluded: false,
};
const creepClear: CreepResult = { ...creepFlagged, flagged: false, spendGrowthBps: 20 };
/**
 * O.20g — the third verdict, scanned by the guardrails like the other two: a
 * reader whose window has a month with no income row at all. `flagged` is false
 * because the comparison was refused, NOT because spending tracked income.
 */
const creepNotComparable: CreepResult = {
  ...creepFlagged,
  flagged: false,
  incomeMeasured: false,
  incomeBaselineCents: cents(8),
};
/** The other side of the refusal: no discretionary baseline to grow from. */
const creepNoSpendBaseline: CreepResult = {
  ...creepFlagged,
  flagged: false,
  spendMeasured: false,
  discretionaryBaselineCents: cents(0),
};
/** Neither side measurable — the ordinary brand-new account. */
const creepNeitherMeasured: CreepResult = {
  ...creepFlagged,
  flagged: false,
  incomeMeasured: false,
  spendMeasured: false,
  incomeBaselineCents: cents(0),
  discretionaryBaselineCents: cents(0),
};

const opportunity = (kind: Opportunity['kind']): Opportunity => ({
  kind,
  merchant: 'LA Fitness',
  monthlyCents: cents(3499),
  todayValue10Cents: cents(605000),
  todayValue20Cents: cents(1822000),
  todayValue30Cents: cents(4267000),
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
  { label: 'fiNumber', text: COACH_COPY.fiNumber(cents(150_000_000), 400, cents(6_000_000), 6), isProjection: true },
  { label: 'savingsRateNegative', text: COACH_COPY.savingsRateHeadline(-2500, 'May 2026'), isProjection: false },
  { label: 'sliderContext', text: COACH_COPY.sliderContext(2330, 3734, 'May 2026', 6), isProjection: false },
  // W.12 — headline / Coast defer to `fiProjectionBasis` for the rate number; they still
  // say "assumptions" so the projection sweep keeps them honest, without restating 4.50%.
  { label: 'yearsToFI', text: COACH_COPY.yearsToFI(17, 3), isProjection: true },
  { label: 'notOnTrack', text: COACH_COPY.notOnTrack(), isProjection: false },
  // The two states W.2 split out of `notOnTrack`'s null overload. `beyondProjectionHorizon`
  // refuses a date rather than projecting one — not a projection for the assumption sweep.
  {
    label: 'notOnTrackButCoasting',
    text: COACH_COPY.notOnTrackButCoasting(),
    isProjection: false,
  },
  {
    label: 'beyondProjectionHorizon',
    text: COACH_COPY.beyondProjectionHorizon(),
    isProjection: false,
  },
  // C.14 (audit #22): the goals card's null state — refuses a figure, never
  // prints "~null months". Not a projection: it refuses one.
  {
    label: 'goalFiBeyondHorizon',
    text: COACH_COPY.goalFiBeyondHorizon(),
    isProjection: false,
  },
  // The SELECTOR over those four, scanned through all four of its states — so the sweeps see
  // what the card actually renders, not only the strings in isolation.
  {
    label: 'fiHeadline:onTrack',
    text: COACH_COPY.fiHeadline({
      monthsToFI: 207,
      monthlySavingsCents: 200_000,
      coastIsCoast: false,
    }),
    isProjection: true,
  },
  {
    label: 'fiHeadline:beyondHorizon',
    text: COACH_COPY.fiHeadline({
      monthsToFI: null,
      monthlySavingsCents: 74_000,
      coastIsCoast: false,
    }),
    isProjection: false,
  },
  {
    label: 'fiHeadline:coasting',
    text: COACH_COPY.fiHeadline({
      monthsToFI: null,
      monthlySavingsCents: -500_000,
      coastIsCoast: true,
    }),
    isProjection: false,
  },
  {
    label: 'fiHeadline:notSaving',
    text: COACH_COPY.fiHeadline({
      monthsToFI: null,
      monthlySavingsCents: -500_000,
      coastIsCoast: false,
    }),
    isProjection: false,
  },
  // Four ownership branches, not two (W.13). Each row's RATES agree with its flags, so no row
  // here pins a sentence production can never print: 800 is a return only a reader can have
  // chosen and 700 is the app's own, while an inflation rate that is not 250 can never be
  // `inflationIsDefault` (the fallback IS 250) — which is why every floored row below, needing
  // inflation above the return, is `DEFAULT_RETURN` rather than `DEFAULT_BOTH`.
  {
    label: 'fiProjectionBasis',
    text: COACH_COPY.fiProjectionBasis(550, 800, 250, false, OWNS_BOTH),
    isProjection: true,
  },
  {
    label: 'fiProjectionBasis:defaultInflation',
    text: COACH_COPY.fiProjectionBasis(550, 800, 250, false, DEFAULT_INFLATION),
    isProjection: true,
  },
  {
    label: 'fiProjectionBasis:defaultReturn',
    text: COACH_COPY.fiProjectionBasis(450, 700, 250, false, DEFAULT_RETURN),
    isProjection: true,
  },
  {
    label: 'fiProjectionBasis:defaultBoth',
    text: COACH_COPY.fiProjectionBasis(450, 700, 250, false, DEFAULT_BOTH),
    isProjection: true,
  },
  {
    label: 'fiProjectionBasis:floored',
    text: COACH_COPY.fiProjectionBasis(0, 800, 1000, true, OWNS_BOTH),
    isProjection: true,
  },
  {
    label: 'fiProjectionBasis:floored+defaultReturn',
    text: COACH_COPY.fiProjectionBasis(0, 700, 1000, true, DEFAULT_RETURN),
    isProjection: true,
  },
  { label: 'coastFI', text: COACH_COPY.coastFI(25, true), isProjection: true },
  { label: 'coastFI:readerHorizon', text: COACH_COPY.coastFI(25, false), isProjection: true },
  {
    label: 'notCoastFI',
    text: COACH_COPY.notCoastFI(cents(120000), 25, true),
    isProjection: true,
  },
  {
    label: 'notCoastFI:readerHorizon',
    text: COACH_COPY.notCoastFI(cents(120000), 25, false),
    isProjection: true,
  },
  // C14 past-enough framing — a values choice, not a figure, so not a projection.
  { label: 'pastEnoughCoast', text: COACH_COPY.pastEnoughCoast(), isProjection: false },
  { label: 'sliderCaption', text: COACH_COPY.sliderCaption(2200, 3000, 23, 17, 6), isProjection: true },
  // W.10 — the rate here is the reader's own RETURN dial (the money grows at it); the figures
  // themselves are then deflated to today's money, which `opportunityBasis` states once.
  { label: 'opportunity:unused', text: COACH_COPY.opportunity(opportunity('unused-subscription'), 700), isProjection: true },
  { label: 'opportunity:price', text: COACH_COPY.opportunity(opportunity('price-increase'), 700), isProjection: true },
  { label: 'opportunity:insurance', text: COACH_COPY.opportunity(opportunity('insurance-reshop'), 700), isProjection: true },
  { label: 'opportunity:bill', text: COACH_COPY.opportunity(opportunity('negotiable-bill'), 700), isProjection: true },
  // The zero-return branch, where "compounding does the work" would be false and is dropped.
  { label: 'opportunity:zeroReturn', text: COACH_COPY.opportunity(opportunity('unused-subscription'), 0), isProjection: true },
  // W.10a critic — the same payload dropped for the other reason: a printed figure at or below
  // the dollars handed over. A non-zero rate reaches it, so it is its own branch and its own row.
  {
    label: 'opportunity:trailsContributions',
    text: COACH_COPY.opportunity(
      { ...opportunity('unused-subscription'), todayValue10Cents: cents(400_000) },
      700,
    ),
    isProjection: true,
  },
  // Every branch of the list's basis line gets a row — a branch absent from this table has
  // never been scanned by the guardrail sweeps at all.
  {
    label: 'opportunityBasis',
    text: COACH_COPY.opportunityBasis(700, 250, DEFAULT_BOTH),
    isProjection: true,
  },
  {
    label: 'opportunityBasis:ownedDials',
    text: COACH_COPY.opportunityBasis(800, 250, OWNS_BOTH),
    isProjection: true,
  },
  {
    label: 'opportunityBasis:noInflation',
    text: COACH_COPY.opportunityBasis(800, 0, OWNS_BOTH),
    isProjection: true,
  },
  {
    label: 'opportunityBasis:noInflation+defaultReturn',
    text: COACH_COPY.opportunityBasis(700, 0, DEFAULT_RETURN),
    isProjection: true,
  },
  {
    label: 'opportunityBasis:inflationOutruns',
    text: COACH_COPY.opportunityBasis(500, 600, OWNS_BOTH),
    isProjection: true,
  },
  // Wealth target — every projection here carries BOTH assumptions (rate + today's dollars).
  {
    label: 'wealthTargetBasis',
    text: COACH_COPY.wealthTargetBasis(cents(1_000_000_000), 550, 800, 250, false, OWNS_BOTH),
    isProjection: true,
  },
  {
    label: 'wealthTargetBasis:defaultBoth',
    text: COACH_COPY.wealthTargetBasis(cents(1_000_000_000), 450, 700, 250, false, DEFAULT_BOTH),
    isProjection: true,
  },
  {
    label: 'wealthTargetBasis:floored',
    text: COACH_COPY.wealthTargetBasis(cents(1_000_000_000), 0, 800, 1000, true, OWNS_BOTH),
    isProjection: true,
  },
  {
    label: 'wealthTargetBasis:floored+defaultReturn',
    text: COACH_COPY.wealthTargetBasis(cents(1_000_000_000), 0, 700, 1000, true, DEFAULT_RETURN),
    isProjection: true,
  },
  {
    label: 'wealthTargetVsFiCard',
    text: COACH_COPY.wealthTargetVsFiCard(450),
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
  // C.10 (audit P0-8) — the settings-% pace sentence and its refusal. The planned pace is a
  // projection; both refusals are not.
  {
    label: 'wealthTargetAtPlannedPace',
    text: COACH_COPY.wealthTargetAtPlannedPace(44, 5, cents(500000), 450),
    isProjection: true,
  },
  {
    label: 'wealthTargetPlanNotSaving',
    text: COACH_COPY.wealthTargetPlanNotSaving(cents(500000), 6),
    isProjection: false,
  },
  {
    label: 'wealthTargetPlanNotSaving:no-months',
    text: COACH_COPY.wealthTargetPlanNotSaving(cents(500000), 0),
    isProjection: false,
  },
  {
    // The selector emits only its building blocks; registered so the completeness check below
    // sees the key, scanning the planned-pace routing as its representative string.
    label: 'wealthTargetPaceLine',
    text: COACH_COPY.wealthTargetPaceLine({
      basis: 'settings-savings-pct',
      contributionCents: cents(500000),
      contributionFloored: false,
      historicalCents: cents(400000),
      averagedOverMonths: 6,
      arrivalMonths: 533,
      realBps: 450,
    }),
    isProjection: true,
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
    text: COACH_COPY.wealthTargetDials(1000, 250, OWNS_BOTH),
    isProjection: false,
  },
  {
    label: 'wealthTargetDials:default-inflation',
    text: COACH_COPY.wealthTargetDials(1000, 250, DEFAULT_INFLATION),
    isProjection: false,
  },
  {
    label: 'wealthTargetDials:default-return',
    text: COACH_COPY.wealthTargetDials(700, 250, DEFAULT_RETURN),
    isProjection: false,
  },
  {
    label: 'wealthTargetDials:default-both',
    text: COACH_COPY.wealthTargetDials(700, 250, DEFAULT_BOTH),
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
    text: COACH_COPY.wealthTargetRequired(cents(1_250_00), 25, 450, 250, OWNS_BOTH),
    isProjection: true,
  },
  {
    label: 'wealthTargetRequired:oneYear+defaultInflation',
    text: COACH_COPY.wealthTargetRequired(cents(1_250_00), 1, 450, 250, DEFAULT_INFLATION),
    isProjection: true,
  },
  {
    label: 'wealthTargetRequiredShare',
    text: COACH_COPY.wealthTargetRequiredShare(3400, 6),
    isProjection: false,
  },
  {
    label: 'wealthTargetRequiredExceedsIncome',
    text: COACH_COPY.wealthTargetRequiredExceedsIncome(),
    isProjection: false,
  },
  {
    label: 'wealthTargetContributionBasis:settings',
    text: COACH_COPY.wealthTargetContributionBasis(
      'settings-savings-pct',
      cents(500_000),
      2500,
      cents(200_000),
    ),
    isProjection: false,
  },
  {
    label: 'wealthTargetContributionBasis:surplus',
    text: COACH_COPY.wealthTargetContributionBasis('recent-surplus', cents(200_000), null, cents(200_000)),
    isProjection: false,
  },
  {
    label: 'wealthTargetCutsIntro:withDials',
    text: COACH_COPY.wealthTargetCutsIntro(cents(100_000), 2),
    isProjection: false,
  },
  {
    label: 'wealthTargetCutsIntro:noDials',
    text: COACH_COPY.wealthTargetCutsIntro(cents(100_000), 0),
    isProjection: false,
  },
  {
    label: 'wealthTargetCutRow',
    text: COACH_COPY.wealthTargetCutRow('Dining Out', cents(45_000)),
    isProjection: false,
  },
  {
    label: 'wealthTargetCutsEmpty',
    text: COACH_COPY.wealthTargetCutsEmpty(cents(100_000)),
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
    text: COACH_COPY.wealthTargetSensitivityIntro(true, OWNS_BOTH),
    isProjection: false,
  },
  {
    label: 'wealthTargetSensitivityIntro:degenerate',
    text: COACH_COPY.wealthTargetSensitivityIntro(false, OWNS_BOTH),
    isProjection: false,
  },
  {
    label: 'wealthTargetSensitivityIntro:degenerate+defaultReturn',
    text: COACH_COPY.wealthTargetSensitivityIntro(false, DEFAULT_RETURN),
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
  // O.20g — the third verdict and its Money Review line, both refusal states each.
  { label: 'creepNotComparable:income', text: COACH_COPY.creepNotComparable(creepNotComparable), isProjection: false },
  { label: 'creepNotComparable:spend', text: COACH_COPY.creepNotComparable(creepNoSpendBaseline), isProjection: false },
  // The third combination — BOTH sides unmeasured — is the one every brand-new
  // account hits (`detectLifestyleCreep([])`), and it is the only branch that
  // concatenates every clause. It was missing, so the shame/assumption sweeps
  // skipped exactly the copy most readers see first.
  { label: 'creepNotComparable:neither', text: COACH_COPY.creepNotComparable(creepNeitherMeasured), isProjection: false },
  // And the zero-income variant, whose refusal clause takes the other branch.
  { label: 'creepNotComparable:noIncomeAtAll', text: COACH_COPY.creepNotComparable({ ...creepNotComparable, incomeBaselineCents: cents(0) }), isProjection: false },
  { label: 'reviewCreepNotComparable:income', text: COACH_COPY.reviewCreepNotComparable(creepNotComparable), isProjection: false },
  { label: 'reviewCreepNotComparable:spend', text: COACH_COPY.reviewCreepNotComparable(creepNoSpendBaseline), isProjection: false },
  { label: 'reviewCreepNotComparable:neither', text: COACH_COPY.reviewCreepNotComparable(creepNeitherMeasured), isProjection: false },
  { label: 'creepCard:title', text: COACH_COPY.creepCard(creepNotComparable).title, isProjection: false },
  { label: 'creepCard:body', text: COACH_COPY.creepCard(creepNotComparable).body, isProjection: false },
  { label: 'creepCard:linkLabel', text: COACH_COPY.creepCard(creepNotComparable).linkLabel, isProjection: false },
  { label: 'creepCard:flaggedTitle', text: COACH_COPY.creepCard(creepFlagged).title, isProjection: false },
  { label: 'creepCard:clearTitle', text: COACH_COPY.creepCard(creepClear).title, isProjection: false },
  { label: 'runway', text: COACH_COPY.runway(3.2), isProjection: false },
  // Audit P2: the negative branches are SECOND strings these functions produce
  // and this file claims to scan every one of them — a negative runway must
  // not ship past the shame/assumption guardrails as a flat fact.
  { label: 'runway:negative', text: COACH_COPY.runway(-2.3), isProjection: false },
  { label: 'lifeEnergy', text: COACH_COPY.lifeEnergy(cents(19000), 5), isProjection: true },
  { label: 'lifeEnergyFootnote', text: COACH_COPY.lifeEnergyFootnote(cents(3800)), isProjection: true },
  { label: 'lifeEnergyReflection', text: COACH_COPY.lifeEnergyReflection(), isProjection: false },
  { label: 'fulfillmentTitle', text: COACH_COPY.fulfillmentTitle(), isProjection: false },
  {
    label: 'fulfillmentSubtitle',
    text: COACH_COPY.fulfillmentSubtitle({
      windowMonths: 6,
      months: ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'],
      hourlyWageCents: 3800,
      categories: [],
      categoryCount: 0,
    }),
    isProjection: false,
  },
  {
    label: 'fulfillmentSubtitle:truncated',
    text: COACH_COPY.fulfillmentSubtitle({
      windowMonths: 6,
      months: ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'],
      hourlyWageCents: 3800,
      categoryCount: 11,
      categories: [
        {
          categoryId: 'shopping',
          categoryName: 'Shopping',
          isMoneyDial: false,
          monthly: [],
          totalSpendCents: 1,
          totalHours: 1,
          trendBps: 0,
          trendMeasured: false,
        },
      ],
    }),
    isProjection: false,
  },
  { label: 'fulfillmentEmpty', text: COACH_COPY.fulfillmentEmpty(), isProjection: false },
  {
    label: 'fulfillmentOmitted',
    text:
      COACH_COPY.fulfillmentOmitted({
        windowMonths: 6,
        months: [],
        hourlyWageCents: 3800,
        categoryCount: 11,
        categories: new Array(5).fill(null).map((_, i) => ({
          categoryId: `c${i}`,
          categoryName: `C${i}`,
          isMoneyDial: false,
          monthly: [],
          totalSpendCents: 1,
          totalHours: 1,
          trendBps: 0,
          trendMeasured: false,
        })),
      }) ?? '',
    isProjection: false,
  },
  {
    label: 'fulfillmentFootnote',
    text: COACH_COPY.fulfillmentFootnote(cents(3800)),
    isProjection: true,
  },
  {
    label: 'fulfillmentRow',
    text: COACH_COPY.fulfillmentRow(
      {
        categoryId: 'dining',
        categoryName: 'Dining Out',
        isMoneyDial: true,
        monthly: [],
        totalSpendCents: 114_000,
        totalHours: 30,
        trendBps: 1200,
        trendMeasured: true,
      },
      6,
    ),
    isProjection: false,
  },
  {
    label: 'fulfillmentRow:unmeasured',
    text: COACH_COPY.fulfillmentRow(
      {
        categoryId: 'shopping',
        categoryName: 'Shopping',
        isMoneyDial: false,
        monthly: [],
        totalSpendCents: 5_000,
        totalHours: 1.3,
        trendBps: 0,
        trendMeasured: false,
      },
      6,
    ),
    isProjection: false,
  },
  {
    label: 'fulfillmentSpark',
    text: COACH_COPY.fulfillmentSpark({
      categoryId: 'dining',
      categoryName: 'Dining Out',
      isMoneyDial: true,
      monthly: [
        { month: '2025-12', spendCents: 19_000, hours: 5 },
        { month: '2026-01', spendCents: 19_000, hours: 5 },
      ],
      totalSpendCents: 38_000,
      totalHours: 10,
      trendBps: 0,
      trendMeasured: true,
    }),
    isProjection: false,
  },
  { label: 'reviewImprovement', text: COACH_COPY.reviewImprovement('May 2026', 1836, 3197), isProjection: false },
  { label: 'reviewImprovementRunway', text: COACH_COPY.reviewImprovementRunway(3.2), isProjection: false },
  { label: 'reviewCreep', text: COACH_COPY.reviewCreep('Netflix', cents(250)), isProjection: false },
  { label: 'reviewCreepSpending', text: COACH_COPY.reviewCreepSpending(creepFlagged), isProjection: false },
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
  // W.8 — each key must appear as the label prefix so the completeness pin can shrink.
  // The composed `nextAction:*` rows above still scan the wrapper+inner pair; these
  // scan the inner strings (and the wrapper) on their own names.
  { label: 'reviewNextAction', text: COACH_COPY.reviewNextAction(COACH_COPY.nextActionAutomate()), isProjection: false },
  { label: 'reviewPersonalizedBadge', text: COACH_COPY.reviewPersonalizedBadge(), isProjection: false },
  { label: 'nextActionCancelSub', text: COACH_COPY.nextActionCancelSub('LA Fitness', cents(3499)), isProjection: false },
  { label: 'nextActionTransfer', text: COACH_COPY.nextActionTransfer(cents(105000), 'Tue, Jun 23', null), isProjection: false },
  {
    label: 'nextActionTransfer:frozen',
    text: COACH_COPY.nextActionTransfer(cents(105000), 'Tue, Jun 23', {
      label: 'Everyday Checking',
      frozenSince: '2026-06-01',
    }),
    isProjection: false,
  },
  { label: 'nextActionAutomate', text: COACH_COPY.nextActionAutomate(), isProjection: false },
  { label: 'disclaimer', text: COACH_COPY.disclaimer(), isProjection: false },
  // Wave 1 principle captions
  { label: 'invisibleWealth', text: COACH_COPY.invisibleWealth(cents(235000), 'May 2026'), isProjection: false },
  { label: 'runwayBanded:below', text: COACH_COPY.runwayBanded(1.8, 'below'), isProjection: false },
  { label: 'runwayBanded:negative', text: COACH_COPY.runwayBanded(-2.3, 'below'), isProjection: false },
  { label: 'runwayBanded:in', text: COACH_COPY.runwayBanded(4.2, 'in'), isProjection: false },
  { label: 'runwayBanded:above', text: COACH_COPY.runwayBanded(9.5, 'above'), isProjection: false },
  // W.12 — payoff reframes the headline years; it is not a second projection with its own rate.
  { label: 'freedomDividend', text: COACH_COPY.freedomDividend(17), isProjection: false },
  { label: 'yourEnough', text: COACH_COPY.yourEnough(), isProjection: false },
  { label: 'biggestLever', text: COACH_COPY.biggestLever(), isProjection: false },
  // P.1 #506 — the FI-movement sentence over the cut list. Every branch except
  // the honest null (locked separately, below the scan).
  ...([
    ['cutCounterfactual', 4, false, { baselineMonths: 400, cutMonths: 367, monthsSooner: 33, newlyReachable: false, baselineFiTargetCents: cents(90_000_000), cutFiTargetCents: cents(87_000_000), targetDropCents: cents(3_000_000) }],
    ['cutCounterfactual:singular', 1, false, { baselineMonths: 400, cutMonths: 399, monthsSooner: 1, newlyReachable: false, baselineFiTargetCents: cents(90_000_000), cutFiTargetCents: cents(89_700_000), targetDropCents: cents(300_000) }],
    ['cutCounterfactual:estimate', 4, true, { baselineMonths: 400, cutMonths: 367, monthsSooner: 33, newlyReachable: false, baselineFiTargetCents: cents(90_000_000), cutFiTargetCents: cents(87_000_000), targetDropCents: cents(3_000_000) }],
    ['cutCounterfactual:newlyReachable', 2, false, { baselineMonths: null, cutMonths: 734, monthsSooner: 0, newlyReachable: true, baselineFiTargetCents: cents(90_000_000), cutFiTargetCents: cents(66_000_000), targetDropCents: cents(24_000_000) }],
  ] as const).map(([label, count, hasEstimate, cf]) => ({
    label: label as string,
    text: COACH_COPY.cutCounterfactual(count, cents(7837), cf, hasEstimate)!,
    isProjection: true,
  })),
  // P.1 radar half — dip/cover movement over the 90-day walk. Honest null is
  // locked separately below the scan (null is not a string to scan).
  ...([
    [
      'cutRadarCounterfactual',
      {
        baselineDipDate: isoDate('2026-06-24'),
        cutDipDate: null,
        dipDisappears: true,
        dipLater: false,
        baselineCoverCents: cents(105000),
        cutCoverCents: null,
        coverDropCents: cents(105000),
        moved: true,
      },
    ],
    [
      'cutRadarCounterfactual:later',
      {
        baselineDipDate: isoDate('2026-06-12'),
        cutDipDate: isoDate('2026-06-25'),
        dipDisappears: false,
        dipLater: true,
        baselineCoverCents: cents(50000),
        cutCoverCents: cents(50000),
        coverDropCents: cents(0),
        moved: true,
      },
    ],
    [
      'cutRadarCounterfactual:cover',
      {
        baselineDipDate: isoDate('2026-06-20'),
        cutDipDate: isoDate('2026-06-20'),
        dipDisappears: false,
        dipLater: false,
        baselineCoverCents: cents(50000),
        cutCoverCents: cents(40000),
        coverDropCents: cents(10000),
        moved: true,
      },
    ],
    [
      'cutRadarCounterfactual:later+cover',
      {
        baselineDipDate: isoDate('2026-06-12'),
        cutDipDate: isoDate('2026-06-25'),
        dipDisappears: false,
        dipLater: true,
        baselineCoverCents: cents(50000),
        cutCoverCents: cents(30000),
        coverDropCents: cents(20000),
        moved: true,
      },
    ],
  ] as const).map(([label, cf]) => ({
    label: label as string,
    text: COACH_COPY.cutRadarCounterfactual(cf)!,
    isProjection: true,
  })),
  { label: 'dialTag', text: COACH_COPY.dialTag('Dining Out'), isProjection: false },
  { label: 'volatilityPrice', text: COACH_COPY.volatilityPrice(700, 450), isProjection: true },
  {
    label: 'drawdownCounterfactual',
    text: COACH_COPY.drawdownCounterfactual({
      shockBps: 3000,
      baselineMonths: 20,
      shockedMonths: 50,
      shockedPortfolioCents: cents(7_000_000),
      monthsLater: 30,
      newlyUnreachable: false,
    })!,
    isProjection: true,
  },
  {
    label: 'drawdownCounterfactual:unreachable',
    text: COACH_COPY.drawdownCounterfactual({
      shockBps: 3000,
      baselineMonths: 0,
      shockedMonths: null,
      shockedPortfolioCents: cents(7_000_000),
      monthsLater: 0,
      newlyUnreachable: true,
    })!,
    isProjection: true,
  },
  {
    label: 'incomeLever',
    text: COACH_COPY.incomeLever({
      raiseAnnualCents: cents(1_200_000),
      monthlyRaiseCents: cents(100_000),
      rateBps: 2000,
      extraMonthlySavingsCents: cents(20_000),
      raisedMonthlySavingsCents: cents(120_000),
      baselineMonths: 120,
      raisedMonths: 100,
      monthsSooner: 20,
      newlyReachable: false,
      noIncome: false,
      rateNonPositive: false,
      alreadyThere: false,
    }, 6)!,
    isProjection: true,
  },
  {
    label: 'incomeLever:reachable',
    text: COACH_COPY.incomeLever({
      raiseAnnualCents: cents(2_400_000),
      monthlyRaiseCents: cents(200_000),
      rateBps: 100,
      extraMonthlySavingsCents: cents(2_000),
      raisedMonthlySavingsCents: cents(11_000),
      baselineMonths: null,
      raisedMonths: 1091,
      monthsSooner: 0,
      newlyReachable: true,
      noIncome: false,
      rateNonPositive: false,
      alreadyThere: false,
    }, 6)!,
    isProjection: true,
  },
  {
    label: 'incomeLever:already',
    text: COACH_COPY.incomeLever({
      raiseAnnualCents: cents(1_200_000),
      monthlyRaiseCents: cents(100_000),
      rateBps: 2000,
      extraMonthlySavingsCents: cents(20_000),
      raisedMonthlySavingsCents: cents(120_000),
      baselineMonths: 0,
      raisedMonths: 0,
      monthsSooner: 0,
      newlyReachable: false,
      noIncome: false,
      rateNonPositive: false,
      alreadyThere: true,
    }, 6)!,
    isProjection: false,
  },
  {
    label: 'incomeLeverContext',
    text: COACH_COPY.incomeLeverContext(2000, 6),
    isProjection: false,
  },
  {
    label: 'incomeLeverContext:zeroRate',
    text: COACH_COPY.incomeLeverContext(0, 6),
    isProjection: false,
  },
  {
    label: 'incomeLeverContext:empty',
    text: COACH_COPY.incomeLeverContext(null, 0),
    isProjection: false,
  },
  { label: 'incomeLeverIdle', text: COACH_COPY.incomeLeverIdle(), isProjection: true },
  { label: 'investingLadderTitle', text: COACH_COPY.investingLadderTitle(), isProjection: false },
  { label: 'investingLadderSubtitle', text: COACH_COPY.investingLadderSubtitle(), isProjection: false },
  { label: 'investingLadderSummary', text: COACH_COPY.investingLadderSummary(), isProjection: false },
  { label: 'investingLadder', text: COACH_COPY.investingLadder(), isProjection: false },
  {
    label: 'feeDrag',
    text: COACH_COPY.feeDrag(
      {
        portfolioCents: cents(10_000_000),
        monthlyLeakCents: cents(8_333),
        feeBps: 100,
        months: 360,
        nominalReturnBps: 700,
        inflationBps: 250,
        costTodayCents: cents(2_000_000),
        costNominalCents: cents(3_000_000),
      },
      DEFAULT_BOTH,
    )!,
    isProjection: true,
  },
  {
    label: 'feeDrag:chosen',
    text: COACH_COPY.feeDrag(
      {
        portfolioCents: cents(10_000_000),
        monthlyLeakCents: cents(8_333),
        feeBps: 100,
        months: 360,
        nominalReturnBps: 700,
        inflationBps: 250,
        costTodayCents: cents(2_000_000),
        costNominalCents: cents(3_000_000),
      },
      OWNS_BOTH,
    )!,
    isProjection: true,
  },
  {
    label: 'feeDrag:zeroInflation',
    text: COACH_COPY.feeDrag(
      {
        portfolioCents: cents(10_000_000),
        monthlyLeakCents: cents(8_333),
        feeBps: 100,
        months: 360,
        nominalReturnBps: 700,
        inflationBps: 0,
        costTodayCents: cents(3_000_000),
        costNominalCents: cents(3_000_000),
      },
      DEFAULT_BOTH,
    )!,
    isProjection: true,
  },
  {
    label: 'feeDrag:trails',
    text: COACH_COPY.feeDrag(
      {
        portfolioCents: cents(14_200_000),
        monthlyLeakCents: cents(11_833),
        feeBps: 100,
        months: 360,
        nominalReturnBps: 250,
        inflationBps: 250,
        costTodayCents: cents(3_020_167),
        costNominalCents: cents(6_000_000),
      },
      DEFAULT_BOTH,
    )!,
    isProjection: true,
  },
  { label: 'feeDragEmpty', text: COACH_COPY.feeDragEmpty(), isProjection: false },
  { label: 'dontTimeIt', text: COACH_COPY.dontTimeIt(), isProjection: true },
  {
    label: 'interestFeesYtdTitle',
    text: COACH_COPY.interestFeesYtdTitle(2026),
    isProjection: false,
  },
  {
    label: 'interestFeesYtdSubtitle',
    text: COACH_COPY.interestFeesYtdSubtitle(),
    isProjection: false,
  },
  {
    label: 'interestFeesYtd',
    text: COACH_COPY.interestFeesYtd(
      {
        paidYtdCents: cents(120_000),
        year: 2026,
        contributingCategoryIds: ['fees-interest'] as const,
        monthlyEquivalentCents: cents(10_000),
        months: 360,
        nominalReturnBps: 700,
        inflationBps: 250,
        valueTodayCents: cents(5_815_000),
        valueNominalCents: cents(12_200_000),
      },
      DEFAULT_BOTH,
    )!,
    isProjection: true,
  },
  {
    label: 'interestFeesYtd:chosen',
    text: COACH_COPY.interestFeesYtd(
      {
        paidYtdCents: cents(120_000),
        year: 2026,
        contributingCategoryIds: ['fees-interest'] as const,
        monthlyEquivalentCents: cents(10_000),
        months: 360,
        nominalReturnBps: 800,
        inflationBps: 200,
        valueTodayCents: cents(6_000_000),
        valueNominalCents: cents(13_000_000),
      },
      OWNS_BOTH,
    )!,
    isProjection: true,
  },
  {
    label: 'interestFeesYtd:zeroInflation',
    text: COACH_COPY.interestFeesYtd(
      {
        paidYtdCents: cents(120_000),
        year: 2026,
        contributingCategoryIds: ['fees-interest'] as const,
        monthlyEquivalentCents: cents(10_000),
        months: 360,
        nominalReturnBps: 700,
        inflationBps: 0,
        valueTodayCents: cents(12_200_000),
        valueNominalCents: cents(12_200_000),
      },
      DEFAULT_BOTH,
    )!,
    isProjection: true,
  },
  {
    label: 'interestFeesYtd:trails',
    text: COACH_COPY.interestFeesYtd(
      {
        paidYtdCents: cents(120_000),
        year: 2026,
        contributingCategoryIds: ['fees-interest'] as const,
        monthlyEquivalentCents: cents(10_000),
        months: 360,
        nominalReturnBps: 250,
        inflationBps: 250,
        valueTodayCents: cents(3_020_167),
        valueNominalCents: cents(6_000_000),
      },
      DEFAULT_BOTH,
    )!,
    isProjection: true,
  },
  {
    label: 'interestFeesYtd:tooSmall',
    text: COACH_COPY.interestFeesYtd(
      {
        paidYtdCents: cents(5),
        year: 2026,
        contributingCategoryIds: ['fees'] as const,
        monthlyEquivalentCents: cents(0),
        months: 360,
        nominalReturnBps: 700,
        inflationBps: 250,
        valueTodayCents: cents(0),
        valueNominalCents: cents(0),
      },
      DEFAULT_BOTH,
    )!,
    isProjection: false,
  },
  {
    label: 'interestFeesYtdEmpty',
    text: COACH_COPY.interestFeesYtdEmpty(2026),
    isProjection: false,
  },
  {
    label: 'givingYtdTitle',
    text: COACH_COPY.givingYtdTitle(2026),
    isProjection: false,
  },
  {
    label: 'givingYtdSubtitle',
    text: COACH_COPY.givingYtdSubtitle(),
    isProjection: false,
  },
  {
    label: 'givingYtd',
    text: COACH_COPY.givingYtd({
      givenYtdCents: cents(100_000),
      year: 2026,
      contributingCategoryIds: ['gifts', 'charity'],
    })!,
    isProjection: false,
  },
  {
    label: 'givingYtd:charityOnly',
    text: COACH_COPY.givingYtd({
      givenYtdCents: cents(25_000),
      year: 2026,
      contributingCategoryIds: ['charity'],
    })!,
    isProjection: false,
  },
  {
    label: 'givingYtdEmpty',
    text: COACH_COPY.givingYtdEmpty(2026),
    isProjection: false,
  },
  {
    // Renamed from `givingGoalPresetIntro` in #522 — it heads every chip.
    label: 'goalPresetIntro',
    text: COACH_COPY.goalPresetIntro(),
    isProjection: false,
  },
  {
    label: 'givingGoalPresetLabel',
    text: COACH_COPY.givingGoalPresetLabel(),
    isProjection: false,
  },
  {
    label: 'givingGoalPresetHint',
    text: COACH_COPY.givingGoalPresetHint(),
    isProjection: false,
  },
  {
    label: 'educationGoalPresetLabel',
    text: COACH_COPY.educationGoalPresetLabel(),
    isProjection: false,
  },
  {
    label: 'educationGoalPresetHint',
    text: COACH_COPY.educationGoalPresetHint(),
    isProjection: false,
  },
  { label: 'mortgageEarlyPayoffTitle', text: COACH_COPY.mortgageEarlyPayoffTitle(), isProjection: false },
  { label: 'mortgageEarlyPayoffSubtitle', text: COACH_COPY.mortgageEarlyPayoffSubtitle(), isProjection: false },
  { label: 'mortgageEarlyPayoffEmpty', text: COACH_COPY.mortgageEarlyPayoffEmpty(), isProjection: false },
  {
    label: 'mortgageEarlyPayoffPaidOff',
    text: COACH_COPY.mortgageEarlyPayoffPaidOff('Home loan'),
    isProjection: false,
  },
  {
    label: 'mortgageEarlyPayoffIncomplete:rate',
    text: COACH_COPY.mortgageEarlyPayoffIncomplete('Home loan', 'rate'),
    isProjection: false,
  },
  {
    label: 'mortgageEarlyPayoffIncomplete:minimum',
    text: COACH_COPY.mortgageEarlyPayoffIncomplete('Home loan', 'minimum'),
    isProjection: false,
  },
  {
    label: 'mortgageEarlyPayoffIncomplete:both',
    text: COACH_COPY.mortgageEarlyPayoffIncomplete('Home loan', 'rate-and-minimum'),
    isProjection: false,
  },
  { label: 'mortgageEarlyPayoffContext', text: COACH_COPY.mortgageEarlyPayoffContext(), isProjection: false },
  {
    label: 'mortgageEarlyPayoffIdle',
    text: COACH_COPY.mortgageEarlyPayoffIdle({
      accountId: 'm1',
      accountName: 'Home loan',
      balanceCents: 30_000,
      aprBps: 1200,
      minimumPaymentCents: 10_000,
      extraMonthlyCents: 0,
      baselineMonths: 4,
      extraMonths: 4,
      monthsSaved: 0,
      baselineInterestCents: 614,
      extraInterestCents: 614,
      interestSavedCents: 0,
    }),
    isProjection: true,
  },
  {
    label: 'mortgageEarlyPayoffIdle:never',
    text: COACH_COPY.mortgageEarlyPayoffIdle({
      accountId: 'm1',
      accountName: 'Home loan',
      balanceCents: 100_000,
      aprBps: 3600,
      minimumPaymentCents: 1_000,
      extraMonthlyCents: 0,
      baselineMonths: null,
      extraMonths: null,
      monthsSaved: null,
      baselineInterestCents: 0,
      extraInterestCents: 0,
      interestSavedCents: null,
    }),
    isProjection: true,
  },
  {
    label: 'mortgageEarlyPayoff',
    text: COACH_COPY.mortgageEarlyPayoff({
      accountId: 'm1',
      accountName: 'Home loan',
      balanceCents: 30_000,
      aprBps: 1200,
      minimumPaymentCents: 10_000,
      extraMonthlyCents: 10_000,
      baselineMonths: 4,
      extraMonths: 2,
      monthsSaved: 2,
      baselineInterestCents: 614,
      extraInterestCents: 403,
      interestSavedCents: 211,
    })!,
    isProjection: true,
  },
  {
    label: 'mortgageEarlyPayoff:neverBoth',
    text: COACH_COPY.mortgageEarlyPayoff({
      accountId: 'm1',
      accountName: 'Home loan',
      balanceCents: 100_000,
      aprBps: 3600,
      minimumPaymentCents: 1_000,
      extraMonthlyCents: 500,
      baselineMonths: null,
      extraMonths: null,
      monthsSaved: null,
      baselineInterestCents: 0,
      extraInterestCents: 0,
      interestSavedCents: null,
    })!,
    isProjection: true,
  },
  {
    label: 'mortgageEarlyPayoff:baselineNever',
    text: COACH_COPY.mortgageEarlyPayoff({
      accountId: 'm1',
      accountName: 'Home loan',
      balanceCents: 100_000,
      aprBps: 3600,
      minimumPaymentCents: 1_000,
      extraMonthlyCents: 4_000,
      baselineMonths: null,
      extraMonths: 31,
      monthsSaved: null,
      baselineInterestCents: 0,
      extraInterestCents: 12_000,
      interestSavedCents: null,
    })!,
    isProjection: true,
  },
  { label: 'pawLensTitle', text: COACH_COPY.pawLensTitle(), isProjection: false },
  { label: 'pawLensSubtitle', text: COACH_COPY.pawLensSubtitle(), isProjection: false },
  { label: 'pawLensEmpty', text: COACH_COPY.pawLensEmpty(6), isProjection: false },
  { label: 'pawLensEmpty:one', text: COACH_COPY.pawLensEmpty(1), isProjection: false },
  {
    label: 'pawLensIdle',
    text: COACH_COPY.pawLensIdle({
      ageYears: 0,
      annualIncomeCents: cents(6_000_000),
      incomeWindowMonths: 6,
      netWorthCents: cents(14_480_474),
      expectedNetWorthCents: null,
      band: null,
      idle: true,
      noIncome: false,
    }),
    isProjection: false,
  },
  {
    label: 'pawLens:near',
    text: COACH_COPY.pawLens({
      ageYears: 40,
      annualIncomeCents: cents(10_000_000),
      incomeWindowMonths: 6,
      netWorthCents: cents(40_000_000),
      expectedNetWorthCents: cents(40_000_000),
      band: 'near',
      idle: false,
      noIncome: false,
    })!,
    isProjection: false,
  },
  {
    label: 'pawLens:above',
    text: COACH_COPY.pawLens({
      ageYears: 40,
      annualIncomeCents: cents(10_000_000),
      incomeWindowMonths: 6,
      netWorthCents: cents(80_000_000),
      expectedNetWorthCents: cents(40_000_000),
      band: 'above',
      idle: false,
      noIncome: false,
    })!,
    isProjection: false,
  },
  {
    label: 'pawLens:under',
    text: COACH_COPY.pawLens({
      ageYears: 40,
      annualIncomeCents: cents(10_000_000),
      incomeWindowMonths: 6,
      netWorthCents: cents(10_000_000),
      expectedNetWorthCents: cents(40_000_000),
      band: 'under',
      idle: false,
      noIncome: false,
    })!,
    isProjection: false,
  },
  {
    label: 'pawLens:tooSmall',
    text: COACH_COPY.pawLens({
      ageYears: 1,
      annualIncomeCents: cents(4),
      incomeWindowMonths: 1,
      netWorthCents: cents(100_000),
      expectedNetWorthCents: cents(0),
      band: null,
      idle: false,
      noIncome: false,
    })!,
    isProjection: false,
  },
  { label: 'idleCashTitle', text: COACH_COPY.idleCashTitle(), isProjection: false },
  { label: 'idleCashSubtitle', text: COACH_COPY.idleCashSubtitle(), isProjection: false },
  {
    label: 'idleCashEmpty',
    text: COACH_COPY.idleCashEmpty({
      liquidCents: cents(2_310_000),
      monthlyExpenseCents: cents(0),
      expenseWindowMonths: 6,
      cushionCents: null,
      excessCents: null,
      runwayMonths: Number.POSITIVE_INFINITY,
      idle: true,
      noExpenses: true,
    }),
    isProjection: false,
  },
  {
    label: 'idleCashEmpty:zero',
    text: COACH_COPY.idleCashEmpty({
      liquidCents: cents(100_000),
      monthlyExpenseCents: cents(0),
      expenseWindowMonths: 0,
      cushionCents: null,
      excessCents: null,
      runwayMonths: Number.POSITIVE_INFINITY,
      idle: true,
      noExpenses: true,
    }),
    isProjection: false,
  },
  {
    label: 'idleCashIdle',
    text: COACH_COPY.idleCashIdle({
      liquidCents: cents(1_800_000),
      monthlyExpenseCents: cents(300_000),
      expenseWindowMonths: 6,
      cushionCents: cents(1_800_000),
      excessCents: null,
      runwayMonths: 6,
      idle: true,
      noExpenses: false,
    }),
    isProjection: false,
  },
  {
    label: 'idleCashIdle:pastNotFar',
    text: COACH_COPY.idleCashIdle({
      liquidCents: cents(1_800_001),
      monthlyExpenseCents: cents(300_000),
      expenseWindowMonths: 6,
      cushionCents: cents(1_800_000),
      excessCents: null,
      runwayMonths: 6,
      idle: true,
      noExpenses: false,
    }),
    isProjection: false,
  },
  {
    label: 'idleCashIdle:negative',
    text: COACH_COPY.idleCashIdle({
      liquidCents: cents(-50_000),
      monthlyExpenseCents: cents(300_000),
      expenseWindowMonths: 6,
      cushionCents: cents(1_800_000),
      excessCents: null,
      runwayMonths: -0.2,
      idle: true,
      noExpenses: false,
    }),
    isProjection: false,
  },
  {
    label: 'idleCash',
    text: COACH_COPY.idleCash({
      liquidCents: cents(2_400_000),
      monthlyExpenseCents: cents(300_000),
      expenseWindowMonths: 6,
      cushionCents: cents(1_800_000),
      excessCents: cents(600_000),
      runwayMonths: 8,
      idle: false,
      noExpenses: false,
    })!,
    isProjection: false,
  },
  { label: 'fifteenPercentReference', text: COACH_COPY.fifteenPercentReference(), isProjection: false },
  { label: 'savingsGoalReference', text: COACH_COPY.savingsGoalReference(4000), isProjection: false },
  { label: 'savingsStreak:3', text: COACH_COPY.savingsStreak(3, 2653), isProjection: false },
  // Audit P2: 1–4 bps renders "0.0%" via pct1 — a positive streak must name the
  // magnitude instead of printing a zero that isn't one. An exact zero stays "0.0%".
  { label: 'savingsStreak:tiny', text: COACH_COPY.savingsStreak(3, 4), isProjection: false },
  { label: 'savingsPersonalBest:tiny', text: COACH_COPY.savingsPersonalBest(4, 'May 2026'), isProjection: false },
  { label: 'savingsPersonalBest:zero', text: COACH_COPY.savingsPersonalBest(0, 'May 2026'), isProjection: false },
  { label: 'savingsPersonalBest', text: COACH_COPY.savingsPersonalBest(3197, 'May 2026'), isProjection: false },
  { label: 'cushionIsAGoal', text: COACH_COPY.cushionIsAGoal(), isProjection: false },
  { label: 'assumptionsChange', text: COACH_COPY.assumptionsChange(), isProjection: false },
  { label: 'consciousSpending', text: COACH_COPY.consciousSpending(58, 14, 28, CONSCIOUS_BUCKET_COUNTS.fixed, null), isProjection: false },
  { label: 'consciousSpending:settings', text: COACH_COPY.consciousSpending(58, 14, 28, CONSCIOUS_BUCKET_COUNTS.fixed, 4000), isProjection: false },
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
  // W.8 — both count branches: a second string these functions produce.
  { label: 'digestNothingDueWithUndated', text: COACH_COPY.digestNothingDueWithUndated(1), isProjection: false },
  { label: 'digestNothingDueWithUndated:many', text: COACH_COPY.digestNothingDueWithUndated(3), isProjection: false },
  { label: 'digestUndatedAlongsideDues', text: COACH_COPY.digestUndatedAlongsideDues(1), isProjection: false },
  { label: 'digestUndatedAlongsideDues:many', text: COACH_COPY.digestUndatedAlongsideDues(3), isProjection: false },
  { label: 'digestOutro', text: COACH_COPY.digestOutro(), isProjection: false },
  { label: 'runway:noExpenses', text: COACH_COPY.runway(Infinity), isProjection: false },
  { label: 'reviewImprovementRunway:negative', text: COACH_COPY.reviewImprovementRunway(-2.3), isProjection: false },
  // #252 Money Signature — every state variant scans through the guardrails.
  { label: 'signatureTitle', text: COACH_COPY.signatureTitle(), isProjection: false },
  { label: 'signatureBasis', text: COACH_COPY.signatureBasis(), isProjection: false },
  { label: 'signatureWeather:strained', text: COACH_COPY.signatureWeather('strained', 0.8, 1200, 'May 2026', 6), isProjection: false },
  { label: 'signatureWeather:strainedNegative', text: COACH_COPY.signatureWeather('strained', -2.3, 1200, 'May 2026', 6), isProjection: false },
  { label: 'signatureWeather:tight', text: COACH_COPY.signatureWeather('tight', 2.4, 300, 'May 2026', 6), isProjection: false },
  { label: 'signatureWeather:tightNegative', text: COACH_COPY.signatureWeather('tight', 5.1, -800, 'May 2026', 6), isProjection: false },
  { label: 'signatureWeather:calm', text: COACH_COPY.signatureWeather('calm', 4.2, 900, 'May 2026', 6), isProjection: false },
  { label: 'signatureWeather:bright', text: COACH_COPY.signatureWeather('bright', 6.5, 3197, 'May 2026', 6), isProjection: false },
  { label: 'signatureWeather:infiniteRunway', text: COACH_COPY.signatureWeather('calm', Infinity, null, null, 0), isProjection: false },
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
  // P1.3 — the reader's own Rich Life one-liner (one state: their words inside
  // the fixed sentence; the label stays bare so the completeness lock covers it).
  { label: 'richLifeHeader', text: COACH_COPY.richLifeHeader('three months of travel every year'), isProjection: false },
  // P1.2 — staying-wealthy row: every branch these functions produce.
  { label: 'stayingWealthyTitle', text: COACH_COPY.stayingWealthyTitle(), isProjection: false },
  { label: 'stayingWealthyFraming', text: COACH_COPY.stayingWealthyFraming(), isProjection: false },
  { label: 'stayingWealthyFooter', text: COACH_COPY.stayingWealthyFooter(), isProjection: false },
  { label: 'stayingWealthyCards:present', text: COACH_COPY.stayingWealthyCards('present'), isProjection: false },
  { label: 'stayingWealthyCards:forming', text: COACH_COPY.stayingWealthyCards('forming'), isProjection: false },
  { label: 'stayingWealthyCards:no_history', text: COACH_COPY.stayingWealthyCards('no_history'), isProjection: false },
  { label: 'stayingWealthyCards:broken', text: COACH_COPY.stayingWealthyCards('broken'), isProjection: false },
  { label: 'stayingWealthyRunway:present', text: COACH_COPY.stayingWealthyRunway('present', 4.2), isProjection: false },
  { label: 'stayingWealthyRunway:building', text: COACH_COPY.stayingWealthyRunway('building', -2.3), isProjection: false },
  { label: 'stayingWealthyRunway:unknown', text: COACH_COPY.stayingWealthyRunway('unknown', Infinity), isProjection: false },
  { label: 'stayingWealthyIncome:present', text: COACH_COPY.stayingWealthyIncome('present'), isProjection: false },
  { label: 'stayingWealthyIncome:outpaced', text: COACH_COPY.stayingWealthyIncome('outpaced'), isProjection: false },
  { label: 'stayingWealthyIncome:unknown', text: COACH_COPY.stayingWealthyIncome('unknown'), isProjection: false },
  // W.6(b) — every destination + skipped + assumptions (the assumption sweep
  // is why `nextDollarAssumptions` is marked a projection).
  ...(() => {
    const auto = {
      id: 'acct-autoloan',
      name: 'Auto Loan',
      kind: 'installment' as const,
      balanceCents: 1_430_000,
      aprBps: 649,
    };
    const store = {
      id: 'acct-store',
      name: 'Store Card',
      kind: 'revolving' as const,
      balanceCents: 4350,
      aprBps: 3199,
    };
    const base = {
      expectedReturnBps: 700,
      returnIsDefault: true,
      runwayMonths: 4.2,
      runwayFloorMonths: 3 as const,
      employerMatch: 'unknown' as const,
      skipped: ['employer_match', 'tax_advantaged'] as const,
      highestInstallment: auto,
    };
    const invest = { ...base, destination: 'invest' as const, debt: null };
    const revolving = {
      ...base,
      destination: 'revolving_debt' as const,
      debt: store,
      runwayMonths: 1.5,
    };
    const match = {
      ...base,
      destination: 'employer_match' as const,
      debt: null,
      employerMatch: 'uncaptured' as const,
      skipped: ['tax_advantaged'] as const,
    };
    const emergency = {
      ...base,
      destination: 'emergency_fund' as const,
      debt: null,
      runwayMonths: 1.5,
    };
    const installment = {
      ...base,
      destination: 'installment_debt' as const,
      debt: { ...auto, aprBps: 1200, name: 'Personal Loan' },
      highestInstallment: { ...auto, aprBps: 1200, name: 'Personal Loan' },
    };
    const noDebt = {
      ...base,
      destination: 'invest' as const,
      debt: null,
      highestInstallment: null,
      runwayMonths: Number.POSITIVE_INFINITY,
    };
    return [
      { label: 'nextDollarTitle', text: COACH_COPY.nextDollarTitle(), isProjection: false },
      { label: 'nextDollarHeadline:invest', text: COACH_COPY.nextDollarHeadline(invest), isProjection: false },
      { label: 'nextDollarHeadline:revolving', text: COACH_COPY.nextDollarHeadline(revolving), isProjection: false },
      { label: 'nextDollarHeadline:match', text: COACH_COPY.nextDollarHeadline(match), isProjection: false },
      { label: 'nextDollarHeadline:emergency', text: COACH_COPY.nextDollarHeadline(emergency), isProjection: false },
      { label: 'nextDollarHeadline:installment', text: COACH_COPY.nextDollarHeadline(installment), isProjection: false },
      { label: 'nextDollarWhy:invest', text: COACH_COPY.nextDollarWhy(invest), isProjection: false },
      { label: 'nextDollarWhy:revolving', text: COACH_COPY.nextDollarWhy(revolving), isProjection: false },
      { label: 'nextDollarWhy:match', text: COACH_COPY.nextDollarWhy(match), isProjection: false },
      { label: 'nextDollarWhy:emergency', text: COACH_COPY.nextDollarWhy(emergency), isProjection: false },
      { label: 'nextDollarWhy:installment', text: COACH_COPY.nextDollarWhy(installment), isProjection: false },
      { label: 'nextDollarWhy:investNoDebt', text: COACH_COPY.nextDollarWhy(noDebt), isProjection: false },
      { label: 'nextDollarSkipped:unknown', text: COACH_COPY.nextDollarSkipped(invest), isProjection: false },
      { label: 'nextDollarSkipped:taxOnly', text: COACH_COPY.nextDollarSkipped(match), isProjection: false },
      {
        label: 'nextDollarSkipped:loanApr',
        text: COACH_COPY.nextDollarSkipped({
          ...invest,
          skipped: ['employer_match', 'tax_advantaged', 'loan_apr'],
        }),
        isProjection: false,
      },
      {
        label: 'nextDollarWhy:zeroAprLoan',
        text: COACH_COPY.nextDollarWhy({
          ...invest,
          highestInstallment: { ...auto, aprBps: 0, name: 'Promo Loan' },
        }),
        isProjection: false,
      },
      {
        label: 'nextDollarWhy:noKnownLoan',
        text: COACH_COPY.nextDollarWhy(noDebt),
        isProjection: false,
      },
      { label: 'nextDollarCardsNote', text: COACH_COPY.nextDollarCardsNote(), isProjection: false },
      { label: 'nextDollarAssumptions:default', text: COACH_COPY.nextDollarAssumptions(invest), isProjection: true },
      {
        label: 'nextDollarAssumptions:chosen',
        text: COACH_COPY.nextDollarAssumptions({ ...invest, returnIsDefault: false }),
        isProjection: true,
      },
    ];
  })(),
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

  // P.1 #506 — when the re-projection moves nothing, there is no sentence:
  // "about 0 months sooner" would fabricate an effect. The null is decided by
  // the copy's one author, so no caller can print a zero-delta claim.
  it('cutCounterfactual: nothing moves ⇒ null, never a zero-delta sentence', () => {
    const still = {
      baselineMonths: 400,
      cutMonths: 400,
      monthsSooner: 0,
      newlyReachable: false,
      baselineFiTargetCents: cents(90_000_000),
      cutFiTargetCents: cents(89_700_000),
      targetDropCents: cents(300_000),
    };
    expect(COACH_COPY.cutCounterfactual(3, cents(5000), still, false)).toBeNull();
    const alreadyThere = { ...still, baselineMonths: 0, cutMonths: 0, targetDropCents: cents(0) };
    expect(COACH_COPY.cutCounterfactual(3, cents(5000), alreadyThere, false)).toBeNull();
  });

  it('cutRadarCounterfactual: nothing improved ⇒ null, never a zero-delta dip sentence', () => {
    const still = {
      baselineDipDate: isoDate('2026-06-24'),
      cutDipDate: isoDate('2026-06-24'),
      dipDisappears: false,
      dipLater: false,
      baselineCoverCents: cents(105000),
      cutCoverCents: cents(105000),
      coverDropCents: cents(0),
      moved: false,
    };
    expect(COACH_COPY.cutRadarCounterfactual(still)).toBeNull();
    const alreadyClear = {
      ...still,
      baselineDipDate: null,
      cutDipDate: null,
      baselineCoverCents: null,
      cutCoverCents: null,
    };
    expect(COACH_COPY.cutRadarCounterfactual(alreadyClear)).toBeNull();
  });

  it('incomeLever: nothing moves ⇒ null, never a zero-delta sooner sentence', () => {
    const still = {
      raiseAnnualCents: cents(1_200_000),
      monthlyRaiseCents: cents(100_000),
      rateBps: 2000,
      extraMonthlySavingsCents: cents(20_000),
      raisedMonthlySavingsCents: cents(120_000),
      baselineMonths: 120,
      raisedMonths: 120,
      monthsSooner: 0,
      newlyReachable: false,
      noIncome: false,
      rateNonPositive: false,
      alreadyThere: false,
    };
    expect(COACH_COPY.incomeLever(still, 6)).toBeNull();
    expect(COACH_COPY.incomeLever({ ...still, noIncome: true, rateBps: null }, 6)).toBeNull();
    expect(COACH_COPY.incomeLever({ ...still, rateNonPositive: true, rateBps: 0 }, 6)).toBeNull();
    expect(COACH_COPY.incomeLever({ ...still, raiseAnnualCents: cents(0) }, 6)).toBeNull();
  });

  it('test_regression__p15_fee_drag_names_monthly_leak_and_grow_then_deflate', () => {
    const text = COACH_COPY.feeDrag(
      {
        portfolioCents: cents(14_200_000),
        monthlyLeakCents: cents(11_833),
        feeBps: 100,
        months: 360,
        nominalReturnBps: 700,
        inflationBps: 250,
        costTodayCents: cents(6_882_218),
        costNominalCents: cents(14_435_917),
      },
      DEFAULT_BOTH,
    );
    expect(text).toContain('$118.33 a month');
    expect(text).toContain('grown at our default 7.00% return assumption');
    expect(text).toContain('our default 2.50% inflation assumption taken off');
    expect(text).toContain("what the leak would buy today");
    expect(text).not.toContain('assumptions working');
  });

  it('test_regression__p15_fee_drag_trails_contributions_names_the_assumptions', () => {
    const text = COACH_COPY.feeDrag(
      {
        portfolioCents: cents(14_200_000),
        monthlyLeakCents: cents(11_833),
        feeBps: 100,
        months: 360,
        nominalReturnBps: 250,
        inflationBps: 250,
        costTodayCents: cents(3_020_167),
        costNominalCents: cents(6_000_000),
      },
      DEFAULT_BOTH,
    );
    expect(text).toContain('assumptions working, not an error');
    expect(text).toContain('at or below the dollars that would leak');
  });

  it('feeDrag: zero today-money cost ⇒ null, never a $0.00 leak sentence', () => {
    expect(
      COACH_COPY.feeDrag(
        {
          portfolioCents: cents(10_000_000),
          monthlyLeakCents: cents(8_333),
          feeBps: 100,
          months: 360,
          nominalReturnBps: 700,
          inflationBps: 250,
          costTodayCents: cents(0),
          costNominalCents: cents(0),
        },
        DEFAULT_BOTH,
      ),
    ).toBeNull();
  });

  it('interestFeesYtd: zero paid ⇒ null, never a $0.00 invested sentence', () => {
    expect(
      COACH_COPY.interestFeesYtd(
        {
          paidYtdCents: cents(0),
          year: 2026,
          contributingCategoryIds: [],
          monthlyEquivalentCents: cents(0),
          months: 360,
          nominalReturnBps: 700,
          inflationBps: 250,
          valueTodayCents: cents(0),
          valueNominalCents: cents(0),
        },
        DEFAULT_BOTH,
      ),
    ).toBeNull();
  });

  it('test_regression__p14_income_lever_does_not_claim_lifestyle_frozen', () => {
    const text = COACH_COPY.incomeLever({
      raiseAnnualCents: cents(1_200_000),
      monthlyRaiseCents: cents(100_000),
      rateBps: 2000,
      extraMonthlySavingsCents: cents(20_000),
      raisedMonthlySavingsCents: cents(120_000),
      baselineMonths: 120,
      raisedMonths: 100,
      monthsSooner: 20,
      newlyReachable: false,
      noIncome: false,
      rateNonPositive: false,
      alreadyThere: false,
    }, 6)!;
    expect(text).toContain('Only that share of the raise is treated as extra savings');
    expect(text).not.toMatch(/lifestyle grows|lifestyle frozen|does not assume lifestyle/i);
  });

  it('test_regression__p14_income_lever_names_window_average_not_current', () => {
    const text = COACH_COPY.incomeLever({
      raiseAnnualCents: cents(1_200_000),
      monthlyRaiseCents: cents(100_000),
      rateBps: 2000,
      extraMonthlySavingsCents: cents(20_000),
      raisedMonthlySavingsCents: cents(120_000),
      baselineMonths: 120,
      raisedMonths: 100,
      monthsSooner: 20,
      newlyReachable: false,
      noIncome: false,
      rateNonPositive: false,
      alreadyThere: false,
    }, 6)!;
    expect(text).toContain('6-month average 20.0%');
    expect(text).not.toMatch(/your current /i);
  });

  it('cutRadarCounterfactual assumption does not claim every cut cancels the series (critic P1-2)', () => {
    const text = COACH_COPY.cutRadarCounterfactual({
      baselineDipDate: isoDate('2026-06-20'),
      cutDipDate: isoDate('2026-06-20'),
      dipDisappears: false,
      dipLater: false,
      baselineCoverCents: cents(50000),
      cutCoverCents: cents(40000),
      coverDropCents: cents(10000),
      moved: true,
    })!;
    expect(text).toContain('an estimated saving only shrinks it');
    expect(text).not.toMatch(/stop hitting/);
  });

  // Critic F3 — a month span reads the way the FI card phrases spans
  // ("about X years Y months"), never "about 734 months" at a reader.
  it('cutCounterfactual: month spans phrase as months under two years, years+months above', () => {
    const at = (monthsSooner: number) =>
      COACH_COPY.cutCounterfactual(2, cents(5000), {
        baselineMonths: 400,
        cutMonths: 400 - monthsSooner,
        monthsSooner,
        newlyReachable: false,
        baselineFiTargetCents: cents(90_000_000),
        cutFiTargetCents: cents(88_000_000),
        targetDropCents: cents(2_000_000),
      }, false)!;
    expect(at(1)).toContain('about 1 month sooner');
    expect(at(11)).toContain('about 11 months sooner');
    expect(at(23)).toContain('about 23 months sooner');
    expect(at(24)).toContain('about 2 years sooner');
    expect(at(26)).toContain('about 2 years 2 months sooner');
    expect(at(300)).toContain('about 25 years sooner');
    expect(at(300)).not.toContain('300 months');
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

/**
 * O.20g — the lifestyle-creep card has THREE verdicts, and the third one used to
 * render as the second. `creepCard` selects title, body and link together so
 * they cannot disagree about which state the reader is in; these are the locks
 * on that selection and on the sentences it picks.
 */
describe('lifestyle-creep card — three verdicts, and the refusal is not an all-clear (O.20g)', () => {
  it('an unmeasured income window is neither "outpacing" nor "tracking"', () => {
    const card = COACH_COPY.creepCard(creepNotComparable);
    expect(card.title).toBe(`Can't compare yet`);
    // The two claims this state may NOT make — the exact strings the other two
    // verdicts render. Fail-old: before this slice, `!flagged` produced them.
    expect(card.title).not.toBe('Tracking income');
    expect(card.body).not.toContain('no lifestyle drift detected');
    expect(card.body).not.toContain('tracking income growth');
    // It states the side it CAN measure …
    expect(card.body).toContain('Typical discretionary spending grew ~12.4%');
    // … prints the two figures the refusal actually rests on, rather than a
    // conclusion the reader cannot check …
    expect(card.body).toContain('$0.08 a month of income against $1,200.00 a month of discretionary spending');
    // … and names the likely cause without asserting it.
    expect(card.body).toContain("not that you earned nothing");
    // The unmeasured side's growth figure is NEVER printed: a card headed
    // "Can't compare yet" that opens with "income grew ~6,249,900.0%" refutes
    // itself. `creepNotComparable` embeds only measured figures.
    expect(card.body).not.toContain('Typical income');
    // And the control points at the side that is missing.
    expect(card.linkHref).toBe('/transactions?type=income');
  });

  it('the link label does not assert a definition the register does not implement', () => {
    // `type=income` is a SIGN filter (`matchesType`: !isTransfer && amountCents > 0),
    // not `isIncomeFlowRow` — so a credit this engine refuses still shows there.
    // A label promising "what the app counts as income" would land the reader on
    // the very row the sentence above calls "no income".
    const card = COACH_COPY.creepCard(creepNotComparable);
    expect(card.linkLabel).toBe('See the money coming in on your activity');
    expect(card.linkLabel).not.toContain('counts as income');
  });

  it('the measured verdicts are unchanged, and each keeps its own link', () => {
    const flaggedCard = COACH_COPY.creepCard(creepFlagged);
    expect(flaggedCard.title).toBe('Spending is outpacing income');
    expect(flaggedCard.body).toContain('not a verdict');
    expect(flaggedCard.linkHref).toBe('/transactions?type=expense');
    const clearCard = COACH_COPY.creepCard(creepClear);
    expect(clearCard.title).toBe('Tracking income');
    expect(clearCard.body).toContain('no lifestyle drift detected');
    expect(clearCard.linkHref).toBe('/transactions?type=income');
  });

  it('the refusal outranks the flag INDEPENDENTLY, not via `flagged` being false', () => {
    // The engine gates `flagged` on both sides being measured, but the card must
    // not rely on that: this asserts the ordering the docblock claims, with a
    // (currently unreachable) result where both are set.
    const contradictory: CreepResult = { ...creepNotComparable, flagged: true };
    expect(COACH_COPY.creepCard(contradictory).title).toBe(`Can't compare yet`);
  });

  it('a missing SPEND baseline says what `spendMeasured` actually tests — a MEDIAN, not a total', () => {
    const card = COACH_COPY.creepCard(creepNoSpendBaseline);
    expect(card.title).toBe(`Can't compare yet`);
    // `spendMeasured` is `median(firstHalf) > 0`, false when HALF the months are
    // empty — so a claim that the half "recorded no discretionary purchases" is
    // contradicted on screen by the card's own bar strip, which can show a
    // month with named purchases in it.
    expect(card.body).toContain('most months in the first half');
    // The negative has to be anchored: the honest sentence CONTAINS the false
    // one as a substring, so a bare `not.toContain` of the old wording would
    // fail against the correct copy.
    expect(card.body).not.toContain('measure: the first half of');
    // It must not also claim an income gap it does not have.
    expect(card.body).not.toContain('no income growth to measure');
    expect(card.linkHref).toBe('/transactions?type=expense');
  });

  it('with NO income at all the refusal says so, instead of comparing two figures', () => {
    const none: CreepResult = { ...creepNotComparable, incomeBaselineCents: cents(0) };
    const body = COACH_COPY.creepNotComparable(none);
    expect(body).toContain('the app counted no income at all across the first half');
    expect(body).not.toContain('$0.00 a month of income');
  });

  it('the both-unmeasured body — every brand-new account — reads on its own', () => {
    const body = COACH_COPY.creepNotComparable(creepNeitherMeasured);
    // No dangling pronoun: the earlier draft opened "There's no income growth to
    // compare THAT with" when no clause preceded it.
    expect(body).not.toContain('compare that with');
    expect(body.startsWith("There's no income growth to measure")).toBe(true);
    expect(body).toContain('most months in the first half');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('NaN');
    // Neither growth figure is printed, because neither is a measurement.
    expect(body).not.toContain('Typical discretionary spending');
    expect(body).not.toContain('Typical income');
  });

  it('the degenerate one-month window reads correctly', () => {
    const degenerate: CreepResult = { ...creepNeitherMeasured, windowMonths: 1 };
    const body = COACH_COPY.creepNotComparable(degenerate);
    expect(body).toContain('the last month');
    expect(body).not.toContain('the last 1 months');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('NaN');
  });

  it('a growth figure is described with the verb that matches its sign', () => {
    // Fail-old: both creep sentences hard-coded "grew ~", so a figure that FELL
    // printed "grew ~-12.4%". Reachable while flagged — the flag is a
    // difference, so income falling faster flags a spend figure that shrank.
    const fell: CreepResult = { ...creepFlagged, spendGrowthBps: -1240, incomeGrowthBps: -3000 };
    const body = COACH_COPY.creepFlagged(fell);
    expect(body).toContain('spending fell ~12.4%');
    expect(body).toContain('income fell ~30.0%');
    expect(body).not.toContain('grew ~-');
    // An EXACT zero reads as flat; a ROUNDED zero must not (pct1 rounds 1–4 bps
    // to "0.0%", and calling that flat asserts more than the number does).
    expect(COACH_COPY.creepFlagged({ ...creepFlagged, incomeGrowthBps: 0 })).toContain('income was flat');
    // A ROUNDED zero gets neither "flat" nor a direction: "fell ~0.0%" states a
    // fall with a magnitude of nothing, which is self-refuting to a reader.
    expect(COACH_COPY.creepFlagged({ ...creepFlagged, incomeGrowthBps: 3 })).toContain('income barely moved');
    expect(COACH_COPY.creepFlagged({ ...creepFlagged, incomeGrowthBps: 3 })).not.toContain('was flat');
    expect(COACH_COPY.creepFlagged({ ...creepFlagged, incomeGrowthBps: -3 })).toContain('income barely moved');
    expect(COACH_COPY.creepFlagged({ ...creepFlagged, incomeGrowthBps: -3 })).not.toContain('fell ~0.0%');
  });

  it('the recap line about the SAME two figures cannot contradict the card', () => {
    // Found by mutation: reverting this sentence left the whole suite green.
    // It hard-coded "while income is flat" — a clause with no input behind it —
    // and printed "is up ~-10.0%" whenever the figure fell, which is reachable
    // exactly when it renders, because `flagged` is a DIFFERENCE (income falling
    // faster than spending flags a spend figure that itself shrank).
    const fell: CreepResult = { ...creepFlagged, spendGrowthBps: -1000, incomeGrowthBps: -5000 };
    const line = COACH_COPY.reviewCreepSpending(fell);
    expect(line).toContain('spending fell ~10.0%');
    expect(line).toContain('income fell ~50.0%');
    expect(line).not.toContain('is up ~-');
    expect(line).not.toContain('income is flat');
    // And it agrees with the card, verb for verb, on the same result.
    const card = COACH_COPY.creepFlagged(fell);
    expect(card).toContain('spending fell ~10.0%');
    expect(card).toContain('income fell ~50.0%');
    // A genuinely flat income still reads as flat in both.
    const flatIncome: CreepResult = { ...creepFlagged, incomeGrowthBps: 0 };
    expect(COACH_COPY.reviewCreepSpending(flatIncome)).toContain('income was flat');
  });

  it('the Money Review line refuses too, instead of taking the all-clear slot', () => {
    const line = COACH_COPY.reviewCreepNotComparable(creepNotComparable);
    expect(line).toContain("What we can't tell yet");
    expect(line).not.toContain('no lifestyle drift detected');
    const review = generateMoneyReview({
      flows: [],
      creep: creepNotComparable,
      opportunities: [],
      runwayMonths: 4,
    });
    expect(review.creep).toBe(line);
    expect(review.creep).not.toContain('tracking income growth');
  });
});

// Audit P2 — exact rendered locks for the negative-runway branches. The old
// strings printed "-2.3 months of expenses in cash" as a flat fact and kept
// an aphorism that only makes sense with a positive buffer; each negative
// branch must render the honest statement verbatim.
describe('runway copy — negative-runway branches (audit P2)', () => {
  it('runway states cash below zero instead of a negative month count as fact', () => {
    expect(COACH_COPY.runway(-2.3)).toBe(
      'Room for error: none right now — your cash balance is negative, about 2.3 months of expenses short of zero.',
    );
  });

  it('runwayBanded drops the 3–6 month band clause when there is no buffer', () => {
    expect(COACH_COPY.runwayBanded(-2.3, 'below')).toBe(
      'Room for error: none right now — your cash balance is negative, about 2.3 months of expenses short of zero.',
    );
  });

  it('reviewImprovementRunway names the negative and what to expect next', () => {
    expect(COACH_COPY.reviewImprovementRunway(-2.3)).toBe(
      'What held steady: your cash runway is negative right now — about 2.3 months short of zero. It shows as a cover again once the balance turns positive.',
    );
  });

  it('signatureWeather says cash is below zero, never "on hand"', () => {
    const text = COACH_COPY.signatureWeather('strained', -2.3, 1200, 'May 2026', 6);
    expect(text).toContain(
      'your cash is below zero, about 2.3 months of expenses short (cash ÷ your 6-month average expenses)',
    );
    expect(text).not.toContain('on hand');
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
    const floored = COACH_COPY.wealthTargetBasis(
      cents(1_000_000_000),
      0,
      700,
      1000,
      true,
      OWNS_BOTH,
    );
    expect(floored).not.toMatch(/7\.00% return assumption less 10\.00% inflation/);
    expect(floored).toContain('at or below your 10.00% inflation assumption');
    // And it must state the direction of the error the floor introduces.
    expect(floored).toContain('arrive later than it says, not sooner');
    // The unfloored branch still shows its working.
    expect(
      COACH_COPY.wealthTargetBasis(cents(1_000_000_000), 450, 700, 250, false, OWNS_BOTH),
    ).toContain('your 7.00% return assumption less 2.50% inflation');
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
    expect(COACH_COPY.wealthTargetSensitivityIntro(true, OWNS_BOTH)).toContain(
      'the spread between them',
    );
    const degenerate = COACH_COPY.wealthTargetSensitivityIntro(false, OWNS_BOTH);
    expect(degenerate).not.toMatch(/the spread between them is usually wider/);
    expect(degenerate).toContain('all three floor to no real growth');
  });

  it('the required contribution says a flat standing order will not keep pace', () => {
    const line = COACH_COPY.wealthTargetRequired(cents(183_243), 25, 450, 250, OWNS_BOTH);
    expect(line).toContain("in today's money");
    expect(line).toContain('would need to rise with inflation');
    expect(line).toContain('2.50% a year on your own assumption');
  });

  /**
   * A W.2 critic found this card calling the SAME 2.50% "Aimplifi's default, which you haven't
   * changed" and "your own assumption" 633px apart, live on the demo. One dial, one card, two
   * claims about who owns it.
   */
  it('the required contribution will not call an unset inflation dial "your own"', () => {
    const defaulted = COACH_COPY.wealthTargetRequired(
      cents(183_243),
      25,
      450,
      250,
      DEFAULT_INFLATION,
    );
    expect(defaulted).toContain('2.50% a year on our default assumption');
    expect(defaulted).not.toContain('your own assumption');
  });

  /**
   * W.2 REPLACED this lock. It used to assert the sentence said the FI card ran on a nominal
   * basis and therefore printed an EARLIER date — true when the FI card compounded at the
   * nominal dial, and false the moment it stopped. A copy lock that survives the change it
   * should have caught is worse than no lock, so the assertions now pin the new claim: one
   * shared basis, and the destination as the thing that differs.
   */
  it('the FI-card reconciliation claims a SHARED basis and names the real difference', () => {
    const line = COACH_COPY.wealthTargetVsFiCard(450);
    expect(line).toContain('same footing');
    expect(line).toContain("today's dollars");
    expect(line).toContain('4.50% growth after inflation');
    expect(line).toContain('What differs is the destination');
    // The retired claim may not creep back: both cards now deflate, so nothing on this card
    // may tell a reader the one above it runs earlier or before inflation.
    expect(line).not.toContain('before inflation');
    expect(line).not.toContain('earlier');
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
    const set = COACH_COPY.wealthTargetDials(1000, 250, OWNS_BOTH);
    const defaulted = COACH_COPY.wealthTargetDials(1000, 250, DEFAULT_INFLATION);
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
 * C.10 (audit P0-8) — the pace line must name WHERE the contribution came from, and a PLAN is
 * not an observation. #375 made the years dial compound the settings savings-% target whenever
 * one is set, but the sentence kept calling it "what was left after spending", and the refusal
 * kept testing only the figure the dial was handed — so a reader overspending in every month on
 * record was handed a confident 20-year arrival beside the paragraph naming their negative
 * surplus. The decision now lives in `wealthTargetPaceLine`, pure and locked here.
 */
describe('C.10 — the pace line branches on the contribution basis, and a plan refuses on real history', () => {
  /** 154 months = 12 years 10 months; the fixture the surplus pins above already use. */
  const SURPLUS_ARGS = {
    basis: 'recent-surplus' as const,
    contributionCents: cents(23_888_10),
    contributionFloored: false,
    historicalCents: cents(23_888_10),
    averagedOverMonths: 3,
    arrivalMonths: 154,
    realBps: 750,
  };

  it('keeps the recent-surplus pace byte-identical through the selector', () => {
    expect(COACH_COPY.wealthTargetPaceLine(SURPLUS_ARGS)).toBe(
      COACH_COPY.wealthTargetAtCurrentPace(12, 10, cents(23_888_10), 750, 3),
    );
  });

  it('keeps the recent-surplus refusal byte-identical through the selector', () => {
    expect(
      COACH_COPY.wealthTargetPaceLine({
        ...SURPLUS_ARGS,
        contributionCents: cents(0),
        contributionFloored: true,
        historicalCents: cents(-450_00),
      }),
    ).toBe(COACH_COPY.wealthTargetNotSaving(3));
  });

  it('names a settings-% pace as the plan, never as leftover history', () => {
    const s = COACH_COPY.wealthTargetAtPlannedPace(12, 10, cents(23_888_10), 750);
    expect(s).toContain('$23,888.10');
    expect(s).toContain('12 years 10 months');
    expect(s).toContain('7.50% growth after inflation');
    expect(s).toMatch(/your plan/i);
    expect(s).not.toMatch(/left after spending/i);
    // The window belongs to the SURPLUS sentence; the planned sentence carries none of it.
    expect(s).not.toContain('3 months');
  });

  it('routes a settings-% pace with positive history to the planned sentence', () => {
    expect(
      COACH_COPY.wealthTargetPaceLine({ ...SURPLUS_ARGS, basis: 'settings-savings-pct' }),
    ).toBe(COACH_COPY.wealthTargetAtPlannedPace(12, 10, cents(23_888_10), 750));
  });

  it('refuses a settings-% pace when the observed history is negative', () => {
    // The exact audit shape: a positive PLANNED figure beside a NEGATIVE surplus. The old card
    // floored only the figure it was handed and printed the arrival.
    const refused = COACH_COPY.wealthTargetPaceLine({
      ...SURPLUS_ARGS,
      basis: 'settings-savings-pct',
      contributionCents: cents(100_000_00),
      historicalCents: cents(-450_00),
    });
    expect(refused).toBe(COACH_COPY.wealthTargetPlanNotSaving(cents(100_000_00), 3));
    expect(refused).not.toMatch(/you'd get there/i);
    expect(refused).toContain('$100,000.00');
    // Phrased in the surplus pace sentence's own words ("what was left after spending") so the
    // reader can check it — and accurate at an exact tie, which "spending is ahead" would not be.
    expect(refused).toMatch(/nothing has been left over after spending/i);
    expect(refused).toContain('3 months');
  });

  it('an exactly-zero history refuses a settings-% pace too', () => {
    const s = COACH_COPY.wealthTargetPaceLine({
      ...SURPLUS_ARGS,
      basis: 'settings-savings-pct',
      historicalCents: cents(0),
    });
    expect(s).not.toMatch(/you'd get there/i);
  });

  it('names the zero-history refusal as absence, not overspending', () => {
    // 0 complete months divides 0 by 1 — the same shape `wealthTargetNotSaving` separates, and
    // the same `an-empty-set-is-not-a-fact-about-money` rule: no behaviour claim from nothing.
    const none = COACH_COPY.wealthTargetPlanNotSaving(cents(100_000_00), 0);
    expect(none).toMatch(/complete month/i);
    expect(none).not.toMatch(/ahead of income/i);
    expect(none).toContain('$100,000.00');
    const viaSelector = COACH_COPY.wealthTargetPaceLine({
      ...SURPLUS_ARGS,
      basis: 'settings-savings-pct',
      contributionCents: cents(100_000_00),
      historicalCents: cents(0),
      averagedOverMonths: 0,
    });
    expect(viaSelector).toBe(none);
    // Singular window is reachable, not a typo.
    expect(COACH_COPY.wealthTargetPlanNotSaving(cents(100_00), 1)).toContain('1 month ');
  });

  it('the plan-vs-history gate is one exported predicate both sites read', () => {
    // The card's horizon seed and the pace-line refusal must never drift: a fix that re-wrote
    // either comparison inline (`a-fence-by-construction-not-per-call-site`) is what this locks.
    expect(wealthTargetPlanUnproven('settings-savings-pct', cents(-450_00))).toBe(true);
    // An exact tie refuses too: nothing is going in either way.
    expect(wealthTargetPlanUnproven('settings-savings-pct', cents(0))).toBe(true);
    expect(wealthTargetPlanUnproven('settings-savings-pct', cents(1))).toBe(false);
    // The recent-surplus routing has its own guard (the figure IS the history, so
    // `contributionFloored` catches it); the predicate must not fire there.
    expect(wealthTargetPlanUnproven('recent-surplus', cents(-450_00))).toBe(false);
    expect(wealthTargetPlanUnproven('recent-surplus', cents(0))).toBe(false);
  });

  it('keeps the beyond-horizon line under both bases when a pace exists to name', () => {
    const beyond = COACH_COPY.wealthTargetBeyondHorizon(750);
    expect(COACH_COPY.wealthTargetPaceLine({ ...SURPLUS_ARGS, arrivalMonths: null })).toBe(beyond);
    expect(
      COACH_COPY.wealthTargetPaceLine({
        ...SURPLUS_ARGS,
        basis: 'settings-savings-pct',
        arrivalMonths: null,
      }),
    ).toBe(beyond);
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
  it('test_regression__w8_every_coach_copy_key_is_scanned', () => {
    const covered = new Set(ALL_STRINGS.map((s) => s.label.split(':')[0]));
    const emitters = Object.entries(COACH_COPY)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k);
    expect(emitters.length).toBeGreaterThan(0);
    const missing = emitters.filter((k) => !covered.has(k));
    // W.8 closed the seven-key pin. The list may only shrink; a new COACH_COPY
    // key without an ALL_STRINGS row fails here.
    const KNOWN_UNSCANNED: string[] = [];
    const unexpected = missing.filter((k) => !KNOWN_UNSCANNED.includes(k));
    expect(unexpected, `COACH_COPY keys with no ALL_STRINGS row: ${unexpected.join(', ')}`).toEqual(
      [],
    );
    // And the pin itself cannot rot: a key that gets registered must leave this list.
    expect(KNOWN_UNSCANNED.filter((k) => !missing.includes(k))).toEqual([]);
  });
});

// Audit P2 — `pct1` rounds 1–4 bps to "0.0%", so the positive-streak sentence must name the
// magnitude instead of calling a 0.0% month positive, and the personal-best sentence must
// not celebrate a rounded zero. An exact zero stays "0.0%" — a zero is a claim and must
// name which zero. The refusal lock (`not.toContain('0.0%')`) pins the fixed shape.
describe('Audit P2 — the streak never calls a 0.0% month positive', () => {
  it('names a 1–4 bps rate "under 0.1%" instead of "0.0%"', () => {
    expect(COACH_COPY.savingsStreak(3, 4)).toContain('positive savings rate (latest under 0.1%)');
    expect(COACH_COPY.savingsStreak(3, 4)).not.toContain('0.0%');
    expect(COACH_COPY.savingsPersonalBest(4, 'May 2026')).toContain(
      'May 2026 is a personal best so far at under 0.1%',
    );
    expect(COACH_COPY.savingsPersonalBest(4, 'May 2026')).not.toContain('0.0%');
  });

  it('keeps "0.0%" for an exact zero and prints the plain figure above 4 bps', () => {
    expect(COACH_COPY.savingsPersonalBest(0, 'May 2026')).toContain(
      'personal best so far at 0.0%',
    );
    expect(COACH_COPY.savingsPersonalBest(0, 'May 2026')).not.toContain('under 0.1%');
    expect(COACH_COPY.savingsStreak(3, 2653)).toContain('(latest 26.5%)');
  });
});

// C.9 (#405, audit P0-6) — every sentence that names the expense/income window carries it in;
// none of them may spell "6" for a reader whose history is shorter. The full-window (6) forms
// are pinned byte-identical in ALL_STRINGS above; these lock the short-history branches.
describe('C.9 — window copy is carried, never hardcoded to 6', () => {
  it('the FI sentence names the real window and its multiplier', () => {
    expect(COACH_COPY.fiNumber(cents(90_000_000), 400, cents(3_600_000), 3)).toContain(
      'your last 3 full months × 4',
    );
    expect(COACH_COPY.fiNumber(cents(90_000_000), 400, cents(3_600_000), 6)).toContain(
      'your last 6 full months × 2',
    );
    // No history at all: no window claim, no multiplier — the figure is named as unfilled.
    const empty = COACH_COPY.fiNumber(cents(0), 400, cents(0), 0);
    expect(empty).toContain('no complete month of spending is on record yet');
    expect(empty).not.toContain('×');
  });

  it('the slider captions name the real window (and never for the unchanged drag branch)', () => {
    expect(COACH_COPY.sliderCaption(2200, 2200, 23, 17, 3)).toContain(
      'average over the last 3 months',
    );
    expect(COACH_COPY.sliderCaption(2200, 2200, 23, 17, 1)).toContain(
      'average over the last 1 month',
    );
    expect(COACH_COPY.sliderCaption(0, 0, 0, 0, 0)).toContain('no complete months on record yet');
    // The drag branch makes no window claim in any window.
    expect(COACH_COPY.sliderCaption(2200, 3000, 23, 17, 3)).not.toContain('month');
  });

  it('the slider context names the real window', () => {
    expect(COACH_COPY.sliderContext(2330, null, undefined, 3)).toContain('3-month average pace');
    expect(COACH_COPY.sliderContext(2330, 3734, 'May 2026', 6)).toContain('6-month average pace');
    expect(COACH_COPY.sliderContext(0, null, undefined, 0)).toContain(
      'no average pace to start from yet',
    );
  });

  it('the share-of-income sentence names the real window', () => {
    expect(COACH_COPY.wealthTargetRequiredShare(3400, 3)).toContain('over the last 3 months');
    expect(COACH_COPY.wealthTargetRequiredShare(3400, 1)).toContain('over the last 1 month.');
    expect(COACH_COPY.wealthTargetRequiredShare(3400, 6)).toContain('over the last 6 months');
  });
});
