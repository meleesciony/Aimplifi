/**
 * Idle-cash lens (COACH_PRINCIPLES_PLAN C10 / C2 — DECISIONS #519).
 *
 * When checking + savings (the same `liquid` sum runway uses) sit at least
 * one extra month past a 6-month cash cushion, name the surplus. "Far" is
 * that extra month — one cent past 6 months is idle, not a surplus claim.
 * The 6-month ceiling is the same bound the room-for-error band already
 * calls "past". This module does not invent a yield, a product, or a
 * shortfall — unknown expenses are not a $0 cushion.
 *
 * Pure: no I/O, integer cents, deterministic.
 */

import { type Cents, cents } from '@/lib/money';
import { monthsOfRunway } from '@/lib/engine/fi/insights';

/** Classic emergency-fund ceiling — same "past" bound as `runwayBanded`. */
export const IDLE_CASH_CUSHION_MONTHS = 6;

export interface IdleCashInput {
  /** Checking + savings balances — the runway numerator. */
  liquidCents: Cents | number;
  /** Same average monthly expenses the runway figure divides by. */
  monthlyExpenseCents: Cents | number;
  /** Complete months that average was taken over. Named in copy. */
  expenseWindowMonths: number;
}

export interface IdleCash {
  liquidCents: Cents;
  monthlyExpenseCents: Cents;
  expenseWindowMonths: number;
  /** Null when there are no expenses — 6 × $0 is not a cushion. */
  cushionCents: Cents | null;
  /** Null unless liquid is at least one extra month past the cushion. */
  excessCents: Cents | null;
  /** Same `monthsOfRunway` the Room-for-error card prints. */
  runwayMonths: number;
  idle: boolean;
  noExpenses: boolean;
}

export function idleCash(input: IdleCashInput): IdleCash {
  const liquidCents = cents(Math.trunc(Number(input.liquidCents)));
  const monthlyExpenseCents = cents(Math.max(0, Math.trunc(Number(input.monthlyExpenseCents))));
  const expenseWindowMonths = Math.max(0, Math.trunc(input.expenseWindowMonths));
  const runwayMonths = monthsOfRunway(liquidCents, monthlyExpenseCents);
  const noExpenses = monthlyExpenseCents <= 0;

  if (noExpenses) {
    return {
      liquidCents,
      monthlyExpenseCents,
      expenseWindowMonths,
      cushionCents: null,
      excessCents: null,
      runwayMonths,
      idle: true,
      noExpenses: true,
    };
  }

  const cushionCents = cents(monthlyExpenseCents * IDLE_CASH_CUSHION_MONTHS);
  const rawExcess = liquidCents - cushionCents;
  // One extra month past the 6-month ceiling — "far", not a rounding nick.
  const excessCents =
    rawExcess >= monthlyExpenseCents ? cents(rawExcess) : null;
  return {
    liquidCents,
    monthlyExpenseCents,
    expenseWindowMonths,
    cushionCents,
    excessCents,
    runwayMonths,
    idle: excessCents == null,
    noExpenses: false,
  };
}
