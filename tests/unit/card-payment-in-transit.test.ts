/**
 * DECISIONS #791 — a card payment counts once it leaves checking, before the card side shows it.
 *
 * Owner, live, 2026-10-06: "I've clearly paid off my ccs for this cycle. However it says I
 * still owe." Measured read-only on production (figures stay out of the repo): three payments
 * left checking on the due date, each exactly one card's statement balance; the issuer had
 * shown ONE on the card side a day later and neither of the others, so Home demanded two
 * bills the checking balance had already paid. Every figure below is invented, in that shape.
 */
import { describe, expect, it } from 'vitest';
import { holidayTable, isoDate } from '@/lib/dates';
import { assembleCashNeededInput } from '@/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import {
  BILL_PAY_WORDS_RE,
  CARD_ISSUER_RE,
  CARD_PAYMENT_WORDS_RE,
  detectInTransitCardPayments,
  type InTransitTxn,
} from '@/lib/engine/cash-needed/detected-payments';
import { inTransitPaymentsSentence } from '@/lib/engine/cash-needed/in-transit-copy';
import { cents } from '@/lib/money';
import { answerCashNeeded } from '@/lib/engine/assistant/answer';

const TODAY = isoDate('2026-10-06');
const HOLIDAYS = holidayTable(2026, 2027);
const DESC = 'NORTHWIND BANK CRCARDPMT';

type Row = { accountId: string; date: string; amountCents: number; rawDescriptor?: string; status?: string; isTransfer?: boolean; categoryId?: string | null };

/** Three cards, statements closed Sep 10, due Oct 5: $1,234.56, $4,321.09 and $9,876.54. */
const base = (rows: Row[], extra: { statements?: { id: string; accountId: string; cycleEnd: string; dueDate: string; statementBalanceCents: number; minimumPaymentCents: number }[] } = {}) => ({
  today: TODAY,
  scenario: 'PAY_IN_FULL' as const,
  paymentAccountId: 'chk',
  accounts: [
    { id: 'chk', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 300000, aprBps: null, dueDayOfMonth: null, cycleCloseDayOfMonth: null },
    { id: 'sav', name: 'Rainy Day Savings', type: 'SAVINGS', currentBalanceCents: 500000, aprBps: null, dueDayOfMonth: null, cycleCloseDayOfMonth: null },
    { id: 'a', name: 'Card A', type: 'CREDIT', currentBalanceCents: 20000, aprBps: 2499, dueDayOfMonth: 5, cycleCloseDayOfMonth: 10 },
    { id: 'b', name: 'Card B', type: 'CREDIT', currentBalanceCents: 480000, aprBps: 2499, dueDayOfMonth: 5, cycleCloseDayOfMonth: 10 },
    { id: 'c', name: 'Card C', type: 'CREDIT', currentBalanceCents: 1010000, aprBps: 2499, dueDayOfMonth: 5, cycleCloseDayOfMonth: 10 },
  ],
  autopays: [],
  statements: extra.statements ?? [
    { id: 'sa', accountId: 'a', cycleEnd: '2026-09-10', dueDate: '2026-10-05', statementBalanceCents: 123456, minimumPaymentCents: 3500 },
    { id: 'sb', accountId: 'b', cycleEnd: '2026-09-10', dueDate: '2026-10-05', statementBalanceCents: 432109, minimumPaymentCents: 4300 },
    { id: 'sc', accountId: 'c', cycleEnd: '2026-09-10', dueDate: '2026-10-05', statementBalanceCents: 987654, minimumPaymentCents: 9800 },
  ],
  cardPayments: [],
  transactions: rows.map((r) => ({ status: 'POSTED', isTransfer: true, rawDescriptor: DESC, categoryId: 'transfer', ...r })),
  scheduled: [],
  holidayTable: HOLIDAYS,
});
const run = (rows: Row[], extra?: Parameters<typeof base>[1]) => computeCashNeeded(assembleCashNeededInput(base(rows, extra)));
/** What a card owes on its STATEMENT this cycle (a settled card shows next cycle's estimate instead — not a bill). */
const due = (r: ReturnType<typeof run>, name: string) => r.cards.find((c) => c.cardName === name && !c.isEstimated)?.remainingDueCents ?? 0;

/** The owner's shape: all three debits posted Oct 5; only Card A's card side has shown it. */
const OWNER_SHAPE: Row[] = [
  { accountId: 'chk', date: '2026-10-05', amountCents: -123456 },
  { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
  { accountId: 'chk', date: '2026-10-05', amountCents: -987654 },
  { accountId: 'a', date: '2026-10-05', amountCents: 123456, rawDescriptor: 'NORTHWIND AUTOPAY PYMT' },
];

describe('#791 — test_regression__a_card_payment_counts_once_it_leaves_checking', () => {
  it('CONTROL — before #791 two of the three bills were still demanded ($4,321.09 + $9,876.54 = $14,197.63)', () => {
    // Without the bank-side debits the same statements are demanded in full; with only the
    // card A pair, A is paid and B and C are not. The debits are what #791 reads.
    const r = run([{ accountId: 'a', date: '2026-10-05', amountCents: 123456, rawDescriptor: 'NORTHWIND AUTOPAY PYMT' }, { accountId: 'chk', date: '2026-10-05', amountCents: -123456 }]);
    expect(due(r, 'Card A')).toBe(0);
    expect(r.headline.requiredCents).toBe(432109 + 987654);
  });

  it('the owner’s shape: nothing is due, and the two in-transit payments are named', () => {
    const r = run(OWNER_SHAPE);
    expect(r.headline.requiredCents).toBe(0);
    expect(r.headline.firstDueDate).toBeNull();
    expect(r.inTransitPayments.map((x) => [x.cardName, x.amountCents, x.date, x.fromAccountName])).toEqual([
      ['Card B', 432109, '2026-10-05', 'Everyday Checking'],
      ['Card C', 987654, '2026-10-05', 'Everyday Checking'],
    ]);
    expect(inTransitPaymentsSentence(r.inTransitPayments)).toBe(
      'Counted as paid before the card companies show them: $4,321.09 to Card B (left Everyday Checking Mon, Oct 5); and $9,876.54 to Card C (left Everyday Checking Mon, Oct 5). Each matches what was left to pay on that card’s statement, to the cent.',
    );
  });

  it('once the card side posts inside the pair window, the pair rule owns it — counted once, nothing in transit', () => {
    const r = run([...OWNER_SHAPE, { accountId: 'b', date: '2026-10-06', amountCents: 432109 }, { accountId: 'c', date: '2026-10-06', amountCents: 987654 }]);
    expect(r.headline.requiredCents).toBe(0);
    expect(r.inTransitPayments).toEqual([]);
  });

  it('a card side that posts AFTER the pair window is the same money — still paid, never a "next statement" credit', () => {
    // Today Oct 12: Card C's credit posted Oct 11, six days after the debit.
    const rows: Row[] = [...OWNER_SHAPE, { accountId: 'c', date: '2026-10-11', amountCents: 987654 }];
    const r = computeCashNeeded(assembleCashNeededInput({ ...base(rows), today: isoDate('2026-10-12') }));
    expect(due(r, 'Card C')).toBe(0);
    const notes = r.cards.flatMap((c) => c.notes);
    expect(notes.some((n) => n.includes('credit posted after statement close'))).toBe(false);
  });
});

describe('#791 — a late card side on a bill not yet due', () => {
  it('the arrival is the same money: no "credit posted after statement close" for it', () => {
    // Due Oct 25, so the paid statement stays current; the card side posts Oct 11, six days
    // after the debit — outside the pair window — and the feed did not flag it a transfer.
    const statements = [{ id: 'sc', accountId: 'c', cycleEnd: '2026-09-28', dueDate: '2026-10-25', statementBalanceCents: 987654, minimumPaymentCents: 9800 }];
    const rows: Row[] = [
      { accountId: 'chk', date: '2026-10-05', amountCents: -987654 },
      { accountId: 'c', date: '2026-10-11', amountCents: 987654, isTransfer: false, categoryId: null, rawDescriptor: 'PAYMENT RECEIVED' },
    ];
    const r = computeCashNeeded(assembleCashNeededInput({ ...base(rows, { statements }), today: isoDate('2026-10-12') }));
    expect(due(r, 'Card C')).toBe(0);
    // Still credited, but the card company HAS shown it now — so it is no longer listed as
    // "before the card company shows it" (critic cycle 1, P2-1).
    expect(r.inTransitPayments).toEqual([]);
    expect(r.cards.flatMap((c) => c.notes).some((n) => n.includes('credit posted after statement close'))).toBe(false);
  });

  it('control — a genuine refund on that card is still announced', () => {
    const statements = [{ id: 'sc', accountId: 'c', cycleEnd: '2026-09-28', dueDate: '2026-10-25', statementBalanceCents: 987654, minimumPaymentCents: 9800 }];
    const rows: Row[] = [
      { accountId: 'chk', date: '2026-10-05', amountCents: -987654 },
      { accountId: 'c', date: '2026-10-11', amountCents: 2599, isTransfer: false, categoryId: 'refund', rawDescriptor: 'MERCHANT REFUND' },
    ];
    const r = computeCashNeeded(assembleCashNeededInput({ ...base(rows, { statements }), today: isoDate('2026-10-12') }));
    expect(r.cards.flatMap((c) => c.notes).some((n) => n.includes('$25.99 credit posted after statement close'))).toBe(true);
  });
});

describe('#791 — every refusal (the bill is demanded as before)', () => {
  const only = (row: Row, extra?: Parameters<typeof base>[1]) => run([row], extra);

  it('a part payment is not the remainder', () => {
    const r = only({ accountId: 'chk', date: '2026-10-05', amountCents: -400000 });
    expect(due(r, 'Card B')).toBe(432109);
    expect(r.inTransitPayments).toEqual([]);
  });

  it('two cards with the same unpaid remainder: the payment names neither', () => {
    const statements = [
      { id: 'sa', accountId: 'a', cycleEnd: '2026-09-10', dueDate: '2026-10-05', statementBalanceCents: 432109, minimumPaymentCents: 3500 },
      { id: 'sb', accountId: 'b', cycleEnd: '2026-09-10', dueDate: '2026-10-05', statementBalanceCents: 432109, minimumPaymentCents: 4300 },
    ];
    const r = only({ accountId: 'chk', date: '2026-10-05', amountCents: -432109 }, { statements });
    expect(due(r, 'Card A')).toBe(432109);
    expect(due(r, 'Card B')).toBe(432109);
  });

  it('a row that does not read as a card payment: a loan payment, an unfiled one, a transfer with no card words', () => {
    for (const row of [
      { accountId: 'chk', date: '2026-10-05', amountCents: -432109, categoryId: 'loan-payment', isTransfer: false, rawDescriptor: 'NORTHWIND LOAN PAYMENT' },
      { accountId: 'chk', date: '2026-10-05', amountCents: -432109, categoryId: null, isTransfer: false },
      { accountId: 'chk', date: '2026-10-05', amountCents: -432109, rawDescriptor: 'ONLINE TRANSFER TO SAVINGS' },
    ]) {
      expect(due(only(row), 'Card B'), JSON.stringify(row)).toBe(432109);
    }
    // Filed Credit Card Payment needs no words.
    expect(due(only({ accountId: 'chk', date: '2026-10-05', amountCents: -432109, categoryId: 'credit-card-payment', isTransfer: false, rawDescriptor: 'WEB PMT 5521' }), 'Card B')).toBe(0);
  });

  it('a payment the card side already shows pays ITS card — never a second card with the same amount due', () => {
    const statements = [
      { id: 'sb', accountId: 'b', cycleEnd: '2026-09-10', dueDate: '2026-10-05', statementBalanceCents: 432109, minimumPaymentCents: 4300 },
      { id: 'sc', accountId: 'c', cycleEnd: '2026-09-10', dueDate: '2026-10-05', statementBalanceCents: 432109, minimumPaymentCents: 9800 },
    ];
    const r = run(
      [
        { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
        { accountId: 'b', date: '2026-10-06', amountCents: 432109, rawDescriptor: 'NORTHWIND AUTOPAY PYMT' },
      ],
      { statements },
    );
    expect(due(r, 'Card B')).toBe(0);
    expect(due(r, 'Card C')).toBe(432109);
    expect(r.inTransitPayments).toEqual([]);
  });

  it('a move between the reader’s own bank accounts', () => {
    const r = run([
      { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
      { accountId: 'sav', date: '2026-10-06', amountCents: 432109, rawDescriptor: 'TRANSFER FROM CHECKING' },
    ]);
    expect(due(r, 'Card B')).toBe(432109);
  });

  it('a payment that came back', () => {
    const r = run([
      { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
      { accountId: 'chk', date: '2026-10-06', amountCents: 432109, rawDescriptor: 'RETURNED ITEM NORTHWIND CRCARDPMT' },
    ]);
    expect(due(r, 'Card B')).toBe(432109);
  });

  it('a payment on or before the statement closed is already inside the balance', () => {
    const r = only({ accountId: 'chk', date: '2026-09-10', amountCents: -432109 });
    expect(due(r, 'Card B')).toBe(432109);
    expect(r.inTransitPayments).toEqual([]); // never named as counted, either
  });

  it('pending, split-parent, after-today and non-bank rows', () => {
    for (const row of [
      { accountId: 'chk', date: '2026-10-05', amountCents: -432109, status: 'PENDING' },
      { accountId: 'chk', date: '2026-10-07', amountCents: -432109 },
      { accountId: 'a', date: '2026-10-05', amountCents: -432109 },
    ]) {
      expect(due(only(row), 'Card B'), JSON.stringify(row)).toBe(432109);
    }
    const split: InTransitTxn = { accountId: 'chk', date: '2026-10-05', amountCents: -432109, status: 'POSTED', isSplitParent: true, isTransfer: true, categoryId: 'transfer', rawDescriptor: DESC };
    expect(
      detectInTransitCardPayments({
        transactions: [split],
        accountTypeById: new Map([['chk', 'CHECKING'], ['b', 'CREDIT']]),
        today: TODAY,
        candidates: [{ cardAccountId: 'b', statementId: 'sb', cycleEnd: '2026-09-10', statementBalanceCents: 432109, payments: [] }],
      }),
    ).toEqual([]);
  });

  it('two payments of one remainder: the first pays it, the second finds it paid', () => {
    const found = detectInTransitCardPayments({
      transactions: [
        { accountId: 'chk', date: '2026-10-05', amountCents: -432109, status: 'POSTED', isTransfer: true, categoryId: 'transfer', rawDescriptor: DESC },
        { accountId: 'chk', date: '2026-10-06', amountCents: -432109, status: 'POSTED', isTransfer: true, categoryId: 'transfer', rawDescriptor: DESC },
      ],
      accountTypeById: new Map([['chk', 'CHECKING'], ['b', 'CREDIT']]),
      today: TODAY,
      candidates: [{ cardAccountId: 'b', statementId: 'sb', cycleEnd: '2026-09-10', statementBalanceCents: 432109, payments: [] }],
    });
    expect(found.map((f) => [f.date, f.amountCents])).toEqual([['2026-10-05', 432109]]);
  });

  it('card-payment words: what the banks print, and what they do not', () => {
    // Words only a card payment carries.
    for (const d of ['NORTHWIND BANK CRCARDPMT', 'CHASE CREDIT CRD AUTOPAY', 'CITI CARD ONLINE PAYMENT', 'CREDIT CARD PAYMENT']) {
      expect(CARD_PAYMENT_WORDS_RE.test(d), d).toBe(true);
    }
    // Words every bill prints — a card payment only beside a card issuer (critic cycle 1, P2-2).
    const billPay = (d: string) => BILL_PAY_WORDS_RE.test(d) && CARD_ISSUER_RE.test(d);
    for (const d of ['AMEX EPAYMENT ACH PMT', 'DISCOVER E-PAYMENT', 'CAPITAL ONE AUTOPAY PYMT', 'BARCLAYCARD ONLINE PMT']) {
      expect(CARD_PAYMENT_WORDS_RE.test(d) || billPay(d), d).toBe(true);
    }
    for (const d of ['VERIZON WIRELESS EPAY', 'TOYOTA FINANCIAL AUTOPAY', 'ONLINE TRANSFER TO SAVINGS', 'ZELLE PAYMENT TO MARY', 'USBANK LOAN PAYMENT', 'VANGUARD BUY INVESTMENT', 'AUTOMATIC PAYMENT - THANK']) {
      expect(CARD_PAYMENT_WORDS_RE.test(d) || billPay(d), d).toBe(false);
    }
  });
});

describe('#791 critic cycle 1 — the in-transit credit agrees with the pair rule everywhere', () => {
  // Card B carried a balance: Aug statement $3,000.00 (closed Aug 10, due Sep 5), Sep statement
  // $4,321.09 (it holds the $2,000.00 carried). Today Oct 6.
  const withOlder = (rows: Row[]) =>
    run(rows, {
      statements: [
        { id: 'sb-aug', accountId: 'b', cycleEnd: '2026-08-10', dueDate: '2026-09-05', statementBalanceCents: 300000, minimumPaymentCents: 3500 },
        { id: 'sb', accountId: 'b', cycleEnd: '2026-09-10', dueDate: '2026-10-05', statementBalanceCents: 432109, minimumPaymentCents: 4300 },
      ],
    });

  it('P1-1: paying the newest statement in transit never brings back an older one as a past-due bill', () => {
    // $1,000.00 of August paid and paired Sep 4; September paid in full Oct 5, card side not shown.
    const r = withOlder([
      { accountId: 'chk', date: '2026-09-04', amountCents: -100000 },
      { accountId: 'b', date: '2026-09-04', amountCents: 100000, rawDescriptor: 'NORTHWIND AUTOPAY PYMT' },
      { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
    ]);
    expect(r.headline.requiredCents).toBe(0);
    expect(r.cards.flatMap((c) => c.notes).some((n) => n.includes('Due date has passed'))).toBe(false);
    // The same money through the pair rule gives the same $0 — one rule for both.
    const paired = withOlder([
      { accountId: 'chk', date: '2026-09-04', amountCents: -100000 },
      { accountId: 'b', date: '2026-09-04', amountCents: 100000, rawDescriptor: 'NORTHWIND AUTOPAY PYMT' },
      { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
      { accountId: 'b', date: '2026-10-06', amountCents: 432109, rawDescriptor: 'NORTHWIND AUTOPAY PYMT' },
    ]);
    expect(paired.headline.requiredCents).toBe(0);
  });

  it('P1-1: an August payment the pair rule never saw does not resurface August once September is paid in transit', () => {
    const r = withOlder([{ accountId: 'chk', date: '2026-10-05', amountCents: -432109 }]);
    expect(r.headline.requiredCents).toBe(0);
  });

  it('P1-2: the next cycle is estimated from the charges since the close, not from a balance still holding the payment', () => {
    // Card B's issuer balance is $4,800.00 (the $4,321.09 not taken off yet); $478.91 charged since Sep 10.
    const r = run([
      ...OWNER_SHAPE,
      { accountId: 'b', date: '2026-09-20', amountCents: -40000, rawDescriptor: 'KROGER', isTransfer: false, categoryId: 'groceries' },
      { accountId: 'b', date: '2026-10-01', amountCents: -7891, rawDescriptor: 'SHELL', isTransfer: false, categoryId: 'gas' },
    ]);
    const nextB = [...r.upcoming, ...r.cards].find((c) => c.cardName === 'Card B' && c.isEstimated);
    expect(nextB?.remainingDueCents).toBe(47891);
    // Card C: no charges since the close, but its issuer balance of $10,100.00 less the
    // $9,876.54 not shown yet leaves $223.46 — the larger figure (critic cycle 2, P2-2).
    const nextC = [...r.upcoming, ...r.cards].find((c) => c.cardName === 'Card C' && c.isEstimated);
    expect(nextC?.remainingDueCents).toBe(22346);
    expect(r.cards.find((c) => c.cardName === 'Card B')!.notes.join(' ')).toContain(
      'estimated from the charges since the last statement closed on Thu, Sep 10 ($478.91), because the card company’s balance may still include the $4,321.09 payment counted in transit.',
    );
    // Card A was paid through the pair rule: its estimate still reads the issuer's balance ($200.00).
    expect([...r.upcoming, ...r.cards].find((c) => c.cardName === 'Card A' && c.isEstimated)?.remainingDueCents).toBe(20000);
  });

  it('P2-1: a card side that arrived BEFORE the bank side is the same payment — not a next-statement credit, and not "not shown yet"', () => {
    // Card C credited Oct 1, the bank posted Oct 5: four days apart, outside the pair window.
    const r = run([
      { accountId: 'chk', date: '2026-10-05', amountCents: -987654 },
      { accountId: 'c', date: '2026-10-01', amountCents: 987654, rawDescriptor: 'PAYMENT RECEIVED', isTransfer: false, categoryId: null },
    ]);
    expect(due(r, 'Card C')).toBe(0);
    expect(r.cards.flatMap((c) => c.notes).some((n) => n.includes('credit posted after statement close'))).toBe(false);
    expect(r.inTransitPayments).toEqual([]);
  });

  it('P2-1: once the card side has arrived late, the sentence no longer says it has not', () => {
    const rows: Row[] = [...OWNER_SHAPE, { accountId: 'c', date: '2026-10-11', amountCents: 987654 }];
    const r = computeCashNeeded(assembleCashNeededInput({ ...base(rows), today: isoDate('2026-10-12') }));
    expect(r.inTransitPayments.map((x) => x.cardName)).toEqual(['Card B']);
  });

  it('P2-2: bill-pay words read as a card payment only beside a card issuer; another filing is never one', () => {
    const one = (row: Row) => due(run([row]), 'Card B');
    // The categorizer files EPAY rows Transfer — a phone bill is still not a card payment.
    expect(one({ accountId: 'chk', date: '2026-10-05', amountCents: -432109, categoryId: 'transfer', rawDescriptor: 'VERIZON WIRELESS EPAY' })).toBe(432109);
    // Flagged a transfer by the pair detector, filed to a car loan.
    expect(one({ accountId: 'chk', date: '2026-10-05', amountCents: -432109, categoryId: 'auto-loan', isTransfer: true, rawDescriptor: 'TOYOTA FINANCIAL AUTOPAY' })).toBe(432109);
    // A card issuer's bill-pay text is a card payment; so is an unfiled transfer with card words.
    expect(one({ accountId: 'chk', date: '2026-10-05', amountCents: -432109, categoryId: 'transfer', rawDescriptor: 'AMEX EPAYMENT ACH PMT' })).toBe(0);
    expect(one({ accountId: 'chk', date: '2026-10-05', amountCents: -432109, categoryId: null, isTransfer: true, rawDescriptor: 'CAPITAL ONE CRCARDPMT' })).toBe(0);
    expect(one({ accountId: 'chk', date: '2026-10-05', amountCents: -432109, categoryId: null, isTransfer: false, rawDescriptor: 'CAPITAL ONE CRCARDPMT' })).toBe(432109);
    // Filed to spending by the reader or a rule: never a card payment, flag and words or no.
    expect(one({ accountId: 'chk', date: '2026-10-05', amountCents: -432109, categoryId: 'shopping', isTransfer: true, rawDescriptor: 'CAPITAL ONE CRCARDPMT' })).toBe(432109);
  });

  it('P2-3: topping checking up with exactly the bill — the same day or the next — is not the payment coming back', () => {
    for (const day of ['2026-10-05', '2026-10-06']) {
      const r = run([
        { accountId: 'sav', date: day, amountCents: -432109, rawDescriptor: 'TRANSFER TO CHECKING' },
        { accountId: 'chk', date: day, amountCents: 432109, rawDescriptor: 'TRANSFER FROM SAVINGS' },
        { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
      ]);
      expect(due(r, 'Card B'), day).toBe(0);
    }
    // An unrelated deposit of the same amount the SAME day is not a return (returns post later).
    const sameDay = run([
      { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
      { accountId: 'chk', date: '2026-10-05', amountCents: 432109, rawDescriptor: 'MOBILE DEPOSIT', isTransfer: false, categoryId: 'income' },
    ]);
    expect(due(sameDay, 'Card B')).toBe(0);
    // A same-amount deposit on a LATER day with no move behind it is a return.
    const returned = run([
      { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
      { accountId: 'chk', date: '2026-10-06', amountCents: 432109, rawDescriptor: 'RETURNED ITEM' },
    ]);
    expect(due(returned, 'Card B')).toBe(432109);
  });
});

describe('#791 critic cycle 2', () => {
  it('P1-1: only the NEWEST statement is ever current — paying it never resurfaces an older one', () => {
    // Sep $4,321.09 paid Oct 5 from checking; the card side posts Oct 9, outside the pair
    // window. Oct statement $1,000.00 (closed Oct 10, due Nov 5) paid Nov 5. Today Nov 6.
    const statements = [
      { id: 'sb-sep', accountId: 'b', cycleEnd: '2026-09-10', dueDate: '2026-10-05', statementBalanceCents: 432109, minimumPaymentCents: 4300 },
      { id: 'sb-oct', accountId: 'b', cycleEnd: '2026-10-10', dueDate: '2026-11-05', statementBalanceCents: 100000, minimumPaymentCents: 3500 },
    ];
    const rows: Row[] = [
      { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
      { accountId: 'b', date: '2026-10-09', amountCents: 432109, rawDescriptor: 'PAYMENT RECEIVED', isTransfer: false, categoryId: null },
      { accountId: 'chk', date: '2026-11-05', amountCents: -100000 },
    ];
    const r = computeCashNeeded(assembleCashNeededInput({ ...base(rows, { statements }), today: isoDate('2026-11-06') }));
    expect(r.headline.requiredCents).toBe(0);
    expect(r.cards.flatMap((c) => c.notes).some((n) => n.includes('Due date has passed'))).toBe(false);
  });

  it('P1-1: an older statement paid from an unlinked bank does not come back when the newer one is paid', () => {
    const statements = [
      { id: 'sb-aug', accountId: 'b', cycleEnd: '2026-08-10', dueDate: '2026-09-05', statementBalanceCents: 300000, minimumPaymentCents: 3500 },
      { id: 'sb', accountId: 'b', cycleEnd: '2026-09-10', dueDate: '2026-10-05', statementBalanceCents: 50000, minimumPaymentCents: 3500 },
    ];
    expect(run([{ accountId: 'chk', date: '2026-10-05', amountCents: -50000 }], { statements }).headline.requiredCents).toBe(0);
  });

  it('P2-1: a top-up beside a returned payment never hides the return — one move explains one deposit', () => {
    const r = run([
      { accountId: 'sav', date: '2026-10-04', amountCents: -432109, rawDescriptor: 'TRANSFER TO CHECKING' },
      { accountId: 'chk', date: '2026-10-04', amountCents: 432109, rawDescriptor: 'TRANSFER FROM SAVINGS' },
      { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
      { accountId: 'chk', date: '2026-10-06', amountCents: 432109, rawDescriptor: 'RETURNED ITEM' },
    ]);
    expect(due(r, 'Card B')).toBe(432109);
    expect(r.inTransitPayments).toEqual([]);
  });

  it('P2-2: the estimate is the larger of the charges since the close and the balance less the unshown payment', () => {
    // No card rows since the close; the issuer balance $4,800.00 still holds the $4,321.09.
    const onlyB = (rows: Row[], over: object = {}) =>
      computeCashNeeded(
        assembleCashNeededInput({
          ...base(rows),
          accounts: base([]).accounts.map((a) => (a.id === 'b' ? { ...a, ...over } : a)),
        }),
      );
    const est = (r: ReturnType<typeof run>) => [...r.upcoming, ...r.cards].find((c) => c.cardName === 'Card B' && c.isEstimated);
    const r = onlyB([{ accountId: 'chk', date: '2026-10-05', amountCents: -432109 }]);
    expect(est(r)?.remainingDueCents).toBe(47891); // 480,000 − 432,109
    expect(r.cards.find((c) => c.cardName === 'Card B')!.notes.join(' ')).toContain(
      'estimated from the card company’s balance less the $4,321.09 payment it hasn’t shown yet ($478.91)',
    );
    // The issuer already took the payment off (balance $78.91) but $478.91 posted since: the charges win.
    const r2 = onlyB(
      [
        { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
        { accountId: 'b', date: '2026-09-20', amountCents: -47891, rawDescriptor: 'KROGER', isTransfer: false, categoryId: 'groceries' },
      ],
      { currentBalanceCents: 7891 },
    );
    expect(est(r2)?.remainingDueCents).toBe(47891);
    // A manual card's typed balance is never replaced; a card with no next due date keeps its real balance.
    expect(est(onlyB([{ accountId: 'chk', date: '2026-10-05', amountCents: -432109 }], { provider: 'manual' }))?.remainingDueCents).toBe(480000);
    const undated = onlyB([{ accountId: 'chk', date: '2026-10-05', amountCents: -432109 }], { dueDayOfMonth: null, cycleCloseDayOfMonth: null });
    expect(undated.cards.flatMap((c) => c.notes).join(' ')).not.toContain('estimated from');
  });

  it('P2-2: what the charges count — posted, after the close day, never a payment the pair rule credited', () => {
    // Card B with an issuer balance of $0, so only the charges can make the figure.
    const b = (rows: Row[]) => {
      const r = computeCashNeeded(
        assembleCashNeededInput({
          ...base([{ accountId: 'chk', date: '2026-10-05', amountCents: -432109 }, ...rows]),
          accounts: base([]).accounts.map((a) => (a.id === 'b' ? { ...a, currentBalanceCents: 0 } : a)),
        }),
      );
      return [...r.upcoming, ...r.cards].find((c) => c.cardName === 'Card B' && c.isEstimated)?.remainingDueCents ?? 0;
    };
    const charge = (date: string, cents: number, extra: Partial<Row> = {}): Row => ({ accountId: 'b', date, amountCents: -cents, rawDescriptor: 'KROGER', isTransfer: false, categoryId: 'groceries', ...extra });
    expect(b([charge('2026-09-20', 10000)])).toBe(10000);
    expect(b([charge('2026-09-10', 10000)])).toBe(0); // on the close day: inside the statement
    expect(b([charge('2026-09-20', 10000, { status: 'PENDING' })])).toBe(0); // pending: not posted yet
    // A $50.00 mid-cycle payment the pair rule credits is not ALSO subtracted from the new charges.
    expect(
      b([
        charge('2026-09-20', 10000),
        { accountId: 'chk', date: '2026-09-25', amountCents: -5000, rawDescriptor: 'ONLINE PMT', isTransfer: false, categoryId: null },
        { accountId: 'b', date: '2026-09-25', amountCents: 5000, rawDescriptor: 'PAYMENT RECEIVED', isTransfer: false, categoryId: null },
      ]),
    ).toBe(10000);
  });

  it('P2-3: an unrelated refund of the same amount is not the payment arriving', () => {
    const statements = [{ id: 'sb', accountId: 'b', cycleEnd: '2026-09-28', dueDate: '2026-10-25', statementBalanceCents: 432109, minimumPaymentCents: 4300 }];
    const rows: Row[] = [
      { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
      { accountId: 'b', date: '2026-10-13', amountCents: 432109, rawDescriptor: 'BEST BUY REFUND', isTransfer: false, categoryId: 'electronics' },
    ];
    const r = computeCashNeeded(assembleCashNeededInput({ ...base(rows, { statements }), today: isoDate('2026-10-14') }));
    expect(r.inTransitPayments.map((x) => x.cardName)).toEqual(['Card B']);
    expect(r.cards.flatMap((c) => c.notes).some((n) => n.includes('$4,321.09 credit posted after statement close'))).toBe(true);
  });

  it('P3-3: a card side up to 31 days late is the payment arriving; past that it is not', () => {
    const statements = [{ id: 'sb', accountId: 'b', cycleEnd: '2026-09-28', dueDate: '2026-11-25', statementBalanceCents: 432109, minimumPaymentCents: 4300 }];
    const at = (day: string, today: string) =>
      computeCashNeeded(
        assembleCashNeededInput({
          ...base([{ accountId: 'chk', date: '2026-10-05', amountCents: -432109 }, { accountId: 'b', date: day, amountCents: 432109, rawDescriptor: 'PAYMENT RECEIVED', isTransfer: false, categoryId: null }], { statements }),
          today: isoDate(today),
        }),
      );
    expect(at('2026-11-05', '2026-11-06').inTransitPayments).toEqual([]); // 31 days: arrived
    expect(at('2026-11-06', '2026-11-07').inTransitPayments.map((x) => x.cardName)).toEqual(['Card B']); // 32: not
  });

  it('P2-4: a payment made after the in-transit one never undoes it; the whole statement balance also matches', () => {
    const after = computeCashNeeded(
      assembleCashNeededInput({
        ...base([
          { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
          { accountId: 'chk', date: '2026-10-06', amountCents: -10000, rawDescriptor: 'ONLINE PMT', isTransfer: false, categoryId: null },
          { accountId: 'b', date: '2026-10-06', amountCents: 10000, rawDescriptor: 'PAYMENT RECEIVED', isTransfer: false, categoryId: null },
        ]),
        today: isoDate('2026-10-07'),
      }),
    );
    expect(due(after, 'Card B')).toBe(0);
    // $100.00 paid Sep 20, then the full statement balance Oct 5: matched by the whole balance.
    const before = run([
      { accountId: 'chk', date: '2026-09-20', amountCents: -10000, rawDescriptor: 'ONLINE PMT', isTransfer: false, categoryId: null },
      { accountId: 'b', date: '2026-09-20', amountCents: 10000, rawDescriptor: 'PAYMENT RECEIVED', isTransfer: false, categoryId: null },
      { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
    ]);
    expect(due(before, 'Card B')).toBe(0);
  });

  it('P2-4: the remainder is read ON the day the money left — payments before it count, payments after do not', () => {
    // $100.00 paid Sep 20, the $4,221.09 remainder Oct 5, then $50.00 more Oct 6. Today Oct 7.
    const r = computeCashNeeded(
      assembleCashNeededInput({
        ...base([
          { accountId: 'chk', date: '2026-09-20', amountCents: -10000, rawDescriptor: 'ONLINE PMT', isTransfer: false, categoryId: null },
          { accountId: 'b', date: '2026-09-20', amountCents: 10000, rawDescriptor: 'PAYMENT RECEIVED', isTransfer: false, categoryId: null },
          { accountId: 'chk', date: '2026-10-05', amountCents: -422109 },
          { accountId: 'chk', date: '2026-10-06', amountCents: -5000, rawDescriptor: 'ONLINE PMT', isTransfer: false, categoryId: null },
          { accountId: 'b', date: '2026-10-06', amountCents: 5000, rawDescriptor: 'PAYMENT RECEIVED', isTransfer: false, categoryId: null },
        ]),
        today: isoDate('2026-10-07'),
      }),
    );
    expect(r.inTransitPayments.map((x) => [x.cardName, x.amountCents])).toEqual([['Card B', 422109]]);
  });

  it('an arrival is never a credit the pair rule used, never dated inside the statement, never more than 14 days early', () => {
    const statements = [{ id: 'sb', accountId: 'b', cycleEnd: '2026-09-10', dueDate: '2026-10-25', statementBalanceCents: 432109, minimumPaymentCents: 4300 }];
    const listed = (rows: Row[], today = '2026-10-14') =>
      computeCashNeeded(assembleCashNeededInput({ ...base([{ accountId: 'chk', date: '2026-10-05', amountCents: -432109 }, ...rows], { statements }), today: isoDate(today) }))
        .inTransitPayments.map((x) => x.cardName);
    const credit = (date: string): Row => ({ accountId: 'b', date, amountCents: 432109, rawDescriptor: 'PAYMENT RECEIVED', isTransfer: false, categoryId: null });
    // A second payment of the same amount on Oct 12, paired with its own debit: the pair rule's, not an arrival.
    expect(listed([{ accountId: 'chk', date: '2026-10-12', amountCents: -432109, rawDescriptor: 'ONLINE PMT', isTransfer: false, categoryId: null }, credit('2026-10-12')])).toEqual(['Card B']);
    // Dated on or before the close: inside the statement already — even within 14 days of the debit.
    const late = [{ id: 'sb', accountId: 'b', cycleEnd: '2026-09-28', dueDate: '2026-10-25', statementBalanceCents: 432109, minimumPaymentCents: 4300 }];
    expect(
      computeCashNeeded(assembleCashNeededInput({ ...base([{ accountId: 'chk', date: '2026-10-05', amountCents: -432109 }, credit('2026-09-27')], { statements: late }), today: isoDate('2026-10-14') }))
        .inTransitPayments.map((x) => x.cardName),
    ).toEqual(['Card B']);
    // After the close but 20 days before the debit: too early to be this payment.
    expect(listed([credit('2026-09-15')])).toEqual(['Card B']);
    // Control: 10 days early, after the close — the payment arriving first.
    expect(listed([credit('2026-09-25')])).toEqual([]);
  });

  it('a card with no next due date keeps the card company’s balance on the undated list', () => {
    const r = computeCashNeeded(
      assembleCashNeededInput({
        ...base([{ accountId: 'chk', date: '2026-10-05', amountCents: -432109 }]),
        accounts: base([]).accounts.map((a) => (a.id === 'b' ? { ...a, dueDayOfMonth: null, cycleCloseDayOfMonth: null } : a)),
      }),
    );
    const undated = r.unknownDueDateCards.find((c) => c.cardName === 'Card B');
    if (undated) expect(undated.currentBalanceCents).toBe(480000);
    expect(r.cards.find((c) => c.cardName === 'Card B')?.notes.join(' ') ?? '').not.toContain('estimated from');
  });

  it('P3-4: an issuer’s loan, mortgage or insurance payment is not a card payment', () => {
    for (const d of ['CHASE MORTGAGE EPAY', 'CHASE HOME LENDING EPAY', 'CHASE AUTO EPAY', 'DISCOVER STUDENT LOAN EPAY', 'WELLS FARGO AUTO EPAY', 'USAA P&C EPAY', 'CAPITAL ONE AUTO FINANCE EPAY', 'GOLDMAN SACHS MARCUS EPAY', 'AMEX PERSONAL LOAN EPAY']) {
      expect(due(run([{ accountId: 'chk', date: '2026-10-05', amountCents: -432109, rawDescriptor: d }]), 'Card B'), d).toBe(432109);
    }
    // "AUTO PAY" is still a card payment beside an issuer.
    expect(due(run([{ accountId: 'chk', date: '2026-10-05', amountCents: -432109, rawDescriptor: 'CHASE AUTO PAY' }]), 'Card B')).toBe(0);
  });
});

describe('#791 critic cycle 3', () => {
  it('P2-4: once the card side shows the payment late, the next cycle reads the card company’s balance again', () => {
    // Paid Oct 5 in transit; the card side posts it Oct 11 (outside the pair window). The issuer's
    // balance is now $478.91 — exactly the charges since the close. Today Oct 13.
    const r = computeCashNeeded(
      assembleCashNeededInput({
        ...base([
          { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
          { accountId: 'b', date: '2026-09-20', amountCents: -47891, rawDescriptor: 'KROGER', isTransfer: false, categoryId: 'groceries' },
          { accountId: 'b', date: '2026-10-11', amountCents: 432109, rawDescriptor: 'PAYMENT RECEIVED', isTransfer: false, categoryId: 'credit-card-payment' },
        ]),
        accounts: base([]).accounts.map((a) => (a.id === 'b' ? { ...a, currentBalanceCents: 47891 } : a)),
        today: isoDate('2026-10-13'),
      }),
    );
    expect(r.inTransitPayments).toEqual([]);
    expect(due(r, 'Card B')).toBe(0);
    // Not $0.00: subtracting the arrived payment again would take the $4,321.09 off twice.
    expect([...r.upcoming, ...r.cards].find((c) => c.cardName === 'Card B' && c.isEstimated)?.remainingDueCents).toBe(47891);
  });

  it('P3-6: a payment the pair rule credits on the same day the remainder leaves counts toward what was left', () => {
    // $100.00 and the $4,221.09 remainder both leave Oct 5; the $100.00 shows on the card the same day.
    const r = run([
      { accountId: 'chk', date: '2026-10-05', amountCents: -10000, rawDescriptor: 'ONLINE PMT', isTransfer: false, categoryId: null },
      { accountId: 'b', date: '2026-10-05', amountCents: 10000, rawDescriptor: 'PAYMENT RECEIVED', isTransfer: false, categoryId: null },
      { accountId: 'chk', date: '2026-10-05', amountCents: -422109 },
    ]);
    expect(r.inTransitPayments.map((x) => [x.cardName, x.amountCents])).toEqual([['Card B', 422109]]);
    expect(due(r, 'Card B')).toBe(0);
  });

  it('P3-6: a card side 14 days before the bank side is the payment arriving; 15 days before is not', () => {
    const statements = [{ id: 'sb', accountId: 'b', cycleEnd: '2026-09-10', dueDate: '2026-10-25', statementBalanceCents: 432109, minimumPaymentCents: 4300 }];
    const listed = (creditDate: string) =>
      computeCashNeeded(
        assembleCashNeededInput({
          ...base(
            [
              { accountId: 'chk', date: '2026-10-05', amountCents: -432109 },
              { accountId: 'b', date: creditDate, amountCents: 432109, rawDescriptor: 'PAYMENT RECEIVED', isTransfer: false, categoryId: null },
            ],
            { statements },
          ),
          today: isoDate('2026-10-14'),
        }),
      ).inTransitPayments.map((x) => x.cardName);
    expect(listed('2026-09-21')).toEqual([]); // 14 days early: arrived
    expect(listed('2026-09-20')).toEqual(['Card B']); // 15: not
  });

  it('P2-1: the matcher reads each row a bounded number of times — never once per pair of rows', () => {
    // 2,000 rows, a quarter of them deposits into checking or savings. Before the fix the
    // top-up pass read every row once per deposit (~1,000,000 reads); now it is a few passes.
    let reads = 0;
    const row = (accountId: string, date: string, amountCents: number, rawDescriptor = 'KROGER', categoryId: string | null = 'groceries'): InTransitTxn => {
      const t = { accountId, date, amountCents, rawDescriptor, categoryId, isTransfer: categoryId === 'transfer' } as InTransitTxn;
      Object.defineProperty(t, 'status', { enumerable: true, get: () => (reads++, 'POSTED') });
      return t;
    };
    const txns: InTransitTxn[] = Array.from({ length: 2000 }, (_, i) =>
      i % 4 === 0
        ? row(i % 8 === 0 ? 'chk' : 'sav', isoDate('2026-09-11'), 432109, 'ONLINE TRANSFER', 'transfer')
        : row('b', isoDate('2026-09-12'), -(100 + i)),
    );
    txns.push(row('chk', '2026-10-05', -432109, DESC, 'transfer'));
    const found = detectInTransitCardPayments({
      transactions: txns,
      accountTypeById: new Map([['chk', 'CHECKING'], ['sav', 'SAVINGS'], ['b', 'CREDIT']]),
      today: TODAY,
      candidates: [{ cardAccountId: 'b', statementId: 'sb', cycleEnd: '2026-09-10', statementBalanceCents: 432109, payments: [] }],
    });
    // Every same-amount deposit is dated before the payment, so none is it coming back.
    expect(found.map((x) => x.amountCents)).toEqual([432109]);
    expect(reads).toBeLessThan(txns.length * 10);
  });
});

describe('#791 — Ask', () => {
  it('the all-clear and the amount due both name the payment counted in transit', () => {
    const clear = answerCashNeeded(run(OWNER_SHAPE), 'Everyday Checking');
    expect(clear.headline).toBe('You have nothing due on your cards this cycle.');
    expect(clear.detail).toContain('$4,321.09 to Card B (left Everyday Checking Mon, Oct 5)');
    // Card C still owed: the amount answer names B's payment beside it.
    const partial = answerCashNeeded(
      run([{ accountId: 'chk', date: '2026-10-05', amountCents: -432109 }]),
      'Everyday Checking',
    );
    expect(partial.detail).toContain('Counted as paid before the card company shows it: $4,321.09 to Card B');
    // Nothing in transit, nothing said.
    expect(answerCashNeeded(run([]), 'Everyday Checking').detail ?? '').not.toContain('Counted as paid');
  });
});

describe('#791 — the words', () => {
  it('one payment, and none', () => {
    expect(inTransitPaymentsSentence([])).toBeNull();
    expect(
      inTransitPaymentsSentence([{ cardId: 'b', cardName: 'Card B', amountCents: cents(432109), date: isoDate('2026-10-05'), fromAccountId: 'chk', fromAccountName: 'Everyday Checking' }]),
    ).toBe(
      'Counted as paid before the card company shows it: $4,321.09 to Card B (left Everyday Checking Mon, Oct 5). It matches what was left to pay on that card’s statement, to the cent.',
    );
  });
});
