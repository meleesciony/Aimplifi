/**
 * Reports engine known-answer tests (DECISIONS #67).
 */
import { describe, expect, it } from 'vitest';
import { spendingByCategory, type ReportTxn } from '@/lib/engine/reports/reports';
import { detectTransfers } from '@/lib/engine/categorize/transfers';

const T = (date: string, amountCents: number, categoryId: string | null, extra: Partial<ReportTxn> = {}): ReportTxn => ({
  date,
  amountCents,
  categoryId,
  ...extra,
});

describe('spendingByCategory', () => {
  const txns: ReportTxn[] = [
    T('2026-06-02', -5000, 'dining'),
    T('2026-06-05', -3000, 'dining'),
    T('2026-06-07', -8000, 'groceries'),
    T('2026-06-09', 2000, 'dining'), // refund nets down dining
    T('2026-06-10', 400000, 'income'), // income excluded
    T('2026-06-11', -10000, 'transfer'), // transfer excluded
    T('2026-06-12', -1000, 'dining', { isSplitParent: true }), // split parent excluded
    T('2026-05-30', -9999, 'dining'), // out of range (May)
  ];

  it('sums expenses by category, nets refunds, excludes income/transfer/splits/out-of-range', () => {
    const r = spendingByCategory(txns, { fromYm: '2026-06', toYm: '2026-06' });
    const dining = r.byCategory.find((c) => c.categoryId === 'dining');
    expect(dining?.amountCents).toBe(6000); // 5000 + 3000 − 2000 refund
    const groceries = r.byCategory.find((c) => c.categoryId === 'groceries');
    expect(groceries?.amountCents).toBe(8000);
    expect(r.byCategory.find((c) => c.categoryId === 'income')).toBeUndefined();
    expect(r.byCategory.find((c) => c.categoryId === 'transfer')).toBeUndefined();
    expect(r.totalCents).toBe(14000);
  });

  it('sorts categories descending and rolls up to parent groups', () => {
    const r = spendingByCategory(txns, { fromYm: '2026-06', toYm: '2026-06' });
    expect(r.byCategory[0].categoryId).toBe('groceries'); // 8000 > 6000
    const foodGroup = r.byGroup.find((g) => g.group === 'Food & Dining');
    expect(foodGroup?.amountCents).toBe(14000); // dining + groceries both Food & Dining
    expect(foodGroup?.categories.length).toBe(2);
  });

  it('a category that nets to a refund (positive) is dropped', () => {
    const refundOnly: ReportTxn[] = [T('2026-06-01', -1000, 'shopping'), T('2026-06-02', 3000, 'shopping')];
    const r = spendingByCategory(refundOnly, { fromYm: '2026-06', toYm: '2026-06' });
    expect(r.byCategory.find((c) => c.categoryId === 'shopping')).toBeUndefined();
    expect(r.totalCents).toBe(0);
  });
});

/**
 * O.8(b) — a card payment we cannot see the other side of IS spending.
 *
 * This pins a DECISION, not an accident. TASKS O.8(b) proposed adding
 * `credit-card-payment` to the exclusion beside `transfer`, on two grounds that
 * were both checked and found false:
 *
 *  1. "/budgets already excludes it via NON_BUDGETABLE." FALSE —
 *     `NON_BUDGETABLE` is the budget-TARGET picker's offer set, and
 *     `summarizeBudgets` renders the union of spend keys, so /budgets counts
 *     these rows exactly as /reports does. The two surfaces never disagreed.
 *  2. "It double-counts against the charges it settles." TRUE, but only in a
 *     narrow window. When we hold the card, `detectTransfers` normally pairs the
 *     two sides and sets `isTransfer`, which line 45 excludes — and that is what
 *     production shows (counts in docs/STATUS.md §O.8). Pairing needs opposite
 *     amounts within +/-3 calendar days, though, so a payment whose card-side
 *     credit posts later escapes it. That case is real and is pinned below.
 *
 * The exclusion is declined anyway, as a TRADE-OFF rather than a no-op: it would
 * fix the straddle and would delete the only trace of money leaving for a reader
 * paying a card this app cannot see. Over-counting makes /budgets under-spend;
 * under-counting makes an INSTRUCTION ("$87.70 left this month") too generous,
 * which is the direction that costs money (L.14). The straddle's fix belongs in
 * the DETECTOR, not this predicate.
 *
 * If a later pass wants to exclude these rows, it has to delete these tests and
 * answer the argument in them.
 */
describe('O.8b — the credit-card-payment category, decided rather than defaulted', () => {
  const RANGE = { fromYm: '2026-06', toYm: '2026-06' };

  it('COUNTS an unpaired card payment — the card is not ours to see', () => {
    const rows = [
      T('2026-06-04', -200000, 'credit-card-payment'), // paying a card we do not hold
      T('2026-06-05', -5000, 'groceries'),
    ];
    const r = spendingByCategory(rows, RANGE);
    expect(r.byCategory.find((c) => c.categoryId === 'credit-card-payment')?.amountCents).toBe(200000);
    expect(r.totalCents).toBe(205000);
  });

  it('EXCLUDES the same payment once the detector has paired it with our own card', () => {
    // The real double-count case, and the mechanism that already prevents it.
    const rows = [
      T('2026-06-04', -200000, 'credit-card-payment', { isTransfer: true }),
      T('2026-06-04', 200000, 'credit-card-payment', { isTransfer: true }), // the card's side
      T('2026-06-05', -5000, 'groceries'),
    ];
    const r = spendingByCategory(rows, RANGE);
    expect(r.byCategory.find((c) => c.categoryId === 'credit-card-payment')).toBeUndefined();
    expect(r.totalCents).toBe(5000);
  });

  it('the `transfer` id is still excluded by id alone — a backstop the flag does not provide', () => {
    // Anti-vacuity for the pair above: id-based exclusion is real and does work
    // that the isTransfer flag does not, which is why the flag is not the whole
    // story and `credit-card-payment` had to be decided on its merits.
    const r = spendingByCategory([T('2026-06-04', -30000, 'transfer')], RANGE);
    expect(r.totalCents).toBe(0);
  });
});

/**
 * O.8(b) residual — the pair detector's ±3-day window, executed rather than
 * assumed. This is a KNOWN DEFECT pinned so it stays visible: the assertions
 * describe what the code does today, and closing it (TASKS O.10) means changing
 * a test that says why it exists.
 */
describe('O.8b residual — a held-card payment can straddle the pair window', () => {
  it('flags both sides when the card posts within 3 days (the normal case)', () => {
    const paired = detectTransfers([
      { id: 'pay', accountId: 'chk', date: '2026-06-28', amountCents: -50000, rawDescriptor: 'CHASE CARD PMT' },
      { id: 'crd', accountId: 'card', date: '2026-06-30', amountCents: 50000, rawDescriptor: 'PAYMENT THANK YOU' },
    ]);
    expect([...paired].sort()).toEqual(['crd', 'pay']);
  });

  it('leaves the PAYMENT unflagged at 5 days — so it counts as spending and is never offset', () => {
    const straddled = detectTransfers([
      { id: 'pay', accountId: 'chk', date: '2026-06-28', amountCents: -50000, rawDescriptor: 'CHASE CARD PMT' },
      { id: 'crd', accountId: 'card', date: '2026-07-03', amountCents: 50000, rawDescriptor: 'PAYMENT THANK YOU' },
    ]);
    // Only the card side is caught, by its transfer-like descriptor. The
    // checking-side payment escapes entirely.
    expect([...straddled]).toEqual(['crd']);

    // …and that unflagged payment lands in June's spending, on top of the real
    // charges it settles: $300 of charges + a $500 payment = $800.00.
    const june = spendingByCategory(
      [
        T('2026-06-10', -30000, 'groceries'),
        T('2026-06-28', -50000, 'credit-card-payment'), // unflagged: the straddle
      ],
      { fromYm: '2026-06', toYm: '2026-06' },
    );
    expect(june.totalCents).toBe(80000);

    // The offsetting credit cannot repay it in July: it IS flagged, so it never
    // enters a spending figure at all. The phantom $500 is permanent.
    const july = spendingByCategory(
      [T('2026-07-03', 50000, 'credit-card-payment', { isTransfer: true })],
      { fromYm: '2026-07', toYm: '2026-07' },
    );
    expect(july.totalCents).toBe(0);
  });
});
