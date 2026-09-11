/**
 * The one insight sentence a savings-goal card (and the Home Goals card) says about
 * progress and pace (DECISIONS #737). Pure: reads a `GoalProgress` plus the fields the
 * sentence names, formats money through the one canonical `formatCents`, dates through
 * `formatMonth`. Same guardrails as coach-copy: second person, no shame, and EVERY
 * projection names both of its inputs inline — the flat monthly pledge AND the saved
 * figure it starts from. `savedCents` is a hand-typed field (Ask-saved goals start at
 * $0), so a verdict that leaned on it silently would call a reader "behind" for money
 * they moved but never marked (critic P1-1); the sentence therefore says "counting the
 * $X you've marked saved" and, when behind, invites the update before the bigger pledge.
 */
import { compareDates, formatMonth, monthKey, monthWindow, type ISODate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import type { GoalPace, GoalProgress } from './progress';

const fmt = (n: number) => formatCents(cents(n));
const month = (d: ISODate) => formatMonth(monthKey(d));
const months = (n: number) => `${n} ${n === 1 ? 'month' : 'months'}`;

/** Short badge text per pace. */
export const GOAL_PACE_LABEL: Record<GoalPace, string> = {
  funded: 'Funded',
  'date-passed': 'Date passed',
  'no-pledge': 'Needs a monthly amount',
  'no-date': 'No date yet',
  'on-track': 'On pace',
  behind: 'Behind pace',
};

/**
 * One-line headline over a set of goals (the Home card title). Attention first: any goal
 * that is behind or past its date names the count; else any goal that cannot be paced yet
 * (no pledge / no date); else everything is fine and the line says so.
 */
export function goalsHeadline(paces: readonly GoalPace[]): string {
  const n = paces.length;
  const goals = n === 1 ? 'goal' : 'goals';
  const attention = paces.filter((p) => p === 'behind' || p === 'date-passed').length;
  if (attention > 0) {
    return n === 1 ? 'Your goal needs a look' : `${attention} of ${n} ${goals} ${attention === 1 ? 'needs' : 'need'} a look`;
  }
  const unpaced = paces.filter((p) => p === 'no-pledge' || p === 'no-date').length;
  if (unpaced > 0) {
    return n === 1
      ? 'Your goal needs a monthly amount or a date'
      : `${unpaced} of ${n} ${goals} ${unpaced === 1 ? 'needs' : 'need'} a monthly amount or a date`;
  }
  const funded = paces.filter((p) => p === 'funded').length;
  if (funded === n) return n === 1 ? 'Your goal is funded' : `All ${n} goals funded`;
  return n === 1 ? 'Your goal is on pace' : `All ${n} goals on pace`;
}

export interface GoalSentenceContext {
  targetCents: number;
  /** The hand-typed saved figure the verdict starts from — named in every projection. */
  savedCents: number;
  monthlyContributionCents: number | null;
  targetDate: ISODate | null;
  /** The business "today" the progress was computed on (for "is here" vs "has passed"). */
  today: ISODate;
}

export function goalPaceSentence(p: GoalProgress, goal: GoalSentenceContext): string {
  const monthly = goal.monthlyContributionCents ?? 0;
  const basis = `counting the ${fmt(Math.max(0, goal.savedCents))} you've marked saved`;
  switch (p.pace) {
    case 'funded':
      return `Fully funded — the whole ${fmt(goal.targetCents)} is set aside. Nice work.`;
    case 'date-passed': {
      // targetDate is non-null in this pace by construction (goalProgress). "Is here" only
      // while the target month is the current month; an older month has passed.
      const target = goal.targetDate as ISODate;
      const stillCurrent = compareDates(monthWindow(monthKey(target)).to, goal.today) >= 0;
      return `Your ${month(target)} date ${stillCurrent ? 'is here' : 'has passed'} with ${fmt(p.remainingCents)} still to go. Pick a new date to get a fresh monthly figure.`;
    }
    case 'no-pledge':
      if (goal.targetDate !== null && p.requiredMonthlyCents !== null) {
        return `${fmt(p.remainingCents)} to go, ${basis}. Setting aside ${fmt(p.requiredMonthlyCents)}/mo funds this by ${month(goal.targetDate)}.`;
      }
      return `${fmt(p.remainingCents)} to go, ${basis}. Add a monthly amount to see when this lands.`;
    case 'no-date':
      return `${fmt(p.remainingCents)} to go, ${basis}. At ${fmt(monthly)}/mo this is funded by ${month(p.fundedByDate as ISODate)}. Set a date to check your pace.`;
    case 'on-track': {
      const funded = month(p.fundedByDate as ISODate);
      const delta = p.monthsDelta ?? 0;
      return delta === 0
        ? `On pace: ${basis}, ${fmt(monthly)}/mo has this funded by ${funded} — right on your date.`
        : `On pace: ${basis}, ${fmt(monthly)}/mo has this funded by ${funded}, ${months(delta)} ahead of your ${month(goal.targetDate as ISODate)} date.`;
    }
    case 'behind':
      return `Behind pace: ${basis}, ${fmt(monthly)}/mo has this funded by ${month(p.fundedByDate as ISODate)}, ${months(p.monthsDelta ?? 0)} after your ${month(goal.targetDate as ISODate)} date. ${fmt(p.requiredMonthlyCents ?? 0)}/mo gets you there on time (${fmt(p.gapMonthlyCents ?? 0)}/mo more). If you've set more aside, update what you've saved and this recalculates.`;
  }
}
