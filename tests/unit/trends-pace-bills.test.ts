/**
 * C.2 (CALC_AUDIT 2026-08-02, P1-1) — the pace projection reads the bill
 * calendar the app already owns.
 *
 * The owner's report: *"'on pace for 19,713.85 less than last month' how? we've
 * spent 578.79 on the first day of the month… 8971.25 makes no sense since our
 * mortgage is ~6200."* A linear rate models a household month as a uniform
 * stream, so it is biased low before the bills land and wildly high the morning
 * they do. Every expected value below is hand-derived in its own comment.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { buildSeedData } from '@/lib/seed/build';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { detectRecurring, toScheduledTransactions } from '@/lib/engine/recurring/detect';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
import {
  billOccurrencesInMonth,
  computeSpendingTrends,
  type PaceBillInput,
  type TrendTxn,
} from '@/lib/engine/trends/trends';
import { paceAssumption } from '@/lib/engine/trends/labels';
import { toTrendTxns } from '@/server/trends';

const T = (
  date: string,
  amountCents: number,
  categoryId: string | null,
  extra: Partial<TrendTxn> = {},
): TrendTxn => ({ date, amountCents, categoryId, status: 'POSTED', ...extra });

const MORTGAGE = 'Mr Cooper';

const bill = (over: Partial<PaceBillInput> = {}): PaceBillInput => ({
  description: MORTGAGE,
  amountCents: -620000,
  nextDate: '2026-07-01', // next month's occurrence; June's has already passed
  cadence: 'MONTHLY',
  ...over,
});

// May = $28,685.10, the owner's own prior month, the mortgage included. That row
// is UNFILED (`categoryId: null`) because it is the shape a servicer descriptor
// takes here — the normalizer has no mortgage pattern (audit P0-4) — and an
// unfiled row still counts toward a month's spend.
const may: TrendTxn[] = [
  T('2026-05-01', -620000, null, { merchant: MORTGAGE }),
  T('2026-05-15', -2248510, 'dining', { merchant: 'Cafe' }),
];

describe('pace projects known bills, not a uniform stream (C.2)', () => {
  it('counts a bill that has not been charged yet — day 2, mortgage still to come', () => {
    const r = computeSpendingTrends({
      txns: [
        ...may,
        T('2026-06-01', -28879, 'dining', { merchant: 'Cafe' }),
        T('2026-06-02', -29000, 'groceries', { merchant: 'Market' }),
      ],
      today: '2026-06-02',
      scheduled: [bill()],
    });
    expect(r.pace).toMatchObject({
      daysElapsed: 2,
      daysInMonth: 30,
      spentSoFarCents: 57879, // 28879 + 29000 — the owner's own figure
      billsStillDueCents: 620000, // nothing has posted at Mr Cooper this month
      discretionarySoFarCents: 57879, // none of it is bill money
      projectedRemainderCents: 810306, // 57879 × 28 / 2
      projectedCents: 1488185, // 57879 + 620000 + 810306 = $14,881.85
      priorMonthCents: 2868510,
    });
    // The old model's answer for this exact input was 57879 / 2 × 30 = 868185
    // ($8,681.85) — the shape the owner said "makes no sense", a whole-month
    // projection smaller than the mortgage plus two days of groceries.
    expect(r.pace!.projectedCents).toBeGreaterThan(868185);
    expect(r.pace!.billsStillDue).toEqual([{ merchant: MORTGAGE, amountCents: 620000 }]);
  });

  it('does not demand the same bill twice once it HAS been charged — day 10', () => {
    const r = computeSpendingTrends({
      txns: [
        ...may,
        T('2026-06-01', -620000, null, { merchant: MORTGAGE }), // posted
        T('2026-06-02', -144700, 'dining', { merchant: 'Cafe' }),
        T('2026-06-08', -144700, 'groceries', { merchant: 'Market' }),
      ],
      today: '2026-06-10',
      scheduled: [bill()],
    });
    expect(r.pace).toMatchObject({
      spentSoFarCents: 909400, // 620000 + 289400
      billsStillDueCents: 0, // June's occurrence is accounted for
      discretionarySoFarCents: 289400, // the mortgage is out of the rate
      projectedRemainderCents: 578800, // 289400 × 20 / 10
      projectedCents: 1488200, // 909400 + 0 + 578800 = $14,882.00
    });
    // THE POINT OF THE SLICE. The same month projects $14,881.85 on the 2nd and
    // $14,882.00 on the 10th — 15 cents apart, off a discretionary rate that is
    // deliberately the same in both fixtures. Under the old model the identical
    // data read $8,681.85 and then $27,282.00 (909400 / 10 × 30): an $18,600
    // swing, green to red, overnight, caused by nothing the reader did.
    expect(Math.abs(r.pace!.projectedCents - 1488185)).toBeLessThan(100);
  });

  it('credits a bill at its own size when the merchant is also a shop', () => {
    // $15/mo of Prime inside $415 of Amazon: crediting the whole $415 against
    // the bill would delete $400 of real discretionary spending from the rate.
    const r = computeSpendingTrends({
      txns: [
        T('2026-05-04', -1500, 'shopping', { merchant: 'Amazon' }), // admission history
        T('2026-06-05', -41500, 'shopping', { merchant: 'Amazon' }),
      ],
      today: '2026-06-10',
      scheduled: [bill({ description: 'Amazon', amountCents: -1500 })],
    });
    expect(r.pace).toMatchObject({
      spentSoFarCents: 41500,
      billsStillDueCents: 0, // 41500 already covers the 1500 expected
      discretionarySoFarCents: 40000, // 41500 − min(41500, 1500)
      projectedRemainderCents: 80000, // 40000 × 20 / 10
      projectedCents: 121500,
    });
  });

  it('refuses a bill whose money the comparison basis never counts', () => {
    // Three refusals, one rule. The auto-loan ACH is the one `isTransfer` class
    // `detectRecurring` deliberately keeps (detect.ts:380), so its payment is in
    // NEITHER side of this comparison; the savings sweep is a transfer; the
    // third is a hand-authored label no merchant will ever match, which is
    // exactly where a guess would become the money heuristic #134 rejected.
    const r = computeSpendingTrends({
      txns: [
        T('2026-05-05', -38500, 'auto-loan', { merchant: 'Prime Auto Finance', isTransfer: true }),
        T('2026-06-05', -38500, 'auto-loan', { merchant: 'Prime Auto Finance', isTransfer: true }),
        T('2026-05-01', -50000, 'transfer', { merchant: 'Account Transfer', isTransfer: true }),
        T('2026-06-03', -10000, 'dining', { merchant: 'Cafe' }),
      ],
      today: '2026-06-10',
      scheduled: [
        bill({ description: 'Prime Auto Finance', amountCents: -38500 }),
        bill({ description: 'Account Transfer', amountCents: -50000 }),
        bill({ description: 'Rent — Peachtree Properties', amountCents: -180000 }),
      ],
    });
    expect(r.pace).toMatchObject({
      spentSoFarCents: 10000,
      billsStillDueCents: 0,
      billsRefusedCount: 3,
      discretionarySoFarCents: 10000,
      projectedCents: 30000, // 10000 + 10000 × 20 / 10 — the pure rate, unchanged
    });
    expect(r.pace!.billsStillDue).toEqual([]);
  });

  it('refuses an AGGREGATE merchant — one canonical name over many payees', () => {
    const r = computeSpendingTrends({
      txns: [
        T('2026-05-04', -25000, 'home', { merchant: 'Zelle Payment', aggregateMerchant: true }),
        T('2026-06-04', -3000, 'dining', { merchant: 'Cafe' }),
      ],
      today: '2026-06-10',
      scheduled: [bill({ description: 'Zelle Payment', amountCents: -25000 })],
    });
    expect(r.pace!.billsStillDue).toEqual([]);
    expect(r.pace!.billsRefusedCount).toBe(1);
    expect(r.pace!.projectedCents).toBe(9000); // 3000 + 3000 × 20 / 10
    // Cycle 2 P1-1: they HAVE spent at "Zelle Payment"; a qualifier that
    // said "only when we can match it to a merchant you have spent at" was
    // a lie. The refused sentence must not explain admission.
    expect(paceAssumption(r.pace!)).toBe(
      'This projection does not add scheduled outflows. Assumes spending continues at the current daily rate — a projection, not a prediction.',
    );
    expect(paceAssumption(r.pace!)).not.toContain('merchant you have spent at');
  });

  it('C.21: a refused rival does not steal the admitted-bill branch', () => {
    // One mortgage still due (branch A) plus a hand-authored label the
    // admission rule refuses. The refused count is recorded; the assumption
    // still describes the bill that WAS added, not the refused-all zero.
    const r = computeSpendingTrends({
      txns: [
        ...may,
        T('2026-06-01', -28879, 'dining', { merchant: 'Cafe' }),
        T('2026-06-02', -29000, 'groceries', { merchant: 'Market' }),
      ],
      today: '2026-06-02',
      scheduled: [bill(), bill({ description: 'Rent — Peachtree Properties', amountCents: -180000 })],
    });
    expect(r.pace).toMatchObject({
      billsStillDueCents: 620000,
      billsRefusedCount: 1,
      discretionarySoFarCents: 57879,
    });
    expect(r.pace!.billsStillDue).toEqual([{ merchant: MORTGAGE, amountCents: 620000 }]);
    // C.21 critic P2-1: mixed stays branch A. A refused-first flip would
    // print "not in this figure" on a projection that added $6,200.00.
    expect(paceAssumption(r.pace!)).toContain('Adds $6,200.00 of bills still due');
    expect(paceAssumption(r.pace!)).not.toContain('does not add scheduled outflows');
  });

  it('never projects less than the money already counted', () => {
    // The last day of the month: no days left to extrapolate. June's mortgage
    // never posted, so it is still owed and the projection still says so.
    const r = computeSpendingTrends({
      txns: [...may, T('2026-06-30', -12345, 'dining', { merchant: 'Cafe' })],
      today: '2026-06-30',
      scheduled: [bill()],
    });
    expect(r.pace).toMatchObject({
      spentSoFarCents: 12345,
      billsStillDueCents: 620000,
      projectedRemainderCents: 0,
      projectedCents: 632345,
    });
  });

  it('income and $0 scheduled rows are not bills', () => {
    const r = computeSpendingTrends({
      txns: [T('2026-06-04', -3000, 'dining', { merchant: 'Cafe' })],
      today: '2026-06-10',
      scheduled: [
        { description: 'Payroll', amountCents: 245000, nextDate: '2026-06-15', cadence: 'BIWEEKLY' },
        { description: 'Cafe', amountCents: 0, nextDate: '2026-06-15', cadence: 'MONTHLY' },
      ],
    });
    expect(r.pace!.billsStillDue).toEqual([]);
    expect(r.pace!.billsRefusedCount).toBe(0);
  });

  it('still abstains on a month with nothing counted, bills or not (C.1 holds)', () => {
    // A bill calendar is not a rate. C.1's abstention is about having zero
    // observations to extrapolate from, and knowing a mortgage is due does not
    // create one.
    const r = computeSpendingTrends({ txns: may, today: '2026-06-02', scheduled: [bill()] });
    expect(r.pace).toBeNull();
  });
});

/**
 * The occurrence count, which is what makes a lumpy bill lumpy. The five forward
 * expanders in this repo all anchor at `today`; this one counts a whole calendar
 * month, including an occurrence that has already passed.
 */
describe('billOccurrencesInMonth', () => {
  const b = (nextDate: string, cadence: string | null): PaceBillInput => ({
    description: 'X',
    amountCents: -1000,
    nextDate,
    cadence,
  });

  it('a MONTHLY bill occurs once in every month, before or after its next date', () => {
    expect(billOccurrencesInMonth(b('2026-07-01', 'MONTHLY'), '2026-06')).toBe(1);
    expect(billOccurrencesInMonth(b('2026-01-15', 'MONTHLY'), '2026-06')).toBe(1);
  });

  it('QUARTERLY lands only on its own phase', () => {
    expect(billOccurrencesInMonth(b('2026-09-15', 'QUARTERLY'), '2026-06')).toBe(1);
    expect(billOccurrencesInMonth(b('2026-09-15', 'QUARTERLY'), '2026-07')).toBe(0);
    expect(billOccurrencesInMonth(b('2026-09-15', 'QUARTERLY'), '2026-12')).toBe(1);
  });

  it('ANNUAL lands in one month a year — the whole point of a lumpy bill', () => {
    expect(billOccurrencesInMonth(b('2027-02-01', 'ANNUAL'), '2026-06')).toBe(0);
    expect(billOccurrencesInMonth(b('2027-02-01', 'ANNUAL'), '2026-02')).toBe(1);
  });

  it('SEMIANNUAL lands twice a year', () => {
    expect(billOccurrencesInMonth(b('2026-09-01', 'SEMIANNUAL'), '2026-03')).toBe(1);
    expect(billOccurrencesInMonth(b('2026-09-01', 'SEMIANNUAL'), '2026-06')).toBe(0);
  });

  it('WEEKLY and BIWEEKLY count the occurrences the month actually holds', () => {
    // June 2026 from an anchor on the 15th: 1, 8, 15, 22, 29 = 5 weekly;
    // 1, 15, 29 = 3 biweekly. Both walk BACKWARDS through the anchor.
    expect(billOccurrencesInMonth(b('2026-06-15', 'WEEKLY'), '2026-06')).toBe(5);
    expect(billOccurrencesInMonth(b('2026-06-15', 'BIWEEKLY'), '2026-06')).toBe(3);
    // February 2026 (28 days) from the same anchor: 2, 9, 16, 23 = 4.
    expect(billOccurrencesInMonth(b('2026-06-15', 'WEEKLY'), '2026-02')).toBe(4);
  });

  it('a one-off belongs to its own month only', () => {
    expect(billOccurrencesInMonth(b('2026-06-15', null), '2026-06')).toBe(1);
    expect(billOccurrencesInMonth(b('2026-06-15', null), '2026-07')).toBe(0);
  });
});

/**
 * The INTAKE, not the arithmetic (`a-dead-branch-is-a-claim-that-something-is-
 * handled`). The bill/charge match is an exact merchant key, and what makes that
 * not a heuristic is a fact about the WRITER: `toScheduledRow` stores
 * `series.merchantCanonical`, and `toTrendTxns` puts the same normalizer's
 * canonical on the row. No unit fixture proves that — so this runs the real
 * path: transactions → detected series → scheduled rows → pace.
 */
describe('C.2 — a bill written by the real detector matches its own charges', () => {
  const descriptor = 'MR COOPER MTG PMT 8841';
  const raw = [1, 2, 3, 4].map((i) => ({
    id: `m${i}`,
    accountId: 'acct-checking',
    date: `2026-0${i + 1}-01`, // Feb, Mar, Apr, May — monthly
    amountCents: -620000,
    rawDescriptor: descriptor,
    isTransfer: false,
  }));

  it('detects the series, projects it, and the pace credits it by merchant', () => {
    const series = detectRecurring(raw, isoDate('2026-06-02'), NO_RECURRING_OVERRIDES);
    const scheduled = toScheduledTransactions(
      series,
      { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking']) },
      isoDate('2026-06-02'),
    );
    // The intake this whole design rests on: a stored row exists, and its
    // description is the canonical merchant name rather than a hand-written label.
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.description).toBe(normalizeMerchant(descriptor).canonical);

    const trendTxns = toTrendTxns(
      [
        ...raw,
        // One June purchase, because C.1 abstains on a month with nothing
        // counted and this test is about the bill, not the abstention.
        { id: 'c1', accountId: 'acct-checking', date: '2026-06-01', amountCents: -3000, rawDescriptor: 'SQ *BLUE BOTTLE 0042 OAK', isTransfer: false },
      ].map((t) => ({ ...t, status: 'POSTED', categoryId: null, merchant: null })),
    );
    const r = computeSpendingTrends({ txns: trendTxns, today: '2026-06-02', scheduled });
    // June's occurrence has not been charged, so the whole payment is still due
    // and named — the owner's mortgage, arriving through the production path.
    expect(r.pace!.billsStillDueCents).toBe(620000);
    expect(r.pace!.billsStillDue[0]!.merchant).toBe(normalizeMerchant(descriptor).canonical);
  });
});

/**
 * What the DEMO does, pinned. The seeded scheduled rows are hand-authored labels
 * ("Rent — Peachtree Properties", "Auto-transfer to savings") plus payroll, so
 * none is admitted and the public demo's pace stays the pure daily rate. That is
 * the correct outcome — a label is not a merchant and a savings sweep is not
 * spending — but it has to be PINNED, or the demo quietly stops exercising the
 * feature and no one notices.
 */
describe('C.2 — the demo seed admits no bills, on purpose', () => {
  const seed = buildSeedData('2026-06-10');
  const r = computeSpendingTrends({
    txns: toTrendTxns(seed.transactions),
    today: '2026-06-10',
    scheduled: seed.scheduled,
  });

  it('leaves the seed pace identical to the no-bill projection', () => {
    expect(seed.scheduled.map((s) => s.description)).toEqual([
      'Payroll — Acme Analytics',
      'Rent — Peachtree Properties',
      'Auto-transfer to savings',
    ]);
    expect(r.pace!.billsStillDue).toEqual([]);
    expect(r.pace!.billsRefusedCount).toBe(2); // rent label + savings sweep; payroll is income
    expect(r.pace!.projectedCents).toBe(376074); // the pinned no-bill figure
    // C.21 critic P2-2: compose the engine result, do not re-derive the count
    // in the label test. The sweep is an item, not a bill.
    expect(paceAssumption(r.pace!)).toBe(
      'This projection does not add scheduled outflows. Assumes spending continues at the current daily rate — a projection, not a prediction.',
    );
  });
});

/**
 * C.2 hostile-critic cycle (2026-08-02) — the two P1s the cycle found, plus the
 * unlocked construction it flagged. Each of these fails on the code as shipped
 * in #390.
 */
describe('C.2 critic — admission and basis seams', () => {
  /**
   * P1-1. `counted` (the admission set) used to be filled BEFORE the
   * `date > today` guard, so a future-dated row admitted a bill.
   *
   * That row is in neither side of the comparison — `soFar` filters it out of
   * `spentSoFarCents`, and it is not in `priorMonthCents` either — so the bill
   * it admits imports a merchant whose money has never been in the basis. Every
   * sibling in the file (`computeLargest`, `computeNewMerchants`) already
   * refuses to treat a future-dated row as fact.
   */
  it('a future-dated row does not admit a bill — it is in neither side of the comparison', () => {
    // FutureCo appears NOWHERE in the reader's history: its only row is dated
    // after today. (The fixture deliberately avoids `MORTGAGE`, whose May charge
    // in `may` would admit its bill legitimately — the first draft of this test
    // used it and passed on the old code for that reason.)
    const r = computeSpendingTrends({
      txns: [
        ...may,
        T('2026-06-05', -2000, 'dining', { merchant: 'Cafe' }),
        // Dated AFTER today: the app's own convention says this has not happened.
        T('2026-06-15', -50000, 'housing', { merchant: 'FutureCo' }),
      ],
      today: '2026-06-10',
      scheduled: [bill({ description: 'FutureCo', amountCents: -50000 })],
    });
    // The merchant has never been counted in a spend total that has happened,
    // so the bill stays out and the projection is the pure discretionary rate.
    expect(r.pace!.billsStillDue).toEqual([]);
    expect(r.pace!.billsStillDueCents).toBe(0);
    expect(r.pace!.billsRefusedCount).toBe(1);
    expect(r.pace!.spentSoFarCents).toBe(2000);
  });

  /**
   * The false-abstention control for the same guard: a PAST row at the same
   * merchant must still admit the bill. Without this, "never admit anything"
   * would pass the test above.
   */
  it('a past row at the same merchant still admits the bill (control)', () => {
    const r = computeSpendingTrends({
      txns: [
        ...may,
        T('2026-06-05', -2000, 'dining', { merchant: 'Cafe' }),
        T('2026-06-08', -620000, null, { merchant: MORTGAGE }),
      ],
      today: '2026-06-10',
      scheduled: [bill({ nextDate: '2026-07-01' })],
    });
    // June's occurrence is already charged, so nothing is still due — but the
    // bill WAS admitted, which is what separates this from the case above.
    expect(r.pace!.discretionarySoFarCents).toBeLessThan(r.pace!.spentSoFarCents);
  });

  /**
   * C.20 / P1-2. `spentSoFarCents` nets refunds by CATEGORY and drops a
   * net-refunded category to zero. The rate credit now attributes through
   * those same surviving nets, so FinanceCo's $100 is not subtracted from a
   * total it is not in. Still-due is a different question: the charge landed,
   * so the bill is not demanded again.
   *
   * #391's crossing guard (take no credit) produced the same discretionary
   * $30 on THIS fixture; the tests below are the ones that fail on that
   * guard and pass only when the credit shares the category basis.
   */
  it('a net-refunded category cannot delete unrelated spending from the rate', () => {
    const r = computeSpendingTrends({
      txns: [
        ...may,
        // `shopping` nets NEGATIVE: 100 + 200 − 350 = −50 → the category is
        // dropped to 0 by `spendingByCategory`, taking the bill's own charge
        // with it.
        T('2026-06-01', -10000, 'shopping', { merchant: 'FinanceCo' }),
        T('2026-06-02', -20000, 'shopping', { merchant: 'BigBox' }),
        T('2026-06-03', 35000, 'shopping', { merchant: 'BigBox' }),
        // Real money, at an unrelated merchant, in a healthy category.
        T('2026-06-01', -3000, 'dining', { merchant: 'Cafe' }),
      ],
      today: '2026-06-10',
      scheduled: [bill({ description: 'FinanceCo', amountCents: -10000 })],
    });
    // The dining money is the only thing left in the month total…
    expect(r.pace!.spentSoFarCents).toBe(3000);
    // …and it must survive into the rate rather than being clamped away.
    expect(r.pace!.discretionarySoFarCents).toBe(3000);
    // The bill posted; still-due does not re-add money the category drop
    // already removed from spent-so-far.
    expect(r.pace!.billsStillDueCents).toBe(0);
    // Which means the month still projects forward instead of flat-lining.
    expect(r.pace!.projectedCents).toBeGreaterThan(r.pace!.spentSoFarCents);
  });

  /**
   * C.20. The #391 crossing guard took NO credit once any merchant raw sum
   * exceeded the month total — so a healthy-category bill riding next to a
   * dropped-category bill stayed inside the daily rate. Attributing through
   * the surviving nets credits only the $80 that is actually in spent-so-far.
   *
   * Hand-verified: shopping −50 → drop; dining $30; electricity $80.
   * spentSoFar = 11000. Credit = 0 + 8000. discretionary = 3000.
   * elapsed = 10, remainder = 3000 × 20 / 10 = 6000.
   * projected = 11000 + 0 + 6000 = 17000.
   * Old guard: credited 10000+8000 > 11000 → discretionary 11000,
   * remainder 22000, projected 33000.
   */
  it('test_regression__c20_credit_uses_surviving_category_nets', () => {
    const r = computeSpendingTrends({
      txns: [
        T('2026-05-04', -10000, 'shopping', { merchant: 'FinanceCo' }),
        T('2026-05-04', -8000, 'electricity', { merchant: 'ElectricCo' }),
        T('2026-06-01', -10000, 'shopping', { merchant: 'FinanceCo' }),
        T('2026-06-02', -20000, 'shopping', { merchant: 'BigBox' }),
        T('2026-06-03', 35000, 'shopping', { merchant: 'BigBox' }),
        T('2026-06-01', -3000, 'dining', { merchant: 'Cafe' }),
        T('2026-06-01', -8000, 'electricity', { merchant: 'ElectricCo' }),
      ],
      today: '2026-06-10',
      scheduled: [
        bill({ description: 'FinanceCo', amountCents: -10000 }),
        bill({ description: 'ElectricCo', amountCents: -8000 }),
      ],
    });
    expect(r.pace).toMatchObject({
      spentSoFarCents: 11000,
      billsStillDueCents: 0,
      discretionarySoFarCents: 3000,
      projectedRemainderCents: 6000,
      projectedCents: 17000,
    });
    expect(paceAssumption(r.pace!)).toContain('already posted');
    expect(paceAssumption(r.pace!)).not.toContain('already counted');
  });

  /**
   * C.20. A partially-refunded category still holds some of the bill. Credit
   * is that surviving net, not the raw merchant post and not "take no credit".
   *
   * Hand-verified: shopping 100 + 50 − 80 = 70. spentSoFar = 7000.
   * Credit = min(10000, 7000) = 7000. discretionary = 0.
   * Old guard: 10000 > 7000 → discretionary 7000 (bill money left in the rate).
   */
  it('test_regression__c20_partial_category_refund_credits_the_surviving_net', () => {
    const r = computeSpendingTrends({
      txns: [
        T('2026-05-04', -10000, 'shopping', { merchant: 'FinanceCo' }),
        T('2026-06-01', -10000, 'shopping', { merchant: 'FinanceCo' }),
        T('2026-06-02', -5000, 'shopping', { merchant: 'BigBox' }),
        T('2026-06-03', 8000, 'shopping', { merchant: 'BigBox' }),
      ],
      today: '2026-06-10',
      scheduled: [bill({ description: 'FinanceCo', amountCents: -10000 })],
    });
    expect(r.pace).toMatchObject({
      spentSoFarCents: 7000,
      billsStillDueCents: 0,
      discretionarySoFarCents: 0,
      projectedRemainderCents: 0,
      projectedCents: 7000,
    });
  });

  /**
   * C.20. Exclusive categories are credited before contested ones, so a
   * shop+bill merchant cannot exhaust its cap on a shared leftover and leave
   * the other bill's surviving money in the rate.
   *
   * A posted $80+$80 (expected $100) across shopping+electricity; B posted
   * $80 in shopping (expected $80). Shopping net $100 (160 raw, $60 refunded).
   * Electricity net $80, exclusive to A.
   * Exclusive-first: A takes 80 from electricity (cap left 20), then shopping
   * gives A 20 + B 80. Credit = 180. discretionary = 0.
   * Contested-first in name order (A then B): A takes 80 from shopping
   * (cap left 20) + 20 from electricity; B takes 20 from shopping.
   * Credit = 120 — $60 of B left in the rate.
   */
  it('test_regression__c20_exclusive_category_is_credited_before_contested', () => {
    const r = computeSpendingTrends({
      txns: [
        T('2026-05-04', -10000, 'shopping', { merchant: 'AlphaBill' }),
        T('2026-05-04', -10000, 'electricity', { merchant: 'BetaBill' }),
        T('2026-06-01', -8000, 'shopping', { merchant: 'AlphaBill' }),
        T('2026-06-01', -8000, 'shopping', { merchant: 'BetaBill' }),
        T('2026-06-02', 6000, 'shopping', { merchant: 'BigBox' }),
        T('2026-06-01', -8000, 'electricity', { merchant: 'AlphaBill' }),
      ],
      today: '2026-06-10',
      scheduled: [
        bill({ description: 'AlphaBill', amountCents: -10000 }),
        bill({ description: 'BetaBill', amountCents: -8000 }),
      ],
    });
    expect(r.pace).toMatchObject({
      spentSoFarCents: 18000, // shopping 100 + electricity 80
      billsStillDueCents: 0,
      discretionarySoFarCents: 0,
      projectedCents: 18000,
    });
  });

  /**
   * P2-4. Two series on one canonical merchant are summed into a single expected
   * amount by construction, so one merchant's charges cannot be compared against
   * the same bill twice. Named in the audit brief as this repo's known failure
   * class and previously unlocked.
   */
  it('two series on one merchant sum into one expectation, never two comparisons', () => {
    const r = computeSpendingTrends({
      txns: [
        ...may,
        T('2026-06-01', -5000, null, { merchant: MORTGAGE }),
        T('2026-06-02', -1000, 'dining', { merchant: 'Cafe' }),
      ],
      today: '2026-06-02',
      scheduled: [
        bill({ amountCents: -400000 }),
        bill({ amountCents: -220000 }),
      ],
    });
    // 400,000 + 220,000 expected, 5,000 already charged ⇒ one row, 615,000 due.
    expect(r.pace!.billsStillDue).toEqual([{ merchant: MORTGAGE, amountCents: 615000 }]);
  });
});
