/**
 * TASKS C.6 / audit P0-1 — detected mid-cycle card payments.
 *
 * The majority of these are ABSTENTIONS, deliberately. Crediting a payment that
 * was not made under-demands a bill, and the cost of that is a missed payment;
 * refusing to credit one that was made over-demands, and the cost of that is an
 * unnecessary transfer. Every refusal below is therefore load-bearing, and the
 * refund cases are drawn from rows measured on the live account
 * (`scripts/audit-probes/c6-card-payments.mts`, 2026-08-04), where the loose
 * "any own-account pair" rule credited 11 merchant credits as payments.
 */
import { describe, expect, it } from 'vitest';
import { holidayTable, isoDate } from '@/lib/dates';
import { assembleCashNeededInput } from '@/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import {
  type DetectedPaymentTxn,
  detectCardPayments,
  detectedPaymentCentsForStatement,
} from '@/lib/engine/cash-needed/detected-payments';

const TYPES = new Map<string, string>([
  ['card', 'CREDIT'],
  ['card2', 'CREDIT'],
  ['checking', 'CHECKING'],
  ['savings', 'SAVINGS'],
  ['brokerage', 'INVESTMENT'],
]);

const txn = (o: Partial<DetectedPaymentTxn> & Pick<DetectedPaymentTxn, 'accountId' | 'date' | 'amountCents'>): DetectedPaymentTxn => ({
  status: 'POSTED',
  ...o,
});

describe('detectCardPayments — what counts', () => {
  it('credits a card inflow matched by a same-amount checking debit within 3 days', () => {
    const rows = [
      txn({ accountId: 'card', date: '2026-06-05', amountCents: 40000 }),
      txn({ accountId: 'checking', date: '2026-06-07', amountCents: -40000 }),
    ];
    const found = detectCardPayments(rows, TYPES);
    expect(found).toEqual([
      { cardAccountId: 'card', date: '2026-06-05', amountCents: 40000, txnIndex: 0 },
    ]);
  });

  it('accepts a SAVINGS payer as readily as a CHECKING one', () => {
    const rows = [
      txn({ accountId: 'card', date: '2026-06-05', amountCents: 40000 }),
      txn({ accountId: 'savings', date: '2026-06-05', amountCents: -40000 }),
    ];
    expect(detectCardPayments(rows, TYPES)).toHaveLength(1);
  });

  it('credits each card separately when one debit day pays two cards', () => {
    const rows = [
      txn({ accountId: 'card', date: '2026-07-05', amountCents: 11199 }),
      txn({ accountId: 'card2', date: '2026-07-05', amountCents: 67967 }),
      txn({ accountId: 'checking', date: '2026-07-06', amountCents: -11199 }),
      txn({ accountId: 'checking', date: '2026-07-06', amountCents: -67967 }),
    ];
    const found = detectCardPayments(rows, TYPES);
    expect(found.map((f) => [f.cardAccountId, f.amountCents])).toEqual([
      ['card', 11199],
      ['card2', 67967],
    ]);
  });
});

describe('detectCardPayments — what it refuses (the majority case)', () => {
  it('refuses a merchant refund: an inflow with no debit anywhere', () => {
    const rows = [txn({ accountId: 'card', date: '2026-07-21', amountCents: 798 })];
    expect(detectCardPayments(rows, TYPES)).toEqual([]);
  });

  it('refuses a refund whose only match is on ANOTHER CARD — the duplicate-connection artifact', () => {
    // Measured live: an Amex Uber One statement credit arrived on the same card
    // under two providers a day apart and paired with itself. Under the loose
    // rule it was subtracted from an amount due.
    const rows = [
      txn({ accountId: 'card', date: '2026-07-09', amountCents: 999 }),
      txn({ accountId: 'card2', date: '2026-07-08', amountCents: -999 }),
    ];
    expect(detectCardPayments(rows, TYPES)).toEqual([]);
  });

  it('refuses a match on an account type that cannot pay a card bill', () => {
    const rows = [
      txn({ accountId: 'card', date: '2026-06-05', amountCents: 40000 }),
      txn({ accountId: 'brokerage', date: '2026-06-05', amountCents: -40000 }),
    ];
    expect(detectCardPayments(rows, TYPES)).toEqual([]);
  });

  it('refuses a counterpart on an account it was not told about', () => {
    // A superseded account, or one withheld by the currency guard, is filtered
    // out upstream — it cannot prove anything about money it may not hold.
    const rows = [
      txn({ accountId: 'card', date: '2026-06-05', amountCents: 40000 }),
      txn({ accountId: 'unknown-acct', date: '2026-06-05', amountCents: -40000 }),
    ];
    expect(detectCardPayments(rows, TYPES)).toEqual([]);
  });

  it('refuses when either leg is PENDING', () => {
    const cardPending = [
      txn({ accountId: 'card', date: '2026-06-05', amountCents: 40000, status: 'PENDING' }),
      txn({ accountId: 'checking', date: '2026-06-05', amountCents: -40000 }),
    ];
    const payerPending = [
      txn({ accountId: 'card', date: '2026-06-05', amountCents: 40000 }),
      txn({ accountId: 'checking', date: '2026-06-05', amountCents: -40000, status: 'PENDING' }),
    ];
    expect(detectCardPayments(cardPending, TYPES)).toEqual([]);
    expect(detectCardPayments(payerPending, TYPES)).toEqual([]);
  });

  it('refuses a debit that settles 4 days away — the window is exactly 3', () => {
    const three = [
      txn({ accountId: 'card', date: '2026-06-05', amountCents: 40000 }),
      txn({ accountId: 'checking', date: '2026-06-08', amountCents: -40000 }),
    ];
    const four = [
      txn({ accountId: 'card', date: '2026-06-05', amountCents: 40000 }),
      txn({ accountId: 'checking', date: '2026-06-09', amountCents: -40000 }),
    ];
    expect(detectCardPayments(three, TYPES)).toHaveLength(1);
    expect(detectCardPayments(four, TYPES)).toEqual([]);
  });

  it('refuses a near-miss amount — the legs must be equal to the cent', () => {
    const rows = [
      txn({ accountId: 'card', date: '2026-06-05', amountCents: 40000 }),
      txn({ accountId: 'checking', date: '2026-06-05', amountCents: -39999 }),
    ];
    expect(detectCardPayments(rows, TYPES)).toEqual([]);
  });

  it('refuses a split container on either leg', () => {
    const rows = [
      txn({ accountId: 'card', date: '2026-06-05', amountCents: 40000, isSplitParent: true }),
      txn({ accountId: 'checking', date: '2026-06-05', amountCents: -40000 }),
    ];
    const payerParent = [
      txn({ accountId: 'card', date: '2026-06-05', amountCents: 40000 }),
      txn({ accountId: 'checking', date: '2026-06-05', amountCents: -40000, isSplitParent: true }),
    ];
    expect(detectCardPayments(rows, TYPES)).toEqual([]);
    expect(detectCardPayments(payerParent, TYPES)).toEqual([]);
  });

  it('refuses an inflow on a CHECKING account (a paycheck is not a card payment)', () => {
    const rows = [
      txn({ accountId: 'checking', date: '2026-06-05', amountCents: 40000 }),
      txn({ accountId: 'savings', date: '2026-06-05', amountCents: -40000 }),
    ];
    expect(detectCardPayments(rows, TYPES)).toEqual([]);
  });
});

describe('detectedPaymentCentsForStatement — window and dedupe', () => {
  const detected = detectCardPayments(
    [
      txn({ accountId: 'card', date: '2026-06-05', amountCents: 40000 }),
      txn({ accountId: 'checking', date: '2026-06-05', amountCents: -40000 }),
    ],
    TYPES,
  );

  it('credits a payment posted after the statement closed', () => {
    expect(
      detectedPaymentCentsForStatement({
        detected,
        cardAccountId: 'card',
        cycleEnd: '2026-06-01',
        storedPayments: [],
      }),
    ).toBe(40000);
  });

  it('refuses a payment ON the close date — it is already inside the printed balance', () => {
    expect(
      detectedPaymentCentsForStatement({
        detected,
        cardAccountId: 'card',
        cycleEnd: '2026-06-05',
        storedPayments: [],
      }),
    ).toBe(0);
  });

  it('refuses a payment before the close date', () => {
    expect(
      detectedPaymentCentsForStatement({
        detected,
        cardAccountId: 'card',
        cycleEnd: '2026-06-11',
        storedPayments: [],
      }),
    ).toBe(0);
  });

  it('does not credit another card the payment did not touch', () => {
    expect(
      detectedPaymentCentsForStatement({
        detected,
        cardAccountId: 'card2',
        cycleEnd: '2026-06-01',
        storedPayments: [],
      }),
    ).toBe(0);
  });

  it('drops a detected payment that duplicates a stored CardPayment row', () => {
    // The demo dataset writes BOTH halves for its mid-cycle $400 — without this,
    // the seed's $1,000 statement would report $200 remaining instead of $600.
    expect(
      detectedPaymentCentsForStatement({
        detected,
        cardAccountId: 'card',
        cycleEnd: '2026-06-01',
        storedPayments: [{ date: '2026-06-05', amountCents: 40000 }],
      }),
    ).toBe(0);
  });

  it('a stored row of a DIFFERENT amount does not absorb the detected one', () => {
    expect(
      detectedPaymentCentsForStatement({
        detected,
        cardAccountId: 'card',
        cycleEnd: '2026-06-01',
        storedPayments: [{ date: '2026-06-05', amountCents: 25000 }],
      }),
    ).toBe(40000);
  });

  it('one stored row absorbs only ONE detected payment of that amount', () => {
    const twice = detectCardPayments(
      [
        txn({ accountId: 'card', date: '2026-06-05', amountCents: 40000 }),
        txn({ accountId: 'checking', date: '2026-06-05', amountCents: -40000 }),
        txn({ accountId: 'card', date: '2026-06-20', amountCents: 40000 }),
        txn({ accountId: 'checking', date: '2026-06-20', amountCents: -40000 }),
      ],
      TYPES,
    );
    expect(twice).toHaveLength(2);
    expect(
      detectedPaymentCentsForStatement({
        detected: twice,
        cardAccountId: 'card',
        cycleEnd: '2026-06-01',
        storedPayments: [{ date: '2026-06-05', amountCents: 40000 }],
      }),
    ).toBe(40000);
  });
});

/**
 * The lock the repo did not have: transaction rows → the REAL assembler → the
 * REAL engine → `remainingDueCents`. Every pre-existing cash-needed test injects
 * `paymentsAppliedCents` into a hand-built CardSnapshot, so none of them could
 * ever fail on the missing intake — which is how P0-1 survived to the audit.
 *
 * The fixture is the owner's live shape, measured 2026-08-04: a Plaid card whose
 * only statement closed 2026-07-11 with $9,250.93 due 2026-08-05, no stored
 * CardPayment row anywhere, and autopay debiting Schwab checking on the 5th. The
 * next statement will not close until ~08-11, so 08-06 sits in the six-day window
 * where the bill is settled and the app still demanded it in full.
 */
describe('C.6 integration — a settled bill stops being demanded', () => {
  const HOLIDAYS = holidayTable(2026, 2027);
  const TODAY = isoDate('2026-08-06');

  const base = (transactions: Array<{ accountId: string; date: string; amountCents: number; rawDescriptor: string; status?: string; isTransfer?: boolean }>) => ({
    today: TODAY,
    scenario: 'PAY_IN_FULL' as const,
    paymentAccountId: 'chk',
    accounts: [
      { id: 'chk', name: 'Investor Checking', type: 'CHECKING', currentBalanceCents: 1500000, aprBps: null, dueDayOfMonth: null, cycleCloseDayOfMonth: null },
      { id: 'cardA', name: 'Venture', type: 'CREDIT', currentBalanceCents: 1070025, aprBps: 2499, dueDayOfMonth: 5, cycleCloseDayOfMonth: 11 },
    ],
    autopays: [],
    statements: [
      { id: 'stmt-1', accountId: 'cardA', cycleEnd: '2026-07-11', dueDate: '2026-08-05', statementBalanceCents: 925093, minimumPaymentCents: 3500 },
    ],
    // The whole point: production has none of these.
    cardPayments: [],
    transactions: transactions.map((t) => ({ status: 'POSTED', isTransfer: false, ...t })),
    scheduled: [],
    holidayTable: HOLIDAYS,
  });

  const run = (rows: Parameters<typeof base>[0]) => computeCashNeeded(assembleCashNeededInput(base(rows)));

  it('CONTROL — with no payment rows at all it demands the full statement balance', () => {
    const r = run([]);
    expect(r.cards.find((c) => c.cardName === 'Venture')?.remainingDueCents).toBe(925093);
    expect(r.headline.requiredCents).toBe(925093);
  });

  it('credits the autopay pair and the card drops out of the amount due', () => {
    const r = run([
      { accountId: 'cardA', date: '2026-08-05', amountCents: 925093, rawDescriptor: 'CAPITAL ONE AUTOPAY PYMT' },
      { accountId: 'chk', date: '2026-08-06', amountCents: -925093, rawDescriptor: 'CAPITAL ONE AUTOPAY PYMT' },
    ]);
    expect(r.headline.requiredCents).toBe(0);
    expect(r.headline.byDate).toBeNull();
    expect(r.headline.shortfallCents).toBe(0);
  });

  it('a PARTIAL payment leaves exactly the remainder — not zero, not the whole bill', () => {
    const r = run([
      { accountId: 'cardA', date: '2026-08-05', amountCents: 400000, rawDescriptor: 'CAPITAL ONE ONLINE PYMT' },
      { accountId: 'chk', date: '2026-08-05', amountCents: -400000, rawDescriptor: 'CAPITAL ONE ONLINE PYMT' },
    ]);
    expect(r.cards.find((c) => c.cardName === 'Venture')?.remainingDueCents).toBe(525093);
    expect(r.headline.requiredCents).toBe(525093);
  });

  it('ABSTAINS on a merchant refund posted after close — the bill is still demanded in full', () => {
    const r = run([
      { accountId: 'cardA', date: '2026-07-26', amountCents: 62073, rawDescriptor: 'AMAZON MKTPLACE PMTS' },
    ]);
    expect(r.cards.find((c) => c.cardName === 'Venture')?.remainingDueCents).toBe(925093);
    expect(r.headline.requiredCents).toBe(925093);
  });

  it('ABSTAINS on a credit whose only match is another CARD (the duplicate-connection refund)', () => {
    const withDupe = {
      ...base([]),
      accounts: [
        ...base([]).accounts,
        { id: 'cardDupe', name: 'Venture (duplicate feed)', type: 'CREDIT', currentBalanceCents: 1070025, aprBps: 2499, dueDayOfMonth: 5, cycleCloseDayOfMonth: 11 },
      ],
      transactions: [
        { accountId: 'cardA', date: '2026-07-21', amountCents: 5002, rawDescriptor: 'DOGWOOD GOLF CLUB', status: 'POSTED', isTransfer: true },
        { accountId: 'cardDupe', date: '2026-07-21', amountCents: -5002, rawDescriptor: 'DOGWOOD GOLF CLUB', status: 'POSTED', isTransfer: true },
      ],
    };
    const r = computeCashNeeded(assembleCashNeededInput(withDupe));
    expect(r.cards.find((c) => c.cardName === 'Venture')?.remainingDueCents).toBe(925093);
  });

  it('a credited payment is never ALSO announced as a next-statement credit', () => {
    // The post-close-credit note says a credit "reduces your next statement, not
    // this amount due" — the correct sentence for a refund and a flat
    // contradiction of a payment we just subtracted. The two sets must be
    // disjoint, and BOTH must still be reachable in one cycle, so the fixture
    // carries one of each: a $4,000 payment and a genuine $620.73 refund.
    //
    // A fully-paid card cannot test this — its statement settles, `current` goes
    // null, and the card leaves the path that emits either note, so both
    // assertions would pass without proving anything. Partial payment is the
    // only shape where the two sentences compete for the same card.
    //
    // isTransfer is left FALSE on both legs on purpose: the background flag
    // refresh can lag the rows, and this must not depend on it having run.
    const r = run([
      { accountId: 'cardA', date: '2026-08-05', amountCents: 400000, rawDescriptor: 'CAPITAL ONE ONLINE PYMT' },
      { accountId: 'chk', date: '2026-08-05', amountCents: -400000, rawDescriptor: 'CAPITAL ONE ONLINE PYMT' },
      { accountId: 'cardA', date: '2026-07-26', amountCents: 62073, rawDescriptor: 'AMAZON MKTPLACE PMTS' },
    ]);
    const notes = r.cards.flatMap((c) => c.notes);
    // The payment is named as a payment, for its own amount and no other.
    expect(notes.some((n) => n.includes('$4,000.00 already paid this cycle'))).toBe(true);
    // The refund is named as a refund, for its own amount and no other.
    expect(notes.some((n) => n.includes('$620.73 credit posted after statement close'))).toBe(true);
    expect(notes.some((n) => n.includes('$4,000.00 credit posted after statement close'))).toBe(false);
    // And the refund is NOT also subtracted: $9,250.93 − $4,000 payment, with
    // the $620.73 left for next statement.
    expect(r.cards.find((c) => c.cardName === 'Venture')?.remainingDueCents).toBe(525093);
  });

  it('a fully-paid card announces neither note — it has left the statement path', () => {
    const r = run([
      { accountId: 'cardA', date: '2026-08-05', amountCents: 925093, rawDescriptor: 'CAPITAL ONE AUTOPAY PYMT' },
      { accountId: 'chk', date: '2026-08-05', amountCents: -925093, rawDescriptor: 'CAPITAL ONE AUTOPAY PYMT' },
    ]);
    const notes = r.cards.flatMap((c) => c.notes);
    expect(notes.some((n) => n.includes('reduces your next statement'))).toBe(false);
    expect(notes.some((n) => n.includes('already paid this cycle'))).toBe(false);
    // What it DOES say: the next bill is an estimate, and it is not owed now.
    expect(notes.some((n) => n.includes('statement not generated yet'))).toBe(true);
    expect(r.headline.requiredCents).toBe(0);
  });

  it('still names a genuine refund as a next-statement credit when no payment is involved', () => {
    const r = run([
      { accountId: 'cardA', date: '2026-07-26', amountCents: 62073, rawDescriptor: 'AMAZON MKTPLACE PMTS' },
    ]);
    const notes = r.cards.flatMap((c) => c.notes);
    expect(notes.some((n) => n.includes('reduces your next statement'))).toBe(true);
  });
});
