/**
 * Assembles a CashNeededInput snapshot from data-layer rows (Prisma rows or
 * the pure seed dataset — both satisfy these structural types). Pure: no I/O.
 *
 * Rules:
 *  - A card's CURRENT statement is its most recent statement whose issuer due
 *    date is on/after `today`. If none exists, the statement hasn't generated
 *    yet → estimate path (next close/due derived from the card's cycle days).
 *  - Pending transactions on the payment account feed the projection once.
 *  - Scheduled rows are expanded into dated occurrences within [today, today+60d].
 */

import { type Cents, cents } from '@/lib/money';
import { type ISODate, addDays, addMonthsClamped, compareDates, daysInMonth, isoDate } from '@/lib/dates';
import { isLiabilityType } from '@/lib/engine/transactions/query';
import type { CardSnapshot, CashNeededInput, PendingTx, Scenario, ScheduledItem } from './types';

export interface AccountLike {
  id: string;
  name: string;
  type: string;
  currentBalanceCents: number;
  aprBps: number | null;
  dueDayOfMonth: number | null;
  cycleCloseDayOfMonth: number | null;
}
export interface AutopayLike {
  accountId: string;
  mode: string;
  fixedAmountCents: number | null;
}
export interface StatementLike {
  id: string;
  accountId: string;
  cycleEnd: string;
  dueDate: string;
  statementBalanceCents: number;
  minimumPaymentCents: number;
}
export interface CardPaymentLike {
  statementId: string;
  date: string;
  amountCents: number;
}
export interface TransactionLike {
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  status: string;
  isTransfer: boolean;
  /** Container row left behind by a split — its children carry the amounts. */
  isSplitParent?: boolean;
}
export interface ScheduledLike {
  accountId: string;
  description: string;
  amountCents: number;
  nextDate: string;
  cadence: string | null;
}

export interface AssembleParams {
  today: ISODate;
  scenario: Scenario;
  paymentAccountId: string;
  accounts: AccountLike[];
  autopays: AutopayLike[];
  statements: StatementLike[];
  cardPayments: CardPaymentLike[];
  transactions: TransactionLike[];
  scheduled: ScheduledLike[];
  holidayTable: ISODate[];
  /** Projection window for expanding scheduled cadences. */
  horizonDays?: number;
}

/** Next calendar date with the given day-of-month, on/after `from` (clamped to month length). */
function nextDayOfMonth(day: number, from: ISODate): ISODate {
  const y = +from.slice(0, 4);
  const m = +from.slice(5, 7);
  const clamped = Math.min(day, daysInMonth(y, m));
  const candidate = isoDate(`${from.slice(0, 7)}-${String(clamped).padStart(2, '0')}`);
  if (compareDates(candidate, from) >= 0) return candidate;
  const nm = addMonthsClamped(isoDate(`${from.slice(0, 7)}-01`), 1);
  const ny = +nm.slice(0, 4);
  const nmo = +nm.slice(5, 7);
  return isoDate(`${nm.slice(0, 7)}-${String(Math.min(day, daysInMonth(ny, nmo))).padStart(2, '0')}`);
}

export function assembleCashNeededInput(p: AssembleParams): CashNeededInput {
  const horizon = addDays(p.today, p.horizonDays ?? 60);
  const paymentAccount = p.accounts.find((a) => a.id === p.paymentAccountId);
  if (!paymentAccount) throw new Error(`assemble: payment account ${p.paymentAccountId} not found`);

  // Split parents are containers — counting them AND their children would
  // double-apply the amount (Hostile Critic finding F1, Phase 2 cycle 2).
  const pending: PendingTx[] = p.transactions
    .filter((t) => t.accountId === p.paymentAccountId && t.status === 'PENDING' && !t.isSplitParent)
    .map((t) => ({ amountCents: cents(t.amountCents), description: t.rawDescriptor }));

  const autopayByAccount = new Map(p.autopays.map((a) => [a.accountId, a]));

  const cards: CardSnapshot[] = p.accounts
    .filter((a) => a.type === 'CREDIT')
    .map((card) => {
      const own = p.statements
        .filter((s) => s.accountId === card.id)
        .sort((a, b) => compareDates(isoDate(b.cycleEnd), isoDate(a.cycleEnd)));
      const paidAgainst = (statementId: string) =>
        p.cardPayments
          .filter((cp) => cp.statementId === statementId)
          .reduce((sum, cp) => sum + cp.amountCents, 0);
      // Current obligation = the most recent statement that is either not yet
      // due OR still carries an unpaid remainder (delinquent statements must
      // NEVER vanish into the estimate path — Hostile Critic finding P1-2).
      const current =
        own.find(
          (s) =>
            compareDates(isoDate(s.dueDate), p.today) >= 0 ||
            s.statementBalanceCents - paidAgainst(s.id) > 0,
        ) ?? null;

      let paymentsApplied = 0;
      let postCloseCredit = 0;
      if (current) {
        paymentsApplied = paidAgainst(current.id);
        postCloseCredit = p.transactions
          .filter(
            (t) =>
              t.accountId === card.id &&
              t.status === 'POSTED' &&
              !t.isTransfer &&
              !t.isSplitParent &&
              t.amountCents > 0 &&
              compareDates(isoDate(t.date), isoDate(current.cycleEnd)) > 0,
          )
          .reduce((sum, t) => sum + t.amountCents, 0);
      }

      const autopayRow = autopayByAccount.get(card.id);
      const autopay = autopayRow
        ? {
            mode: autopayRow.mode as 'STATEMENT_BALANCE' | 'MINIMUM' | 'FIXED_AMOUNT',
            fixedAmountCents:
              autopayRow.fixedAmountCents !== null ? cents(autopayRow.fixedAmountCents) : undefined,
          }
        : null;

      let nextCycleCloseDate: ISODate | undefined;
      let nextDueDate: ISODate | undefined;
      if (!current && card.cycleCloseDayOfMonth !== null && card.dueDayOfMonth !== null) {
        nextCycleCloseDate = nextDayOfMonth(card.cycleCloseDayOfMonth, p.today);
        nextDueDate = nextDayOfMonth(card.dueDayOfMonth, addDays(nextCycleCloseDate, 1));
      }

      return {
        id: card.id,
        name: card.name,
        aprBps: card.aprBps ?? 0,
        autopay,
        statement: current
          ? {
              statementBalanceCents: cents(current.statementBalanceCents),
              minimumPaymentCents: cents(current.minimumPaymentCents),
              dueDate: isoDate(current.dueDate),
              cycleEnd: isoDate(current.cycleEnd),
            }
          : null,
        currentBalanceCents: cents(card.currentBalanceCents),
        nextCycleCloseDate,
        nextDueDate,
        paymentsAppliedCents: cents(paymentsApplied),
        postCloseCreditCents: postCloseCredit > 0 ? cents(postCloseCredit) : undefined,
      };
    });

  const scheduled: ScheduledItem[] = [];
  for (const row of p.scheduled) {
    if (row.accountId !== p.paymentAccountId) continue;
    const start = isoDate(row.nextDate);
    if (row.cadence === 'MONTHLY') {
      for (let i = 0; ; i++) {
        const occ = addMonthsClamped(start, i);
        if (compareDates(occ, horizon) > 0) break;
        if (compareDates(occ, p.today) >= 0) {
          scheduled.push({ date: occ, amountCents: cents(row.amountCents), description: row.description });
        }
      }
    } else if (row.cadence === 'WEEKLY' || row.cadence === 'BIWEEKLY') {
      const step = row.cadence === 'WEEKLY' ? 7 : 14;
      for (let occ = start; compareDates(occ, horizon) <= 0; occ = addDays(occ, step)) {
        if (compareDates(occ, p.today) >= 0) {
          scheduled.push({ date: occ, amountCents: cents(row.amountCents), description: row.description });
        }
      }
    } else if (compareDates(start, p.today) >= 0 && compareDates(start, horizon) <= 0) {
      scheduled.push({ date: start, amountCents: cents(row.amountCents), description: row.description });
    }
  }

  return {
    today: p.today,
    paymentAccount: {
      name: paymentAccount.name,
      balanceCents: cents(paymentAccount.currentBalanceCents),
      pending,
    },
    cards,
    scheduled,
    scenario: p.scenario,
    holidayTable: p.holidayTable,
  };
}

/** Net worth from account rows: assets − liabilities (sign decided by type). */
export function netWorthCents(accounts: { type: string; currentBalanceCents: number }[]): Cents {
  let total = 0;
  for (const a of accounts) {
    total += isLiabilityType(a.type) ? -a.currentBalanceCents : a.currentBalanceCents;
  }
  return cents(total);
}
