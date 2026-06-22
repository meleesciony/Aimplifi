/**
 * Spending Plan engine (DECISIONS #66) — the "safe to spend" answer, Simplifi's
 * signature view, surpassed by being exact: of this month's expected income,
 * after what you've already spent, the bills still coming, and your planned
 * savings, here's what's genuinely left — and what that is per remaining day.
 *
 * Pure: integer cents in, integer cents out, no I/O, no `new Date()`.
 */
import type { ISODate } from '@/lib/dates';

export interface SpendingPlanInput {
  today: ISODate;
  /** Expected income for the whole month = received so far + still-scheduled. */
  expectedIncomeCents: number;
  /** Expenses already posted this month (bills + variable), as positive cents. */
  spentSoFarCents: number;
  /** Recurring bills scheduled to post later this month (not yet spent). */
  upcomingBillsCents: number;
  /** Planned savings this month (sum of goal monthly contributions). */
  plannedSavingsCents: number;
}

export interface SpendingPlan extends SpendingPlanInput {
  /** Income − (spent + upcoming bills + savings). Can be negative (overspent). */
  leftToSpendCents: number;
  /** Calendar days remaining this month, including today (≥ 1). */
  daysLeftInMonth: number;
  /** leftToSpend spread over the days remaining, floored at 0. */
  perDayCents: number;
  overspent: boolean;
}

/** Days in a Gregorian month (1-indexed), leap-year aware — no Date object. */
export function daysInMonth(year: number, month: number): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function computeSpendingPlan(input: SpendingPlanInput): SpendingPlan {
  const committed = input.spentSoFarCents + input.upcomingBillsCents + input.plannedSavingsCents;
  const leftToSpendCents = input.expectedIncomeCents - committed;

  const year = Number(input.today.slice(0, 4));
  const month = Number(input.today.slice(5, 7));
  const day = Number(input.today.slice(8, 10));
  const daysLeftInMonth = Math.max(1, daysInMonth(year, month) - day + 1);

  const perDayCents = leftToSpendCents > 0 ? Math.floor(leftToSpendCents / daysLeftInMonth) : 0;

  return {
    ...input,
    leftToSpendCents,
    daysLeftInMonth,
    perDayCents,
    overspent: leftToSpendCents < 0,
  };
}
