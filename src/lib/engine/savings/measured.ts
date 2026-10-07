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
 * Money INTO a savings account counts only when it is traceable to new saving (critic
 * cycles 1 and 2, P1-1 / P1-A): its other half left one of the reader's linked checking or
 * savings accounts as a MOVE — both halves filed Transfer or Investment & Savings, or
 * flagged a transfer and filed nothing else, within the transfer detector's ±3 days — or
 * it came back from a linked investment account ("Money you put in" counts it taken out),
 * or it reverses money that left the same savings account (a return or reversal within two
 * weeks), or it is filed as income other than a retirement withdrawal (pay split straight
 * into savings). Anything else may be money saved long ago or money borrowed, so it is
 * listed and NOT counted. Money OUT of a savings account always counts as money out,
 * including a row the reader excluded from totals (critic cycle 1, P1-2: an exclusion says
 * "not my spending", and the money still left).
 * Both directions err low: the figure can understate saving, never flatter it.
 *
 * Money moved between a savings account and an investment account counts once: it
 * leaves one side (−) and arrives on the other (+). Money moved from checking to savings
 * is read on the savings side only. Money left in checking is not set aside until it is
 * moved.
 *
 * Months are #788's: the last 12 complete months and this month so far, never before
 * the first complete month the linked checking and savings records cover; each month
 * carries #788's missing-records accounts, because a month with no records is not a
 * month with no money. The average compares only complete months whose records are
 * complete.
 *
 * Pure: typed inputs in, a typed result out; no DB, no React, integer cents only.
 */
import { compareDates, daysBetween, isoDate, monthKey, type ISODate } from '@/lib/dates';
import { isIncomeCategoryId, isMoneyMoveCategoryId } from '@/lib/engine/categorize/categories';
import { BANK_RETURN_RE } from '@/lib/engine/categorize/brokerage-move';
import { REVERSAL_RE } from '@/lib/engine/spending-plan/bonus';
import {
  RETURN_WINDOW_DAYS,
  computeDepositHistory,
  liveDepositRows,
  type DepositHistory,
  type DepositHistoryInput,
  type DepositMonth,
  type LiveDepositRow,
} from '@/lib/engine/investments/deposits';

/** A savings account's own earnings: never money set aside from pay. */
export const EARNINGS_CATEGORY_IDS: ReadonlySet<string> = new Set(['interest-income', 'investment-income']);

/**
 * Words a bank's own interest or dividend credit carries. Read only on money coming in
 * that is not filed yet or filed plain Income (critic cycle 1, P2-1: the categorizer files
 * "INTEREST PAYMENT", not "INTEREST", "MONTHLY INTEREST", "INT PAID" or "DIV CREDIT").
 */
export const EARNINGS_WORD_RE = /\b(INTEREST|INT|DIVIDENDS?|DIV)\b/i;

/** Accounts a move into savings may come from and still be the reader's own saving. */
const CASH_ACCOUNT_TYPES: ReadonlySet<string> = new Set(['CHECKING', 'SAVINGS']);

/** The transfer detector's own window (`categorize/transfers.ts`: equal and opposite, ±3 days). */
export const MOVE_PAIR_WINDOW_DAYS = 3;

/** Words that make an earnings-worded row a move instead ("TRANSFER FROM INTEREST CHECKING"). */
const MOVE_WORD_RE = /\b(TRANSFER|XFER|TRNSFR|ZELLE|WIRE)\b/i;

/**
 * Income filings that are not new money set aside: a retirement withdrawal is the reader's
 * own savings coming back (critic cycle 2, P3-F); interest and dividends are earnings.
 */
const NOT_NEW_INCOME_IDS: ReadonlySet<string> = new Set(['retirement-income', 'interest-income', 'investment-income']);

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
  /** Net money into the linked savings accounts (signed), earnings and untraced money in left out. */
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
  /** Money into savings that no linked account, investment or income filing explains — left out. */
  untracedInCents: number;
  /** The savings-account rows behind `savingsNetCents`, oldest first. */
  savingsRows: readonly SavingsRowView[];
  /** The rows behind `earningsCents`. */
  earningsRows: readonly SavingsRowView[];
  /** The rows behind `untracedInCents`. */
  untracedRows: readonly SavingsRowView[];
  /** How many #788 movements are behind `investmentsNetCents`. */
  investmentMovements: number;
  /**
   * Rows "Money you put in" lists this month under "Not counted", less the ones this
   * measure counts as a move into or out of savings (critic cycle 1, P2-5).
   */
  uncountedInvestmentRows: number;
  /** Linked checking or savings accounts whose records do not cover all of this month (#788). */
  missingRecordsFrom: readonly string[];
  /** The same accounts, with where their records start or end (#788). */
  missingRecordsDetail: DepositMonth['missingRecordsDetail'];
}

/**
 * The plan's savings line, and the part of it this measure can see (critic cycle 1, P1-3):
 * a debt-free goal's monthly contribution is an extra payment to a debt, which no savings
 * or investment account shows. `comparedCents` is the line recomputed without those
 * contributions; equal to `plannedSavingsCents` when there are none.
 */
export interface SavingsPlanLine {
  /** `SpendingPlan.plannedSavingsCents`. */
  plannedSavingsCents: number;
  /** Monthly contributions of debt-free goals inside the plan's goal contributions. */
  debtPaydownCents: number;
  /** The line this measure compares with. */
  comparedCents: number;
}

/**
 * The plan's savings line less its extra debt payments (critic cycle 2, P1-B). The plan
 * reserves ONE pool — max(goal contributions, savings-% target), "never added together" —
 * and a debt-free goal's payment comes out of that pool whichever side won (Ask's
 * debt-free answer says so). What reaches a savings or investment account is the rest:
 * planned − debt, i.e. max(other goals, target − debt). Debt is never more than the
 * line (goal contributions are inside it), so the result is never below zero.
 */
export function savingsPlanLine(input: { plannedSavingsCents: number; debtPaydownCents: number }): SavingsPlanLine {
  const debt = Math.max(0, Math.min(input.debtPaydownCents, input.plannedSavingsCents));
  return { plannedSavingsCents: input.plannedSavingsCents, debtPaydownCents: debt, comparedCents: input.plannedSavingsCents - debt };
}

/** The monthly contributions of debt-free goals (`Goal.kind === 'debt_free'`) — extra debt payments. */
export function debtPaydownContributionsCents(goals: readonly { kind: string | null; monthlyContributionCents: number | null }[]): number {
  return goals.filter((g) => g.kind === 'debt_free').reduce((sum, g) => sum + (g.monthlyContributionCents ?? 0), 0);
}

export interface MeasuredSavings {
  hasSavingsAccounts: boolean;
  hasInvestmentAccounts: boolean;
  /** At least one live checking or savings account. */
  hasSourceAccounts: boolean;
  /** The first complete month the linked checking and savings records cover (#788); null = none. */
  recordsFromMonth: string | null;
  /** The plan line this measure compares with (`SavingsPlanLine.comparedCents`). */
  plannedSavingsCents: number;
  /** The plan's whole savings line and the debt-free part this measure can't see. */
  plan: SavingsPlanLine;
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
  /** This month's planned savings line — a bare figure (no debt-free goals), or the full line. */
  plan: number | SavingsPlanLine;
}

const byDateThenId = (a: SavingsRowView, b: SavingsRowView) =>
  compareDates(a.date, b.date) || (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0);

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function roundedAverage(total: number, n: number): number {
  const q = Math.round(Math.abs(total) / n);
  return total < 0 && q > 0 ? -q : q;
}

/**
 * A row this measure reads on a savings account, or as the other half of a move: posted,
 * not a split parent, not $0, not after today. An exclusion from totals is NOT applied —
 * money that left still left (critic cycle 1, P1-2); see `counted` below for money in.
 */
function readable(x: LiveDepositRow, today: ISODate): boolean {
  return x.row.status === 'POSTED' && !x.row.isSplitParent && x.row.amountCents !== 0 && compareDates(x.date, today) <= 0;
}

const isUnfiled = (categoryId: string | null | undefined) => !categoryId || categoryId === 'uncategorized';

function isEarnings(x: LiveDepositRow): boolean {
  const c = x.row.categoryId;
  if (c && EARNINGS_CATEGORY_IDS.has(c)) return true;
  const words = x.row.rawDescriptor ?? '';
  // A move worded with "INTEREST" ("TRANSFER FROM INTEREST CHECKING") is a move (critic cycle 2, P3-A).
  if (x.row.isTransfer === true || MOVE_WORD_RE.test(words)) return false;
  return x.row.amountCents > 0 && (isUnfiled(c) || c === 'income') && EARNINGS_WORD_RE.test(words);
}

/**
 * A half of a move between the reader's own accounts, by its own filing (critic cycle 2,
 * P1-A): filed Transfer or Investment & Savings, or flagged a transfer and filed nothing
 * else. A row filed to anything else — daycare, a card payment, a loan — is never one.
 */
function isMoveLeg(x: LiveDepositRow): boolean {
  const c = x.row.categoryId;
  return isMoneyMoveCategoryId(c) || (x.row.isTransfer === true && isUnfiled(c));
}

/**
 * One-to-one pairing of equal, opposite move halves (`isMoveLeg`) on two different linked
 * checking or savings accounts within `MOVE_PAIR_WINDOW_DAYS`, at least one leg on a
 * savings account — closest dates first, then earlier dates and ids. Returns every paired
 * row id.
 */
function pairCashMoves(rows: readonly LiveDepositRow[]): Set<string> {
  const byAmount = new Map<number, LiveDepositRow[]>();
  for (const x of rows) {
    const k = Math.abs(x.row.amountCents);
    const list = byAmount.get(k) ?? [];
    list.push(x);
    byAmount.set(k, list);
  }
  const edges: { out: LiveDepositRow; inn: LiveDepositRow; gap: number }[] = [];
  for (const group of byAmount.values()) {
    for (const out of group) {
      if (out.row.amountCents >= 0) continue;
      for (const inn of group) {
        if (inn.row.amountCents <= 0 || inn.account.id === out.account.id) continue;
        if (out.account.type !== 'SAVINGS' && inn.account.type !== 'SAVINGS') continue;
        const gap = Math.abs(daysBetween(out.date, inn.date));
        if (gap <= MOVE_PAIR_WINDOW_DAYS) edges.push({ out, inn, gap });
      }
    }
  }
  edges.sort(
    (a, b) => a.gap - b.gap || compareDates(a.out.date, b.out.date) || byId(a.out.row.id, b.out.row.id) || byId(a.inn.row.id, b.inn.row.id),
  );
  const paired = new Set<string>();
  for (const { out, inn } of edges) {
    if (paired.has(out.row.id) || paired.has(inn.row.id)) continue;
    paired.add(out.row.id);
    paired.add(inn.row.id);
  }
  return paired;
}

/**
 * Money coming back to the savings account it left (critic cycle 2, P2-A): an inflow worded
 * as a return or reversal, equal to an outflow on the SAME account up to two weeks before
 * it (#788's return window), one to one, closest first. Returns the inflows' ids.
 */
function pairReturns(rows: readonly LiveDepositRow[]): Set<string> {
  const outs = rows.filter((x) => x.row.amountCents < 0);
  const ins = rows
    .filter((x) => x.row.amountCents > 0 && (BANK_RETURN_RE.test(x.row.rawDescriptor ?? '') || REVERSAL_RE.test(x.row.rawDescriptor ?? '')))
    .sort((a, b) => compareDates(a.date, b.date) || byId(a.row.id, b.row.id));
  const used = new Set<string>();
  const out = new Set<string>();
  for (const inn of ins) {
    let best: LiveDepositRow | null = null;
    let bestGap = Infinity;
    for (const o of outs) {
      if (used.has(o.row.id) || o.account.id !== inn.account.id || o.row.amountCents !== -inn.row.amountCents) continue;
      const gap = daysBetween(o.date, inn.date);
      if (gap < 0 || gap > RETURN_WINDOW_DAYS) continue;
      if (gap < bestGap || (gap === bestGap && best && byId(o.row.id, best.row.id) < 0)) {
        best = o;
        bestGap = gap;
      }
    }
    if (best) {
      used.add(best.row.id);
      out.add(inn.row.id);
    }
  }
  return out;
}

export function measureSavings(input: MeasuredSavingsInput): MeasuredSavings {
  const today = isoDate(input.deposit.today);
  const deposits: DepositHistory = computeDepositHistory(input.deposit);
  const accounts = input.deposit.accounts;
  const plan: SavingsPlanLine =
    typeof input.plan === 'number' ? { plannedSavingsCents: input.plan, debtPaydownCents: 0, comparedCents: input.plan } : input.plan;

  // The rows #788 reads (terminal successor, one copy per real movement on a handover day).
  const live = liveDepositRows(input.deposit).filter((x) => readable(x, today));
  /** Savings rows #788 counts as money taken back out of a linked investment account. */
  const fromInvestments = new Set<string>();
  for (const m of deposits.months) for (const e of m.events) if (e.direction === 'out') fromInvestments.add(e.rowId);
  // Only move halves pair (critic cycle 2, P1-A). A checking row "Money you put in" counts
  // cannot also vouch for a savings arrival: #788 pairs the same kinds of rows over a wider
  // window first and stops counting a deposit whose other half landed in the reader's own
  // account ('landed-in-your-account').
  const paired = pairCashMoves(live.filter((x) => CASH_ACCOUNT_TYPES.has(x.account.type) && isMoveLeg(x)));
  const returned = pairReturns(live.filter((x) => x.account.type === 'SAVINGS' && !paired.has(x.row.id)));

  type Slot = MeasuredMonth & { savingsRows: SavingsRowView[]; earningsRows: SavingsRowView[]; untracedRows: SavingsRowView[] };
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
      untracedInCents: 0,
      savingsRows: [],
      earningsRows: [],
      untracedRows: [],
      investmentMovements: m.events.length,
      // A row #788 couldn't place that this measure reads as a move between the reader's
      // own checking and savings is not uncounted here (critic cycle 1, P2-5).
      uncountedInvestmentRows: deposits.uncounted.filter((u) => u.month === m.month && !paired.has(u.rowId)).length,
      missingRecordsFrom: m.missingRecordsFrom,
      missingRecordsDetail: m.missingRecordsDetail,
    });
  }

  for (const x of live) {
    if (x.account.type !== 'SAVINGS') continue;
    const slot = slots.get(monthKey(x.date));
    if (!slot) continue;
    const view: SavingsRowView = {
      rowId: x.row.id,
      date: x.date,
      accountLabel: x.account.label,
      descriptor: x.row.rawDescriptor,
      cents: x.row.amountCents,
    };
    if (isEarnings(x)) {
      slot.earningsCents += x.row.amountCents;
      slot.earningsRows.push(view);
      continue;
    }
    if (x.row.amountCents > 0) {
      // An exclusion still keeps money IN out of the figure (it errs low).
      if (x.row.excludeFromTotals === true) continue;
      const c = x.row.categoryId;
      const traced =
        paired.has(x.row.id) ||
        fromInvestments.has(x.row.id) ||
        returned.has(x.row.id) ||
        (!!c && isIncomeCategoryId(c) && !NOT_NEW_INCOME_IDS.has(c));
      if (!traced) {
        slot.untracedInCents += x.row.amountCents;
        slot.untracedRows.push(view);
        continue;
      }
    }
    slot.savingsNetCents += x.row.amountCents;
    slot.savingsRows.push(view);
  }

  const months = [...slots.values()].map((s) => {
    s.savingsRows.sort(byDateThenId);
    s.earningsRows.sort(byDateThenId);
    s.untracedRows.sort(byDateThenId);
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
    plannedSavingsCents: plan.comparedCents,
    plan,
    months,
    // #788's months always run through this month, so the last one IS this month so far.
    thisMonth: months.at(-1) ?? null,
    average,
    monthsMissingRecords: complete.filter((m) => m.missingRecordsFrom.length > 0).map((m) => m.month),
  };
}
