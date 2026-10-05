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
 *      EXCEPT a positive row from the payer of a live regular paycheck dated
 *      after that paycheck's last payday: no paycheck has landed after it, so it
 *      may BE the paycheck (a learned rule files a payer's NEXT deposit the way
 *      its last two were filed — #787 critic cycle 1, P1-1), and only the part
 *      above the usual paycheck counts until one does.
 *   2. `above-paycheck` — a day the payer of a live regular paycheck (a
 *      `RegularPayStream`) deposited MORE than 1.5× the usual paycheck, once an
 *      ordinary paycheck (0.5×–1.5×) from that payer has landed AFTER it. The
 *      part above the usual paycheck counts: the bonus exactly when the
 *      paycheck came the same day, the bonus less one paycheck when it came on
 *      its own (low, never high). Without a later ordinary paycheck the day may
 *      be a raise of more than half or a new job under the same payroll name
 *      (cycle 1, P2-3) — it is not bonus money.
 *   3. `taken-back` — a negative row (not filed Bonus) from a payer of this
 *      month's bonus money: a reversal, or a duplicate taken back (cycle 1,
 *      P1-2). It nets against the total. Payers the normalizer cannot identify
 *      (Zelle, Venmo, checks — `aggregate`) are never matched: their outflows
 *      are anyone's.
 * The total nets everything and never goes below $0.
 *
 * THE USUAL PAYCHECK is the stream's paycheck, or after a rise (#786) its newest
 * paycheck — the level a bonus day actually rode on (cycle 1, P2-4).
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

/** A day counts as carrying a bonus when its total is more than this percent
 *  of the usual paycheck — regular pay's own paycheck band (1.5×), compared as
 *  whole numbers so the boundary is exact. */
const ABOVE_PAYCHECK_PCT = 150;
/** An ordinary paycheck: from half to one and a half usual paychecks. */
const ORDINARY_LOW_PCT = 50;

export interface BonusDeposit {
  date: ISODate;
  /** `filed`: a row filed Bonus. `above-paycheck`: a day the payer of a
   *  regular paycheck deposited more than 1.5× it. `taken-back`: a negative
   *  row from a payer of this month's bonus money. */
  kind: 'filed' | 'above-paycheck' | 'taken-back';
  /** What landed, signed: the row (`filed`, `taken-back`), or the payer's pay
   *  deposits that day (`above-paycheck`). */
  depositCents: number;
  /** The usual paycheck taken off — always for `above-paycheck`; for `filed`
   *  only when the row may be that paycheck (see the module header); else null. */
  paycheckCents: number | null;
  /** What counts, signed: the deposit, less `paycheckCents` when set (never
   *  below 0 for a `filed` row). */
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
  const streams = new Map(
    regularPay.streams.map((s) => [
      s.payerCanonical,
      {
        usual: s.step ? Math.max(s.paycheckCents, s.step.newestCents) : s.paycheckCents,
        lastPaidOn: s.lastPaidOn as string,
      },
    ]),
  );
  const deposits: BonusDeposit[] = [];
  /** Payers this month's bonus money came from — the ones whose take-backs net. */
  const bonusPayers = new Set<string>();

  for (const t of transactions) {
    if (t.categoryId !== 'bonus' || !inMonth(t) || !countsInFlows(t) || t.amountCents === 0) continue;
    const payer = normalizeMerchant(t.rawDescriptor);
    bonusPayers.add(payer.canonical);
    const stream = streams.get(payer.canonical);
    const held = t.amountCents > 0 && stream !== undefined && t.date > stream.lastPaidOn;
    deposits.push({
      date: t.date as ISODate,
      kind: 'filed',
      depositCents: t.amountCents,
      paycheckCents: held ? stream.usual : null,
      bonusCents: held ? Math.max(0, t.amountCents - stream.usual) : t.amountCents,
    });
  }

  const daysByPayer = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    if (!inMonth(t) || !isPayrollDepositRow(t)) continue;
    const payer = normalizeMerchant(t.rawDescriptor).canonical;
    if (!streams.has(payer)) continue;
    const days = daysByPayer.get(payer) ?? new Map<string, number>();
    days.set(t.date, (days.get(t.date) ?? 0) + t.amountCents);
    daysByPayer.set(payer, days);
  }
  for (const [payer, days] of daysByPayer) {
    const { usual } = streams.get(payer)!;
    if (usual <= 0) continue;
    const ordinary = (total: number) =>
      total * 100 >= usual * ORDINARY_LOW_PCT && total * 100 <= usual * ABOVE_PAYCHECK_PCT;
    for (const [date, totalCents] of days) {
      if (totalCents * 100 <= usual * ABOVE_PAYCHECK_PCT) continue;
      if (![...days].some(([later, total]) => later > date && ordinary(total))) continue;
      bonusPayers.add(payer);
      deposits.push({
        date: date as ISODate,
        kind: 'above-paycheck',
        depositCents: totalCents,
        paycheckCents: usual,
        bonusCents: totalCents - usual,
      });
    }
  }

  for (const t of transactions) {
    if (t.amountCents >= 0 || t.categoryId === 'bonus' || !inMonth(t) || !countsInFlows(t)) continue;
    const payer = normalizeMerchant(t.rawDescriptor);
    if (payer.aggregate) continue;
    const fromBonusPayer = [...bonusPayers].some(
      (p) => payer.canonical === p || payer.canonical.startsWith(`${p} `),
    );
    if (!fromBonusPayer) continue;
    deposits.push({
      date: t.date as ISODate,
      kind: 'taken-back',
      depositCents: t.amountCents,
      paycheckCents: null,
      bonusCents: t.amountCents,
    });
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
