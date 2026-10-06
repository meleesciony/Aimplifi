/**
 * Money you put in — brokerage deposits read from the bank side (DECISIONS #788).
 * The engine's every rule and boundary, the words it prints, the brokerage list's
 * drift against the categorizer, the demo seed, and the real loader. Every account,
 * amount and date is invented (keep-live-figures-out-of-repo). Hand-verified values:
 * tests/edge-cases/investment-deposits.md.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { prisma } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import { GENERIC_CATEGORY_RULES } from '@/lib/engine/categorize/normalize';
import { BROKERAGES, brokerageOfAccount, brokeragesNamedIn } from '@/lib/engine/investments/brokerages';
import {
  computeDepositHistory,
  descriptorCarriesMask,
  type DepositAccount,
  type DepositHistory,
  type DepositRow,
  type UncountedRow,
} from '@/lib/engine/investments/deposits';
import {
  DEPOSITS_NO_INVESTMENT_ACCOUNTS,
  DEPOSITS_NO_RECORDS,
  DEPOSITS_NO_SOURCE_ACCOUNTS,
  depositLead,
  depositRuleNote,
  destinationDetail,
  destinationLabel,
  figureParts,
  monthFigure,
  monthFigureParts,
  monthMissingNote,
  movementPhrase,
  scopeByNameNote,
  scopeNote,
  thisYearSpan,
  uncountedDirection,
  uncountedReason,
} from '@/lib/engine/investments/deposits-copy';
import { buildSeedData } from '@/lib/seed/build';
import { getDepositHistory } from '@/server/investment-deposits';

const TODAY = isoDate('2026-10-17');
const YESTERDAY = '2026-10-16';

function acct(
  id: string,
  type: string,
  label: string,
  mask: string | null,
  institutionName: string | null,
  extra: Partial<DepositAccount> = {},
): DepositAccount {
  const bank = type === 'CHECKING' || type === 'SAVINGS' || type === 'CREDIT';
  return { id, type, label, mask, institutionName, feedName: label, completeThrough: bank ? YESTERDAY : null, ...extra };
}

const CHK = acct('chk', 'CHECKING', 'Everyday Checking', '7712', 'First Example Bank');
const SAV = acct('sav', 'SAVINGS', 'Rainy Day Savings', '3390', 'First Example Bank');
const CARD = acct('card', 'CREDIT', 'Travel Card', '1188', 'First Example Bank');
const VG = acct('vg', 'INVESTMENT', 'Vanguard Brokerage', '5521', 'Vanguard');
const IRA = acct('ira', 'INVESTMENT', 'Roth IRA', '6604', null);
const BASE = [CHK, SAV, CARD, VG, IRA];

let n = 0;
function row(
  accountId: string,
  date: string,
  amountCents: number,
  rawDescriptor: string,
  categoryId: string | null = 'transfer',
  extra: Partial<DepositRow> = {},
): DepositRow {
  return { id: `r${String(++n).padStart(4, '0')}`, accountId, date, amountCents, rawDescriptor, status: 'POSTED', categoryId, ...extra };
}

/** Records start 2025-01-02 on checking and savings → the window is 2025-10 … 2026-10, every month covered. */
const ANCHORS = () => [row('chk', '2025-01-02', -1000, 'BLUE DOOR COFFEE', 'coffee'), row('sav', '2025-01-02', -200, 'MONTHLY FEE', 'fees')];

function history(
  rows: DepositRow[],
  accounts: DepositAccount[] = BASE,
  extra: { terminalOf?: Map<string, string>; scopeAccountId?: string; handoverDates?: Set<string> } = {},
): DepositHistory {
  return computeDepositHistory({ today: TODAY, rows: [...ANCHORS(), ...rows], accounts, ...extra });
}

const month = (h: DepositHistory, m: string) => h.months.find((x) => x.month === m)!;

describe('A1/A2/A3 — what counts and where it goes', () => {
  it('a brokerage name places the money at the BROKERAGE, never one account there (A1)', () => {
    const h = history([row('chk', '2026-09-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment')]);
    expect(month(h, '2026-09').putInCents).toBe(50000);
    expect(month(h, '2026-09').events).toMatchObject([{ destinationKey: 'brokerage:vanguard', direction: 'in', cents: 50000, sourceLabel: 'Everyday Checking' }]);
    const d = h.destinations[0]!.destination;
    expect(d).toEqual({ key: 'brokerage:vanguard', kind: 'brokerage', accountIds: ['vg'], accountLabels: ['Vanguard Brokerage'], brokerageName: 'Vanguard' });
    expect(destinationLabel(d)).toBe('Vanguard');
    expect(destinationDetail(d)).toBe('Matched by name only — your linked account there is Vanguard Brokerage');
    expect(h.thisYear).toEqual({ fromMonth: '2026-01', putInCents: 50000, takenOutCents: 0, monthsMissingRecords: 0 });
    expect(h.uncounted).toEqual([]);
  });

  it('the last four after a mask marker places it in that account (A2)', () => {
    const marked = ['ONLINE TRANSFER TO XXXXXX6604', 'TRANSFER TO ROTH X6604', 'ACH TO ...6604', 'XFER *6604', 'TO ACCOUNT ENDING IN 6604', 'TO ACCT 6604', 'TO ACCT# 6604', 'TO acct no. 6604', 'x6604 transfer'];
    for (const d of marked) {
      const h = history([row('chk', '2026-09-10', -25000, d)]);
      expect(month(h, '2026-09').events.map((e) => e.destinationKey), d).toEqual(['ira']);
      expect(destinationDetail(h.destinations[0]!.destination)).toBe('Matched by its last four digits');
      expect(destinationLabel(h.destinations[0]!.destination)).toBe('Roth IRA');
    }
    // A check number or a reference is not an account (critic F14): no "#" marker.
    const unmarked = ['TRANSFER 6604', 'BOX6604 TRANSFER', 'TO X66041', 'REF X6604A', 'TO ACCT 66043', 'CHECK #6604', 'REF #6604'];
    for (const d of unmarked) {
      const h = history([row('chk', '2026-09-10', -25000, d)]);
      expect(month(h, '2026-09').events, d).toEqual([]);
      expect(h.uncounted, d).toEqual([]);
    }
  });

  it('descriptorCarriesMask refuses masks shorter than four or not letters and digits', () => {
    expect(descriptorCarriesMask('TO X123', '123')).toBe(false);
    expect(descriptorCarriesMask('TO X12-4', '12-4')).toBe(false);
    expect(descriptorCarriesMask('TO X12A4', '12a4')).toBe(true);
    expect(descriptorCarriesMask('TO X6604', null)).toBe(false);
  });

  it('money arriving FROM a brokerage is taken out, summed apart from money put in (A3)', () => {
    const h = history([
      row('chk', '2026-09-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment'),
      row('chk', '2026-08-14', 30000, 'VANGUARD REDEMPTION'),
    ]);
    expect(month(h, '2026-08')).toMatchObject({ putInCents: 0, takenOutCents: 30000 });
    expect(month(h, '2026-08').events[0]).toMatchObject({ direction: 'out', cents: 30000 });
    expect(h.thisYear).toMatchObject({ putInCents: 50000, takenOutCents: 30000 });
    expect(h.destinations[0]).toMatchObject({ putInCents: 50000, takenOutCents: 30000 });
  });

  it('savings is a source too', () => {
    const h = history([row('sav', '2026-09-05', -12345, 'TRANSFER TO X5521')]);
    expect(month(h, '2026-09').events).toMatchObject([{ destinationKey: 'vg', sourceAccountId: 'sav' }]);
  });
});

describe('A4 — never counted', () => {
  it('pending, split parent, excluded, filed to spending, on a card, $0 or after today: not counted and not listed', () => {
    const h = history([
      row('chk', '2026-09-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment', { status: 'PENDING' }),
      row('chk', '2026-09-06', -50000, 'VANGUARD BUY INVESTMENT', 'investment', { isSplitParent: true }),
      row('chk', '2026-09-07', -50000, 'VANGUARD BUY INVESTMENT', 'investment', { excludeFromTotals: true }),
      row('chk', '2026-09-08', -50000, 'VANGUARD BUY INVESTMENT', 'shopping'),
      row('card', '2026-09-11', -50000, 'VANGUARD BUY INVESTMENT', 'investment'),
      row('chk', '2026-09-12', 0, 'VANGUARD BUY INVESTMENT', 'investment'),
      row('chk', '2026-10-20', -50000, 'VANGUARD BUY INVESTMENT', 'investment'),
    ]);
    expect(h.months.every((m) => m.events.length === 0)).toBe(true);
    expect(h.uncounted).toEqual([]);
    expect(h.destinations).toEqual([]);
  });

  it('a transfer that names no investment account is an ordinary move — ignored', () => {
    const h = history([row('chk', '2026-09-05', -50000, 'ONLINE TRANSFER TO SAVINGS X3390')]);
    expect(h.uncounted).toEqual([]);
    expect(month(h, '2026-09').events).toEqual([]);
  });
});

describe('F3 — a row not filed yet that names a destination is listed, never dropped', () => {
  it('lists it with "file it to count it", and the lead does not say nothing moved', () => {
    const h = history([
      row('chk', '2026-09-05', -50000, 'ONLINE TRANSFER TO XXXXXX6604', 'uncategorized'),
      row('chk', '2026-04-05', -50000, 'VANGUARD BUY INVESTMENT', null),
      row('chk', '2026-04-06', -7000, 'CORNER DELI', null),
    ]);
    expect(h.uncounted.map((u) => [u.reason, u.destinationAccountIds])).toEqual([
      ['not-filed', ['vg']],
      ['not-filed', ['ira']],
    ]);
    expect(month(h, '2026-09').putInCents).toBe(0);
    expect(monthFigureParts(month(h, '2026-09'))).toEqual(['None counted', '1 not counted']);
    expect(depositLead(h)).toBe('Nothing counted so far this year. 2 movements we couldn’t count are listed under “Not counted”.');
    expect(uncountedReason(h.uncounted[0]!)).toBe('It isn’t filed yet. File it as Transfer or Investment & Savings to count it.');
  });
});

describe('F4 — money that came back cancels the deposit', () => {
  it('a returned item, not filed, two weeks or less later: listed as returned, the return itself not listed', () => {
    const h = history([
      row('chk', '2026-09-05', -50000, 'ONLINE TRANSFER TO XXXXXX6604'),
      row('chk', '2026-09-08', 50000, 'RETURNED ITEM ONLINE TRANSFER XXXXXX6604', 'uncategorized'),
    ]);
    expect(month(h, '2026-09')).toMatchObject({ putInCents: 0, takenOutCents: 0 });
    expect(h.uncounted).toMatchObject([{ reason: 'returned', returnedOn: '2026-09-08', cents: 50000, direction: 'in' }]);
    expect(uncountedReason(h.uncounted[0]!)).toBe('The same amount came back on Tue, Sep 8, so the two cancel out.');
  });

  it('a reversal filed Transfer cancels too; 14 days still cancels, 15 does not', () => {
    const rev = history([row('chk', '2026-09-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment'), row('chk', '2026-09-19', 50000, 'VANGUARD REVERSAL')]);
    expect(rev.uncounted).toMatchObject([{ reason: 'returned', returnedOn: '2026-09-19' }]);
    expect(month(rev, '2026-09')).toMatchObject({ putInCents: 0, takenOutCents: 0 });
    const late = history([row('chk', '2026-09-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment'), row('chk', '2026-09-20', 50000, 'VANGUARD REVERSAL')]);
    expect(month(late, '2026-09')).toMatchObject({ putInCents: 50000, takenOutCents: 50000 });
  });

  it('an unfiled return needs no return words; money arriving BEFORE a deposit is never its return', () => {
    const unworded = history([row('chk', '2026-09-05', -50000, 'TO X6604'), row('chk', '2026-09-07', 50000, 'ONLINE TRANSFER XXXXXX6604', null)]);
    expect(unworded.uncounted).toMatchObject([{ reason: 'returned', returnedOn: '2026-09-07' }]);
    const before = history([row('chk', '2026-09-01', 50000, 'VANGUARD REVERSAL'), row('chk', '2026-09-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment')]);
    expect(month(before, '2026-09')).toMatchObject({ putInCents: 50000, takenOutCents: 50000 });
    expect(before.uncounted).toEqual([]);
  });

  it('an ordinary withdrawal filed Transfer, no return words, is money taken out — not a return', () => {
    const h = history([row('chk', '2026-09-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment'), row('chk', '2026-09-09', 50000, 'VANGUARD REDEMPTION')]);
    expect(month(h, '2026-09')).toMatchObject({ putInCents: 50000, takenOutCents: 50000 });
    expect(h.uncounted).toEqual([]);
  });

  it('only the same account, the same amount, and one return per deposit', () => {
    const h = history([
      row('chk', '2026-09-05', -50000, 'TO X6604'),
      row('chk', '2026-09-06', -50000, 'TO X6604'),
      row('chk', '2026-09-08', 50000, 'RETURN X6604', 'uncategorized'),
      // On another account (and filed as income, so not the other half of a move either).
      row('sav', '2026-09-08', 50000, 'RETURN', 'income'),
      row('chk', '2026-09-09', 49999, 'RETURN X6604'),
    ]);
    expect(h.uncounted.filter((u) => u.reason === 'returned').map((u) => u.date)).toEqual(['2026-09-06']);
    expect(month(h, '2026-09').putInCents).toBe(50000);
  });
});

describe('A4/F1 — only evidence of a move takes a deposit, one to one', () => {
  it('an equal amount arriving in another of your accounts within 7 days takes it; 8 days does not', () => {
    const h = history([row('chk', '2026-07-02', -40000, 'ONLINE TRANSFER TO XXXXXX6604'), row('sav', '2026-07-09', 40000, 'ONLINE TRANSFER FROM CHK')]);
    expect(month(h, '2026-07').putInCents).toBe(0);
    expect(h.uncounted).toMatchObject([{ reason: 'landed-in-your-account', otherAccountLabel: 'Rainy Day Savings', cents: 40000, destinationAccountIds: ['ira'] }]);
    const apart = history([row('chk', '2026-07-02', -40000, 'ONLINE TRANSFER TO XXXXXX6604'), row('sav', '2026-07-10', 40000, 'ONLINE TRANSFER FROM CHK')]);
    expect(month(apart, '2026-07').putInCents).toBe(40000);
  });

  it('a card payment credit is the other half of a card payment, not of the deposit beside it', () => {
    const h = history([
      row('chk', '2026-06-01', -50000, 'CHASE EPAY TRAVEL CARD', 'credit-card-payment'),
      row('chk', '2026-06-02', -50000, 'VANGUARD BUY INVESTMENT', 'investment'),
      row('card', '2026-06-02', 50000, 'PAYMENT THANK YOU', 'credit-card-payment'),
    ]);
    expect(month(h, '2026-06').putInCents).toBe(50000);
    expect(h.uncounted).toEqual([]);
  });

  it('an ordinary transfer claims its own other half first, even when the deposit is closer (ACH lag)', () => {
    const h = history([
      row('chk', '2026-06-01', -50000, 'ONLINE TRANSFER TO OTHER BANK SAVINGS'),
      row('chk', '2026-06-02', -50000, 'VANGUARD BUY INVESTMENT', 'investment'),
      row('sav', '2026-06-03', 50000, 'TRANSFER FROM CHK'),
    ]);
    expect(month(h, '2026-06').putInCents).toBe(50000);
  });

  it('a card refund, a card purchase, income, pending, excluded or a future row is not the other half', () => {
    const cases: DepositRow[][] = [
      [row('chk', '2026-09-10', -50000, 'VANGUARD BUY INVESTMENT', 'investment'), row('card', '2026-09-12', 50000, 'AMAZON.COM REFUND', 'shopping')],
      [row('sav', '2026-09-10', 50000, 'VANGUARD REDEMPTION'), row('card', '2026-09-12', -50000, 'DELTA AIR LINES', 'air-travel')],
      [row('chk', '2026-09-10', -50000, 'VANGUARD BUY INVESTMENT', 'investment'), row('sav', '2026-09-12', 50000, 'INTEREST PAID', 'interest')],
      [row('chk', '2026-09-10', -50000, 'VANGUARD BUY INVESTMENT', 'investment'), row('sav', '2026-09-12', 50000, 'TRANSFER IN', 'transfer', { status: 'PENDING' })],
      [row('chk', '2026-09-10', -50000, 'VANGUARD BUY INVESTMENT', 'investment'), row('sav', '2026-09-12', 50000, 'TRANSFER IN', 'transfer', { excludeFromTotals: true })],
      [row('chk', '2026-10-15', -50000, 'TO X6604'), row('sav', '2026-10-18', 50000, 'TRANSFER IN')],
      // A card OUTFLOW (a purchase) never sends money to the checking account.
      [row('chk', '2026-09-10', 50000, 'VANGUARD REDEMPTION'), row('card', '2026-09-11', -50000, 'TRANSFER', 'transfer')],
    ];
    for (const rows of cases) {
      const h = history(rows);
      expect(h.uncounted, rows[1]!.rawDescriptor).toEqual([]);
      const m = month(h, rows[0]!.date.slice(0, 7));
      expect(m.putInCents + m.takenOutCents, rows[1]!.rawDescriptor).toBe(50000);
    }
  });

  it('an unfiled row or one flagged as a transfer IS evidence of a move', () => {
    const unfiled = history([row('chk', '2026-09-10', -50000, 'TO X6604'), row('sav', '2026-09-12', 50000, 'DEPOSIT', null)]);
    expect(unfiled.uncounted.map((u) => u.reason)).toEqual(['landed-in-your-account']);
    const flagged = history([row('chk', '2026-09-10', -50000, 'TO X6604'), row('sav', '2026-09-12', 50000, 'DEPOSIT', 'income', { isTransfer: true })]);
    expect(flagged.uncounted.map((u) => u.reason)).toEqual(['landed-in-your-account']);
  });

  it('money taken out that LEFT another of your accounts within a week is listed as such', () => {
    const h = history([row('chk', '2026-05-12', 60000, 'VANGUARD REDEMPTION'), row('sav', '2026-05-11', -60000, 'TRANSFER TO CHECKING')]);
    expect(h.uncounted).toMatchObject([{ reason: 'landed-in-your-account', direction: 'out', otherAccountLabel: 'Rainy Day Savings' }]);
    expect(uncountedReason(h.uncounted[0]!)).toBe('The same amount left Rainy Day Savings within a week, so it looks like a move between your own accounts.');
    expect(uncountedDirection(h.uncounted[0]!)).toBe('Arrived in Everyday Checking.');
  });
});

describe('A5 — a brokerage that is not linked here', () => {
  it('is listed, never counted', () => {
    const h = history([row('chk', '2026-09-12', -10000, 'ROBINHOOD FUNDS', 'investment')]);
    expect(month(h, '2026-09').putInCents).toBe(0);
    expect(h.uncounted).toMatchObject([{ reason: 'not-linked', brokerageName: 'Robinhood', destinationAccountIds: [], cents: 10000 }]);
  });

  it('but a bank move that landed in your own account at that brokerage says nothing about investing', () => {
    const schwabChk = acct('schwab-chk', 'CHECKING', 'Schwab Checking', '2201', 'Charles Schwab');
    const h = history([row('chk', '2026-09-15', -20000, 'SCHWAB MONEYLINK'), row('schwab-chk', '2026-09-16', 20000, 'FUNDS TRANSFER')], [...BASE, schwabChk]);
    expect(h.uncounted).toEqual([]);
    expect(h.months.every((m) => m.events.length === 0)).toBe(true);
  });
});

describe('F10 — fees, bills and card payments to a brokerage are not money put in', () => {
  it('is listed as a payment to the brokerage', () => {
    const rh = acct('rh', 'INVESTMENT', 'Robinhood Individual', '3001', 'Robinhood');
    const ml = acct('ml', 'INVESTMENT', 'Merrill Edge', '3002', 'Merrill');
    const h = history(
      [
        row('chk', '2026-09-01', -120000, 'ROBINHOOD CARD PAYMENT', 'investment'),
        row('chk', '2026-09-02', -500, 'ROBINHOOD GOLD MEMBERSHIP', 'investment'),
        row('chk', '2026-09-03', -25000, 'MERRILL LYNCH ADVISORY FEE', 'investment'),
        row('chk', '2026-09-04', -30000, 'SCHWAB VISA PAYMENT', 'investment'),
      ],
      [...BASE, rh, ml],
    );
    expect(month(h, '2026-09').putInCents).toBe(0);
    expect(h.uncounted.map((u) => [u.reason, u.brokerageName])).toEqual([
      ['not-a-deposit', 'Robinhood'],
      ['not-a-deposit', 'Robinhood'],
      ['not-a-deposit', 'Merrill'],
      ['not-a-deposit', 'Charles Schwab'],
    ]);
    expect(uncountedReason(h.uncounted[0]!)).toBe(
      'It names Robinhood next to a fee, bill or card-payment word, so it looks like a payment to Robinhood, not money put in.',
    );
  });
});

describe('A6 — a linked bank or card account at the same brokerage', () => {
  const schwabChk = acct('schwab-chk', 'CHECKING', 'Schwab Checking', '2201', 'Charles Schwab');
  const schwabBrk = acct('schwab-brk', 'INVESTMENT', 'Schwab Brokerage', '2202', 'Charles Schwab');
  const accounts = [...BASE, schwabChk, schwabBrk];
  const schwabSince = (date: string) => row('schwab-chk', date, -500, 'SCHWAB ATM FEE', 'fees');

  it('counts when that account’s records cover the week around the row and show no other half', () => {
    const h = history([schwabSince('2025-01-03'), row('chk', '2026-09-20', -100000, 'SCHWAB BROKERAGE MONEYLINK')], accounts);
    expect(month(h, '2026-09').events).toMatchObject([{ destinationKey: 'brokerage:schwab', cents: 100000 }]);
  });

  it('records starting exactly a week before still cover; a day later they do not', () => {
    const at = history([schwabSince('2026-09-13'), row('chk', '2026-09-20', -100000, 'SCHWAB BROKERAGE MONEYLINK')], accounts);
    expect(month(at, '2026-09').putInCents).toBe(100000);
    const later = history([schwabSince('2026-09-14'), row('chk', '2026-09-20', -100000, 'SCHWAB BROKERAGE MONEYLINK')], accounts);
    expect(month(later, '2026-09').putInCents).toBe(0);
    expect(later.uncounted).toMatchObject([{ reason: 'same-brokerage-account', brokerageName: 'Charles Schwab', otherAccountLabel: 'Schwab Checking', destinationAccountIds: ['schwab-brk'] }]);
    expect(uncountedReason(later.uncounted[0]!)).toBe(
      'You also link Schwab Checking at Charles Schwab, and its records don’t cover the week around this, so we can’t rule out that it went there.',
    );
  });

  it('a bank account with no rows at all cannot rule anything out', () => {
    const h = history([row('chk', '2026-09-20', -100000, 'SCHWAB BROKERAGE MONEYLINK')], accounts);
    expect(h.uncounted).toMatchObject([{ reason: 'same-brokerage-account' }]);
  });

  it('a feed that vouches for nothing covers only to its last row (F2: a stopped, failing or manual feed)', () => {
    const quiet = [...BASE, { ...schwabChk, completeThrough: null }, schwabBrk];
    const short = history([schwabSince('2025-01-03'), schwabSince('2026-09-26'), row('chk', '2026-09-20', -100000, 'SCHWAB BROKERAGE MONEYLINK')], quiet);
    expect(short.uncounted).toMatchObject([{ reason: 'same-brokerage-account' }]);
    const enough = history([schwabSince('2025-01-03'), schwabSince('2026-09-27'), row('chk', '2026-09-20', -100000, 'SCHWAB BROKERAGE MONEYLINK')], quiet);
    expect(month(enough, '2026-09').putInCents).toBe(100000);
  });

  it('until a whole week has passed it is too new; a week and a day counts', () => {
    const fresh = history([schwabSince('2025-01-03'), row('chk', '2026-10-10', -100000, 'SCHWAB BROKERAGE MONEYLINK')], accounts);
    expect(fresh.uncounted).toMatchObject([{ reason: 'too-new', brokerageName: 'Charles Schwab', otherAccountLabel: 'Schwab Checking' }]);
    expect(uncountedReason(fresh.uncounted[0]!)).toBe(
      'It’s less than a week old, and Schwab Checking (at Charles Schwab) may still show the other half. We’ll check again once a week has passed.',
    );
    const week = history([schwabSince('2025-01-03'), row('chk', '2026-10-09', -100000, 'SCHWAB BROKERAGE MONEYLINK')], accounts);
    expect(month(week, '2026-10').putInCents).toBe(100000);
  });

  it('the row’s own account is not the other account it must rule out', () => {
    // Its own record ends on the row's day — it could never "cover" the week after — yet it counts.
    const h = history([schwabSince('2025-01-03'), row('schwab-chk', '2026-09-20', -70000, 'TRANSFER TO SCHWAB BROKERAGE')], [CHK, { ...schwabChk, completeThrough: null }, schwabBrk]);
    expect(month(h, '2026-09').events).toMatchObject([{ destinationKey: 'brokerage:schwab', sourceAccountId: 'schwab-chk' }]);
  });

  it('the last four settle it without the coverage test', () => {
    const h = history([row('chk', '2026-10-15', -100000, 'SCHWAB BROKERAGE MONEYLINK X2202')], accounts);
    expect(month(h, '2026-10').events).toMatchObject([{ destinationKey: 'schwab-brk' }]);
  });

  it('the last four of your own bank account at that brokerage: a move between your accounts, ignored (F14)', () => {
    const h = history([schwabSince('2025-01-03'), row('chk', '2026-09-01', -100000, 'SCHWAB MONEYLINK TO X2201'), row('schwab-chk', '2026-09-10', 100000, 'FUNDS IN')], accounts);
    expect(month(h, '2026-09').events).toEqual([]);
    expect(h.uncounted).toEqual([]);
  });
});

describe('A7/A8 — ambiguity is never counted, and says which ambiguity', () => {
  it('two brokerages named', () => {
    const h = history([row('chk', '2026-09-05', -50000, 'VANGUARD SCHWAB MOVE', 'investment')]);
    expect(h.uncounted).toMatchObject([{ reason: 'two-brokerages', brokerageName: 'Vanguard', otherBrokerageName: 'Charles Schwab' }]);
    expect(uncountedReason(h.uncounted[0]!)).toBe('It names both Vanguard and Charles Schwab, so we can’t tell where it went.');
  });

  it('last four shared with another linked account, of any type', () => {
    const twin = acct('twin', 'CREDIT', 'Store Card', '5521', 'Other Bank');
    const h = history([row('chk', '2026-09-05', -50000, 'VANGUARD TRANSFER X5521')], [...BASE, twin]);
    expect(h.uncounted).toMatchObject([{ reason: 'shared-last-four', destinationAccountIds: ['vg'] }]);
    // F7: never "more than one of your Vanguard accounts" — the reader has one.
    expect(uncountedReason(h.uncounted[0]!)).toBe('More than one of your linked accounts ends in the four digits it names, so we can’t tell which one it went to.');
  });

  it('two investment accounts with the same last four', () => {
    const twin = acct('vg2', 'INVESTMENT', 'Vanguard IRA', '5521', 'Vanguard');
    const h = history([row('chk', '2026-09-05', -50000, 'ONLINE TRANSFER TO X5521')], [...BASE, twin]);
    expect(h.uncounted).toMatchObject([{ reason: 'shared-last-four', destinationAccountIds: ['vg', 'vg2'] }]);
  });

  it('the row’s OWN account’s last four in its description is not another account', () => {
    const byMask = history([row('chk', '2026-09-05', -50000, 'FROM CHK X7712 TO X6604')]);
    expect(month(byMask, '2026-09').events).toMatchObject([{ destinationKey: 'ira' }]);
    const byName = history([row('chk', '2026-09-06', -50000, 'FROM CHK X7712 VANGUARD BUY', 'investment')]);
    expect(month(byName, '2026-09').events).toMatchObject([{ destinationKey: 'brokerage:vanguard' }]);
  });

  it('a description naming one of your bank accounts AND an investment account', () => {
    const h = history([row('chk', '2026-09-05', -50000, 'FROM SAVINGS X3390 TO X5521')]);
    expect(h.uncounted).toMatchObject([{ reason: 'shared-last-four' }]);
  });

  it('last four and name disagree (A8)', () => {
    const h = history([row('chk', '2026-09-05', -50000, 'SCHWAB TRANSFER X5521')]);
    expect(h.uncounted).toMatchObject([{ reason: 'last-four-vs-name', brokerageName: 'Vanguard', otherBrokerageName: 'Charles Schwab' }]);
    expect(uncountedReason(h.uncounted[0]!)).toBe('Its last four digits point to your Vanguard account, but it names Charles Schwab, so we can’t tell where it went.');
  });

  it('last four of an account with no known brokerage beside a brokerage name: the last four win', () => {
    const h = history([row('chk', '2026-09-05', -50000, 'VANGUARD TRANSFER X6604')]);
    expect(month(h, '2026-09').events).toMatchObject([{ destinationKey: 'ira' }]);
  });

  it('last four and the same brokerage name agree', () => {
    const h = history([row('chk', '2026-09-05', -50000, 'VANGUARD TRANSFER X5521')]);
    expect(month(h, '2026-09').events).toMatchObject([{ destinationKey: 'vg' }]);
  });
});

describe('A9/F2 — the window, and months whose records are incomplete', () => {
  it('the last 12 complete months and this month, never before the records', () => {
    const h = history([
      row('chk', '2025-09-30', -50000, 'VANGUARD BUY INVESTMENT', 'investment'),
      row('chk', '2025-10-01', -20000, 'VANGUARD BUY INVESTMENT', 'investment'),
    ]);
    expect(h.recordsFromMonth).toBe('2025-02');
    expect(h.months.map((m) => m.month)).toEqual([
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
    ]);
    expect(h.months.filter((m) => m.partial).map((m) => m.month)).toEqual(['2026-10']);
    expect(h.months.every((m) => m.missingRecordsFrom.length === 0)).toBe(true);
    expect(month(h, '2025-10').putInCents).toBe(20000);
    expect(h.thisYear).toEqual({ fromMonth: '2026-01', putInCents: 0, takenOutCents: 0, monthsMissingRecords: 0 });
    expect(depositLead(h)).toBe('Nothing moved between your linked checking or savings and your investment accounts so far this year.');
  });

  it('a feed that stopped: every month after its last row says so, and the zero is "nothing found"', () => {
    const stopped = { ...CHK, completeThrough: null };
    const h = computeDepositHistory({
      today: TODAY,
      accounts: [stopped, VG],
      rows: [row('chk', '2025-01-02', -1000, 'CAFE', 'coffee'), row('chk', '2025-03-05', -40000, 'TO X5521'), row('chk', '2025-11-05', -40000, 'TO X5521')],
    });
    expect(month(h, '2025-10').missingRecordsFrom).toEqual([]);
    expect(month(h, '2025-11').missingRecordsFrom).toEqual(['Everyday Checking']);
    expect(month(h, '2025-11').putInCents).toBe(40000);
    expect(month(h, '2026-03').missingRecordsFrom).toEqual(['Everyday Checking']);
    expect(monthFigureParts(month(h, '2026-03'))).toEqual(['None found']);
    expect(monthMissingNote(month(h, '2026-03'))).toBe('Records from Everyday Checking don’t cover all of this month.');
    expect(monthMissingNote(month(h, '2026-10'))).toBe('Records from Everyday Checking don’t cover all of this month so far.');
    expect(h.thisYear).toMatchObject({ putInCents: 0, monthsMissingRecords: 10 });
    expect(depositLead(h)).toBe('Nothing found so far this year in the records we have. Some months are missing records — they’re marked below.');
  });

  it('a second account linked later: earlier months name it', () => {
    const second = acct('chk2', 'CHECKING', 'Joint Checking', '4400', 'First Example Bank');
    const h = history([row('chk2', '2026-09-01', -1500, 'CAFE', 'coffee'), row('chk', '2026-09-05', -50000, 'TO X6604')], [...BASE, second]);
    expect(month(h, '2026-08').missingRecordsFrom).toEqual(['Joint Checking']);
    expect(month(h, '2026-09').missingRecordsFrom).toEqual([]);
    expect(depositLead(h)).toBe('$500.00 put in so far this year. Some months are missing records — they’re marked below.');
  });

  it('this month needs records only through yesterday', () => {
    const h = history([]);
    expect(month(h, '2026-10').missingRecordsFrom).toEqual([]);
    const stale = history([], [CHK, { ...SAV, completeThrough: '2026-10-15' }, VG]);
    expect(month(stale, '2026-10').missingRecordsFrom).toEqual(['Rainy Day Savings']);
    expect(month(stale, '2026-09').missingRecordsFrom).toEqual([]);
  });

  it('a feed vouching past today still covers this month', () => {
    const h = history([], [{ ...CHK, completeThrough: '2027-01-01' }, SAV, VG]);
    expect(month(h, '2026-10').missingRecordsFrom).toEqual([]);
  });

  it('records that start mid-year: from the first complete month, and the year from there', () => {
    const h = computeDepositHistory({
      today: TODAY,
      accounts: [CHK, VG],
      rows: [row('chk', '2026-04-20', -1000, 'BLUE DOOR COFFEE', 'coffee'), row('chk', '2026-04-25', -9000, 'VANGUARD BUY INVESTMENT', 'investment'), row('chk', '2026-05-02', -8000, 'VANGUARD BUY INVESTMENT', 'investment')],
    });
    expect(h.recordsFromMonth).toBe('2026-05');
    expect(h.months[0]!.month).toBe('2026-05');
    expect(h.thisYear).toEqual({ fromMonth: '2026-05', putInCents: 8000, takenOutCents: 0, monthsMissingRecords: 0 });
    expect(depositLead(h)).toBe('$80.00 put in since May 2026.');
  });

  it('records starting on the 1st cover that month', () => {
    const h = computeDepositHistory({ today: TODAY, accounts: [CHK, VG], rows: [row('chk', '2026-05-01', -9000, 'VANGUARD BUY INVESTMENT', 'investment')] });
    expect(h.recordsFromMonth).toBe('2026-05');
    expect(month(h, '2026-05').putInCents).toBe(9000);
  });

  it('a card’s older records do not move the start — only checking and savings', () => {
    const h = computeDepositHistory({ today: TODAY, accounts: BASE, rows: [row('card', '2025-01-05', -500, 'CAFE', 'coffee'), row('chk', '2026-08-03', -500, 'CAFE', 'coffee')] });
    expect(h.recordsFromMonth).toBe('2026-09');
  });

  it('no complete month of records: nothing to show; no bank account at all says so', () => {
    const h = computeDepositHistory({ today: TODAY, accounts: BASE, rows: [row('chk', '2026-10-03', -9000, 'VANGUARD BUY INVESTMENT', 'investment')] });
    expect(h.recordsFromMonth).toBe('2026-11');
    expect(h.months).toEqual([]);
    expect(h.thisYear).toBeNull();
    expect(depositLead(h)).toBeNull();
    const none = computeDepositHistory({ today: TODAY, accounts: [CARD, VG], rows: [] });
    expect(none).toMatchObject({ hasSourceAccounts: false, hasInvestmentAccounts: true, recordsFromMonth: null, months: [] });
  });
});

describe('A10/A11/F6 — destinations and combined accounts', () => {
  it('several linked accounts at one brokerage are one destination by name', () => {
    const vg2 = acct('vg2', 'INVESTMENT', 'Vanguard IRA', '7001', 'Vanguard');
    const h = history([row('chk', '2026-09-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment')], [...BASE, vg2]);
    const d = h.destinations[0]!.destination;
    expect(d).toEqual({ key: 'brokerage:vanguard', kind: 'brokerage', accountIds: ['vg', 'vg2'], accountLabels: ['Vanguard Brokerage', 'Vanguard IRA'], brokerageName: 'Vanguard' });
    expect(destinationLabel(d)).toBe('Vanguard');
    expect(destinationDetail(d)).toBe('Matched by name only — your 2 linked accounts there are Vanguard Brokerage and Vanguard IRA');
  });

  it('a combined account’s older rows count on the live account, and its two copies never pair', () => {
    const h = history(
      [row('chk-old', '2026-09-01', -25000, 'VANGUARD BUY INVESTMENT', 'investment'), row('chk', '2026-09-02', 25000, 'MOBILE DEPOSIT', 'transfer')],
      BASE,
      { terminalOf: new Map([['chk-old', 'chk']]) },
    );
    expect(month(h, '2026-09').events).toMatchObject([{ sourceAccountId: 'chk', cents: 25000 }]);
    expect(h.uncounted).toEqual([]);
  });

  it('test_regression__a_handover_day_counts_each_real_deposit_once_as_a_multiset', () => {
    const terminalOf = new Map([['chk-old', 'chk']]);
    const handoverDates = new Set(['2026-09-01']);
    const dep = (acc: string) => row(acc, '2026-09-01', -50000, 'VANGUARD BUY INVESTMENT', 'investment');
    // Without the handover day the boundary's two copies would count twice.
    expect(month(history([dep('chk-old'), dep('chk')], BASE, { terminalOf }), '2026-09').putInCents).toBe(100000);
    expect(month(history([dep('chk-old'), dep('chk')], BASE, { terminalOf, handoverDates }), '2026-09').putInCents).toBe(50000);
    // Two real deposits, reported by both copies (critic F6: the occurrence helper kept 3).
    expect(month(history([dep('chk-old'), dep('chk-old'), dep('chk'), dep('chk')], BASE, { terminalOf, handoverDates }), '2026-09').putInCents).toBe(100000);
    // One copy saw two, the other one: two.
    expect(month(history([dep('chk-old'), dep('chk-old'), dep('chk')], BASE, { terminalOf, handoverDates }), '2026-09').putInCents).toBe(100000);
    // Different amounts are different deposits.
    expect(month(history([dep('chk-old'), row('chk', '2026-09-01', -40000, 'VANGUARD BUY INVESTMENT', 'investment')], BASE, { terminalOf, handoverDates }), '2026-09').putInCents).toBe(90000);
  });

  it('a row on an account that is not live is not read', () => {
    const h = history([row('gone', '2026-09-01', -25000, 'VANGUARD BUY INVESTMENT', 'investment')]);
    expect(month(h, '2026-09').events).toEqual([]);
  });

  it('destinations sort by money put in', () => {
    const h = history([row('chk', '2026-09-05', -100, 'VANGUARD BUY', 'investment'), row('chk', '2026-09-06', -900, 'TO X6604')]);
    expect(h.destinations.map((d) => d.destination.key)).toEqual(['ira', 'brokerage:vanguard']);
  });
});

describe('F5 — one investment account (?account=)', () => {
  const rows = () => [
    row('chk', '2026-09-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment'),
    row('chk', '2026-09-06', -25000, 'TO X6604'),
    row('chk', '2026-09-07', -10000, 'ROBINHOOD FUNDS', 'investment'),
    row('chk', '2026-07-02', -40000, 'ONLINE TRANSFER TO XXXXXX6604'),
    row('sav', '2026-07-03', 40000, 'ONLINE TRANSFER FROM CHK'),
  ];

  it('counts only money placed on that account by its last four, and says so', () => {
    const h = history(rows(), BASE, { scopeAccountId: 'ira' });
    expect(h.destinations.map((d) => d.destination.key)).toEqual(['ira']);
    expect(month(h, '2026-09').putInCents).toBe(25000);
    expect(h.uncounted.map((u) => u.reason)).toEqual(['landed-in-your-account']);
    expect(scopeNote(h)).toBe('Showing only money placed on Roth IRA by its last four digits.');
    expect(depositLead(h)).toBe('$250.00 put in to Roth IRA so far this year.');
    expect(scopeByNameNote(h)).toBeNull();
  });

  it('money matched only by its brokerage’s name is reported beside it, never as its own', () => {
    const h = history(rows(), BASE, { scopeAccountId: 'vg' });
    expect(h.destinations).toEqual([]);
    expect(h.scope).toEqual({ accountId: 'vg', label: 'Vanguard Brokerage', byBrokerageName: { brokerageName: 'Vanguard', putInCents: 50000, takenOutCents: 0 } });
    expect(depositLead(h)).toBe(
      'Nothing moved between your linked checking or savings and Vanguard Brokerage so far this year — none whose description names its last four digits.',
    );
    expect(scopeByNameNote(h)).toBe(
      'Also, over these months $500.00 went to Vanguard by name only — the description doesn’t say which of your accounts there, so it isn’t counted here. See all your investments for it.',
    );
  });

  it('both directions in a narrowed lead, and a scope that is not an investment account is ignored', () => {
    const h = history([row('chk', '2026-09-06', -25000, 'TO X6604'), row('chk', '2026-09-20', 5000, 'FROM X6604')], BASE, { scopeAccountId: 'ira' });
    expect(depositLead(h)).toBe('For Roth IRA: $250.00 put in and $50.00 taken out so far this year — $200.00 more in than out.');
    const notInv = history(rows(), BASE, { scopeAccountId: 'chk' });
    expect(notInv.scope).toBeNull();
    expect(notInv.destinations).toHaveLength(2);
  });
});

describe('no investment account linked', () => {
  it('still lists brokerage-named money, never counting it', () => {
    const h = history([row('chk', '2026-09-12', -10000, 'ROBINHOOD FUNDS', 'investment')], [CHK, SAV]);
    expect(h.hasInvestmentAccounts).toBe(false);
    expect(h.uncounted).toMatchObject([{ reason: 'not-linked' }]);
  });

  it('a row filed Investment & Savings that names nothing is listed; the same filed Transfer is ignored', () => {
    const filed = history([row('chk', '2026-09-12', -30000, 'MARCUS SAVINGS TRANSFER', 'investment')]);
    expect(filed.uncounted).toMatchObject([{ reason: 'no-account-named', brokerageName: null }]);
    // F8: the lead never claims the row names an investment account.
    expect(depositLead(filed)).toBe('Nothing counted so far this year. One movement we couldn’t count is listed under “Not counted”.');
    const transfer = history([row('chk', '2026-09-12', -30000, 'MARCUS SAVINGS TRANSFER', 'transfer')]);
    expect(transfer.uncounted).toEqual([]);
  });
});

describe('the words', () => {
  const lead = (putInCents: number, takenOutCents: number, fromMonth = '2026-01') =>
    depositLead({
      hasSourceAccounts: true,
      hasInvestmentAccounts: true,
      recordsFromMonth: '2025-02',
      months: [],
      thisYear: { fromMonth, putInCents, takenOutCents, monthsMissingRecords: 0 },
      destinations: [],
      uncounted: [],
      scope: null,
    });

  it('every mix of in and out', () => {
    expect(lead(50000, 0)).toBe('$500.00 put in so far this year.');
    expect(lead(0, 30000)).toBe('$300.00 taken out so far this year, nothing put in.');
    expect(lead(50000, 30000)).toBe('$500.00 put in and $300.00 taken out so far this year — $200.00 more in than out.');
    expect(lead(30000, 50000)).toBe('$300.00 put in and $500.00 taken out so far this year — $200.00 more out than in.');
    expect(lead(30000, 30000)).toBe('$300.00 put in and $300.00 taken out so far this year — as much in as out.');
    expect(lead(123456789, 0, '2026-05')).toBe('$1,234,567.89 put in since May 2026.');
  });

  it('an uncounted row before this year does not change the zero', () => {
    const h = history([row('chk', '2025-11-12', -10000, 'ROBINHOOD FUNDS', 'investment')]);
    expect(depositLead(h)).toBe('Nothing moved between your linked checking or savings and your investment accounts so far this year.');
  });

  it('month figures name which zero; money stays whole', () => {
    const base = { month: '2026-09', partial: false, events: [], putInCents: 0, takenOutCents: 0, uncountedCount: 0, missingRecordsFrom: [] as string[] };
    expect(monthFigureParts(base)).toEqual(['None']);
    expect(monthFigureParts({ ...base, uncountedCount: 2 })).toEqual(['None counted', '2 not counted']);
    expect(monthFigureParts({ ...base, missingRecordsFrom: ['Everyday Checking'] })).toEqual(['None found']);
    expect(monthFigureParts({ ...base, putInCents: 75000, uncountedCount: 1 })).toEqual(['$750.00 put in', '1 not counted']);
    expect(monthMissingNote({ ...base, missingRecordsFrom: ['A', 'B', 'C'] })).toBe('Records from A, B and C don’t cover all of this month.');
    expect(monthMissingNote(base)).toBeNull();
    expect(figureParts(75000, 200000)).toEqual(['$750.00 put in', '$2,000.00 taken out']);
    expect(monthFigure(0, 0)).toBe('None');
    expect(monthFigure(75000, 200000)).toBe('$750.00 put in · $2,000.00 taken out');
    expect(movementPhrase('in', 'Brokerage')).toBe('into Brokerage');
    expect(movementPhrase('out', 'Brokerage')).toBe('out of Brokerage');
    expect(thisYearSpan('2026-01')).toBe('so far this year');
    expect(thisYearSpan('2026-04')).toBe('since Apr 2026');
  });

  it('every reason a row is not counted', () => {
    const base: UncountedRow = {
      rowId: 'x',
      date: isoDate('2026-09-01'),
      month: '2026-09',
      sourceAccountId: 'chk',
      sourceLabel: 'Everyday Checking',
      descriptor: 'D',
      direction: 'in',
      cents: 100,
      reason: 'not-linked',
      brokerageName: 'Robinhood',
      otherBrokerageName: null,
      destinationAccountIds: [],
      otherAccountLabel: null,
      returnedOn: null,
    };
    expect(uncountedReason(base)).toBe('No Robinhood investment account is linked here, so it isn’t counted. Link it on Accounts to count it.');
    expect(uncountedDirection(base)).toBe('Left Everyday Checking.');
    expect(uncountedReason({ ...base, reason: 'landed-in-your-account', otherAccountLabel: 'Rainy Day Savings' })).toBe(
      'The same amount arrived in Rainy Day Savings within a week, so it looks like a move between your own accounts.',
    );
    expect(uncountedReason({ ...base, reason: 'returned', returnedOn: null })).toBe('The same amount came back on a later day, so the two cancel out.');
    expect(uncountedReason({ ...base, reason: 'no-account-named', brokerageName: null })).toBe(
      'It’s filed Investment & Savings, but the description doesn’t name an investment account or a brokerage we know, so it isn’t counted.',
    );
  });

  it('the rule note names every brokerage, what is listed, what is never seen, and where records start', () => {
    const note = depositRuleNote('2025-02');
    expect(note).toContain('Vanguard, Fidelity, Charles Schwab, Coinbase, Robinhood, E*TRADE, Wealthfront, Betterment, Acorns or Merrill');
    expect(note).toContain('A brokerage’s name says which firm, not which account');
    expect(note).toContain('money that came back within two weeks, money that arrived in another of your accounts within a week, fees and bills paid to a brokerage, rows not filed yet');
    expect(note).toContain('Never seen here: retirement contributions taken out of your paycheck, money your paycheck sends straight to an investment account, money moved from banks you haven’t linked, and market gains or losses.');
    expect(note).toContain('Your linked checking and savings records start in Feb 2025.');
    expect(depositRuleNote(null)).not.toContain('records start');
    expect(DEPOSITS_NO_SOURCE_ACCOUNTS).toBe('Link a checking or savings account to see what it sends to your investment accounts each month.');
    expect(DEPOSITS_NO_INVESTMENT_ACCOUNTS).toContain('Link a brokerage or retirement account');
    expect(DEPOSITS_NO_RECORDS).toContain('don’t have a full month of records yet');
  });
});

describe('the brokerage list', () => {
  it('drift lock: the categorizer’s investment rule and this list name the same brokerages', () => {
    const rule = GENERIC_CATEGORY_RULES.find((r) => r.categoryId === 'investment');
    expect(rule?.pattern.source).toBe(String.raw`\b(VANGUARD|FIDELITY INVEST\w*|FID BKG|CHARLES SCHWAB|SCHWAB|COINBASE|ROBINHOOD|E\*?TRADE|WEALTHFRONT|BETTERMENT|ACORNS|MERRILL)\b`);
    const samples = ['VANGUARD', 'FIDELITY INVESTMENTS', 'FID BKG SVC', 'CHARLES SCHWAB', 'SCHWAB', 'COINBASE', 'ROBINHOOD', 'E*TRADE', 'ETRADE', 'WEALTHFRONT', 'BETTERMENT', 'ACORNS', 'MERRILL'];
    for (const s of samples) {
      expect(rule!.pattern.test(s), s).toBe(true);
      expect(brokeragesNamedIn(s).length, s).toBe(1);
    }
    expect(BROKERAGES.length).toBe(10);
    expect(brokeragesNamedIn('FIDELITY NATIONAL TITLE')).toEqual([]);
  });

  it('an account’s brokerage: its institution, else (only when none is known) its feed name', () => {
    expect(brokerageOfAccount('Charles Schwab', 'Individual')?.key).toBe('schwab');
    expect(brokerageOfAccount('E*TRADE from Morgan Stanley', 'x')?.key).toBe('etrade');
    expect(brokerageOfAccount(null, 'Vanguard Cash Plus')?.key).toBe('vanguard');
    expect(brokerageOfAccount('Chase', 'Vanguard Cash Plus')).toBeNull();
    expect(brokerageOfAccount('  ', 'Robinhood Gold')?.key).toBe('robinhood');
    expect(brokerageOfAccount(null, 'Vanguard and Schwab')).toBeNull();
    expect(brokerageOfAccount(null, 'Brokerage')).toBeNull();
  });
});

describe('A13 — the demo seed', () => {
  it('the Brokerage receives $750 a month by its last four, and $2,000 came back in March', () => {
    const seed = buildSeedData();
    const asOf = isoDate('2026-06-10');
    const accounts: DepositAccount[] = seed.accounts.map((a) => ({
      id: a.id,
      type: a.type,
      label: a.name,
      mask: a.mask ?? null,
      institutionName: null,
      feedName: a.name,
      // The demo provider's record is complete through today (`accountRecords`).
      completeThrough: asOf,
    }));
    const rows: DepositRow[] = seed.transactions
      .filter((t) => ['CHECKING', 'SAVINGS', 'CREDIT'].includes(accounts.find((a) => a.id === t.accountId)!.type))
      .map((t) => ({ ...t, categoryId: t.isTransfer ? 'transfer' : 'groceries' }));
    const h = computeDepositHistory({ today: asOf, rows, accounts });
    expect(h.months.map((m) => m.month)[0]).toBe('2025-06');
    expect(h.months).toHaveLength(13);
    expect(h.months.every((m) => m.putInCents === 75000 && m.missingRecordsFrom.length === 0)).toBe(true);
    expect(month(h, '2026-03').takenOutCents).toBe(200000);
    expect(h.thisYear).toEqual({ fromMonth: '2026-01', putInCents: 450000, takenOutCents: 200000, monthsMissingRecords: 0 });
    expect(h.destinations).toEqual([
      { destination: { key: 'acct-brokerage', kind: 'account', accountIds: ['acct-brokerage'], accountLabels: ['Brokerage'], brokerageName: null }, putInCents: 975000, takenOutCents: 200000 },
    ]);
    expect(h.uncounted).toEqual([]);
    expect(depositLead(h)).toBe('$4,500.00 put in and $2,000.00 taken out so far this year — $2,500.00 more in than out.');
  });
});

describe('the real loader (DECISIONS #788)', () => {
  const USER = `deposits-${Date.now()}-${process.pid}`;
  const ids = { old: `${USER}-old`, chk: `${USER}-chk`, vg: `${USER}-vg`, rh: `${USER}-rh` };

  beforeAll(async () => {
    vi.stubEnv('DEMO_TODAY', '2026-10-17');
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const base = { userId: USER, currentBalanceCents: 100000, currency: 'USD' };
    await prisma.account.createMany({
      data: [
        // A checking account re-linked once: the old copy owns rows up to Aug 31.
        { ...base, id: ids.old, provider: 'manual', providerRef: `${USER}-r-old`, name: 'Everyday Checking', type: 'CHECKING', mask: '7712' },
        { ...base, id: ids.chk, provider: 'plaid', providerRef: `${USER}-r-chk`, name: 'Everyday Checking', type: 'CHECKING', mask: '7712', plaidItemId: `${USER}-item-bank` },
        // A live Vanguard connection: its institution lives on the item row, not the account.
        { ...base, id: ids.vg, provider: 'plaid', providerRef: `${USER}-r-vg`, name: 'Individual Brokerage', type: 'INVESTMENT', mask: '5521', plaidItemId: `${USER}-item-vg` },
        // A disconnected brokerage: only the stamp knows it was Robinhood.
        { ...base, id: ids.rh, provider: 'plaid', providerRef: `${USER}-r-rh`, name: 'Individual', type: 'INVESTMENT', mask: '3001', institutionName: 'Robinhood' },
      ],
    });
    await prisma.plaidItem.createMany({
      data: [
        { userId: USER, itemId: `${USER}-item-bank`, accessToken: 'x', institution: 'First Example Bank', lastSyncedAt: '2026-10-17' },
        { userId: USER, itemId: `${USER}-item-vg`, accessToken: 'x', institution: 'Vanguard', lastSyncedAt: '2026-10-17' },
      ],
    });
    await prisma.accountReconciliation.create({
      data: { userId: USER, predecessorAccountId: ids.old, successorAccountId: ids.chk, cutoverDate: '2026-08-31', matchSignal: 'mask', confidence: 'high' },
    });
    const r = (accountId: string, date: string, amountCents: number, rawDescriptor: string, categoryId: string) => ({
      accountId,
      date,
      amountCents,
      rawDescriptor,
      categoryId,
      confidenceBps: 10000,
      needsReview: false,
    });
    await prisma.transaction.createMany({
      data: [
        r(ids.old, '2025-01-02', -1000, 'BLUE DOOR COFFEE', 'coffee'),
        r(ids.old, '2026-08-05', -50000, 'ONLINE TRANSFER TO XXXXXX5521', 'transfer'),
        // After the cutover the old copy's rows belong to the live account's history — dropped.
        r(ids.old, '2026-09-05', -60000, 'VANGUARD BUY INVESTMENT', 'investment'),
        r(ids.chk, '2026-09-05', -60000, 'VANGUARD BUY INVESTMENT', 'investment'),
        r(ids.chk, '2026-09-10', -20000, 'ROBINHOOD FUNDS', 'investment'),
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { account: { userId: USER } } });
    await prisma.accountReconciliation.deleteMany({ where: { userId: USER } });
    await prisma.plaidItem.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
    vi.unstubAllEnvs();
  });

  it('test_regression__money_put_into_a_linked_brokerage_is_read_from_the_bank_side', async () => {
    vi.stubEnv('DEMO_TODAY', '2026-10-17');
    const h = await getDepositHistory(USER);
    expect(h.hasInvestmentAccounts).toBe(true);
    expect(h.recordsFromMonth).toBe('2025-02');
    // The live checking's Plaid item vouches through Oct 16: no month is missing records.
    expect(h.months.every((m) => m.missingRecordsFrom.length === 0)).toBe(true);
    // Aug: the old copy's row, read as the live checking, by the Vanguard account's last four.
    expect(h.months.find((m) => m.month === '2026-08')!.events).toMatchObject([{ sourceAccountId: ids.chk, destinationKey: ids.vg, cents: 50000 }]);
    // Sep: the live row only, by name — Vanguard through the live item, Robinhood through the stamp.
    expect(h.months.find((m) => m.month === '2026-09')!.events.map((e) => [e.destinationKey, e.cents])).toEqual([
      ['brokerage:vanguard', 60000],
      ['brokerage:robinhood', 20000],
    ]);
    expect(h.thisYear).toEqual({ fromMonth: '2026-01', putInCents: 130000, takenOutCents: 0, monthsMissingRecords: 0 });
    expect(h.uncounted).toEqual([]);
  });

  it('narrowed to one account: its own money by last four, the brokerage-name money beside it', async () => {
    vi.stubEnv('DEMO_TODAY', '2026-10-17');
    const vg = await getDepositHistory(USER, ids.vg);
    expect(vg.destinations.map((d) => [d.destination.key, d.putInCents])).toEqual([[ids.vg, 50000]]);
    expect(vg.scope?.byBrokerageName).toEqual({ brokerageName: 'Vanguard', putInCents: 60000, takenOutCents: 0 });
  });

  it('the shared demo: $750 a month into the Brokerage, $2,000 back out in March', async () => {
    vi.stubEnv('DEMO_TODAY', '2026-06-10');
    const h = await getDepositHistory('user-demo');
    expect(h.thisYear).toEqual({ fromMonth: '2026-01', putInCents: 450000, takenOutCents: 200000, monthsMissingRecords: 0 });
    expect(h.destinations.map((d) => [d.destination.key, d.putInCents, d.takenOutCents])).toEqual([['acct-brokerage', 975000, 200000]]);
    expect(h.uncounted).toEqual([]);
  });
});
