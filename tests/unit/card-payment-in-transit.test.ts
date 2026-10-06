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
    const r = run([...OWNER_SHAPE, { accountId: 'b', date: '2026-10-07', amountCents: 432109 }, { accountId: 'c', date: '2026-10-06', amountCents: 987654 }]);
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
    expect(r.inTransitPayments.map((x) => x.cardName)).toEqual(['Card C']);
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
    expect(due(only({ accountId: 'chk', date: '2026-09-10', amountCents: -432109 }), 'Card B')).toBe(432109);
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
        candidates: [{ cardAccountId: 'b', statementId: 'sb', cycleEnd: '2026-09-10', unpaidCents: 432109 }],
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
      candidates: [{ cardAccountId: 'b', statementId: 'sb', cycleEnd: '2026-09-10', unpaidCents: 432109 }],
    });
    expect(found.map((f) => [f.date, f.amountCents])).toEqual([['2026-10-05', 432109]]);
  });

  it('card-payment words: what the banks print, and what they do not', () => {
    for (const d of ['NORTHWIND BANK CRCARDPMT', 'CHASE CREDIT CRD AUTOPAY', 'AMEX EPAYMENT ACH PMT', 'DISCOVER E-PAYMENT', 'CITI CARD ONLINE PAYMENT', 'CAPITAL ONE AUTOPAY PYMT', 'AUTOMATIC PAYMENT - THANK']) {
      expect(CARD_PAYMENT_WORDS_RE.test(d), d).toBe(true);
    }
    for (const d of ['ONLINE TRANSFER TO SAVINGS', 'ZELLE PAYMENT TO MARY', 'USBANK LOAN PAYMENT', 'VANGUARD BUY INVESTMENT']) {
      expect(CARD_PAYMENT_WORDS_RE.test(d), d).toBe(false);
    }
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
      inTransitPaymentsSentence([{ cardId: 'b', cardName: 'Card B', amountCents: cents(432109), date: isoDate('2026-10-05'), fromAccountName: 'Everyday Checking' }]),
    ).toBe(
      'Counted as paid before the card company shows it: $4,321.09 to Card B (left Everyday Checking Mon, Oct 5). It matches what was left to pay on that card’s statement, to the cent.',
    );
  });
});
