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
 * WHAT COUNTS (in the rows given — the plan passes the income-account rows
 * regular pay reads — from the current calendar month up to today):
 *   1. `filed` — a row filed Bonus, signed (a bonus taken back nets). Whole,
 *      except where the income figure may already hold it:
 *      - from the payer of a live regular paycheck, dated after that paycheck's
 *        last payday: it may BE the paycheck (two Bonus filings teach a rule
 *        that files the payer's next deposit Bonus — #787 critic cycle 1, P1-1),
 *        so only the part above the usual paycheck counts until one lands
 *        after it;
 *      - from a payer whose deposits filed as pay (Paycheck, Side income,
 *        Income) arrived in the last three complete months: regular pay's
 *        "other income" may already expect it, so only the part above that
 *        payer's usual month counts (cycle 2, P2-B) — for the payer of a
 *        regular paycheck, its usual month of days outside the paycheck band
 *        (cycle 3, P2-1).
 *   2. `above-paycheck` — a day the payer of a live regular paycheck (a
 *      `RegularPayStream`) deposited MORE than 1.5× the usual paycheck, once an
 *      ordinary paycheck (0.5×–1.5×) from that payer has landed AFTER it. The
 *      part above the usual paycheck counts: the bonus exactly when the
 *      paycheck came the same day, the bonus less one paycheck when it came on
 *      its own (low, never high). Without a later ordinary paycheck the day may
 *      be a raise of more than half or a new job under the same payroll name
 *      (cycle 1, P2-3) — it is not bonus money.
 *   3. `taken-back` — once any bonus money landed this month: every outflow
 *      this month that is NOT filed as spending (uncategorized, or an Income
 *      category) or that is marked a reversal or return. Fail closed and
 *      payer-blind (cycle 2, F1): banks reverse a payroll credit under a
 *      descriptor whose middle word changes ("… REVERSAL PPD", "DES:REVERSAL",
 *      "DEPOSITED ITEM RETURNED"), so no payer match can be trusted to find it;
 *      a purchase filed to its spending category never matches (cycle 2, P2-A).
 * The net is signed; what can pay savings never goes below $0.
 *
 * THE USUAL PAYCHECK is the larger of the stream's paycheck (after a #786 rise,
 * its newest level) and the newest ordinary payday from that payer up to today
 * — the level a bonus day actually rode on (cycle 1, P2-4; cycle 2, P3-5).
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
import { addMonthsClamped, isoDate, monthKey, type ISODate } from '@/lib/dates';
import { median } from '@/lib/stats';
import { CATEGORY_BY_ID, categoryName as builtInCategoryName } from '@/lib/engine/categorize/categories';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { countsInFlows, type TxnLike } from '@/lib/engine/fi/insights';
import { isPayrollDepositRow, type RegularPay } from '@/lib/engine/spending-plan/regular-pay';
// TYPE-ONLY: plan.ts imports this module at runtime, so a value import back
// would close a module cycle; `import type` is erased at compile time.
import type { IncomeBasis } from '@/lib/engine/spending-plan/plan';

/** A day counts as carrying a bonus when its total is more than this percent
 *  of the usual paycheck — regular pay's own paycheck band (1.5×), compared as
 *  whole numbers so the boundary is exact. */
const ABOVE_PAYCHECK_PCT = 150;
/** An ordinary paycheck: from half to one and a half usual paychecks. */
const ORDINARY_LOW_PCT = 50;
/** The complete months a payer's usual month of pay is read over — regular
 *  pay's own window for "other income". */
const WINDOW_MONTHS = 3;
/** Words a bank puts on money it takes back. */
const REVERSAL_RE = /\b(REVERSAL|REVERSED|REVERSE|REV|RETURN|RETURNED|CHARGEBACK|CHGBK)\b/i;

export interface BonusDeposit {
  date: ISODate;
  /** `filed`: a row filed Bonus. `above-paycheck`: a day the payer of a
   *  regular paycheck deposited more than 1.5× it. `taken-back`: an outflow
   *  this month not filed as spending, or marked a reversal or return. */
  kind: 'filed' | 'above-paycheck' | 'taken-back';
  /** What landed or went out, signed: the row (`filed`, `taken-back`), or the
   *  payer's pay deposits that day (`above-paycheck`). */
  depositCents: number;
  /** What was taken off before counting, and why: the usual paycheck
   *  (`above-paycheck`, or a `filed` row that may be that paycheck), or the
   *  usual month of a payer whose pay is already counted (`usual-month`), or
   *  the usual month a regular paycheck's payer sends besides the paycheck
   *  (`usual-extra`). Null: nothing. */
  less: { cents: number; reason: 'usual-paycheck' | 'usual-month' | 'usual-extra' } | null;
  /** What counts, signed: the deposit less `less.cents` (never below 0 for a
   *  `filed` row). */
  bonusCents: number;
}

export interface BonusesThisMonth {
  /** The calendar month read (YYYY-MM of today). */
  month: string;
  /** Oldest first; on one date: filed, then above-paycheck, then taken-back. */
  deposits: BonusDeposit[];
  /** Sum of every `bonusCents`, signed — what the copy prints as "in all". */
  netCents: number;
  /** `netCents`, never below 0 — what can pay savings. */
  totalCents: number;
  /** The reader's name for the Bonus category (they can rename it). */
  categoryName: string;
}

const KIND_ORDER: Record<BonusDeposit['kind'], number> = { filed: 0, 'above-paycheck': 1, 'taken-back': 2 };

/** Spending: filed to a category outside the Income group (a custom category
 *  is spending — readers make them for what they spend on). */
function isFiledAsSpending(t: TxnLike): boolean {
  const id = t.categoryId ?? null;
  if (id === null || id === 'uncategorized') return false;
  return CATEGORY_BY_ID.get(id)?.group !== 'Income';
}

/**
 * The bonus money that landed in today's calendar month, up to today.
 * `regularPay` supplies the live regular paychecks — also when the plan is not
 * on regular pay, so the line can still SHOW what landed; whether any of it
 * moves a figure is the plan's decision (`bonusTowardSavingsCents`).
 */
export function bonusesThisMonth(
  transactions: readonly TxnLike[],
  today: ISODate,
  regularPay: RegularPay,
  categoryName: string = builtInCategoryName('bonus'),
): BonusesThisMonth {
  const month = monthKey(today);
  const inMonth = (t: TxnLike) => monthKey(t.date) === month && t.date <= today;
  const payerOf = (t: TxnLike) => normalizeMerchant(t.rawDescriptor).canonical;

  // Every payroll day up to today, per payer (pay rows only — never a Bonus).
  const payDays = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    if (t.date > today || !isPayrollDepositRow(t)) continue;
    const payer = payerOf(t);
    const days = payDays.get(payer) ?? new Map<string, number>();
    days.set(t.date, (days.get(t.date) ?? 0) + t.amountCents);
    payDays.set(payer, days);
  }

  // Live regular paychecks: the usual paycheck and the last payday.
  const streams = new Map<string, { usual: number; lastPaidOn: string }>();
  for (const s of regularPay.streams) {
    const base = s.step ? Math.max(s.paycheckCents, s.step.newestCents) : s.paycheckCents;
    const ordinaryToBase = (total: number) =>
      total * 100 >= base * ORDINARY_LOW_PCT && total * 100 <= base * ABOVE_PAYCHECK_PCT;
    const newestOrdinary = [...(payDays.get(s.payerCanonical) ?? new Map<string, number>())]
      .filter(([, total]) => ordinaryToBase(total))
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))[0];
    streams.set(s.payerCanonical, {
      usual: Math.max(base, newestOrdinary ? newestOrdinary[1] : 0),
      lastPaidOn: s.lastPaidOn,
    });
  }

  // Every payer's usual month of pay over the window that regular pay's "other
  // income" may already expect: all of an other payer's pay; for the payer of a
  // regular paycheck, only its days outside the paycheck band — the days regular
  // pay counts as "other" (#787 critic cycle 3, P2-1).
  const windowStart = addMonthsClamped(isoDate(`${month}-01`), -WINDOW_MONTHS);
  const windowMonths = Array.from({ length: WINDOW_MONTHS }, (_, i) =>
    monthKey(addMonthsClamped(windowStart, i)),
  );
  const usualMonthOf = new Map<string, number>();
  for (const [payer, days] of payDays) {
    const stream = streams.get(payer);
    const counted = (total: number) =>
      stream === undefined ||
      total * 100 < stream.usual * ORDINARY_LOW_PCT ||
      total * 100 > stream.usual * ABOVE_PAYCHECK_PCT;
    const byMonth = windowMonths.map((m) =>
      [...days]
        .filter(([d, total]) => monthKey(d) === m && counted(total))
        .reduce((sum, [, total]) => sum + total, 0),
    );
    const usual = Math.round(median(byMonth));
    if (usual > 0) usualMonthOf.set(payer, usual);
  }

  const deposits: BonusDeposit[] = [];
  for (const t of transactions) {
    if (t.categoryId !== 'bonus' || !inMonth(t) || !countsInFlows(t) || t.amountCents === 0) continue;
    const payer = payerOf(t);
    const stream = streams.get(payer);
    const usualMonth = usualMonthOf.get(payer);
    const less =
      t.amountCents <= 0
        ? null
        : stream !== undefined && t.date > stream.lastPaidOn
          ? { cents: stream.usual, reason: 'usual-paycheck' as const }
          : usualMonth !== undefined
            ? { cents: usualMonth, reason: stream !== undefined ? ('usual-extra' as const) : ('usual-month' as const) }
            : null;
    deposits.push({
      date: t.date as ISODate,
      kind: 'filed',
      depositCents: t.amountCents,
      less,
      bonusCents: less ? Math.max(0, t.amountCents - less.cents) : t.amountCents,
    });
  }

  for (const [payer, { usual }] of streams) {
    if (usual <= 0) continue;
    const days = [...(payDays.get(payer) ?? new Map<string, number>())];
    const ordinary = (total: number) =>
      total * 100 >= usual * ORDINARY_LOW_PCT && total * 100 <= usual * ABOVE_PAYCHECK_PCT;
    for (const [date, totalCents] of days) {
      if (monthKey(date) !== month || totalCents * 100 <= usual * ABOVE_PAYCHECK_PCT) continue;
      if (!days.some(([later, total]) => later > date && ordinary(total))) continue;
      deposits.push({
        date: date as ISODate,
        kind: 'above-paycheck',
        depositCents: totalCents,
        less: { cents: usual, reason: 'usual-paycheck' },
        bonusCents: totalCents - usual,
      });
    }
  }

  // Money going back out nets only in a month bonus money landed — otherwise
  // there is nothing for it to net against, and nothing to say.
  if (deposits.some((d) => d.depositCents > 0)) {
    for (const t of transactions) {
      if (t.amountCents >= 0 || t.categoryId === 'bonus' || !inMonth(t) || !countsInFlows(t)) continue;
      if (isFiledAsSpending(t) && !REVERSAL_RE.test(t.rawDescriptor ?? '')) continue;
      deposits.push({
        date: t.date as ISODate,
        kind: 'taken-back',
        depositCents: t.amountCents,
        less: null,
        bonusCents: t.amountCents,
      });
    }
  }

  deposits.sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      b.bonusCents - a.bonusCents,
  );
  const netCents = deposits.reduce((sum, d) => sum + d.bonusCents, 0);
  return { month, deposits, netCents, totalCents: Math.max(0, netCents), categoryName };
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
