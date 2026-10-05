/**
 * Bonuses, handled when they land (owner, DECISIONS #784; built as #787).
 *
 * THE OWNER'S RULE. "Base pay plans the month … Bonuses show as their own line
 * and go toward your savings target first. Safest if bonus size varies — you
 * never plan monthly spending on money that only arrives 4 times a year." Base
 * pay was built as #785/#786 (`regular-pay.ts`). This module is the other half:
 * it finds the bonus money that has ALREADY LANDED in the current calendar
 * month, so the plan can show it on its own line and let it pay this month's
 * savings first. Nothing here forecasts a bonus — a bonus that has not arrived
 * is not in any figure.
 *
 * WHAT COUNTS AS A BONUS (two kinds, both in the accounts the income figure
 * reads, both from the current calendar month up to today):
 *   1. `filed` — a row filed Bonus. All of it: filing a deposit Bonus is the
 *      reader saying "this is not my regular pay" (regular pay already leaves
 *      every Bonus row out). Signed, so a bonus taken back nets against it.
 *   2. `above-paycheck` — a payday from a steady payroll (a live
 *      `RegularPayStream`) whose deposits that day total MORE than 1.5× its
 *      usual paycheck: a bonus paid through payroll, with or without the
 *      paycheck in the same deposit. Only the part ABOVE the usual paycheck
 *      counts. When the paycheck was paid that day too, that part is the
 *      bonus; when the bonus came on its own date, it is the bonus less one
 *      paycheck — low, never high, because the rows cannot say which.
 *
 * WHY 1.5× AND WHY IT NEVER READS A PAYCHECK AS A BONUS. 1.5× is the band
 * regular pay itself uses to tell a paycheck from a bonus-sized payday. A live
 * stream's in-band paychecks among its last eight all sit within 25% of each
 * other (`MAX_AMOUNT_SPREAD_PCT`), and its paycheck is never below the smallest
 * of them, so no in-band paycheck of the current month can exceed 1.25× it. A
 * double paycheck after a missed payday cannot reach here either: the missed
 * payday breaks the stream's rhythm, so no live stream exists for that payer.
 *
 * Pure: integer cents in, integer cents out; no I/O; no `new Date()`.
 */
import { monthKey, type ISODate } from '@/lib/dates';
import { categoryName as builtInCategoryName } from '@/lib/engine/categorize/categories';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { countsInFlows, type TxnLike } from '@/lib/engine/fi/insights';
import { isPayrollDepositRow, type RegularPay } from '@/lib/engine/spending-plan/regular-pay';
// TYPE-ONLY: plan.ts imports this module at runtime, so a value import back
// would close a module cycle; `import type` is erased at compile time.
import type { IncomeBasis } from '@/lib/engine/spending-plan/plan';

/** A payday counts as carrying a bonus when its total is more than this
 *  percent of the usual paycheck — regular pay's own paycheck band (1.5×),
 *  compared as whole numbers so the boundary is exact. */
const ABOVE_PAYCHECK_PCT = 150;

export interface BonusDeposit {
  date: ISODate;
  /** `filed`: a row filed Bonus. `above-paycheck`: a steady payroll's payday
   *  that brought more than 1.5× its usual paycheck. */
  kind: 'filed' | 'above-paycheck';
  /** What landed: the row (`filed`, signed — a bonus taken back is negative),
   *  or the payroll's pay deposits that day (`above-paycheck`). */
  depositCents: number;
  /** The usual paycheck taken off (`above-paycheck`); null for `filed`. */
  paycheckCents: number | null;
  /** The bonus part: the whole row (`filed`), or the deposits less the usual
   *  paycheck (`above-paycheck`). */
  bonusCents: number;
}

export interface BonusesThisMonth {
  /** The calendar month read (YYYY-MM of today). */
  month: string;
  /** Oldest first; same-date rows keep a stable order (kind, then amount). */
  deposits: BonusDeposit[];
  /** Sum of every `bonusCents`, never below 0. */
  totalCents: number;
  /** The reader's name for the Bonus category (they can rename it) — what the
   *  copy tells them to file a deposit as. */
  categoryName: string;
}

/**
 * The bonus money that landed in today's calendar month, up to today, in the
 * rows given (the plan passes the same income-account rows regular pay reads).
 * `regularPay` supplies the live steady payrolls and their usual paychecks —
 * also when the plan is not on regular pay, so the line can still SHOW a
 * payroll bonus; whether any of it moves a figure is the plan's decision
 * (`bonusTowardSavingsCents`).
 */
export function bonusesThisMonth(
  transactions: readonly TxnLike[],
  today: ISODate,
  regularPay: RegularPay,
  categoryName: string = builtInCategoryName('bonus'),
): BonusesThisMonth {
  const month = monthKey(today);
  const inMonth = (t: TxnLike) => monthKey(t.date) === month && t.date <= today;
  const deposits: BonusDeposit[] = [];

  for (const t of transactions) {
    if (t.categoryId !== 'bonus' || !inMonth(t) || !countsInFlows(t) || t.amountCents === 0) continue;
    deposits.push({
      date: t.date as ISODate,
      kind: 'filed',
      depositCents: t.amountCents,
      paycheckCents: null,
      bonusCents: t.amountCents,
    });
  }

  const paycheckByPayer = new Map(regularPay.streams.map((s) => [s.payerCanonical, s.paycheckCents]));
  const dayTotals = new Map<string, { payer: string; date: string; totalCents: number }>();
  for (const t of transactions) {
    if (!inMonth(t) || !isPayrollDepositRow(t)) continue;
    const payer = normalizeMerchant(t.rawDescriptor).canonical;
    if (!paycheckByPayer.has(payer)) continue;
    const key = `${payer}\u0000${t.date}`;
    const slot = dayTotals.get(key) ?? { payer, date: t.date, totalCents: 0 };
    slot.totalCents += t.amountCents;
    dayTotals.set(key, slot);
  }
  for (const { payer, date, totalCents } of dayTotals.values()) {
    const paycheckCents = paycheckByPayer.get(payer)!;
    if (paycheckCents <= 0 || totalCents * 100 <= paycheckCents * ABOVE_PAYCHECK_PCT) continue;
    deposits.push({
      date: date as ISODate,
      kind: 'above-paycheck',
      depositCents: totalCents,
      paycheckCents,
      bonusCents: totalCents - paycheckCents,
    });
  }

  deposits.sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      (a.kind === b.kind ? 0 : a.kind === 'filed' ? -1 : 1) ||
      b.bonusCents - a.bonusCents,
  );
  const totalCents = Math.max(0, deposits.reduce((sum, d) => sum + d.bonusCents, 0));
  return { month, deposits, totalCents, categoryName };
}

/**
 * How much of this month's bonus money pays this month's planned savings
 * (owner: "go toward your savings target first") — the amount guilt-free rises
 * by. Only on the `regular-pay` income basis: that basis leaves every bonus out
 * of income by construction (Bonus rows are never pay; a bonus-sized payday is
 * never a paycheck, and it cannot sit in the usual month of "other" pay a clean
 * household is allowed — one would be more than the 10% that condition 5
 * permits). Every other basis can already hold bonus pay (the median counts
 * Bonus rows and bonus-sized paydays in the months it reads; a typed income may
 * include it), so there it counts nothing — fail closed. Never more than the
 * planned savings: what is left over plans nothing.
 */
export function bonusTowardSavingsCents(
  bonuses: BonusesThisMonth | null | undefined,
  plannedSavingsCents: number,
  incomeBasis: IncomeBasis,
): number {
  if (!bonuses || incomeBasis !== 'regular-pay') return 0;
  return Math.max(0, Math.min(bonuses.totalCents, plannedSavingsCents));
}
