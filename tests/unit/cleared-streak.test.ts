/**
 * Card cleared-in-full streak (#254, AI plan §Later #17 streaks half).
 *
 * Every expected value is hand-verified in docs/EDGE_CASES.md §Habit Streaks
 * (C1–C9 + seed lock). The basis decisions each get a locking test: strict
 * due-date resolution, payments-by-due-date clearing (late full payment is NOT
 * cleared), $0 balances cleared by construction, gap months qualifying inside
 * the span, estimates invisible.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { buildSeedData } from '@/lib/seed/build';
import {
  computeCardClearedStreak,
  type ClearedStreakPayment,
  type ClearedStreakStatement,
} from '@/lib/engine/cards/cleared-streak';

const TODAY = isoDate('2026-06-10');

let seq = 0;
function stmt(
  overrides: Partial<ClearedStreakStatement> & { dueDate: string; statementBalanceCents: number },
): ClearedStreakStatement {
  return { id: `s-${String(++seq).padStart(3, '0')}`, accountId: 'card-a', ...overrides };
}
function payFor(s: ClearedStreakStatement, overrides: Partial<ClearedStreakPayment> = {}): ClearedStreakPayment {
  return { statementId: s.id, date: s.dueDate, amountCents: s.statementBalanceCents, ...overrides };
}

describe('computeCardClearedStreak (hand-verified C1–C9)', () => {
  it('C1: three consecutive cleared months across two cards → streak 3', () => {
    const a1 = stmt({ dueDate: '2026-03-15', statementBalanceCents: 80000 });
    const a2 = stmt({ dueDate: '2026-04-15', statementBalanceCents: 90000 });
    const a3 = stmt({ dueDate: '2026-05-15', statementBalanceCents: 100000 });
    const b1 = stmt({ dueDate: '2026-05-28', statementBalanceCents: 40000, accountId: 'card-b' });
    const statements = [a1, a2, a3, b1];
    const payments = statements.map((s) => payFor(s));
    const r = computeCardClearedStreak(statements, payments, TODAY);
    expect(r).toEqual({
      streakMonths: 3,
      latestMonth: '2026-05',
      formingThisMonth: false,
      cardsInStreak: 2,
      statementsInStreak: 4,
      brokeAt: null,
    });
  });

  it('C2: a statement not yet due (today 6/10, due 6/15) neither counts nor breaks', () => {
    const a1 = stmt({ dueDate: '2026-05-15', statementBalanceCents: 100000 });
    const future = stmt({ dueDate: '2026-06-15', statementBalanceCents: 271233 });
    const r = computeCardClearedStreak([a1, future], [payFor(a1)], TODAY);
    expect(r.streakMonths).toBe(1);
    expect(r.latestMonth).toBe('2026-05');
    expect(r.statementsInStreak).toBe(1);
  });

  it('C2b: due-date resolution is STRICT — a statement due today is still open', () => {
    const dueToday = stmt({ dueDate: '2026-06-10', statementBalanceCents: 50000 });
    const r = computeCardClearedStreak([dueToday], [], TODAY);
    expect(r.streakMonths).toBe(0);
    expect(r.latestMonth).toBeNull();
  });

  it('C3: a full payment dated AFTER the due date does not clear — streak 0, earlier cleared months unreachable', () => {
    const a1 = stmt({ dueDate: '2026-03-15', statementBalanceCents: 80000 });
    const a2 = stmt({ dueDate: '2026-04-15', statementBalanceCents: 90000 });
    const late = stmt({ dueDate: '2026-05-15', statementBalanceCents: 120000 });
    const payments = [payFor(a1), payFor(a2), payFor(late, { date: '2026-05-17' })];
    const r = computeCardClearedStreak([a1, a2, late], payments, TODAY);
    expect(r.streakMonths).toBe(0);
    expect(r.brokeAt).toBe('2026-05');
    expect(r.latestMonth).toBe('2026-05');
  });

  it('C4: two partial payments summing to the balance by the due date clear it', () => {
    const s = stmt({ dueDate: '2026-05-15', statementBalanceCents: 120000 });
    const payments = [
      payFor(s, { date: '2026-05-01', amountCents: 40000 }),
      payFor(s, { date: '2026-05-15', amountCents: 80000 }),
    ];
    const r = computeCardClearedStreak([s], payments, TODAY);
    expect(r.streakMonths).toBe(1);
    expect(r.brokeAt).toBeNull();
  });

  it('C5: a partial payment (100000 of 120000) fails the month', () => {
    const s = stmt({ dueDate: '2026-05-15', statementBalanceCents: 120000 });
    const r = computeCardClearedStreak([s], [payFor(s, { amountCents: 100000 })], TODAY);
    expect(r.streakMonths).toBe(0);
    expect(r.brokeAt).toBe('2026-05');
  });

  it('C6: a $0-balance statement with no payment rows is cleared', () => {
    const zero = stmt({ dueDate: '2026-05-15', statementBalanceCents: 0 });
    const r = computeCardClearedStreak([zero], [], TODAY);
    expect(r.streakMonths).toBe(1);
    expect(r.statementsInStreak).toBe(1);
  });

  it('C7: a gap month with nothing due qualifies inside the span; the walk floor is the earliest signal month', () => {
    const mar = stmt({ dueDate: '2026-03-15', statementBalanceCents: 80000 });
    const may = stmt({ dueDate: '2026-05-15', statementBalanceCents: 100000 });
    const r = computeCardClearedStreak([mar, may], [payFor(mar), payFor(may)], TODAY);
    // May ✓ + April (gap, qualifies) + March ✓ → 3; nothing below March is counted.
    expect(r.streakMonths).toBe(3);
    expect(r.statementsInStreak).toBe(2);
  });

  it('C8: an isEstimated statement is invisible — excluded before grouping', () => {
    const est = stmt({ dueDate: '2026-05-15', statementBalanceCents: 999999, isEstimated: true });
    const real = stmt({ dueDate: '2026-04-15', statementBalanceCents: 80000 });
    const r = computeCardClearedStreak([est, real], [payFor(real)], TODAY);
    expect(r.streakMonths).toBe(1);
    expect(r.latestMonth).toBe('2026-04');
  });

  it('C9: overpayment clears', () => {
    const s = stmt({ dueDate: '2026-05-15', statementBalanceCents: 120000 });
    const r = computeCardClearedStreak([s], [payFor(s, { amountCents: 130000 })], TODAY);
    expect(r.streakMonths).toBe(1);
  });

  it('empty input abstains: streak 0, latestMonth null, not forming', () => {
    expect(computeCardClearedStreak([], [], TODAY)).toEqual({
      streakMonths: 0,
      latestMonth: null,
      formingThisMonth: false,
      cardsInStreak: 0,
      statementsInStreak: 0,
      brokeAt: null,
    });
  });

  it('C10 (critic F2): a statement resolving inside the current PARTIAL month neither extends nor counts', () => {
    const may = stmt({ dueDate: '2026-05-15', statementBalanceCents: 100000 });
    const junePartial = stmt({ dueDate: '2026-06-05', statementBalanceCents: 50000 });
    const r = computeCardClearedStreak(
      [may, junePartial],
      [payFor(may), payFor(junePartial)],
      TODAY,
    );
    expect(r.streakMonths).toBe(1);
    expect(r.latestMonth).toBe('2026-05');
    expect(r.statementsInStreak).toBe(1);
  });

  it('C11 (critic F2): a MISSED current-partial-month statement does not break until the month completes', () => {
    const may = stmt({ dueDate: '2026-05-15', statementBalanceCents: 100000 });
    const juneMissed = stmt({ dueDate: '2026-06-05', statementBalanceCents: 50000 });
    const r = computeCardClearedStreak([may, juneMissed], [payFor(may)], TODAY);
    expect(r.streakMonths).toBe(1);
    expect(r.brokeAt).toBeNull();
    // …and once the month completes, the break shows (same data, July 1st)
    const later = computeCardClearedStreak([may, juneMissed], [payFor(may)], isoDate('2026-07-01'));
    expect(later.streakMonths).toBe(0);
    expect(later.brokeAt).toBe('2026-06');
  });

  it('C12 (critic F2): only-partial-month history is FORMING, not "no statement has come due"', () => {
    const junePartial = stmt({ dueDate: '2026-06-05', statementBalanceCents: 50000 });
    const r = computeCardClearedStreak([junePartial], [payFor(junePartial)], TODAY);
    expect(r).toEqual({
      streakMonths: 0,
      latestMonth: null,
      formingThisMonth: true,
      cardsInStreak: 0,
      statementsInStreak: 0,
      brokeAt: null,
    });
  });

  it('a payment against an unresolved (future) statement never leaks into a resolved one', () => {
    const may = stmt({ dueDate: '2026-05-15', statementBalanceCents: 100000 });
    const future = stmt({ dueDate: '2026-06-15', statementBalanceCents: 100000 });
    // full payment exists only for the FUTURE statement
    const r = computeCardClearedStreak([may, future], [payFor(future, { date: '2026-06-05' })], TODAY);
    expect(r.streakMonths).toBe(0);
    expect(r.brokeAt).toBe('2026-05');
  });
});

describe('demo seed lock (#254) — 17 cleared months across 4 cards', () => {
  it('SEED: default asOf → streak 17 through 2026-05, unbroken', () => {
    const seed = buildSeedData('2026-06-10');
    const r = computeCardClearedStreak(seed.statements, seed.cardPayments, TODAY);
    expect(r).toEqual({
      streakMonths: 17,
      latestMonth: '2026-05',
      formingThisMonth: false,
      cardsInStreak: 4,
      // sapphire 17 + platinum 17 + freedom 17 + store 8 resolved statements
      statementsInStreak: 59,
      brokeAt: null,
    });
  });
});
