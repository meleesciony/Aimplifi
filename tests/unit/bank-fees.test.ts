/**
 * Fees you paid — the bank and card fees in the reader's last 12 months of records, by kind,
 * and what came back (DECISIONS #796). The engine's rule (`findBankFees`), how a row reads
 * (`feeKindOf`, an ALLOWLIST of each kind's words), what counts as a fee coming back
 * (`feeGivenBackKind`), and every sentence the card prints. Every amount, date and descriptor
 * is invented (keep-live-figures-out-of-repo). Hand-verified values: tests/edge-cases/bank-fees.md.
 *
 * Critic locks. Cycle 1: money in that is not a fee coming back is never "came back" (P0-1);
 * other businesses' fees, deposits' principal and payments are never charged (P1-2); interest
 * and annual fees are phrases (P2-3); no records is its own lead (P2-4); every printed amount
 * counts toward the handover note (P2-5a). Cycle 2: the denylist is gone — every counterexample
 * the second critic found (timeshare/HOA/utility/alarm/biller "SERVICE CHARGE" and "LATE FEE",
 * a payment "INCL LATE FEE", CHARGE-BACK, incoming wires with CREDIT) is locked below (P1-1,
 * P1-2, P2-5, P2-8); the window's last day (P1-3); the window, account by account (P2-7); no
 * sentence points "above" (P2-6); each kind's vocabulary, word by word (P2-9); a same-text
 * credit comes back (P3-11).
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
import {
  FEE_KIND_WORDS,
  bankFeeWindowStart,
  feeGivenBackKind,
  feeKindOf,
  feeTextWords,
  findBankFees,
  readsAsFeeGivenBack,
  type BankFeeRowInput,
  type FeeRecords,
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

describe('feeTextWords — the noise a bank adds comes off', () => {
  it.each([
    ['OVERDRAFT FEE FOR A $12.00 CARD PURCHASE - DETAILS: 0812STARBUCKS #1234', ['OVERDRAFT', 'FEE']],
    ['INSUFFICIENT FUNDS FEE FOR A $45.00 ITEM - DETAILS: CORNER STORE', ['INSUFFICIENT', 'FUNDS', 'FEE']],
    ['NON-CHASE ATM FEE-WITH 08/14 XXXX1234', ['NON', 'ATM', 'FEE', 'WITH']],
    ['MONTHLY SERVICE FEE 08/31/26', ['MONTHLY', 'SERVICE', 'FEE']],
    ['Wire Fee #4471 x9921', ['WIRE', 'FEE']],
    ['LATE FEE 2ND NOTICE', ['LATE', 'FEE', 'NOTICE']],
    ['OVERDRAFT ITEM FEE - DETAILS: 0812 CORNER STORE', ['OVERDRAFT', 'ITEM', 'FEE']],
  ])('%s → %j', (raw, expected) => {
    expect(feeTextWords(raw)).toEqual(expected);
  });
});

describe('feeKindOf — interest and annual phrases first, then the text must be wholly one kind', () => {
  it.each([
    // Overdraft and returned items.
    ['fees', 'OVERDRAFT ITEM FEE', 'overdraft'],
    ['fees', 'OVERDRAFT FEE FOR A $12.00 CARD PURCHASE - DETAILS: 0812STARBUCKS #1234', 'overdraft'],
    ['fees', 'INSUFFICIENT FUNDS FEE FOR A $45.00 ITEM - DETAILS: CORNER STORE', 'overdraft'],
    ['fees', 'NSF RETURNED ITEM FEE', 'overdraft'],
    ['fees', 'OVERDRAFT ITEM FEE - DETAILS: 0812 CORNER STORE', 'overdraft'],
    ['fees', 'NSF RETURN ITEM FEE', 'overdraft'],
    ['fees', 'RETURNED PAYMENT FEE', 'overdraft'],
    ['fees', 'EXTENDED OVERDRAFT FEE', 'overdraft'],
    ['fees', 'OVERDRAFT PROTECTION TRANSFER FEE', 'overdraft'],
    ['fees', 'COURTESY PAY FEE', 'overdraft'],
    ['fees', 'PAID ITEM FEE', 'overdraft'],
    ['fees', 'OD FEE', 'overdraft'],
    // ATM.
    ['fees', 'INTL ATM FEE', 'atm'],
    ['fees', 'NON-CHASE ATM FEE-WITH 08/14', 'atm'],
    ['fees', 'NON-NETWORK ATM FEE', 'atm'],
    ['fees', 'OUT-OF-NETWORK ATM WITHDRAWAL FEE', 'atm'],
    ['fees', 'ATM BALANCE INQUIRY FEE', 'atm'],
    ['fees', 'FOREIGN ATM FEE', 'atm'],
    ['fees', 'ATM INTL TRANSACTION FEE', 'atm'],
    // Late.
    ['fees', 'LATE FEE', 'late'],
    ['fees', 'LATE PAYMENT FEE', 'late'],
    ['fees', 'PAST DUE FEE', 'late'],
    // Wire.
    ['fees', 'WIRE FEE', 'wire'],
    ['fees', 'OUTGOING WIRE FEE', 'wire'],
    ['fees', 'INCOMING WIRE FEE', 'wire'],
    ['fees', 'INTL WIRE FEE', 'wire'],
    ['fees', 'DOMESTIC WIRE TRANSFER FEE', 'wire'],
    // Foreign transaction.
    ['fees', 'FOREIGN TRANSACTION FEE', 'foreign'],
    ['fees', 'INTERNATIONAL TRANSACTION FEE', 'foreign'],
    ['fees', 'FOREIGN EXCHANGE FEE', 'foreign'],
    ['fees', 'CURRENCY CONVERSION FEE', 'foreign'],
    ['fees', 'CROSS-BORDER FEE', 'foreign'],
    ['fees', 'FX FEE', 'foreign'],
    // Monthly account.
    ['fees', 'MONTHLY SERVICE FEE', 'account'],
    ['fees', 'MONTHLY MAINTENANCE FEE', 'account'],
    ['fees', 'SERVICE CHARGE', 'account'],
    ['fees', 'MINIMUM BALANCE FEE', 'account'],
    ['fees', 'LOW BALANCE FEE', 'account'],
    ['fees', 'BELOW MINIMUM BALANCE FEE', 'account'],
    ['fees', 'ACCOUNT MAINTENANCE FEE', 'account'],
    ['fees', 'MONTHLY SERVICE FEE AUG 2026', 'account'],
    // Interest and annual fees: phrases, left out.
    ['fees', 'INTEREST CHARGE ON PURCHASES', 'interest'],
    ['fees', 'PURCHASE INTEREST CHARGE', 'interest'],
    ['fees', 'CASH ADVANCE INTEREST', 'interest'],
    ['fees', 'FINANCE CHARGE', 'interest'],
    ['fees', 'ANNUAL FEE', 'annual'],
    ['fees', 'ANNUAL MEMBERSHIP FEE', 'annual'],
    ['fees', 'IRA ANNUAL FEE', 'annual'],
    // Not a bank's or card's fee, by ANY word outside the kind (critic cycles 1 and 2).
    ['fees', 'HOA MAINTENANCE FEE', 'unread'],
    ['fees', 'TIMESHARE MAINTENANCE FEE', 'unread'],
    ['fees', 'WESTGATE MAINTENANCE FEE', 'unread'],
    ['fees', 'BLUEGREEN VACATIONS MAINTENANCE FEE', 'unread'],
    ['fees', 'ASSOCIA MAINTENANCE FEE', 'unread'],
    ['fees', 'FIRSTSERVICE RESIDENTIAL MAINTENANCE FEE', 'unread'],
    ['fees', 'PARKSIDE COMMONS MAINTENANCE FEE', 'unread'],
    ['fees', 'SOLID WASTE SERVICE CHARGE', 'unread'],
    ['fees', 'STORMWATER SERVICE CHARGE', 'unread'],
    ['fees', 'ALARM MONITORING SERVICE CHARGE', 'unread'],
    ['fees', 'ADT SECURITY SERVICE CHARGE', 'unread'],
    ['fees', 'PAYMENTUS SERVICE CHARGE', 'unread'],
    ['fees', 'STOP PAYMENT SERVICE CHARGE', 'unread'],
    ['fees', 'CASHIERS CHECK SERVICE CHARGE', 'unread'],
    ['fees', 'COIN COUNTING SERVICE CHARGE', 'unread'],
    ['fees', 'IRA MAINTENANCE FEE', 'unread'],
    ['fees', 'PAPER STATEMENT FEE', 'unread'],
    ['fees', 'INTEREST CHECKING MONTHLY SERVICE FEE', 'unread'],
    ['fees', 'RENTCAFE LATE FEE', 'unread'],
    ['fees', 'CITY OF AUSTIN LATE FEE', 'unread'],
    ['fees', 'DIRECTV LATE FEE', 'unread'],
    ['fees', 'NAVIENT PAYMENT INCL LATE FEE', 'unread'],
    ['fees', 'APARTMENT LATE FEE', 'unread'],
    ['fees', 'LATE FEE 2ND NOTICE', 'unread'],
    ['fees', 'ATM SURCHARGE 7-ELEVEN', 'unread'],
    ['fees', 'INSUFFICIENT FUNDS CHARGE-BACK', 'unread'],
    ['fees', 'RETURNED ITEM CHARGE BACK', 'unread'],
    ['fees', 'CHARGE BACK - RETURNED CHECK', 'unread'],
    ['fees', 'DEPOSITED ITEM RETURNED FEE', 'unread'],
    ['fees', 'DEPOSITED ITEM RETURNED - INSUFFICIENT FUNDS', 'unread'],
    ['fees', 'RETURNED DEPOSIT ITEM NSF FEE', 'unread'],
    ['fees', 'OVERDRAFT LINE OF CREDIT PAYMENT', 'unread'],
    ['fees', 'OVERDRAFT PROTECTION FROM SAVINGS', 'unread'],
    ['fees', 'CASH ADVANCE FEE', 'unread'],
    ['fees', 'BALANCE TRANSFER FEE', 'unread'],
    ['fees', 'MONTHLY MEMBERSHIP FEE', 'unread'],
    ['fees', 'VENMO INSTANT TRANSFER FEE', 'unread'],
    ['fees', 'ADVISORY FEE Q3', 'unread'],
    ['fees', 'FEE', 'unread'],
    ['fees', 'INTEREST', 'unread'],
    // ATM Fee and Late Fee supply the kind — never the vocabulary.
    ['atm-fee', 'CASH WITHDRAWAL CHARGE', 'atm'],
    ['atm-fee', 'SURCHARGE', 'atm'],
    ['atm-fee', 'CASH WITHDRAWAL', 'unread'],
    ['atm-fee', 'ATM SURCHARGE 7-ELEVEN', 'unread'],
    ['late-fee', 'PAST DUE FEE', 'late'],
    ['late-fee', 'PAYMENT FEE', 'late'],
    ['late-fee', 'OVERDRAFT FEE', 'overdraft'],
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

  it('every vocabulary word is load-bearing: alone with an anchor and a fee word, it reads as its kind', () => {
    const anchorOf: Record<keyof typeof FEE_KIND_WORDS, string> = {
      overdraft: 'OVERDRAFT',
      atm: 'ATM',
      late: 'LATE',
      wire: 'WIRE',
      foreign: 'FOREIGN',
      account: 'MONTHLY',
    };
    for (const [kind, { anchors, vocab }] of Object.entries(FEE_KIND_WORDS)) {
      for (const word of anchors) {
        expect(feeKindOf('fees', `${word} FEE`), `${kind} anchor ${word}`).toBe(kind);
      }
      for (const word of vocab) {
        const anchor = anchorOf[kind as keyof typeof FEE_KIND_WORDS];
        expect(feeKindOf('fees', `${anchor} ${word} FEE`), `${kind} vocab ${word}`).toBe(kind);
      }
    }
  });
});

describe('feeGivenBackKind — a counted kind of fee, alone or with a word saying it came back', () => {
  it.each([
    ['ATM FEE REBATE', 'atm'],
    ['ATM FEE REIMBURSEMENT', 'atm'],
    ['OVERDRAFT FEE REFUND', 'overdraft'],
    ['OD FEE REVERSAL', 'overdraft'],
    ['MONTHLY SERVICE FEE WAIVED', 'account'],
    ['LATE FEE CREDIT', 'late'],
    ['FOREIGN TRANSACTION FEE REVERSAL', 'foreign'],
    ['INCOMING WIRE FEE REFUND', 'wire'],
    // A same-text credit is the fee coming back (critic cycle 2, P3-11).
    ['LATE FEE', 'late'],
    // Not a fee coming back (critic cycles 1 and 2).
    ['OVERDRAFT REVERSAL', null],
    ['ATM WITHDRAWAL REVERSAL', null],
    ['OVERDRAFT PROTECTION FROM SAVINGS', null],
    ['OVERDRAFT PROT XFER FROM SAV 1234', null],
    ['OVERDRAFT COVERAGE FROM LINE OF CREDIT', null],
    ['FEE REFUND', null],
    ['AIRLINE FEE CREDIT', null],
    ['GLOBAL ENTRY FEE CREDIT', null],
    ['UNITED AIRLINES BAG FEE REFUND', null],
    ['UNIVERSITY TUITION FEE REFUND', null],
    ['APARTMENT APPLICATION FEE REFUND', null],
    ['REGISTRATION FEE REIMBURSEMENT', null],
    ['WESTGATE MAINTENANCE FEE REFUND', null],
    ['INTEREST CHARGE REVERSAL', null],
    ['ANNUAL FEE REFUND', null],
    ['AMAZON REFUND', null],
    ['CASH BACK CREDIT', null],
    ['WIRE TRANSFER CREDIT ACME LLC CONSULTING FEE', null],
    ['INCOMING WIRE CREDIT INV 2207 PROFESSIONAL FEES', null],
    ['WIRE IN CREDIT SMITH LAW SETTLEMENT LESS ATTORNEY FEES', null],
    ['WIRE TYPE:WIRE IN ORIG:FIRST AMERICAN TITLE PMT DET:REFUND EARNEST MONEY LESS WIRE FEE', null],
    // CREDIT beside WIRE is money arriving by wire, never a fee credited.
    ['INCOMING WIRE FEE CREDIT', null],
  ] as const)('%s → %s', (descriptor, kind) => {
    expect(feeGivenBackKind(descriptor)).toBe(kind);
    expect(readsAsFeeGivenBack(descriptor)).toBe(kind !== null);
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
    row('chk', '2026-10-17', -1_100, 'SERVICE CHARGE', 'fees'), // today: inside
    row('chk', '2026-03-24', -1_500, 'INTEREST CHECKING MONTHLY SERVICE FEE', 'fees'),
    row('chk', '2026-06-15', -350, 'NON-NETWORK ATM FEE', 'fees'),
    row('chk', '2026-06-15', -300, 'ATM SURCHARGE 7-ELEVEN', 'atm-fee'),
    row('chk', '2026-06-16', -250, 'CASH WITHDRAWAL CHARGE', 'atm-fee'),
    row('card', '2026-05-20', -2_900, 'LATE FEE', 'late-fee'),
    row('card', '2026-05-25', 2_900, 'LATE FEE', 'late-fee'),
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
    row('chk', '2026-02-10', -185_000, 'WESTGATE MAINTENANCE FEE', 'fees'),
    // Money in that is not a fee coming back.
    row('chk', '2026-03-21', 30_000, 'OVERDRAFT PROTECTION FROM SAVINGS', 'fees'),
    row('chk', '2026-03-22', 40_000, 'ATM WITHDRAWAL REVERSAL', 'cash'),
    row('chk', '2026-03-23', 150_000, 'UNIVERSITY TUITION FEE REFUND', 'education'),
    row('chk', '2026-02-11', 400_000, 'INCOMING WIRE CREDIT INV 2207 PROFESSIONAL FEES', 'other-income'),
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

  it('totals each kind and orders them largest first — today included', () => {
    expect(f.kinds.map((k) => [k.kind, k.chargedCents, k.rows.length])).toEqual([
      ['overdraft', 7_000, 2],
      ['account', 3_500, 3],
      ['late', 2_900, 1],
      ['wire', 1_500, 1],
      ['atm', 600, 2],
      ['foreign', 87, 1],
    ]);
    expect(f.chargedCents).toBe(15_587);
    expect(f.kinds[1].rows[0].date).toBe('2026-10-17');
  });

  it('lists each kind newest first, and every list adds up to its total', () => {
    expect(f.kinds[0].rows.map((r) => r.date)).toEqual(['2026-09-04', '2026-09-03']);
    for (const k of f.kinds) {
      expect(k.rows.reduce((s, r) => s + r.amountCents, 0)).toBe(k.chargedCents);
      for (const r of k.rows) expect(r.amountCents).toBeGreaterThan(0);
    }
  });

  it('counts back only money in that reads as a counted kind of fee', () => {
    expect(f.givenBack.map((r) => [r.date, r.amountCents, r.label])).toEqual([
      ['2026-09-10', 3_500, 'OVERDRAFT FEE REFUND'],
      ['2026-05-25', 2_900, 'LATE FEE'],
      ['2026-03-01', 350, 'ATM FEE REBATE'],
    ]);
    expect(f.givenBackCents).toBe(6_750);
  });

  it('lists what is filed as a fee but does not read as a bank or card fee, and never charges it', () => {
    expect(f.uncounted.map((r) => [r.date, r.amountCents, r.label])).toEqual([
      ['2026-06-15', 300, 'ATM SURCHARGE 7-ELEVEN'],
      ['2026-03-25', 175, 'VENMO INSTANT TRANSFER FEE'],
      ['2026-03-24', 1_500, 'INTEREST CHECKING MONTHLY SERVICE FEE'],
      ['2026-03-20', 120_000, 'DEPOSITED ITEM RETURNED - INSUFFICIENT FUNDS'],
      ['2026-03-10', 45_000, 'HOA MAINTENANCE FEE'],
      ['2026-02-10', 185_000, 'WESTGATE MAINTENANCE FEE'],
    ]);
    expect(f.uncountedCents).toBe(351_975);
  });

  it('leaves out interest (either filing) and annual fees, and their reversals with them', () => {
    expect(f.leftOut).toEqual({ interestCents: 8_489, interestCount: 2, annualCents: 9_500, annualCount: 1 });
  });

  it('reads the window, the records account by account, and the handover day', () => {
    expect(f.from).toBe('2025-10-18');
    expect(f.to).toBe('2026-10-17');
    // chk reaches back to 2024; the card's first row is 2026-01-15, inside the window.
    expect(f.records).toEqual({
      from: '2024-01-05',
      accountsStartingInWindow: 1,
      latestAccountStart: '2026-01-15',
      accounts: 2,
    });
    expect(f.amountsOnHandoverDays).toBe(1);
    expect(f.kinds[0].rows.find((r) => r.date === '2026-09-03')?.onHandoverDay).toBe(true);
  });

  it('prints the lead, the kinds and the other lines exactly', () => {
    expect(bankFeesLead(f)).toBe(
      "You paid at least $155.87 in bank and card fees (10 charges) in the last 12 months (one account's records begin later, on Jan 15, 2026), and $67.50 in fees came back.",
    );
    expect(f.kinds.map(feeKindLine)).toEqual([
      'Overdraft and returned-item fees — $70.00 (2 charges)',
      'Monthly account fees — $35.00 (3 charges)',
      'Late fees — $29.00 (1 charge)',
      'Wire fees — $15.00 (1 charge)',
      'ATM fees — $6.00 (2 charges)',
      'Foreign transaction fees — $0.87 (1 charge)',
    ]);
    expect(feesGivenBackLine(f)).toBe('Came back — $67.50 (3 fees returned)');
    expect(feesUncountedLine(f)).toBe('Filed as fees, not counted — $3,519.75 (6 charges)');
    expect(feesLeftOutLine(f)).toBe(
      'Left out: $84.89 of interest and finance charges (2 charges) and $95.00 of annual fees (1 charge). Interest is what borrowing costs — a balance carried past its due date, or a cash advance. An annual fee is the yearly price of keeping a card or account.',
    );
  });
});

describe('findBankFees — edges', () => {
  it('no rows at all: its own lead, never "in the last 12 months" (cycle 1, P2-4)', () => {
    const f = findBankFees([], TODAY);
    expect(f.kinds).toEqual([]);
    expect(f.records).toEqual({ from: null, accountsStartingInWindow: 0, latestAccountStart: null, accounts: 0 });
    expect(bankFeesLead(f)).toBe(BANK_FEES_NO_RECORDS);
    expect(feesLeftOutLine(f)).toBeNull();
  });

  it('records but nothing counted: the zero names its basis', () => {
    n = 0;
    const f = findBankFees([row('chk', '2024-01-05', -450, 'BLUE DOOR COFFEE', 'coffee')], TODAY);
    expect(bankFeesLead(f)).toBe('No bank or card fees counted in the last 12 months.');
  });

  it('every account starting inside the window: "since your records begin"', () => {
    n = 0;
    const f = findBankFees(
      [row('card', '2026-09-01', -1_234, 'INTEREST CHARGE', 'fees'), row('chk', '2026-09-05', -100, 'COFFEE', 'coffee')],
      TODAY,
    );
    expect(bankFeesLead(f)).toBe('No bank or card fees counted since your records begin on Sep 1, 2026.');
    expect(feesLeftOutLine(f)).toBe(
      'Left out: $12.34 of interest and finance charges (1 charge). Interest is what borrowing costs — a balance carried past its due date, or a cash advance.',
    );
  });

  it('an account whose first row is the window’s first day reaches the window', () => {
    n = 0;
    const f = findBankFees(
      [row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'), row('card', '2025-10-18', -100, 'COFFEE', 'coffee')],
      TODAY,
    );
    expect(f.records.accountsStartingInWindow).toBe(0);
    expect(bankFeesLead(f)).toBe('No bank or card fees counted in the last 12 months.');
  });

  it('only an annual fee: that one reason, no interest clause', () => {
    n = 0;
    const f = findBankFees([row('card', '2026-09-01', -9_500, 'ANNUAL FEE', 'fees')], TODAY);
    expect(feesLeftOutLine(f)).toBe(
      'Left out: $95.00 of annual fees (1 charge). An annual fee is the yearly price of keeping a card or account.',
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
    expect(lead).toBe(
      'You paid at least $12.00 in bank and card fees (1 charge) in the last 12 months, and $47.00 in fees came back.',
    );
    expect(lead).not.toMatch(/cost you/);
  });

  it('one charge, nothing back: singular', () => {
    n = 0;
    const f = findBankFees(
      [row('chk', '2025-01-02', -100, 'COFFEE', 'coffee'), row('card', '2025-05-20', -100, 'COFFEE', 'coffee'), row('card', '2026-05-20', -2_900, 'LATE FEE', 'late-fee')],
      TODAY,
    );
    expect(bankFeesLead(f)).toBe('You paid at least $29.00 in bank and card fees (1 charge) in the last 12 months.');
  });

  it('two accounts starting inside the window, with records reaching back on a third', () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'),
        row('card', '2026-05-01', -2_900, 'LATE FEE', 'fees'),
        row('sav', '2026-02-01', -1_200, 'MONTHLY SERVICE FEE', 'fees'),
      ],
      TODAY,
    );
    expect(bankFeesLead(f)).toBe(
      'You paid at least $41.00 in bank and card fees (2 charges) in the last 12 months (records for 2 accounts begin later, the latest on May 1, 2026).',
    );
  });

  it("the critics' other-business charges are all listed and none is charged (cycle 1 P1-2, cycle 2 P1-1)", () => {
    n = 0;
    const descriptors = [
      'TIMESHARE MAINTENANCE FEE',
      'CONDO ASSN MAINTENANCE FEE',
      'STORAGE UNIT LATE FEE',
      'OVERDRAFT LINE OF CREDIT PAYMENT',
      'WESTGATE MAINTENANCE FEE',
      'SOLID WASTE SERVICE CHARGE',
      'RENTCAFE LATE FEE',
      'NAVIENT PAYMENT INCL LATE FEE',
      'INSUFFICIENT FUNDS CHARGE-BACK',
    ];
    const f = findBankFees(
      [row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'), ...descriptors.map((d, i) => row('chk', `2026-05-${String(i + 1).padStart(2, '0')}`, -10_000, d, 'fees'))],
      TODAY,
    );
    expect(f.chargedCents).toBe(0);
    expect(f.uncounted).toHaveLength(descriptors.length);
    expect(bankFeesLead(f)).toBe('No bank or card fees counted in the last 12 months.');
  });

  it("the critics' money in is never a fee coming back, under any filing (cycle 1 P0-1, cycle 2 P1-2)", () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'),
        row('chk', '2026-05-01', -3_500, 'OVERDRAFT ITEM FEE', 'fees'),
        row('chk', '2026-05-02', 20_000, 'ATM WITHDRAWAL REVERSAL', 'cash'),
        row('chk', '2026-05-03', 30_000, 'OVERDRAFT PROTECTION FROM SAVINGS', 'fees'),
        row('chk', '2026-05-04', 25_000, 'OVERDRAFT PROT XFER FROM SAV 1234', 'fees'),
        row('chk', '2026-05-05', 20_000, 'AIRLINE FEE CREDIT', 'air-travel'),
        row('chk', '2026-05-06', 150_000, 'UNIVERSITY TUITION FEE REFUND', 'education'),
        row('chk', '2026-05-07', 5_000, 'APARTMENT APPLICATION FEE REFUND', 'rent'),
        row('chk', '2026-05-08', 400_000, 'WIRE TRANSFER CREDIT ACME LLC CONSULTING FEE', 'other-income'),
        row('chk', '2026-05-09', 400_000, 'INCOMING WIRE CREDIT INV 2207 PROFESSIONAL FEES', 'fees'),
        row('chk', '2026-05-10', 9_999, 'SOMETHING', 'late-fee'),
      ],
      TODAY,
    );
    expect(f.givenBack).toEqual([]);
    expect(bankFeesLead(f)).toBe('You paid at least $35.00 in bank and card fees (1 charge) in the last 12 months.');
  });

  it('every printed amount on a handover day is counted — charged, back, not counted, left out (cycle 1, P2-5a)', () => {
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

  it('the records begin at each account’s earliest row, whatever order the rows arrive in', () => {
    n = 0;
    const f = findBankFees(
      [row('chk', '2026-09-01', -500, 'COFFEE', 'coffee'), row('chk', '2024-01-05', -500, 'COFFEE', 'coffee')],
      TODAY,
    );
    expect(f.records.from).toBe('2024-01-05');
    expect(f.records.accountsStartingInWindow).toBe(0);
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
  const records = (over: Partial<FeeRecords>): FeeRecords & { from: ReturnType<typeof isoDate> } => ({
    from: isoDate('2024-01-05'),
    accountsStartingInWindow: 0,
    latestAccountStart: null,
    accounts: 2,
    ...over,
  }) as FeeRecords & { from: ReturnType<typeof isoDate> };

  it('names the window account by account (cycle 2, P2-7)', () => {
    expect(feeWindowPhrase(records({}))).toBe('in the last 12 months');
    expect(feeWindowPhrase(records({ from: isoDate('2025-12-01'), accountsStartingInWindow: 2, latestAccountStart: isoDate('2026-02-01') }))).toBe(
      'since your records begin on Dec 1, 2025',
    );
    expect(feeWindowPhrase(records({ accountsStartingInWindow: 1, latestAccountStart: isoDate('2026-01-15') }))).toBe(
      "in the last 12 months (one account's records begin later, on Jan 15, 2026)",
    );
    expect(feeWindowPhrase(records({ accounts: 3, accountsStartingInWindow: 2, latestAccountStart: isoDate('2026-05-01') }))).toBe(
      'in the last 12 months (records for 2 accounts begin later, the latest on May 1, 2026)',
    );
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

  it('no sentence points at another part of the card (cycle 2, P2-6)', () => {
    for (const line of [BANK_FEES_RULE, BANK_FEES_UNCOUNTED_NOTE, ...Object.values(FEE_KIND_COPY).map((c) => c.avoid)]) {
      expect(line).not.toMatch(/\b(above|below|here below|beneath)\b/i);
    }
    // The not-counted note names the kinds it means.
    for (const kind of ['overdraft', 'monthly account', 'late', 'ATM', 'foreign transaction', 'wire']) {
      expect(BANK_FEES_UNCOUNTED_NOTE).toContain(kind);
    }
  });

  it('the rule states what the engine reads, in its terms', () => {
    for (const phrase of [
      'checking, savings and card accounts',
      'up to and including today',
      'pending rows, transfers, split totals, loan payments the app counts on the loan',
      "rows you've excluded",
      'Fees & Charges, ATM Fee or Late Fee',
      'only the words of one',
      'fee, charge or surcharge',
      "One other word, such as a business's name",
      'listed as not counted',
      'refund, reversal, rebate, reimbursement, waived or credit',
      "credit doesn't count beside a wire",
      'Interest and finance charges and annual fees are left out',
      'Everything errs low',
    ]) {
      expect(BANK_FEES_RULE).toContain(phrase);
    }
  });
});
