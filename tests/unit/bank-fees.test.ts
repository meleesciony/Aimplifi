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
 * credit comes back (P3-11). Cycle 3: every text wholly a kind's words is counted, and the
 * not-counted note says only that a row failed the named test (P1-1); money back is capped at
 * what was charged, per account and kind (P1-2); the item tail comes off only after overdraft
 * words and a "$" (P2-3); a reconnected account is one account (P2-4); every word list is
 * pinned exactly (P2-5); the text's kind beats the filing's (P3-6); each phrase alternative and
 * the give-back order are locked (P3-7).
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
import {
  ANNUAL_WORDS,
  FEE_KIND_WORDS,
  FEE_WORDS,
  FILLER,
  GIVEN_BACK_WORDS,
  bankFeeWindowStart,
  feeGivenBackKind,
  feeKindOf,
  feeTextWords,
  findBankFees,
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
    ['NON-SUFFICIENT FUNDS FEE', ['NONSUFFICIENT', 'FUNDS', 'FEE']],
    ['NON SUFFICIENT FUNDS FEE', ['NONSUFFICIENT', 'FUNDS', 'FEE']],
    // A month is noise only as a date (cycle 3, P3-9): beside a number, never alone.
    ['MONTHLY SERVICE FEE AUG 2026', ['MONTHLY', 'SERVICE', 'FEE']],
    ['MONTHLY SERVICE FEE SEPT 30', ['MONTHLY', 'SERVICE', 'FEE']],
    ['MAY LATE FEE', ['MAY', 'LATE', 'FEE']],
    ['MARKET 24 LATE FEE', ['MARKET', 'LATE', 'FEE']],
    // A mask needs its digits: two X's are a word.
    ['XX LATE FEE', ['XX', 'LATE', 'FEE']],
    // The item tail comes off only after an overdraft or returned-item fee's words, and only with a "$" (cycle 3, P2-3).
    ['LATE FEE FOR A $1,450.00 RENT PAYMENT RENTCAFE', ['LATE', 'FEE', 'FOR', 'A', 'RENT', 'PAYMENT', 'RENTCAFE']],
    ['MAINTENANCE FEE DETAILS: WESTGATE RESORTS', ['MAINTENANCE', 'FEE', 'DETAILS', 'WESTGATE', 'RESORTS']],
    ['MAINTENANCE FEE FOR A 2 BEDROOM UNIT SUNSET TOWERS', ['MAINTENANCE', 'FEE', 'FOR', 'A', 'BEDROOM', 'UNIT', 'SUNSET', 'TOWERS']],
    ['OVERDRAFT FEE FOR A 12.00 ITEM', ['OVERDRAFT', 'FEE', 'FOR', 'A', 'ITEM']],
    // What the rule promises to set aside, the code sets aside (cycle 4, P2-4).
    ['NON-WELLS FARGO ATM FEE', ['NON', 'ATM', 'FEE']],
    ['NON-BANK OF AMERICA ATM FEE', ['NON', 'ATM', 'FEE']],
    ['NON-US BANK ATM FEE', ['NON', 'ATM', 'FEE']],
    ['NON-CAPITAL ONE ATM FEE', ['NON', 'ATM', 'FEE']],
    ['NON-TD BANK ATM FEE', ['NON', 'ATM', 'FEE']],
    ['MONTHLY SERVICE FEE 31 AUG', ['MONTHLY', 'SERVICE', 'FEE']],
    ['MONTHLY SERVICE FEE AUG 31ST', ['MONTHLY', 'SERVICE', 'FEE']],
    ['MONTHLY SERVICE FEE AUG-31', ['MONTHLY', 'SERVICE', 'FEE']],
    ['MONTHLY SERVICE FEE AUG31', ['MONTHLY', 'SERVICE', 'FEE']],
    ['OVERDRAFT ITEM FEE-DETAILS: 0812 CORNER STORE', ['OVERDRAFT', 'ITEM', 'FEE']],
    ['OVERDRAFT ITEM FEE DETAIL: CORNER STORE', ['OVERDRAFT', 'ITEM', 'FEE']],
    // A bank's name of up to four words after NON-; a fifth word is not a bank's name.
    ['NON-FIRST NATIONAL BANK TEXAS ATM FEE', ['NON', 'ATM', 'FEE']],
    ['NON-FIRST NATIONAL BANK OF TEXAS ATM FEE', ['NON', 'FIRST', 'NATIONAL', 'BANK', 'OF', 'TEXAS', 'ATM', 'FEE']],
  ])('%s → %j', (raw, expected) => {
    expect(feeTextWords(raw)).toEqual(expected);
  });
});

describe('a month written beside a number is a date, in every spelling (cycle 5, P3-5)', () => {
  it.each([
    'JAN', 'JANUARY', 'FEB', 'FEBRUARY', 'MAR', 'MARCH', 'APR', 'APRIL', 'MAY', 'JUN', 'JUNE', 'JUL', 'JULY',
    'AUG', 'AUGUST', 'SEP', 'SEPT', 'SEPTEMBER', 'OCT', 'OCTOBER', 'NOV', 'NOVEMBER', 'DEC', 'DECEMBER',
  ])('%s', (month) => {
    expect(feeTextWords(`MONTHLY SERVICE FEE ${month} 30`)).toEqual(['MONTHLY', 'SERVICE', 'FEE']);
    expect(feeTextWords(`MONTHLY SERVICE FEE 30 ${month}`)).toEqual(['MONTHLY', 'SERVICE', 'FEE']);
    // Only beside a number: a month's letters inside another word, or alone, stay.
    expect(feeTextWords(`${month}X 30 LATE FEE`)).toContain(`${month}X`);
    expect(feeTextWords(`X${month} 30 LATE FEE`)).toContain(`X${month}`);
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
    // Wholly the kind's words, so counted — never "not counted" under a note that would be false (cycle 3, P1-1).
    ['fees', 'NON-SUFFICIENT FUNDS FEE', 'overdraft'],
    ['fees', 'NON SUFFICIENT FUNDS FEE', 'overdraft'],
    ['fees', 'OUT OF NETWORK WITHDRAWAL FEE', 'atm'],
    ['fees', 'OUT-OF-NETWORK WITHDRAWAL FEE', 'atm'],
    ['fees', 'BALANCE INQUIRY FEE', 'atm'],
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
    ['fees', 'ANNUAL FEE AUG 2026', 'annual'],
    ['fees', 'ANNUAL FEE FOR ACCT', 'annual'],
    ['fees', 'CLUB ANNUAL FEE', 'unread'],
    // Another business's annual fee is not "the yearly price of keeping a card or account" (cycle 4, P2-5).
    ['fees', 'IRA ANNUAL FEE', 'unread'],
    ['fees', 'HOMEOWNERS ASSN ANNUAL FEE', 'unread'],
    ['fees', 'ANYTOWN SWIM CLUB ANNUAL FEE', 'unread'],
    ['fees', 'CAMPGROUND ANNUAL FEE', 'unread'],
    // Each phrase alternative on its own (cycle 3, P3-7): no other alternative or fee word would catch these.
    ['fees', 'PLAN INTEREST', 'interest'],
    ['fees', 'INTEREST CHG', 'interest'],
    ['fees', 'MINIMUM INTEREST', 'interest'],
    // An account's name, not interest (cycle 5, P2-1): the word test lists it, under a true note.
    ['fees', 'BELOW MINIMUM INTEREST CHECKING BALANCE FEE', 'unread'],
    ['fees', 'PLAN INTEREST SAVINGS FEE', 'unread'],
    ['fees', 'MINIMUM INTEREST ACCOUNT FEE', 'unread'],
    ['fees', 'MINIMUM INTEREST ACCT FEE', 'unread'],
    ['fees', 'MINIMUM INTEREST BAL FEE', 'unread'],
    ['fees', 'BALANCE TRANSFER INTEREST', 'interest'],
    ['fees', 'PURCHASE INTEREST', 'interest'],
    ['fees', 'INTEREST ON CASH', 'interest'],
    ['fees', 'INTEREST ON BALANCE', 'interest'],
    ['fees', 'INTEREST ON BALANCES', 'interest'],
    ['fees', 'INTEREST ON PURCHASES', 'interest'],
    ['fees', 'INTEREST FEE', 'interest'],
    ['fees', 'FINANCE CHARGES', 'interest'],
    ['fees', 'INTEREST CHARGED', 'interest'],
    ['fees', 'INTEREST CHARGES', 'interest'],
    ['fees', 'ANNUAL CARD FEE', 'annual'],
    ['fees', 'ANNUAL ACCOUNT FEE', 'annual'],
    // An interest phrase beside an annual one is interest.
    ['fees', 'ANNUAL FEE INTEREST CHARGE', 'interest'],
    // Not a bank's or card's fee, by ANY word outside the kind (critic cycles 1–3).
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
    ['fees', 'CASH WITHDRAWAL FEE', 'unread'],
    ['fees', 'LATE FEE FOR A $1,450.00 RENT PAYMENT RENTCAFE', 'unread'],
    ['fees', 'MAINTENANCE FEE DETAILS: WESTGATE RESORTS', 'unread'],
    ['fees', 'MAINTENANCE FEE FOR A 2 BEDROOM UNIT SUNSET TOWERS', 'unread'],
    ['fees', 'MAY LATE FEE', 'unread'],
    ['fees', 'XX LATE FEE', 'unread'],
    // A word ADDED to a kind's vocabulary would count these (cycle 3, P2-5).
    ['fees', 'PAYMENT INCL LATE FEE', 'unread'],
    ['fees', 'LATE FEE FROM CITY', 'unread'],
    ['fees', 'MONTHLY PAYMENT FEE', 'unread'],
    ['fees', 'ATM DEPOSIT FEE', 'unread'],
    // The text's own kind beats the filing's (cycle 3, P3-6); the filing supplies a kind only to text naming none.
    ['atm-fee', 'FOREIGN TRANSACTION FEE', 'foreign'],
    ['atm-fee', 'INTL TRANSACTION FEE', 'foreign'],
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

  it('the word lists are exactly these — an added word is the direction that overstates (cycle 3, P2-5)', () => {
    const sorted = (s: ReadonlySet<string>) => [...s].sort();
    expect(sorted(FEE_WORDS)).toEqual(['CHARGE', 'CHARGES', 'FEE', 'FEES', 'SURCHARGE']);
    expect(sorted(FILLER)).toEqual(['A', 'AN', 'AND', 'ASSESSED', 'FOR', 'OF', 'ON', 'PER', 'POSTED', 'THE']);
    // Cycle 5, P2-2: an added word here would put a club's annual fee beside "a card or account".
    expect(sorted(ANNUAL_WORDS)).toEqual(['ACCOUNT', 'ACCT', 'ANNUAL', 'CARD', 'MEMBERSHIP']);
    expect(sorted(GIVEN_BACK_WORDS)).toEqual(
      ['CREDIT', 'CREDITED', 'REBATE', 'REBATED', 'REFUND', 'REFUNDED', 'REFUNDS', 'REIMB', 'REIMBURSED', 'REIMBURSEMENT', 'REV', 'REVERSAL', 'REVERSALS', 'REVERSE', 'REVERSED', 'WAIVE', 'WAIVED', 'WAIVER'],
    );
    expect(Object.fromEntries(Object.entries(FEE_KIND_WORDS).map(([k, v]) => [k, { anchors: sorted(v.anchors), vocab: sorted(v.vocab) }]))).toEqual({
      overdraft: {
        anchors: ['COURTESY', 'INSUFFICIENT', 'NONSUFFICIENT', 'NSF', 'OD', 'OVERDRAFT', 'OVERDRAWN', 'PAID', 'RETURN', 'RETURNED'],
        vocab: ['ACCOUNT', 'ACCT', 'ACH', 'CHECK', 'CHECKS', 'CONTINUOUS', 'DAILY', 'DEBIT', 'EXTENDED', 'FUND', 'FUNDS', 'ITEM', 'ITEMS', 'PAY', 'PAYMENT', 'PROTECTION', 'SUSTAINED', 'TRANSFER', 'XFER'],
      },
      atm: {
        anchors: ['ATM', 'INQ', 'INQUIRY', 'NETWORK'],
        vocab: ['BALANCE', 'CASH', 'DOMESTIC', 'FOREIGN', 'INTERNATIONAL', 'INTL', 'NON', 'OPERATOR', 'OUT', 'OWNER', 'TRANSACTION', 'TXN', 'USAGE', 'USE', 'WD', 'WDRL', 'WITH', 'WITHDRAW', 'WITHDRAWAL'],
      },
      late: { anchors: ['LATE', 'PAST'], vocab: ['DUE', 'PAYMENT', 'PMT'] },
      wire: {
        anchors: ['WIRE'],
        vocab: ['DOMESTIC', 'FOREIGN', 'IN', 'INCOMING', 'INTERNATIONAL', 'INTL', 'OUT', 'OUTGOING', 'SERVICE', 'SVC', 'TRANSFER', 'TRF'],
      },
      foreign: {
        anchors: ['CROSS', 'CURRENCY', 'FOREIGN', 'FX', 'INTERNATIONAL', 'INTL'],
        vocab: ['BORDER', 'CONVERSION', 'EXCHANGE', 'PURCHASE', 'SERVICE', 'TRANS', 'TRANSACTION', 'TXN'],
      },
      account: {
        anchors: ['ACCOUNT', 'ACCT', 'BELOW', 'LOW', 'MAINTENANCE', 'MINIMUM', 'MONTHLY', 'SERVICE'],
        vocab: ['BAL', 'BALANCE', 'CHECKING', 'MIN', 'SAVINGS'],
      },
    });
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
    // Wholly a kind's words, so the WORDS read as that kind — whether they COUNT is the cap's
    // call in findBankFees (cycle 3, P1-2), locked below.
    ['INCOMING WIRE TRANSFER 2207 SERVICE FEES', 'wire'],
    ['ATM WITHDRAWAL CHARGE REVERSAL', 'atm'],
  ] as const)('%s → %s', (descriptor, kind) => {
    expect(feeGivenBackKind(descriptor)).toBe(kind);
  });
});

describe('money back is capped at what was charged, per account and kind (cycle 3, P1-2)', () => {
  it('a principal worded only in a kind\'s words never reads as fees that came back', () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'),
        row('chk', '2026-05-01', -1_500, 'WIRE FEE', 'fees'),
        row('chk', '2026-05-02', 400_000, 'INCOMING WIRE TRANSFER 2207 SERVICE FEES', null),
        row('chk', '2026-05-03', 5_000, 'WIRE TRANSFER IN REFUND OF FEES', 'other-income'),
        row('chk', '2026-05-04', 20_000, 'ATM WITHDRAWAL CHARGE REVERSAL', 'cash'),
        row('chk', '2026-05-05', 1_500, 'WIRE FEE REFUND', 'fees'),
      ],
      TODAY,
    );
    // Only the refund that fits what was charged: $15.00 of wire fees, $15.00 back.
    expect(f.givenBack.map((r) => [r.date, r.amountCents])).toEqual([['2026-05-05', 1_500]]);
    expect(bankFeesLead(f)).toBe(
      'You paid at least $15.00 in bank and card fees (1 charge) in the last 12 months, and $15.00 of fees came back.',
    );
  });

  it('credits are taken oldest first until the account’s charges of that kind are used up — and listed newest first', () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'),
        row('chk', '2026-05-01', -3_500, 'OVERDRAFT ITEM FEE', 'fees'),
        row('chk', '2026-05-02', -3_500, 'OVERDRAFT ITEM FEE', 'fees'),
        row('chk', '2026-05-10', 3_500, 'OVERDRAFT FEE REFUND', 'fees'),
        row('chk', '2026-05-11', 3_500, 'OVERDRAFT FEE REFUND', 'fees'),
        row('chk', '2026-05-12', 3_500, 'OVERDRAFT FEE REFUND', 'fees'),
      ],
      TODAY,
    );
    expect(f.givenBack.map((r) => r.date)).toEqual(['2026-05-11', '2026-05-10']);
    expect(f.givenBackCents).toBe(7_000);
  });

  it('to the cent: a credit one cent over what is left has nothing to return', () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'),
        row('chk', '2026-05-01', -3_500, 'OVERDRAFT ITEM FEE', 'fees'),
        row('chk', '2026-05-10', 3_501, 'OVERDRAFT FEE REFUND', 'fees'),
        row('chk', '2026-05-11', 3_500, 'OVERDRAFT FEE REFUND', 'fees'),
      ],
      TODAY,
    );
    expect(f.givenBack.map((r) => r.amountCents)).toEqual([3_500]);
  });

  it('a refund on another account, or of another kind, has nothing to return', () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'),
        row('sav', '2024-01-02', -100, 'COFFEE', 'coffee'),
        row('chk', '2026-05-01', -3_500, 'OVERDRAFT ITEM FEE', 'fees'),
        row('sav', '2026-05-10', 3_500, 'OVERDRAFT FEE REFUND', 'fees'),
        row('chk', '2026-05-11', 1_200, 'MONTHLY SERVICE FEE REFUND', 'fees'),
      ],
      TODAY,
    );
    expect(f.givenBack).toEqual([]);
  });

  it('money in that the flow basis leaves out never comes back — pending, excluded, transfer, split, loan, money move (cycle 4, P1-1)', () => {
    n = 0;
    const loanCredit = row('chk', '2026-05-15', 3_500, 'OVERDRAFT FEE REFUND', 'fees');
    const f = findBankFees(
      [
        row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'),
        ...[1, 2, 3, 4, 5, 6].map((d) => row('chk', `2026-05-0${d}`, -3_500, 'OVERDRAFT ITEM FEE', 'fees')),
        row('chk', '2026-05-10', 3_500, 'OVERDRAFT FEE REFUND', 'fees', { status: 'PENDING' }),
        row('chk', '2026-05-11', 3_500, 'OVERDRAFT FEE REFUND', 'fees', { excludeFromTotals: true }),
        row('chk', '2026-05-12', 3_500, 'OVERDRAFT FEE REFUND', 'fees', { isTransfer: true }),
        row('chk', '2026-05-13', 3_500, 'OVERDRAFT FEE REFUND', 'fees', { isSplitParent: true }),
        row('chk', '2026-05-14', 3_500, 'OVERDRAFT FEE REFUND', 'transfer'),
        loanCredit,
      ],
      TODAY,
      { excludedFlowIds: new Set([loanCredit.id]) },
    );
    expect(f.chargedCents).toBe(21_000);
    expect(f.givenBack).toEqual([]);
    expect(bankFeesLead(f)).toBe('You paid at least $210.00 in bank and card fees (6 charges) in the last 12 months.');
  });

  it('credits are matched oldest first, whatever order they arrive in (cycle 4, P2-2)', () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'),
        row('chk', '2026-05-01', -3_500, 'OVERDRAFT ITEM FEE', 'fees'),
        row('chk', '2026-05-12', 3_500, 'OVERDRAFT FEE REFUND', 'fees'),
        row('chk', '2026-05-10', 3_500, 'OVERDRAFT FEE REFUND', 'fees'),
      ],
      TODAY,
    );
    expect(f.givenBack.map((r) => r.date)).toEqual(['2026-05-10']);
  });

  it('one credit can return several fees: counted as one credit (cycle 4, P2-3)', () => {
    n = 0;
    const f = findBankFees(
      [
        row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'),
        row('chk', '2026-05-01', -3_500, 'OVERDRAFT ITEM FEE', 'fees'),
        row('chk', '2026-05-02', -3_500, 'OVERDRAFT ITEM FEE', 'fees'),
        row('chk', '2026-05-09', 7_000, 'OVERDRAFT FEES REFUND', 'fees'),
      ],
      TODAY,
    );
    expect(feesGivenBackLine(f)).toBe('Came back — $70.00 (1 credit)');
  });

  it('a fee and its refund both on a superseded account are matched on the account it became (cycle 4, P2-2)', () => {
    n = 0;
    const f = findBankFees(
      [
        row('old-chk', '2023-01-04', -100, 'COFFEE', 'coffee'),
        row('old-chk', '2026-02-10', -3_500, 'OVERDRAFT ITEM FEE', 'fees'),
        row('old-chk', '2026-02-12', 3_500, 'OVERDRAFT FEE REFUND', 'fees'),
        row('new-chk', '2026-03-01', -100, 'COFFEE', 'coffee'),
      ],
      TODAY,
      { terminalOf: new Map([['old-chk', 'new-chk']]) },
    );
    expect(f.givenBackCents).toBe(3_500);
  });

  it('a row dated after today is no record: it never sets where an account’s records begin (cycle 4, P3-7)', () => {
    n = 0;
    const f = findBankFees(
      [row('chk', '2024-01-02', -100, 'COFFEE', 'coffee'), row('card', '2026-10-18', -100, 'COFFEE', 'coffee')],
      TODAY,
    );
    expect(f.records).toEqual({ from: '2024-01-02', accountsStartingInWindow: 0, latestAccountStart: null, accounts: 1 });
    expect(bankFeesLead(f)).toBe('No bank or card fees counted in the last 12 months.');
  });

  it('a reconnected account is one account — for the cap and for where its records begin (cycle 3, P2-4)', () => {
    n = 0;
    const rows = [
      row('old-chk', '2023-01-04', -100, 'COFFEE', 'coffee'),
      row('old-chk', '2026-02-10', -3_500, 'OVERDRAFT ITEM FEE', 'fees'),
      row('new-chk', '2026-03-01', -100, 'COFFEE', 'coffee'),
      row('new-chk', '2026-03-05', 3_500, 'OVERDRAFT FEE REFUND', 'fees'),
    ];
    const linked = findBankFees(rows, TODAY, { terminalOf: new Map([['old-chk', 'new-chk']]) });
    expect(linked.records).toEqual({ from: '2023-01-04', accountsStartingInWindow: 0, latestAccountStart: null, accounts: 1 });
    expect(linked.givenBackCents).toBe(3_500);
    expect(bankFeesLead(linked)).toBe(
      'You paid at least $35.00 in bank and card fees (1 charge) in the last 12 months, and $35.00 of fees came back.',
    );
    // Unlinked, they are two accounts: the new one starts inside the window and has no fee to return.
    const unlinked = findBankFees(rows, TODAY);
    expect(unlinked.records.accountsStartingInWindow).toBe(1);
    expect(unlinked.givenBack).toEqual([]);
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

  it('counts back only money in that reads as a counted kind of fee, within what was charged', () => {
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
      "You paid at least $155.87 in bank and card fees (10 charges) in the last 12 months (one account's records begin later, on Jan 15, 2026), and $67.50 of fees came back.",
    );
    expect(f.kinds.map(feeKindLine)).toEqual([
      'Overdraft and returned-item fees — $70.00 (2 charges)',
      'Monthly account fees — $35.00 (3 charges)',
      'Late fees — $29.00 (1 charge)',
      'Wire fees — $15.00 (1 charge)',
      'ATM fees — $6.00 (2 charges)',
      'Foreign transaction fees — $0.87 (1 charge)',
    ]);
    expect(feesGivenBackLine(f)).toBe('Came back — $67.50 (3 credits)');
    expect(feesUncountedLine(f)).toBe('Filed as fees, not counted — $3,519.75 (6 rows)');
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

  it('a refund with no charge of its kind in the window has nothing to return, and is not shown', () => {
    n = 0;
    const f = findBankFees(
      [row('chk', '2025-01-02', -100, 'COFFEE', 'coffee'), row('chk', '2026-01-05', 3_400, 'OVERDRAFT FEE REFUND', 'fees')],
      TODAY,
    );
    expect(f.givenBack).toEqual([]);
    expect(bankFeesLead(f)).toBe('No bank or card fees counted in the last 12 months.');
  });

  it('never more back than charged, and no net is ever stated', () => {
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
    expect(f.givenBackCents).toBe(1_200);
    const lead = bankFeesLead(f);
    expect(lead).toBe(
      'You paid at least $12.00 in bank and card fees (1 charge) in the last 12 months, and $12.00 of fees came back.',
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
        row('chk', day, -9_500, 'ANNUAL FEE', 'fees'),
        row('chk', day, -900, 'GROCERY', 'groceries'),
      ],
      TODAY,
      { handoverKeys: new Set([handoverKey('chk', day)]) },
    );
    expect(f.amountsOnHandoverDays).toBe(5);
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

  it('the rule states what the engine reads, in its terms (cycles 1–3)', () => {
    for (const phrase of [
      'checking, savings and card accounts',
      'up to and including today',
      'an account you reconnected counts as one',
      'pending rows, transfers and money moved to investments or savings, split totals, loan payments the app counts on the loan',
      "rows you've excluded",
      'numbers, amounts, account digits, dates written with a month',
      '"NON-<bank> ATM"',
      'after an overdraft or returned-item fee\'s own words, the "for a $…" or "details:" part',
      'the test passes when every word left belongs to one',
      'a word that names that kind',
      'fee, charge or surcharge',
      'a few connecting words',
      'Fees & Charges, ATM Fee or Late Fee',
      'may leave out the word naming its kind',
      'listed as not counted',
      'refund, reversal, rebate, reimbursement, waived or credit',
      "credit beside a wire doesn't count",
      'only up to what was charged of that kind on that account',
      "other money in isn't shown",
      "Interest and finance charges, and a card's or account's annual fee worded on its own, are left out",
      'Everything errs low',
    ]) {
      expect(BANK_FEES_RULE).toContain(phrase);
    }
    // The not-counted note claims only what is true of every row it heads: they failed the named test.
    expect(BANK_FEES_UNCOUNTED_NOTE).toContain("doesn't pass this card's word test");
    expect(BANK_FEES_UNCOUNTED_NOTE).toContain('How these are counted');
  });
});
