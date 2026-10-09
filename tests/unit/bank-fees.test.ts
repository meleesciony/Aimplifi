/**
 * Fees you paid — the bank and card fees in the reader's last 12 months of records, by kind,
 * and what came back (DECISIONS #796). The engine's rule (`findBankFees`), how a row reads
 * (`feeKindOf`), what counts as a fee coming back (`readsAsFeeGivenBack`), and every sentence
 * the card prints. Every amount, date and descriptor is invented (keep-live-figures-out-of-repo).
 * Hand-verified values: tests/edge-cases/bank-fees.md.
 *
 * Critic cycle 1 locks: money in that is not a bank fee coming back is never "came back"
 * (P0-1); text that doesn't read as a bank or card fee — another business's fee, a deposit's
 * principal, a payment — is listed as not counted, never charged (P1-2); interest and annual
 * fees are read from phrases, not single words (P2-3); no records is its own lead (P2-4); the
 * handover count covers every printed amount (P2-5a).
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
import {
  bankFeeWindowStart,
  feeKindOf,
  findBankFees,
  readsAsFeeGivenBack,
  type BankFeeRowInput,
} from '@/lib/engine/fi/bank-fees';
import {
  BANK_FEES_NO_RECORDS,
  BANK_FEES_RULE,
  BANK_FEES_UNCOUNTED_NOTE,
  FEE_KIND_COPY,
  bankFeesLead,
  feeDate,
  feeKindLine,
  feeWindowPhrase,
  feesGivenBackLine,
  feesLeftOutLine,
  feesUncountedLine,
} from '@/lib/engine/fi/bank-fees-copy';

const TODAY = isoDate('2026-10-17');

let n = 0;
function row(
  accountId: string,
  date: string,
  amountCents: number,
  rawDescriptor: string,
  categoryId: string | null,
  extra: Partial<BankFeeRowInput> = {},
): BankFeeRowInput {
  n += 1;
  return {
    id: `t-${n}`,
    accountId,
    date,
    amountCents,
    rawDescriptor,
    categoryId,
    isTransfer: false,
    status: 'POSTED',
    isSplitParent: false,
    excludeFromTotals: false,
    ...extra,
  };
}

describe('feeKindOf — interest and annual phrases first, then "is it a bank or card fee", then the kind', () => {
  it.each([
    ['fees', 'OVERDRAFT ITEM FEE', 'overdraft'],
    ['fees', 'NSF RETURNED ITEM FEE', 'overdraft'],
    ['fees', 'RETURNED PAYMENT FEE', 'overdraft'],
    ['fees', 'INTL ATM FEE', 'atm'],
    ['fees', 'INTL WIRE FEE', 'wire'],
    ['fees', 'FOREIGN TRANSACTION FEE', 'foreign'],
    ['fees', 'INTERNATIONAL TRANSACTION FEE', 'foreign'],
    ['fees', 'MONTHLY SERVICE FEE', 'account'],
    ['fees', 'MONTHLY MAINTENANCE FEE', 'account'],
    ['fees', 'SERVICE CHARGE', 'account'],
    ['fees', 'PAPER STATEMENT FEE', 'account'],
    ['fees', 'LATE PAYMENT FEE', 'late'],
    // Two kinds read the same text: the earlier one wins.
    ['fees', 'ATM INTL TRANSACTION FEE', 'atm'],
    // Interest and annual are PHRASES (P2-3): the bare words don't make a row interest or annual.
    ['fees', 'INTEREST CHARGE ON PURCHASES', 'interest'],
    ['fees', 'FINANCE CHARGE', 'interest'],
    ['fees', 'INTEREST CHECKING MONTHLY SERVICE FEE', 'account'],
    ['fees', 'PREMIER INTEREST CHECKING MAINTENANCE FEE', 'account'],
    ['fees', 'ANNUAL FEE', 'annual'],
    ['fees', 'ANNUAL MEMBERSHIP FEE', 'annual'],
    ['fees', 'IRA ANNUAL FEE', 'annual'],
    ['fees', 'MONTHLY MEMBERSHIP FEE', 'unread'],
    // Not a bank's or card's fee (P1-2): another business named, no fee word, a deposit's principal.
    ['fees', 'HOA MAINTENANCE FEE', 'unread'],
    ['fees', 'TIMESHARE MAINTENANCE FEE', 'unread'],
    ['fees', 'CONDO ASSN MAINTENANCE FEE', 'unread'],
    ['fees', 'WESTGATE RESORTS MAINTENANCE FEE', 'unread'],
    ['fees', 'APARTMENT LATE FEE', 'unread'],
    ['fees', 'CITY WATER LATE FEE', 'unread'],
    ['fees', 'DEPOSITED ITEM RETURNED - INSUFFICIENT FUNDS', 'unread'],
    ['fees', 'DEPOSITED ITEM RETURNED FEE', 'unread'],
    // A returned DEPOSIT is someone else's check bouncing, not the reader's balance running short:
    // never the overdraft kind, even worded with INSUFFICIENT FUNDS and a fee word.
    ['fees', 'DEPOSITED ITEM RETURNED - INSUFFICIENT FUNDS FEE', 'unread'],
    ['fees', 'RETURNED DEPOSIT ITEM NSF FEE', 'unread'],
    ['fees', 'OVERDRAFT LINE OF CREDIT PAYMENT', 'unread'],
    ['fees', 'OVERDRAFT PROTECTION FROM SAVINGS', 'unread'],
    ['fees', 'INTEREST', 'unread'],
    // A fee word with no kind: Fees & Charges can't place it…
    ['fees', 'VENMO INSTANT TRANSFER FEE', 'unread'],
    ['fees', 'ADVISORY FEE Q3', 'unread'],
    // …the ATM Fee and Late Fee filings can, and they beat the text's own kind.
    ['atm-fee', 'CASH WITHDRAWAL CHARGE', 'atm'],
    ['late-fee', 'PAST DUE FEE', 'late'],
    ['late-fee', 'OVERDRAFT FEE', 'late'],
    // …but not past the text's other verdicts.
    ['atm-fee', 'CASH WITHDRAWAL', 'unread'],
    ['late-fee', 'STORAGE UNIT LATE FEE', 'unread'],
    ['late-fee', 'ANNUAL FEE', 'annual'],
    ['fees-interest', 'ANYTHING AT ALL', 'interest'],
    ['groceries', 'OVERDRAFT FEE', null],
    [null, 'OVERDRAFT FEE', null],
  ] as const)('%s / %s → %s', (categoryId, descriptor, kind) => {
    expect(feeKindOf(categoryId, descriptor)).toBe(kind);
  });

  it('reads the text case-insensitively', () => {
    expect(feeKindOf('fees', 'Overdraft Item Fee')).toBe('overdraft');
  });
});

describe('readsAsFeeGivenBack — a counted kind of fee, said to be coming back', () => {
  it.each([
    ['ATM FEE REBATE', true],
    ['ATM FEE REIMBURSEMENT', true],
    ['OVERDRAFT FEE REFUND', true],
    ['OD FEE REVERSAL', true],
    ['MONTHLY SERVICE FEE WAIVED', true],
    ['LATE FEE CREDIT', true],
    ['FOREIGN TRANSACTION FEE REVERSAL', true],
    // Not a fee coming back (P0-1): no fee word, no kind, another business, a left-out kind.
    ['OVERDRAFT REVERSAL', false],
    ['ATM WITHDRAWAL REVERSAL', false],
    ['OVERDRAFT PROTECTION FROM SAVINGS', false],
    ['OVERDRAFT PROT XFER FROM SAV 1234', false],
    ['OVERDRAFT COVERAGE FROM LINE OF CREDIT', false],
    ['FEE REFUND', false],
    ['AIRLINE FEE CREDIT', false],
    ['GLOBAL ENTRY FEE CREDIT', false],
    ['UNITED AIRLINES BAG FEE REFUND', false],
    ['UNIVERSITY TUITION FEE REFUND', false],
    ['APARTMENT APPLICATION FEE REFUND', false],
    ['REGISTRATION FEE REIMBURSEMENT', false],
    ['INTEREST CHARGE REVERSAL', false],
    ['ANNUAL FEE REFUND', false],
    ['AMAZON REFUND', false],
    ['CASH BACK CREDIT', false],
    ['MONTHLY SERVICE FEE', false],
  ] as const)('%s → %s', (descriptor, expected) => {
    expect(readsAsFeeGivenBack(descriptor)).toBe(expected);
  });
});

describe('the window', () => {
  it('is the 12 months ending today, both ends inclusive', () => {
    expect(bankFeeWindowStart(TODAY)).toBe('2025-10-18');
    // Clamped month ends: Feb 29 minus 12 months is Feb 28, so the window starts Mar 1.
    expect(bankFeeWindowStart(isoDate('2028-02-29'))).toBe('2027-03-01');
  });
});

/** The worked example in tests/edge-cases/bank-fees.md. */
function workedExample(): { rows: BankFeeRowInput[]; loanId: string } {
  n = 0;
  const loan = row('chk', '2026-07-01', -700, 'SERVICE CHARGE', 'fees');
  const rows = [
    row('chk', '2024-01-05', -450, 'BLUE DOOR COFFEE', 'coffee'),
    row('chk', '2026-09-03', -3_500, 'OVERDRAFT ITEM FEE', 'fees'),
    row('chk', '2026-09-03', -1_000, 'CORNER GROCERY', 'groceries'),
    row('chk', '2026-09-04', -3_500, 'NSF RETURNED ITEM FEE', 'fees'),
    row('chk', '2026-09-10', 3_500, 'OVERDRAFT FEE REFUND', 'fees'),
    row('chk', '2026-08-31', -1_200, 'MONTHLY MAINTENANCE FEE', 'fees'),
    row('chk', '2026-07-31', -1_200, 'MONTHLY MAINTENANCE FEE', 'fees'),
    row('chk', '2026-03-24', -1_500, 'INTEREST CHECKING MONTHLY SERVICE FEE', 'fees'),
    row('chk', '2026-06-15', -350, 'NON-NETWORK ATM FEE', 'fees'),
    row('chk', '2026-06-15', -300, 'ATM SURCHARGE 7-ELEVEN', 'atm-fee'),
    row('card', '2026-05-20', -2_900, 'LATE FEE', 'late-fee'),
    row('card', '2026-04-02', -87, 'FOREIGN TRANSACTION FEE', 'fees'),
    row('card', '2026-05-20', -4_512, 'INTEREST CHARGE ON PURCHASES', 'fees'),
    row('card', '2026-04-20', -3_977, 'PURCHASE INTEREST CHARGE', 'fees-interest'),
    row('card', '2026-01-15', -9_500, 'ANNUAL MEMBERSHIP FEE', 'fees'),
    row('card', '2026-02-01', 9_500, 'ANNUAL FEE REVERSAL', 'fees'),
    row('chk', '2026-03-01', 350, 'ATM FEE REBATE', 'refund'),
    row('chk', '2026-08-06', 5_000, 'CASH BACK CREDIT', 'refund'),
    // Filed as fees, not a bank's or card's fee: listed, not counted.
    row('chk', '2026-03-10', -45_000, 'HOA MAINTENANCE FEE', 'fees'),
    row('chk', '2026-03-20', -120_000, 'DEPOSITED ITEM RETURNED - INSUFFICIENT FUNDS', 'fees'),
    row('chk', '2026-03-25', -175, 'VENMO INSTANT TRANSFER FEE', 'fees'),
    // Money in that is not a fee coming back.
    row('chk', '2026-03-21', 30_000, 'OVERDRAFT PROTECTION FROM SAVINGS', 'fees'),
    row('chk', '2026-03-22', 40_000, 'ATM WITHDRAWAL REVERSAL', 'cash'),
    row('chk', '2026-03-23', 150_000, 'UNIVERSITY TUITION FEE REFUND', 'education'),
    row('chk', '2025-10-17', -3_500, 'OVERDRAFT ITEM FEE', 'fees'), // the day before the window
    row('chk', '2025-10-18', -1_500, 'WIRE FEE OUTGOING', 'fees'), // the window's first day
    row('chk', '2026-10-18', -1_000, 'SERVICE CHARGE', 'fees'), // after today
    row('chk', '2026-08-01', -500, 'MONTHLY SERVICE FEE', 'fees', { status: 'PENDING' }),
    row('chk', '2026-08-02', -2_500, 'OVERDRAFT ITEM FEE', 'fees', { excludeFromTotals: true }),
    row('chk', '2026-08-03', -2_500, 'OVERDRAFT ITEM FEE', 'fees', { isTransfer: true }),
    row('chk', '2026-08-04', -2_500, 'OVERDRAFT ITEM FEE', 'fees', { isSplitParent: true }),
    row('chk', '2026-08-05', -150_000, 'RENT PAYMENT', 'rent'),
    loan,
  ];
  return { rows, loanId: loan.id };
}

describe('findBankFees — the worked example', () => {
  const { rows, loanId } = workedExample();
  const f = findBankFees(rows, TODAY, {
    excludedFlowIds: new Set([loanId]),
    handoverKeys: new Set([handoverKey('chk', '2026-09-03')]),
  });

  it('totals each kind and orders them largest first', () => {
    expect(f.kinds.map((k) => [k.kind, k.chargedCents, k.rows.length])).toEqual([
      ['overdraft', 7_000, 2],
      ['account', 3_900, 3],
      ['late', 2_900, 1],
      ['wire', 1_500, 1],
      ['atm', 650, 2],
      ['foreign', 87, 1],
    ]);
    expect(f.chargedCents).toBe(16_037);
  });

  it('lists each kind newest first, and every list adds up to its total', () => {
    const overdraft = f.kinds[0];
    expect(overdraft.rows.map((r) => r.date)).toEqual(['2026-09-04', '2026-09-03']);
    for (const k of f.kinds) {
      expect(k.rows.reduce((s, r) => s + r.amountCents, 0)).toBe(k.chargedCents);
      for (const r of k.rows) expect(r.amountCents).toBeGreaterThan(0);
    }
  });

  it('counts back only money in that reads as a counted kind of fee returned', () => {
    expect(f.givenBack.map((r) => [r.date, r.amountCents, r.label])).toEqual([
      ['2026-09-10', 3_500, 'OVERDRAFT FEE REFUND'],
      ['2026-03-01', 350, 'ATM FEE REBATE'],
    ]);
    expect(f.givenBackCents).toBe(3_850);
  });

  it('lists what is filed as a fee but does not read as a bank or card fee, and never charges it', () => {
    expect(f.uncounted.map((r) => [r.date, r.amountCents, r.label])).toEqual([
      ['2026-03-25', 175, 'VENMO INSTANT TRANSFER FEE'],
      ['2026-03-20', 120_000, 'DEPOSITED ITEM RETURNED - INSUFFICIENT FUNDS'],
      ['2026-03-10', 45_000, 'HOA MAINTENANCE FEE'],
    ]);
    expect(f.uncountedCents).toBe(165_175);
  });

  it('leaves out interest (either filing) and annual fees, and their reversals with them', () => {
    expect(f.leftOut).toEqual({ interestCents: 8_489, interestCount: 2, annualCents: 9_500, annualCount: 1 });
  });

  it('reads the window, the records and the handover day', () => {
    expect(f.from).toBe('2025-10-18');
    expect(f.to).toBe('2026-10-17');
    expect(f.recordsFrom).toBe('2024-01-05');
    // Only the overdraft fee is a printed row on chk's handover day; the grocery row is not read.
    expect(f.amountsOnHandoverDays).toBe(1);
    expect(f.kinds[0].rows.find((r) => r.date === '2026-09-03')?.onHandoverDay).toBe(true);
  });

  it('prints the lead, the kinds and the other lines exactly', () => {
    expect(bankFeesLead(f)).toBe(
      'You paid $160.37 in bank and card fees (10 charges) in the last 12 months, and $38.50 in fees came back.',
    );
    expect(f.kinds.map(feeKindLine)).toEqual([
      'Overdraft and returned-item fees — $70.00 (2 charges)',
      'Monthly account fees — $39.00 (3 charges)',
      'Late fees — $29.00 (1 charge)',
      'Wire fees — $15.00 (1 charge)',
      'ATM fees — $6.50 (2 charges)',
      'Foreign transaction fees — $0.87 (1 charge)',
    ]);
    expect(feesGivenBackLine(f)).toBe('Came back — $38.50 (2 fees returned)');
    expect(feesUncountedLine(f)).toBe('Filed as fees, not counted — $1,651.75 (3 charges)');
    expect(feesLeftOutLine(f)).toBe(
      'Not counted here: $84.89 of interest and finance charges (2 charges) and $95.00 of annual fees (1 charge). Interest is the cost of a balance carried from month to month. An annual fee is the yearly price of keeping a card or account.',
    );
  });
});

describe('findBankFees — edges', () => {
  it('no rows at all: its own lead, never "in the last 12 months" (P2-4)', () => {
    const f = findBankFees([], TODAY);
    expect(f.kinds).toEqual([]);
    expect(f.chargedCents).toBe(0);
    expect(f.recordsFrom).toBeNull();
    expect(bankFeesLead(f)).toBe(BANK_FEES_NO_RECORDS);
    expect(feesLeftOutLine(f)).toBeNull();
  });

  it('records but nothing counted: the zero names its basis', () => {
    n = 0;
    const f = findBankFees([row('chk', '2024-01-05', -450, 'BLUE DOOR COFFEE', 'coffee')], TODAY);
    expect(bankFeesLead(f)).toBe('No bank or card fees counted in the last 12 months.');
  });

  it('only interest: nothing counted, the interest named with its reason alone', () => {
    n = 0;
    const f = findBankFees([row('card', '2026-09-01', -1_234, 'INTEREST CHARGE', 'fees')], TODAY);
    expect(bankFeesLead(f)).toBe('No bank or card fees counted since your records begin on Sep 1, 2026.');
    expect(feesLeftOutLine(f)).toBe(
      'Not counted here: $12.34 of interest and finance charges (1 charge). Interest is the cost of a balance carried from month to month.',
    );
  });

  it('only an annual fee: that one reason, no interest clause', () => {
    n = 0;
    const f = findBankFees([row('card', '2026-09-01', -9_500, 'ANNUAL FEE', 'fees')], TODAY);
    expect(feesLeftOutLine(f)).toBe(
      'Not counted here: $95.00 of annual fees (1 charge). An annual fee is the yearly price of keeping a card or account.',
    );
  });

  it('a refund with no charge in the window still says what came back', () => {
    n = 0;
    const f = findBankFees(
      [row('chk', '2025-01-02', -100, 'COFFEE', 'coffee'), row('chk', '2026-01-05', 3_400, 'OVERDRAFT FEE REFUND', 'fees')],
      TODAY,
    );
    expect(bankFeesLead(f)).toBe('No bank or card fees counted in the last 12 months; $34.00 in fees came back.');
  });

  it('more back than charged: both amounts, and no net is ever stated', () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2025-01-02', -100, 'COFFEE', 'coffee'),
        row('chk', '2026-02-01', -1_200, 'MONTHLY SERVICE FEE', 'fees'),
        row('chk', '2026-02-03', 1_200, 'MONTHLY SERVICE FEE REVERSAL', 'fees'),
        row('chk', '2026-03-03', 3_500, 'OVERDRAFT FEE REVERSAL', 'other-income'),
      ],
      TODAY,
    );
    expect(f.chargedCents).toBe(1_200);
    expect(f.givenBackCents).toBe(4_700);
    const lead = bankFeesLead(f);
    expect(lead).toBe('You paid $12.00 in bank and card fees (1 charge) in the last 12 months, and $47.00 in fees came back.');
    expect(lead).not.toMatch(/cost you/);
  });

  it('one charge, nothing back: singular', () => {
    n = 0;
    const f = findBankFees(
      [row('chk', '2025-01-02', -100, 'COFFEE', 'coffee'), row('card', '2026-05-20', -2_900, 'LATE FEE', 'late-fee')],
      TODAY,
    );
    expect(bankFeesLead(f)).toBe('You paid $29.00 in bank and card fees (1 charge) in the last 12 months.');
  });

  it("the critic's non-bank charges are all listed and none is charged (P1-2)", () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'),
        row('chk', '2026-05-01', -45_000, 'TIMESHARE MAINTENANCE FEE', 'fees'),
        row('chk', '2026-05-02', -45_000, 'CONDO ASSN MAINTENANCE FEE', 'fees'),
        row('chk', '2026-05-03', -5_000, 'STORAGE UNIT LATE FEE', 'fees'),
        row('chk', '2026-05-04', -50_000, 'OVERDRAFT LINE OF CREDIT PAYMENT', 'fees'),
      ],
      TODAY,
    );
    expect(f.chargedCents).toBe(0);
    expect(f.uncountedCents).toBe(145_000);
    expect(bankFeesLead(f)).toBe('No bank or card fees counted in the last 12 months.');
  });

  it("the critic's money in is never a fee coming back, under any filing (P0-1)", () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'),
        row('chk', '2026-05-01', -3_500, 'OVERDRAFT ITEM FEE', 'fees'),
        row('chk', '2026-05-02', 20_000, 'ATM WITHDRAWAL REVERSAL', 'cash'),
        row('chk', '2026-05-03', 30_000, 'OVERDRAFT PROTECTION FROM SAVINGS', 'fees'),
        row('chk', '2026-05-04', 25_000, 'OVERDRAFT PROT XFER FROM SAV 1234', 'fees'),
        row('card', '2026-05-05', 20_000, 'AIRLINE FEE CREDIT', 'air-travel'),
        row('chk', '2026-05-06', 150_000, 'UNIVERSITY TUITION FEE REFUND', 'education'),
        row('chk', '2026-05-07', 5_000, 'APARTMENT APPLICATION FEE REFUND', 'rent'),
        row('chk', '2026-05-08', 9_999, 'SOMETHING', 'late-fee'),
      ],
      TODAY,
    );
    expect(f.givenBack).toEqual([]);
    expect(bankFeesLead(f)).toBe('You paid $35.00 in bank and card fees (1 charge) in the last 12 months.');
  });

  it('every printed amount on a handover day is counted — charged, back, not counted, left out (P2-5a)', () => {
    n = 0;
    const day = '2026-05-01';
    const f = findBankFees(
      [
        row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'),
        row('chk', day, -1_200, 'MONTHLY SERVICE FEE', 'fees'),
        row('chk', day, 1_200, 'MONTHLY SERVICE FEE REVERSAL', 'fees'),
        row('chk', day, -45_000, 'HOA MAINTENANCE FEE', 'fees'),
        row('chk', day, -1_000, 'FINANCE CHARGE', 'fees'),
        row('chk', day, -900, 'GROCERY', 'groceries'),
      ],
      TODAY,
      { handoverKeys: new Set([handoverKey('chk', day)]) },
    );
    expect(f.amountsOnHandoverDays).toBe(4);
    expect(f.givenBack[0].onHandoverDay).toBe(true);
    expect(f.uncounted[0].onHandoverDay).toBe(true);
  });

  it('a $0.00 fee row (a waived fee posted at zero) is neither a charge nor money back', () => {
    n = 0;
    const f = findBankFees([row('chk', '2026-02-01', 0, 'MONTHLY SERVICE FEE WAIVED', 'fees')], TODAY);
    expect(f.kinds).toEqual([]);
    expect(f.givenBack).toEqual([]);
    expect(f.uncounted).toEqual([]);
  });

  it('the records begin at the earliest row, whatever order the rows arrive in', () => {
    n = 0;
    const f = findBankFees(
      [row('chk', '2026-09-01', -500, 'COFFEE', 'coffee'), row('chk', '2024-01-05', -500, 'COFFEE', 'coffee')],
      TODAY,
    );
    expect(f.recordsFrom).toBe('2024-01-05');
  });

  it('equal totals keep the fixed kind order', () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2026-05-01', -1_000, 'WIRE FEE', 'fees'),
        row('chk', '2026-05-02', -1_000, 'ATM FEE', 'fees'),
        row('chk', '2026-05-03', -1_000, 'LATE FEE', 'fees'),
      ],
      TODAY,
    );
    expect(f.kinds.map((k) => k.kind)).toEqual(['late', 'atm', 'wire']);
  });

  it('labels a row with the register name and keeps the bank text only when it says more', () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2026-05-01', -1_000, 'OVERDRAFT ITEM FEE', 'fees', { merchantName: 'Checking overdraft' }),
        row('chk', '2026-05-02', -1_000, 'OVERDRAFT ITEM FEE', 'fees', { merchantName: 'OVERDRAFT ITEM FEE' }),
        // The register's re-cased name of the same words: the bank text would repeat it.
        row('chk', '2026-05-03', -1_000, 'OVERDRAFT  ITEM FEE', 'fees', { merchantName: 'Overdraft Item Fee' }),
      ],
      TODAY,
    );
    expect(f.kinds[0].rows.map((r) => [r.label, r.rawDescriptor])).toEqual([
      ['Overdraft Item Fee', null],
      ['OVERDRAFT ITEM FEE', null],
      ['Checking overdraft', 'OVERDRAFT ITEM FEE'],
    ]);
  });

  it('the kind is read from the bank text, never the name the reader gave the payee', () => {
    n = 0;
    const f = findBankFees(
      [row('chk', '2026-05-01', -1_000, 'MONTHLY SERVICE FEE', 'fees', { merchantName: 'Annual fee nonsense' })],
      TODAY,
    );
    expect(f.kinds.map((k) => k.kind)).toEqual(['account']);
    expect(f.leftOut.annualCount).toBe(0);
  });
});

describe('the words', () => {
  it('names where the records begin only when they begin inside the window', () => {
    const from = isoDate('2025-10-18');
    expect(feeWindowPhrase({ from, recordsFrom: isoDate('2025-10-18') })).toBe('in the last 12 months');
    expect(feeWindowPhrase({ from, recordsFrom: isoDate('2025-10-19') })).toBe('since your records begin on Oct 19, 2025');
    expect(feeDate(isoDate('2026-03-02'))).toBe('Mar 2, 2026');
  });

  it('every sentence is free of shame and of instructions', () => {
    const SHAME_OR_ADVICE =
      /\b(should|must|stop|wasted?|wasting|guilty|guilt|shame|splurg\w*|overspen\w*|cut back|bad habit|irresponsible|careless)\b/i;
    const lines = [
      BANK_FEES_RULE,
      BANK_FEES_UNCOUNTED_NOTE,
      BANK_FEES_NO_RECORDS,
      ...Object.values(FEE_KIND_COPY).flatMap((c) => [c.label, c.avoid]),
    ];
    for (const line of lines) expect(line).not.toMatch(SHAME_OR_ADVICE);
  });

  it('the rule states what the engine reads, in its terms (P2-6)', () => {
    for (const phrase of [
      'checking, savings and card accounts',
      'Fees & Charges',
      'ATM Fee',
      'Late Fee',
      'fee, charge or surcharge',
      'another kind of business',
      'listed as not counted',
      'refunded, reversed, rebated, reimbursed, waived or credited',
      'worded like a bank',
      'Interest and finance charges and annual fees are left out',
      "you've excluded",
    ]) {
      expect(BANK_FEES_RULE).toContain(phrase);
    }
  });
});
