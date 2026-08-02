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
    expect(r.pace!.projectedCents).toBe(9000); // 3000 + 3000 × 20 / 10
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
    expect(r.pace!.projectedCents).toBe(376074); // the pinned no-bill figure
  });
});
