/**
 * EVERY user-facing FI-Coach string lives here, so coach-copy.test.ts can scan
 * them exhaustively for the guardrails:
 *  - educational, never advisory; no security/ticker recommendations
 *  - zero shame language (no "you wasted", "stop buying", "guilty", …)
 *  - every projection states its assumptions inline
 *  - spending on the user's money dials is encouraged, not policed
 */

import { formatCents, type Cents } from '@/lib/money';
import type { Opportunity, CreepResult, MonthlyFlow } from './insights';

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const pct1 = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export const COACH_COPY = {
  savingsRateHeadline: (rateBps: number) =>
    `You kept ${pct(rateBps)} of your after-tax income this month — savings rate, not returns, is what moves your FI date.`,

  savingsRateNoIncome: () =>
    `No income landed this month, so there's no savings rate to compute — the trend below still tells the story.`,

  fiNumber: (fi: Cents, swrBps: number) =>
    `Your FI number is ${formatCents(fi)}, assuming a ${pct(swrBps)} safe withdrawal rate on your current annual spending.`,

  yearsToFI: (years: number, months: number, returnBps: number) =>
    `At your current savings rate you'd reach it in about ${years} years${months > 0 ? ` ${months} months` : ''}, assuming ${pct(returnBps)} average annual returns. Markets wobble — reasonable beats rational, and this number will too.`,

  notOnTrack: () =>
    `Contributions aren't outpacing spending yet, so a projection date wouldn't be honest. The opportunities below are the highest-impact places to look — no small-pleasures audit required.`,

  coastFI: (targetYears: number, returnBps: number) =>
    `You're already Coast FI: assuming ${pct(returnBps)} average returns, what you've invested would grow to your FI number within ${targetYears} years without another dollar added.`,

  notCoastFI: (requiredMonthly: Cents, targetYears: number, returnBps: number) =>
    `To be on pace over the next ${targetYears} years, it takes about ${formatCents(requiredMonthly)}/month, assuming ${pct(returnBps)} average returns.`,

  sliderCaption: (fromBps: number, toBps: number, fromYears: number, toYears: number) =>
    `Raising your savings rate from ${pct1(fromBps)} to ${pct1(toBps)} moves FI from ~${fromYears} years out to ~${toYears} — assumptions unchanged.`,

  opportunity: (o: Opportunity) => {
    const base = `${o.merchant}: ${formatCents(o.monthlyCents)}/mo`;
    const fv = `is ${formatCents(o.fv30Cents)} of future wealth over 30 years (${formatCents(o.fv20Cents)} over 20, ${formatCents(o.fv10Cents)} over 10), assuming your expected return — compounding does the work, not willpower.`;
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

  reviewImprovement: (month: string, fromBps: number, toBps: number) =>
    `What improved in ${month}: savings rate moved from ${pct(fromBps)} to ${pct(toBps)}.`,

  reviewImprovementRunway: (months: number) =>
    `What improved: your cash runway now covers ${months} months of expenses.`,

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
      ? COACH_COPY.reviewImprovement(last.month, prev.savingsRateBps, last.savingsRateBps)
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
