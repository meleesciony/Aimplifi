/**
 * EVERY user-facing FI-Coach string lives here, so coach-copy.test.ts can scan
 * them exhaustively for the guardrails:
 *  - educational, never advisory; no security/ticker recommendations
 *  - zero shame language (no "you wasted", "stop buying", "guilty", …)
 *  - every projection states its assumptions inline
 *  - spending on the user's money dials is encouraged, not policed
 */

import { formatCents, type Cents } from '@/lib/money';
import { formatMonth } from '@/lib/dates';
import type { Opportunity, CreepResult, MonthlyFlow } from './insights';

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
    `Room for error: ${months} months of expenses in cash. The richest feeling money buys is not needing the next paycheck.`,

  lifeEnergy: (amount: Cents, hours: number) =>
    `${formatCents(amount)} ≈ ${hours} hours of your working life, assuming your after-tax hourly wage. A lens, not a judgment.`,

  lifeEnergyFootnote: (wageCents: Cents) =>
    `Hours are computed assuming your after-tax wage of ${formatCents(wageCents)}/hr. A lens, not a judgment.`,

  reviewImprovement: (monthLabel: string, fromBps: number, toBps: number) =>
    `What improved in ${monthLabel}: savings rate moved from ${pct1(fromBps)} to ${pct1(toBps)}.`,

  reviewImprovementRunway: (months: number) =>
    `What held steady: your cash runway covers ${months} months of expenses — room for error is wealth working quietly.`,

  reviewCreep: (merchant: string, delta: Cents) =>
    `What crept: ${merchant} now costs ${formatCents(delta)}/mo more than it used to.`,

  reviewCreepSpending: (growthBps: number) =>
    `What crept: typical discretionary spending is up ~${pct1(growthBps)} over the recent window while income is flat.`,

  reviewNextAction: (action: string) => `One next action: ${action}.`,

  nextActionCancelSub: (merchant: string, monthly: Cents) =>
    `decide on ${merchant} — if it's not earning its ${formatCents(monthly)}/mo, one cancellation beats a month of small sacrifices`,

  nextActionTransfer: (amount: Cents, byDate: string) =>
    `move ${formatCents(amount)} to checking by ${byDate} so every card clears in full`,

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

  // C2 · Housel — saving for its own sake is a goal; the cushion is room for error
  cushionIsAGoal: () =>
    `Saving with no specific goal is still a goal — an unallocated cushion is room for error, and room for error is wealth working quietly.`,

  // Housel — assumptions change; play your own game
  assumptionsChange: () =>
    `These rates are assumptions, and assumptions change — revisit them as your life does. Play your own game; someone else's numbers don't have to be yours.`,

  // ── Wave 2: P0.4 Conscious-spending lens (C6 · Sethi) ──────────────────────
  // Investing is folded into savings (no per-month contribution flow in the data); stated inline.
  consciousSpending: (fixedPct: number, savePct: number, funPct: number) =>
    `This month, about ${fixedPct}% has gone to bills and spending, ${savePct}% to savings and investing goals, and ${funPct}% is guilt-free to spend. A rough target is 50–60% / 15–20% / 20–35% — a lens on where your money goes, not a rule. Investing contributions aren't tracked separately yet, so they sit with savings.`,

  consciousOverspent: () =>
    `Spending has outpaced income this month, so guilt-free has gone negative — one month is weather, not climate. The trend is what matters.`,

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
    `Quick wins clear your first debt in about ${firstWinMonths} months; least-interest saves roughly ${interestSavedLabel} over the full payoff. Momentum or math — your call.`,
  debtStarterBuffer: () =>
    `A common first step (Ramsey): set aside about $1,000 as a starter buffer before throwing extra at debt, so a surprise doesn't send you back to the cards.`,
  debtAskAnswer: (monthLabel: string, strategyLabel: string) =>
    `On the ${strategyLabel} plan, you'd be debt-free around ${monthLabel}, assuming you keep the payments steady.`,
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
  pendingTransfer?: { amountCents: Cents; byDate: string } | null;
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
        COACH_COPY.nextActionTransfer(input.pendingTransfer.amountCents, input.pendingTransfer.byDate),
      )
    : unused
      ? COACH_COPY.reviewNextAction(COACH_COPY.nextActionCancelSub(unused.merchant, unused.monthlyCents))
      : COACH_COPY.reviewNextAction(COACH_COPY.nextActionAutomate());

  return { month: last?.month ?? '', improvement, creep: creepLine, nextAction };
}
