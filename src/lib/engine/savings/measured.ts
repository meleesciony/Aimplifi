/**
 * Money you set aside — measured savings against the plan's savings line (DECISIONS #790).
 *
 * The guilt-free plan sets aside a savings line from pay (`plannedSavingsCents`: the
 * larger of goal contributions and the savings-% target). Until now nothing checked it
 * against what the reader actually did. This engine measures it from the bank's own rows,
 * month by month, on one rule:
 *
 *   set aside = money into the reader's linked SAVINGS accounts, net of what came out,
 *               read from those accounts' own rows — interest and dividends left out
 *               (an account's earnings are not money set aside from pay)
 *             + money into the reader's linked INVESTMENT accounts, net of what came
 *               back, exactly as "Money you put in" counts it (#788: the bank-side rows
 *               it can place on a linked investment account, every rule of that engine)
 *
 * Money moved between a savings account and an investment account counts once: it
 * leaves one side (−) and arrives on the other (+). Money moved from checking to savings
 * is read on the savings side only. Money left in checking is not set aside until it is
 * moved. Money that leaves a savings account for an account the reader has not linked
 * counts as money out — the measure errs low, never high (a savings figure that flatters
 * is the too-generous direction).
 *
 * Months are #788's: the last 12 complete months and this month so far, never before
 * the first complete month the linked checking and savings records cover; each month
 * carries #788's missing-records accounts, because a month with no records is not a
 * month with no money. The average compares only complete months whose records are
 * complete.
 *
 * Pure: typed inputs in, a typed result out; no DB, no React, integer cents only.
 */
import { compareDates, isoDate, monthKey, type ISODate } from '@/lib/dates';
import {
  computeDepositHistory,
  countableDepositRow,
  liveDepositRows,
  type DepositHistory,
  type DepositHistoryInput,
  type DepositMonth,
} from '@/lib/engine/investments/deposits';

/** A savings account's own earnings: never money set aside from pay. */
export const EARNINGS_CATEGORY_IDS: ReadonlySet<string> = new Set(['interest-income', 'investment-income']);

export interface SavingsRowView {
  rowId: string;
  date: ISODate;
  accountLabel: string;
  descriptor: string;
  /** Signed: money in is positive, money out negative. */
  cents: number;
}

export interface MeasuredMonth {
  month: string;
  /** True for this month (so far). */
  partial: boolean;
  /** Net money into the linked savings accounts (signed), earnings left out. */
  savingsNetCents: number;
  /** #788's money put into linked investment accounts this month. */
  putInCents: number;
  /** #788's money taken back out of them this month. */
  takenOutCents: number;
  /** putIn − takenOut. */
  investmentsNetCents: number;
  /** savingsNet + investmentsNet. */
  totalCents: number;
  /** Interest and dividends on the savings accounts (signed), left out of every figure. */
  earningsCents: number;
  /** The savings-account rows behind `savingsNetCents`, oldest first. */
  savingsRows: readonly SavingsRowView[];
  /** The rows behind `earningsCents`. */
  earningsRows: readonly SavingsRowView[];
  /** How many #788 movements are behind `investmentsNetCents`. */
  investmentMovements: number;
  /** Rows "Money you put in" lists this month under "Not counted". */
  uncountedInvestmentRows: number;
  /** Linked checking or savings accounts whose records do not cover all of this month (#788). */
  missingRecordsFrom: readonly string[];
  /** The same accounts, with where their records start or end (#788). */
  missingRecordsDetail: DepositMonth['missingRecordsDetail'];
}

export interface MeasuredSavings {
  hasSavingsAccounts: boolean;
  hasInvestmentAccounts: boolean;
  /** At least one live checking or savings account. */
  hasSourceAccounts: boolean;
  /** The first complete month the linked checking and savings records cover (#788); null = none. */
  recordsFromMonth: string | null;
  plannedSavingsCents: number;
  /** Oldest → newest; the last one is this month so far. Empty when no month is covered. */
  months: readonly MeasuredMonth[];
  thisMonth: MeasuredMonth | null;
  /**
   * The complete months shown whose records are complete, averaged. Null when there is none.
   * Integer cents, rounded half away from zero.
   */
  average: { fromMonth: string; toMonth: string; months: number; totalCents: number; averageCents: number } | null;
  /** Complete months shown that the average leaves out, because their records are incomplete. */
  monthsMissingRecords: readonly string[];
}

export interface MeasuredSavingsInput {
  /** The same unscoped inputs "Money you put in" reads (`loadDepositInputs`). */
  deposit: Omit<DepositHistoryInput, 'scopeAccountId'>;
  /** This month's planned savings line (`SpendingPlan.plannedSavingsCents`). */
  plannedSavingsCents: number;
}

const byDateThenId = (a: SavingsRowView, b: SavingsRowView) =>
  compareDates(a.date, b.date) || (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0);

function roundedAverage(total: number, n: number): number {
  const q = Math.round(Math.abs(total) / n);
  return total < 0 && q > 0 ? -q : q;
}

export function measureSavings(input: MeasuredSavingsInput): MeasuredSavings {
  const today = isoDate(input.deposit.today);
  const deposits: DepositHistory = computeDepositHistory(input.deposit);
  const accounts = input.deposit.accounts;

  type Slot = MeasuredMonth & { savingsRows: SavingsRowView[]; earningsRows: SavingsRowView[] };
  const slots = new Map<string, Slot>();
  for (const m of deposits.months) {
    slots.set(m.month, {
      month: m.month,
      partial: m.partial,
      savingsNetCents: 0,
      putInCents: m.putInCents,
      takenOutCents: m.takenOutCents,
      investmentsNetCents: m.putInCents - m.takenOutCents,
      totalCents: 0,
      earningsCents: 0,
      savingsRows: [],
      earningsRows: [],
      investmentMovements: m.events.length,
      uncountedInvestmentRows: m.uncountedCount,
      missingRecordsFrom: m.missingRecordsFrom,
      missingRecordsDetail: m.missingRecordsDetail,
    });
  }

  // The savings side: the same live rows #788 reads (terminal successor, one copy per real
  // movement on a handover day), on SAVINGS accounts, by the same countable rule.
  for (const x of liveDepositRows(input.deposit)) {
    if (x.account.type !== 'SAVINGS') continue;
    if (!countableDepositRow(x, today)) continue;
    const slot = slots.get(monthKey(x.date));
    if (!slot) continue;
    const view: SavingsRowView = {
      rowId: x.row.id,
      date: x.date,
      accountLabel: x.account.label,
      descriptor: x.row.rawDescriptor,
      cents: x.row.amountCents,
    };
    if (x.row.categoryId && EARNINGS_CATEGORY_IDS.has(x.row.categoryId)) {
      slot.earningsCents += x.row.amountCents;
      slot.earningsRows.push(view);
      continue;
    }
    slot.savingsNetCents += x.row.amountCents;
    slot.savingsRows.push(view);
  }

  const months = [...slots.values()].map((s) => {
    s.savingsRows.sort(byDateThenId);
    s.earningsRows.sort(byDateThenId);
    s.totalCents = s.savingsNetCents + s.investmentsNetCents;
    return s as MeasuredMonth;
  });

  const complete = months.filter((m) => !m.partial);
  const averaged = complete.filter((m) => m.missingRecordsFrom.length === 0);
  const totalCents = averaged.reduce((sum, m) => sum + m.totalCents, 0);
  const average =
    averaged.length === 0
      ? null
      : {
          fromMonth: averaged[0]!.month,
          toMonth: averaged[averaged.length - 1]!.month,
          months: averaged.length,
          totalCents,
          averageCents: roundedAverage(totalCents, averaged.length),
        };

  return {
    hasSavingsAccounts: accounts.some((a) => a.type === 'SAVINGS'),
    hasInvestmentAccounts: deposits.hasInvestmentAccounts,
    hasSourceAccounts: deposits.hasSourceAccounts,
    recordsFromMonth: deposits.recordsFromMonth,
    plannedSavingsCents: input.plannedSavingsCents,
    months,
    // #788's months always run through this month, so the last one IS this month so far.
    thisMonth: months.at(-1) ?? null,
    average,
    monthsMissingRecords: complete.filter((m) => m.missingRecordsFrom.length > 0).map((m) => m.month),
  };
}
