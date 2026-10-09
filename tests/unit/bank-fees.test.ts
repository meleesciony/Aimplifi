/**
 * Fees you paid — the bank fees in the reader's last 12 months of records, by kind, net of
 * what came back (DECISIONS #796). The engine's rule (`findBankFees`), its kinds
 * (`feeKindOf`), the given-back reading (`readsAsFeeGivenBack`), and every sentence the card
 * prints. Every amount, date and descriptor is invented (keep-live-figures-out-of-repo).
 * Hand-verified values: tests/edge-cases/bank-fees.md.
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
  BANK_FEES_RULE,
  FEE_KIND_COPY,
  bankFeesLead,
  feeDate,
  feeKindLine,
  feeWindowPhrase,
  feesGivenBackLine,
  feesLeftOutLine,
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

describe('feeKindOf — the filing first, then the bank text', () => {
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
    ['fees', 'ADVISORY FEE Q3', 'advisory'],
    ['fees', 'ACCOUNT MANAGEMENT FEE', 'advisory'],
    ['fees', 'LATE PAYMENT FEE', 'late'],
    ['fees', 'INTEREST CHARGE ON PURCHASES', 'interest'],
    ['fees', 'FINANCE CHARGE', 'interest'],
    ['fees', 'ANNUAL FEE', 'annual'],
    ['fees', 'ANNUAL MEMBERSHIP FEE', 'annual'],
    ['fees', 'VENMO INSTANT TRANSFER FEE', 'other'],
    // Two rules read the same text: the earlier kind wins.
    ['fees', 'ATM INTL TRANSACTION FEE', 'atm'],
    ['fees', 'ADVISORY ACCOUNT FEE', 'advisory'],
    ['atm-fee', 'CASH WITHDRAWAL CHARGE', 'atm'],
    ['late-fee', 'ANNUAL FEE', 'late'],
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

describe('readsAsFeeGivenBack — money in filed elsewhere', () => {
  it.each([
    ['ATM FEE REBATE', true],
    ['OVERDRAFT REVERSAL', true],
    ['FEE REFUND', true],
    ['MONTHLY SERVICE FEE WAIVED', true],
    ['LATE FEE CREDIT', true],
    ['INTEREST CHARGE REVERSAL', false],
    ['INTEREST FEE REFUND', false],
    ['ANNUAL FEE REFUND', false],
    ['AMAZON REFUND', false],
    ['CASH BACK CREDIT', false],
    ['SERVICE FEE', false],
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
      ['late', 2_900, 1],
      ['account', 2_400, 2],
      ['wire', 1_500, 1],
      ['atm', 650, 2],
      ['foreign', 87, 1],
    ]);
    expect(f.chargedCents).toBe(14_537);
  });

  it('lists each kind newest first, and every list adds up to its total', () => {
    const overdraft = f.kinds[0];
    expect(overdraft.rows.map((r) => r.date)).toEqual(['2026-09-04', '2026-09-03']);
    for (const k of f.kinds) {
      expect(k.rows.reduce((s, r) => s + r.amountCents, 0)).toBe(k.chargedCents);
      for (const r of k.rows) expect(r.amountCents).toBeGreaterThan(0);
    }
  });

  it('subtracts money in on fee rows and refund-worded money in filed elsewhere — and nothing else', () => {
    expect(f.givenBack.map((r) => [r.date, r.amountCents, r.rawDescriptor ?? r.label])).toEqual([
      ['2026-09-10', 3_500, 'OVERDRAFT FEE REFUND'],
      ['2026-03-01', 350, 'ATM FEE REBATE'],
    ]);
    expect(f.givenBackCents).toBe(3_850);
    expect(f.netCents).toBe(10_687);
  });

  it('leaves out interest (either filing) and annual card fees, and their reversals with them', () => {
    expect(f.leftOut).toEqual({ interestCents: 8_489, interestCount: 2, annualCents: 9_500, annualCount: 1 });
  });

  it('reads the window, the records and the handover day', () => {
    expect(f.from).toBe('2025-10-18');
    expect(f.to).toBe('2026-10-17');
    expect(f.recordsFrom).toBe('2024-01-05');
    // Only the overdraft fee is a counted row on chk's handover day; the grocery row is not counted.
    expect(f.countedOnHandoverDays).toBe(1);
    expect(f.kinds[0].rows.find((r) => r.date === '2026-09-03')?.onHandoverDay).toBe(true);
  });

  it('prints the lead, the kinds, the given-back and left-out lines exactly', () => {
    expect(bankFeesLead(f)).toBe(
      'You were charged $145.37 in bank fees (9 charges) in the last 12 months; $38.50 came back, so they cost you $106.87.',
    );
    expect(f.kinds.map(feeKindLine)).toEqual([
      'Overdraft and returned-item fees — $70.00 (2 charges)',
      'Late fees — $29.00 (1 charge)',
      'Monthly account fees — $24.00 (2 charges)',
      'Wire fees — $15.00 (1 charge)',
      'ATM fees — $6.50 (2 charges)',
      'Foreign transaction fees — $0.87 (1 charge)',
    ]);
    expect(feesGivenBackLine(f)).toBe('Came back — $38.50 (2 refunds or reversals)');
    expect(feesLeftOutLine(f)).toBe(
      'Not counted here: $84.89 of interest and finance charges (2 charges) and $95.00 of annual card fees (1 charge). Interest is the cost of a balance carried from month to month, and an annual fee is the price of keeping a card.',
    );
  });
});

describe('findBankFees — edges', () => {
  it('no rows: nothing counted and no records', () => {
    const f = findBankFees([], TODAY);
    expect(f.kinds).toEqual([]);
    expect(f.chargedCents).toBe(0);
    expect(f.netCents).toBe(0);
    expect(f.recordsFrom).toBeNull();
    expect(bankFeesLead(f)).toBe('No bank fees counted in the last 12 months.');
    expect(feesLeftOutLine(f)).toBeNull();
  });

  it('only interest: nothing counted, the interest named', () => {
    n = 0;
    const f = findBankFees([row('card', '2026-09-01', -1_234, 'INTEREST CHARGE', 'fees')], TODAY);
    expect(bankFeesLead(f)).toBe('No bank fees counted since your records begin on Sep 1, 2026.');
    // Only the reason for the money actually left out — no annual-fee clause without an annual fee.
    expect(feesLeftOutLine(f)).toBe(
      'Not counted here: $12.34 of interest and finance charges (1 charge). Interest is the cost of a balance carried from month to month.',
    );
  });

  it('only an annual fee: that one reason, no interest clause', () => {
    n = 0;
    const f = findBankFees([row('card', '2026-09-01', -9_500, 'ANNUAL FEE', 'fees')], TODAY);
    expect(feesLeftOutLine(f)).toBe(
      'Not counted here: $95.00 of annual card fees (1 charge). An annual fee is the price of keeping a card.',
    );
  });

  it('a refund with no charge in the window still says what came back', () => {
    n = 0;
    const f = findBankFees(
      [row('chk', '2025-01-02', -100, 'COFFEE', 'coffee'), row('chk', '2026-01-05', 3_400, 'OVERDRAFT FEE REFUND', 'fees')],
      TODAY,
    );
    expect(f.netCents).toBe(0);
    expect(bankFeesLead(f)).toBe('No bank fees counted in the last 12 months, and $34.00 of fees came back to you.');
  });

  it('more back than charged: the net floors at $0.00 and the lead states the two facts only', () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2025-01-02', -100, 'COFFEE', 'coffee'),
        row('chk', '2026-02-01', -1_200, 'MONTHLY SERVICE FEE', 'fees'),
        row('chk', '2026-02-03', 1_200, 'MONTHLY SERVICE FEE REVERSAL', 'fees'),
        row('chk', '2026-03-03', 3_500, 'OVERDRAFT REVERSAL', 'other-income'),
      ],
      TODAY,
    );
    expect(f.chargedCents).toBe(1_200);
    expect(f.givenBackCents).toBe(4_700);
    expect(f.netCents).toBe(0);
    expect(bankFeesLead(f)).toBe('You were charged $12.00 in bank fees (1 charge) in the last 12 months, and $47.00 came back.');
  });

  it('exactly as much back as charged: the two facts, no "cost you $0.00"', () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2025-01-02', -100, 'COFFEE', 'coffee'),
        row('chk', '2026-02-01', -1_200, 'MONTHLY SERVICE FEE', 'fees'),
        row('chk', '2026-02-03', 1_200, 'MONTHLY SERVICE FEE REVERSAL', 'fees'),
      ],
      TODAY,
    );
    expect(bankFeesLead(f)).toBe('You were charged $12.00 in bank fees (1 charge) in the last 12 months, and $12.00 came back.');
  });

  it('a $0.00 fee row (a waived fee posted at zero) is not a charge', () => {
    n = 0;
    const f = findBankFees([row('chk', '2026-02-01', 0, 'MONTHLY SERVICE FEE WAIVED', 'fees')], TODAY);
    expect(f.kinds).toEqual([]);
    expect(f.givenBack).toEqual([]);
  });

  it('the records begin at the earliest row, whatever order the rows arrive in', () => {
    n = 0;
    const f = findBankFees(
      [row('chk', '2026-09-01', -500, 'COFFEE', 'coffee'), row('chk', '2024-01-05', -500, 'COFFEE', 'coffee')],
      TODAY,
    );
    expect(f.recordsFrom).toBe('2024-01-05');
  });

  it('one charge, nothing back: "You paid", singular', () => {
    n = 0;
    const f = findBankFees(
      [row('chk', '2025-01-02', -100, 'COFFEE', 'coffee'), row('card', '2026-05-20', -2_900, 'LATE FEE', 'late-fee')],
      TODAY,
    );
    expect(bankFeesLead(f)).toBe('You paid $29.00 in bank fees (1 charge) in the last 12 months.');
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
    const base = { from: isoDate('2025-10-18') };
    expect(feeWindowPhrase({ ...base, recordsFrom: isoDate('2025-10-18') })).toBe('in the last 12 months');
    expect(feeWindowPhrase({ ...base, recordsFrom: isoDate('2025-10-19') })).toBe(
      'since your records begin on Oct 19, 2025',
    );
    expect(feeWindowPhrase({ ...base, recordsFrom: null })).toBe('in the last 12 months');
    expect(feeDate(isoDate('2026-03-02'))).toBe('Mar 2, 2026');
  });

  it('every sentence is free of shame and of instructions', () => {
    const SHAME_OR_ADVICE =
      /\b(should|must|stop|wasted?|wasting|guilty|guilt|shame|splurg\w*|overspen\w*|cut back|bad habit|irresponsible|careless)\b/i;
    const lines = [
      BANK_FEES_RULE,
      ...Object.values(FEE_KIND_COPY).flatMap((c) => [c.label, c.avoid]),
    ];
    for (const line of lines) expect(line).not.toMatch(SHAME_OR_ADVICE);
  });

  it('the rule names every counted filing and both left-out kinds', () => {
    for (const phrase of ['Fees & Charges', 'ATM Fee', 'Late Fee', 'Interest and finance charges', 'annual card fees', "you've excluded"]) {
      expect(BANK_FEES_RULE).toContain(phrase);
    }
  });
});

