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

  yearsToFI: (years: number, months: number, returnBps: number) =>
    `At your current savings rate you'd reach it in about ${years} years${months > 0 ? ` ${months} months` : ''}, assuming ${pct(returnBps)} average annual returns. Markets wobble — reasonable beats rational, and this number will too.`,

  notOnTrack: () =>
    `Contributions aren't outpacing spending yet, so a projection date wouldn't be honest. The opportunities below are the highest-impact places to look — no small-pleasures audit required.`,

  coastFI: (targetYears: number, returnBps: number) =>
    `You're already Coast FI: assuming ${pct(returnBps)} average returns, what you've invested would grow to your FI number within ${targetYears} years without another dollar added.`,

  notCoastFI: (requiredMonthly: Cents, targetYears: number, returnBps: number) =>
    `To be on pace over the next ${targetYears} years, it takes about ${formatCents(requiredMonthly)}/month, assuming ${pct(returnBps)} average returns.`,

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

  opportunity: (o: Opportunity, expectedReturnBps: number) => {
    const base = `${o.merchant}: ${formatCents(o.monthlyCents)}/mo`;
    const fv = `is ${formatCents(o.fv30Cents)} of future wealth over 30 years (${formatCents(o.fv20Cents)} over 20, ${formatCents(o.fv10Cents)} over 10), assuming ${pct(expectedReturnBps)} average annual returns — compounding does the work, not willpower.`;
    switch (o.kind) {
      case 'unused-subscription':
        return `Still using it? ${base} ${fv}`;
      case 'price-increase':
        return `Quiet price increase — the extra ${base.split(': ')[1]} at ${o.merchant} ${fv}`;
      case 'insurance-reshop':
        return `Re-shopping ${o.merchant} typically saves ~15% (an estimate, assuming typical quotes): ${base} ${fv}`;
      case 'negotiable-bill':
        return `A retention call to ${o.merchant} often lands ~$20/mo (an estimate, assuming a standard offer): ${fv}`;
    }
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
  freedomDividend: (years: number) =>
    `That's about ${years} years until your time becomes fully yours — the highest dividend money pays, assuming the return rate above holds. Every point of savings rate buys some of it back sooner.`,

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
  volatilityPrice: (returnBps: number) =>
    `Those ${pct(returnBps)} returns aren't free — the price is volatility along the way, and the average is never the experience. Staying invested through the dips is the assumption behind every projection here. A fee for admission, not a fine.`,

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
