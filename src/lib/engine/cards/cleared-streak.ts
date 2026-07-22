/**
 * Card cleared-in-full streak (AI plan §Later #17 streaks half, DECISIONS #254).
 *
 * Pure retrospective walk over statement history — no persistence, no LLM, the
 * savings-rate streak (#205) convention: a streak is a function of history.
 *
 * Basis (stated inline in the coach copy, hand math in EDGE_CASES §Habit Streaks):
 *  - a statement is RESOLVED once its due date is strictly past (`dueDate < today`)
 *    and it is not an estimate; on the due date itself it is still open, so an
 *    autopay dated that day has not "missed";
 *  - a resolved statement is CLEARED when its balance is ≤ 0 or the sum of its
 *    payments DATED ON OR BEFORE the due date covers the balance — a late full
 *    payment is not cleared-by-due-date (that is the interest boundary);
 *  - a month qualifies when EVERY resolved statement due that month cleared; a
 *    month with nothing due qualifies (nothing due = nothing missed) but only
 *    counts inside the walk span;
 *  - the walk covers FULL months only (critic #254 F2): statements resolving
 *    inside the current partial month neither extend nor break the streak
 *    until the month completes — the same lag-honest basis as the sibling
 *    creep walk (#252 convention). Overdue-now urgency belongs to the
 *    reminders/cash-needed surfaces, not a habit streak.
 *  - the walk runs calendar months descending from the latest FULL month with
 *    a resolved statement down to the earliest such month, stopping at the
 *    first month with an uncleared resolved statement.
 */
import { addMonthsToMonthKey, compareDates, isoDate, monthKey, type ISODate } from '@/lib/dates';

export interface ClearedStreakStatement {
  id: string;
  accountId: string;
  dueDate: string; // YYYY-MM-DD
  statementBalanceCents: number;
  isEstimated?: boolean;
}

export interface ClearedStreakPayment {
  statementId: string;
  date: string; // YYYY-MM-DD
  amountCents: number; // positive = amount paid
}

export interface CardClearedStreakResult {
  /** Consecutive qualifying calendar months ending at latestMonth; 0 when the latest signal month fails. */
  streakMonths: number;
  /** Most recent FULL YYYY-MM containing a resolved statement; null when none exist (UI abstains or shows forming). */
  latestMonth: string | null;
  /**
   * True when the only resolved statements sit inside the current PARTIAL
   * month (a first cycle completing mid-month): latestMonth is null but "no
   * statement has come due yet" would be false — the UI renders a forming
   * line instead (critic #254 F2).
   */
  formingThisMonth: boolean;
  /** Distinct card accounts among the resolved statements inside the streak span. */
  cardsInStreak: number;
  /** Resolved statements inside the streak span. */
  statementsInStreak: number;
  /** The month that stopped the walk, or null when the walk exhausted history unbroken. */
  brokeAt: string | null;
}

const prevYm = (month: string) => addMonthsToMonthKey(month, -1);

export function computeCardClearedStreak(
  statements: readonly ClearedStreakStatement[],
  payments: readonly ClearedStreakPayment[],
  today: ISODate,
): CardClearedStreakResult {
  const paidByDueDate = new Map<string, number>();
  const dueDateById = new Map<string, string>();

  const currentYm = monthKey(today);
  const resolvedAny = statements.filter(
    (s) => s.isEstimated !== true && compareDates(isoDate(s.dueDate), today) < 0,
  );
  // Full months only (critic #254 F2): a statement resolving inside the
  // current partial month waits for the month to complete.
  const resolved = resolvedAny.filter((s) => monthKey(s.dueDate) < currentYm);
  const formingThisMonth = resolved.length === 0 && resolvedAny.length > 0;
  for (const s of resolved) dueDateById.set(s.id, s.dueDate);
  for (const p of payments) {
    const due = dueDateById.get(p.statementId);
    if (due === undefined) continue;
    if (compareDates(isoDate(p.date), isoDate(due)) > 0) continue; // late: not cleared-by-due-date
    paidByDueDate.set(p.statementId, (paidByDueDate.get(p.statementId) ?? 0) + p.amountCents);
  }

  const cleared = (s: ClearedStreakStatement): boolean =>
    s.statementBalanceCents <= 0 || (paidByDueDate.get(s.id) ?? 0) >= s.statementBalanceCents;

  const byMonth = new Map<string, ClearedStreakStatement[]>();
  for (const s of resolved) {
    const m = monthKey(s.dueDate);
    const list = byMonth.get(m) ?? [];
    list.push(s);
    byMonth.set(m, list);
  }
  if (byMonth.size === 0) {
    return {
      streakMonths: 0,
      latestMonth: null,
      formingThisMonth,
      cardsInStreak: 0,
      statementsInStreak: 0,
      brokeAt: null,
    };
  }

  const monthsWithSignal = [...byMonth.keys()].sort();
  const latestMonth = monthsWithSignal[monthsWithSignal.length - 1];
  const earliestMonth = monthsWithSignal[0];

  let streakMonths = 0;
  let brokeAt: string | null = null;
  const cardsInStreak = new Set<string>();
  let statementsInStreak = 0;

  for (let m = latestMonth; m >= earliestMonth; m = prevYm(m)) {
    const due = byMonth.get(m) ?? [];
    if (due.some((s) => !cleared(s))) {
      brokeAt = m;
      break;
    }
    streakMonths++;
    for (const s of due) {
      cardsInStreak.add(s.accountId);
      statementsInStreak++;
    }
  }

  return {
    streakMonths,
    latestMonth,
    formingThisMonth: false,
    cardsInStreak: cardsInStreak.size,
    statementsInStreak,
    brokeAt,
  };
}
