/**
 * Money you put in — brokerage deposits read from the bank side (DECISIONS #788).
 * The engine's every rule and boundary, the words it prints, the brokerage list's
 * drift against the categorizer, and the demo seed. Every account, amount and date
 * is invented (keep-live-figures-out-of-repo). Hand-verified values:
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
} from '@/lib/engine/investments/deposits';
import {
  DEPOSITS_NO_INVESTMENT_ACCOUNTS,
  DEPOSITS_NO_RECORDS,
  depositLead,
  depositRuleNote,
  destinationLabel,
  monthFigure,
  movementPhrase,
  thisYearSpan,
  uncountedReason,
} from '@/lib/engine/investments/deposits-copy';
import { buildSeedData } from '@/lib/seed/build';
import { getDepositHistory } from '@/server/investment-deposits';

const TODAY = isoDate('2026-10-17');

function acct(
  id: string,
  type: string,
  label: string,
  mask: string | null,
  institutionName: string | null,
  extra: Partial<DepositAccount> = {},
): DepositAccount {
  return { id, type, label, mask, institutionName, feedName: label, feedDroppedAt: null, ...extra };
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

/** Records start 2025-01-02 on checking → the window is 2025-10 … 2026-10. */
const ANCHOR = () => row('chk', '2025-01-02', -1000, 'BLUE DOOR COFFEE', 'coffee');

function history(rows: DepositRow[], accounts: DepositAccount[] = BASE, extra: { terminalOf?: Map<string, string>; scopeAccountId?: string } = {}): DepositHistory {
  return computeDepositHistory({ today: TODAY, rows: [ANCHOR(), ...rows], accounts, ...extra });
}

const month = (h: DepositHistory, m: string) => h.months.find((x) => x.month === m)!;

describe('A1/A2/A3 — what counts and where it goes', () => {
  it('a brokerage name places the money in the one linked account there (A1)', () => {
    const h = history([row('chk', '2026-09-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment')]);
    expect(month(h, '2026-09').putInCents).toBe(50000);
    expect(month(h, '2026-09').events).toMatchObject([{ destinationKey: 'vg', via: 'name', direction: 'in', cents: 50000, sourceLabel: 'Everyday Checking' }]);
    expect(h.destinations).toEqual([
      { destination: { key: 'vg', accountIds: ['vg'], accountLabels: ['Vanguard Brokerage'], brokerageName: 'Vanguard' }, putInCents: 50000, takenOutCents: 0 },
    ]);
    expect(h.thisYear).toEqual({ fromMonth: '2026-01', putInCents: 50000, takenOutCents: 0 });
    expect(h.uncounted).toEqual([]);
  });

  it('the last four after a mask marker places it in that account, with no brokerage name needed (A2)', () => {
    const marked = ['ONLINE TRANSFER TO XXXXXX6604', 'TRANSFER TO ROTH X6604', 'ACH TO ...6604', 'XFER *6604', 'PAYMENT #6604', 'TO ACCOUNT ENDING IN 6604', 'TO ACCT 6604', 'TO ACCT# 6604', 'TO acct no. 6604', 'x6604 transfer'];
    for (const d of marked) {
      const h = history([row('chk', '2026-09-10', -25000, d)]);
      expect(month(h, '2026-09').events.map((e) => [e.destinationKey, e.via]), d).toEqual([['ira', 'mask']]);
    }
    const unmarked = ['TRANSFER 6604', 'BOX6604 TRANSFER', 'TO X66041', 'REF X6604A', 'TO ACCT 66043'];
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

  it('money arriving FROM a brokerage is taken out, and both directions sum separately (A3)', () => {
    const h = history([
      row('chk', '2026-09-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment'),
      row('chk', '2026-08-14', 30000, 'VANGUARD REDEMPTION'),
    ]);
    expect(month(h, '2026-08')).toMatchObject({ putInCents: 0, takenOutCents: 30000 });
    expect(month(h, '2026-08').events[0]).toMatchObject({ direction: 'out', cents: 30000 });
    expect(h.thisYear).toEqual({ fromMonth: '2026-01', putInCents: 50000, takenOutCents: 30000 });
    expect(h.destinations[0]).toMatchObject({ putInCents: 50000, takenOutCents: 30000 });
  });

  it('savings is a source too', () => {
    const h = history([row('sav', '2026-09-05', -12345, 'TRANSFER TO X5521')]);
    expect(month(h, '2026-09').events).toMatchObject([{ destinationKey: 'vg', sourceAccountId: 'sav' }]);
  });
});

describe('A4 — not counted, silently', () => {
  it('pending, split parent, excluded, another filing, no filing, a card, or $0 never count', () => {
    const h = history([
      row('chk', '2026-09-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment', { status: 'PENDING' }),
      row('chk', '2026-09-06', -50000, 'VANGUARD BUY INVESTMENT', 'investment', { isSplitParent: true }),
      row('chk', '2026-09-07', -50000, 'VANGUARD BUY INVESTMENT', 'investment', { excludeFromTotals: true }),
      row('chk', '2026-09-08', -50000, 'VANGUARD BUY INVESTMENT', 'shopping'),
      row('chk', '2026-09-09', -50000, 'VANGUARD BUY INVESTMENT', null),
      row('chk', '2026-09-10', -50000, 'VANGUARD BUY INVESTMENT', 'uncategorized'),
      row('card', '2026-09-11', -50000, 'VANGUARD BUY INVESTMENT', 'investment'),
      row('chk', '2026-09-12', 0, 'VANGUARD BUY INVESTMENT', 'investment'),
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

  it('a row after today never counts', () => {
    const h = history([row('chk', '2026-10-20', -50000, 'VANGUARD BUY INVESTMENT', 'investment')]);
    expect(month(h, '2026-10').events).toEqual([]);
  });
});

describe('A4 — an equal, opposite row on another of your accounts takes it (one to one)', () => {
  it('is listed as landed in your account, naming that account; 7 days apart still pairs, 8 does not', () => {
    const h = history([
      row('chk', '2026-07-02', -40000, 'ONLINE TRANSFER TO XXXXXX6604'),
      row('sav', '2026-07-09', 40000, 'ONLINE TRANSFER FROM CHK'),
    ]);
    expect(month(h, '2026-07').putInCents).toBe(0);
    expect(h.uncounted).toMatchObject([{ reason: 'landed-in-your-account', counterpartLabel: 'Rainy Day Savings', cents: 40000, direction: 'in', destinationAccountIds: ['ira'] }]);

    const apart = history([
      row('chk', '2026-07-02', -40000, 'ONLINE TRANSFER TO XXXXXX6604'),
      row('sav', '2026-07-10', 40000, 'ONLINE TRANSFER FROM CHK'),
    ]);
    expect(month(apart, '2026-07').putInCents).toBe(40000);
    expect(apart.uncounted).toEqual([]);
  });

  it('a card can hold the other half too', () => {
    const h = history([
      row('chk', '2026-07-02', -40000, 'VANGUARD EDI PYMNTS'),
      row('card', '2026-07-03', 40000, 'PAYMENT THANK YOU'),
    ]);
    expect(h.uncounted).toMatchObject([{ reason: 'landed-in-your-account', counterpartLabel: 'Travel Card' }]);
  });

  it('one $500 into savings explains ONE $500 out, closest first — the brokerage deposit two days later still counts', () => {
    const h = history([
      row('chk', '2026-06-01', -50000, 'ONLINE TRANSFER TO SAVINGS X3390'),
      row('sav', '2026-06-01', 50000, 'ONLINE TRANSFER FROM CHECKING X7712'),
      row('chk', '2026-06-03', -50000, 'VANGUARD BUY INVESTMENT', 'investment'),
    ]);
    expect(month(h, '2026-06').putInCents).toBe(50000);
    expect(h.uncounted).toEqual([]);
  });

  it('money taken out that LEFT another of your accounts within a week is listed as such', () => {
    const h = history([
      row('chk', '2026-05-12', 60000, 'VANGUARD REDEMPTION'),
      row('sav', '2026-05-11', -60000, 'TRANSFER TO CHECKING'),
    ]);
    expect(h.uncounted).toMatchObject([{ reason: 'landed-in-your-account', direction: 'out', counterpartLabel: 'Rainy Day Savings' }]);
    expect(uncountedReason(h.uncounted[0]!)).toBe(
      'The same amount left Rainy Day Savings within a week, so it looks like a move between your own accounts.',
    );
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
    const h = history(
      [row('chk', '2026-09-15', -20000, 'SCHWAB MONEYLINK'), row('schwab-chk', '2026-09-16', 20000, 'FUNDS TRANSFER')],
      [...BASE, schwabChk],
    );
    expect(h.uncounted).toEqual([]);
    expect(h.months.every((m) => m.events.length === 0)).toBe(true);
  });
});

describe('A6 — a linked bank account at the same brokerage', () => {
  const schwabChk = acct('schwab-chk', 'CHECKING', 'Schwab Checking', '2201', 'Charles Schwab');
  const schwabBrk = acct('schwab-brk', 'INVESTMENT', 'Schwab Brokerage', '2202', 'Charles Schwab');
  const accounts = [...BASE, schwabChk, schwabBrk];
  const schwabSince = (date: string) => row('schwab-chk', date, -500, 'SCHWAB ATM FEE', 'fees');

  it('counts when that account’s records cover the week around the row and show no other half', () => {
    const h = history([schwabSince('2025-01-03'), row('chk', '2026-09-20', -100000, 'SCHWAB BROKERAGE MONEYLINK')], accounts);
    expect(month(h, '2026-09').events).toMatchObject([{ destinationKey: 'schwab-brk', via: 'name', cents: 100000 }]);
  });

  it('records starting exactly a week before still cover; a day later they do not', () => {
    const at = history([schwabSince('2026-09-13'), row('chk', '2026-09-20', -100000, 'SCHWAB BROKERAGE MONEYLINK')], accounts);
    expect(month(at, '2026-09').putInCents).toBe(100000);
    const later = history([schwabSince('2026-09-14'), row('chk', '2026-09-20', -100000, 'SCHWAB BROKERAGE MONEYLINK')], accounts);
    expect(month(later, '2026-09').putInCents).toBe(0);
    expect(later.uncounted).toMatchObject([{ reason: 'unclear-account', brokerageName: 'Charles Schwab', destinationAccountIds: ['schwab-brk'] }]);
  });

  it('a bank account with no rows at all cannot rule anything out', () => {
    const h = history([row('chk', '2026-09-20', -100000, 'SCHWAB BROKERAGE MONEYLINK')], accounts);
    expect(h.uncounted).toMatchObject([{ reason: 'unclear-account' }]);
  });

  it('a feed that stopped within the week after cannot rule it out; one that stopped later can', () => {
    const dropped = (d: string) => [...BASE, { ...schwabChk, feedDroppedAt: d }, schwabBrk];
    const within = history([schwabSince('2025-01-03'), row('chk', '2026-09-20', -100000, 'SCHWAB BROKERAGE MONEYLINK')], dropped('2026-09-27'));
    expect(within.uncounted).toMatchObject([{ reason: 'unclear-account' }]);
    const after = history([schwabSince('2025-01-03'), row('chk', '2026-09-20', -100000, 'SCHWAB BROKERAGE MONEYLINK')], dropped('2026-09-28'));
    expect(month(after, '2026-09').putInCents).toBe(100000);
  });

  it('less than a week old is too new to tell; exactly a week old counts', () => {
    const fresh = history([schwabSince('2025-01-03'), row('chk', '2026-10-11', -100000, 'SCHWAB BROKERAGE MONEYLINK')], accounts);
    expect(fresh.uncounted).toMatchObject([{ reason: 'too-new', brokerageName: 'Charles Schwab' }]);
    const week = history([schwabSince('2025-01-03'), row('chk', '2026-10-10', -100000, 'SCHWAB BROKERAGE MONEYLINK')], accounts);
    expect(month(week, '2026-10').putInCents).toBe(100000);
  });

  it('the row’s own account is not the other bank account it must rule out', () => {
    const h = history([row('schwab-chk', '2026-09-20', -70000, 'TRANSFER TO SCHWAB BROKERAGE')], [CHK, schwabChk, schwabBrk]);
    expect(month(h, '2026-09').events).toMatchObject([{ destinationKey: 'schwab-brk', sourceAccountId: 'schwab-chk' }]);
  });

  it('the last four settle it without the coverage test', () => {
    const h = history([row('chk', '2026-10-15', -100000, 'SCHWAB BROKERAGE MONEYLINK X2202')], accounts);
    expect(month(h, '2026-10').events).toMatchObject([{ destinationKey: 'schwab-brk', via: 'mask' }]);
  });
});

describe('A7/A8 — ambiguity is never counted', () => {
  it('two brokerages named', () => {
    const h = history([row('chk', '2026-09-05', -50000, 'VANGUARD SCHWAB MOVE', 'investment')]);
    expect(h.uncounted).toMatchObject([{ reason: 'unclear-account', brokerageName: null }]);
  });

  it('last four shared with another linked account, of any type', () => {
    const twin = acct('twin', 'CREDIT', 'Store Card', '5521', 'Other Bank');
    const h = history([row('chk', '2026-09-05', -50000, 'ONLINE TRANSFER TO X5521')], [...BASE, twin]);
    expect(h.uncounted).toMatchObject([{ reason: 'unclear-account', destinationAccountIds: ['vg'] }]);
  });

  it('two investment accounts with the same last four', () => {
    const twin = acct('vg2', 'INVESTMENT', 'Vanguard IRA', '5521', 'Vanguard');
    const h = history([row('chk', '2026-09-05', -50000, 'ONLINE TRANSFER TO X5521')], [...BASE, twin]);
    expect(h.uncounted).toMatchObject([{ reason: 'unclear-account', destinationAccountIds: ['vg', 'vg2'] }]);
  });

  it('last four and name disagree (A8)', () => {
    const h = history([row('chk', '2026-09-05', -50000, 'SCHWAB TRANSFER X5521')]);
    expect(h.uncounted).toMatchObject([{ reason: 'unclear-account', brokerageName: 'Charles Schwab' }]);
  });

  it('last four of an account with no known brokerage beside a brokerage name: the last four win', () => {
    const h = history([row('chk', '2026-09-05', -50000, 'VANGUARD TRANSFER X6604')]);
    expect(month(h, '2026-09').events).toMatchObject([{ destinationKey: 'ira', via: 'mask' }]);
  });

  it('last four and the same brokerage name agree', () => {
    const h = history([row('chk', '2026-09-05', -50000, 'VANGUARD TRANSFER X5521')]);
    expect(month(h, '2026-09').events).toMatchObject([{ destinationKey: 'vg', via: 'mask' }]);
  });
});

describe('A9 — the window', () => {
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
    expect(month(h, '2025-10').putInCents).toBe(20000);
    expect(h.destinations[0]!.putInCents).toBe(20000);
    expect(h.thisYear).toEqual({ fromMonth: '2026-01', putInCents: 0, takenOutCents: 0 });
  });

  it('records that start mid-year: from the first complete month, and the year from there', () => {
    const h = computeDepositHistory({
      today: TODAY,
      accounts: BASE,
      rows: [row('chk', '2026-04-20', -1000, 'BLUE DOOR COFFEE', 'coffee'), row('chk', '2026-04-25', -9000, 'VANGUARD BUY INVESTMENT', 'investment'), row('chk', '2026-05-02', -8000, 'VANGUARD BUY INVESTMENT', 'investment')],
    });
    expect(h.recordsFromMonth).toBe('2026-05');
    expect(h.months[0]!.month).toBe('2026-05');
    expect(h.thisYear).toEqual({ fromMonth: '2026-05', putInCents: 8000, takenOutCents: 0 });
  });

  it('records starting on the 1st cover that month', () => {
    const h = computeDepositHistory({ today: TODAY, accounts: BASE, rows: [row('chk', '2026-05-01', -9000, 'VANGUARD BUY INVESTMENT', 'investment')] });
    expect(h.recordsFromMonth).toBe('2026-05');
    expect(month(h, '2026-05').putInCents).toBe(9000);
  });

  it('a card’s older records do not move the start — only checking and savings', () => {
    const h = computeDepositHistory({
      today: TODAY,
      accounts: BASE,
      rows: [row('card', '2025-01-05', -500, 'CAFE', 'coffee'), row('chk', '2026-08-03', -500, 'CAFE', 'coffee')],
    });
    expect(h.recordsFromMonth).toBe('2026-09');
  });

  it('no complete month of records: nothing to show', () => {
    const h = computeDepositHistory({ today: TODAY, accounts: BASE, rows: [row('chk', '2026-10-03', -9000, 'VANGUARD BUY INVESTMENT', 'investment')] });
    expect(h.recordsFromMonth).toBe('2026-11');
    expect(h.months).toEqual([]);
    expect(h.thisYear).toBeNull();
    expect(depositLead(h)).toBeNull();
    const none = computeDepositHistory({ today: TODAY, accounts: BASE, rows: [] });
    expect(none.recordsFromMonth).toBeNull();
    expect(none.months).toEqual([]);
  });
});

describe('A10/A11 — destinations and combined accounts', () => {
  it('several linked accounts at one brokerage are one destination by name', () => {
    const vg2 = acct('vg2', 'INVESTMENT', 'Vanguard IRA', '7001', 'Vanguard');
    const h = history([row('chk', '2026-09-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment')], [...BASE, vg2]);
    const d = h.destinations[0]!.destination;
    expect(d).toEqual({ key: 'brokerage:vanguard', accountIds: ['vg', 'vg2'], accountLabels: ['Vanguard Brokerage', 'Vanguard IRA'], brokerageName: 'Vanguard' });
    expect(destinationLabel(d)).toBe('Vanguard (2 accounts)');
  });

  it('a combined account’s older rows count on the live account, and its two copies are one account (never each other’s other half)', () => {
    const h = history(
      [row('chk-old', '2026-09-01', -25000, 'VANGUARD BUY INVESTMENT', 'investment'), row('chk', '2026-09-02', 25000, 'MOBILE DEPOSIT', 'income')],
      BASE,
      { terminalOf: new Map([['chk-old', 'chk']]) },
    );
    expect(month(h, '2026-09').events).toMatchObject([{ sourceAccountId: 'chk', cents: 25000 }]);
    expect(h.uncounted).toEqual([]);
  });

  it('test_regression__a_deposit_both_copies_of_a_combined_account_report_on_the_handover_day_counts_once', () => {
    const rows = [
      row('chk-old', '2026-08-31', -50000, 'VANGUARD BUY INVESTMENT', 'investment'),
      row('chk', '2026-08-31', -50000, 'VANGUARD BUY INVESTMENT', 'investment'),
    ];
    const terminalOf = new Map([['chk-old', 'chk']]);
    // Without the handover day the boundary's two copies would count twice.
    expect(month(history(rows, BASE, { terminalOf }), '2026-08').putInCents).toBe(100000);
    const h = computeDepositHistory({ today: TODAY, rows: [ANCHOR(), ...rows], accounts: BASE, terminalOf, handoverDates: new Set(['2026-08-31']) });
    expect(month(h, '2026-08').putInCents).toBe(50000);
    // Two equal deposits on ONE copy the same day are two real deposits.
    const two = computeDepositHistory({
      today: TODAY,
      rows: [ANCHOR(), ...rows, row('chk', '2026-08-31', -50000, 'VANGUARD BUY INVESTMENT', 'investment')],
      accounts: BASE,
      terminalOf,
      handoverDates: new Set(['2026-08-31']),
    });
    expect(month(two, '2026-08').putInCents).toBe(100000);
  });

  it('a row on an account that is not live is not read', () => {
    const h = history([row('gone', '2026-09-01', -25000, 'VANGUARD BUY INVESTMENT', 'investment')]);
    expect(month(h, '2026-09').events).toEqual([]);
  });

  it('destinations sort by money put in', () => {
    const h = history([row('chk', '2026-09-05', -100, 'VANGUARD BUY', 'investment'), row('chk', '2026-09-06', -900, 'TO X6604')]);
    expect(h.destinations.map((d) => d.destination.key)).toEqual(['ira', 'vg']);
  });
});

describe('scope — one investment account', () => {
  it('keeps only the money that went to (or might have gone to) that account', () => {
    const h = history(
      [
        row('chk', '2026-09-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment'),
        row('chk', '2026-09-06', -25000, 'TO X6604'),
        row('chk', '2026-09-07', -10000, 'ROBINHOOD FUNDS', 'investment'),
        row('chk', '2026-07-02', -40000, 'ONLINE TRANSFER TO XXXXXX6604'),
        row('sav', '2026-07-03', 40000, 'ONLINE TRANSFER FROM CHK'),
      ],
      BASE,
      { scopeAccountId: 'ira' },
    );
    expect(h.destinations.map((d) => d.destination.key)).toEqual(['ira']);
    expect(month(h, '2026-09').putInCents).toBe(25000);
    expect(h.uncounted.map((u) => u.reason)).toEqual(['landed-in-your-account']);
  });
});

describe('no investment account linked; nothing a brokerage can be read from', () => {
  it('still lists brokerage-named money, never counting it', () => {
    const h = history([row('chk', '2026-09-12', -10000, 'ROBINHOOD FUNDS', 'investment')], [CHK, SAV]);
    expect(h.hasInvestmentAccounts).toBe(false);
    expect(h.uncounted).toMatchObject([{ reason: 'not-linked' }]);
    expect(depositLead(h)).toBe('Nothing counted so far this year. One movement that names an investment account is listed below under “Not counted”.');
  });

  it('a row filed Investment & Savings that names nothing is listed; the same filed Transfer is ignored', () => {
    const filed = history([row('chk', '2026-09-12', -30000, 'MARCUS SAVINGS TRANSFER', 'investment')]);
    expect(filed.uncounted).toMatchObject([{ reason: 'no-account-named', brokerageName: null }]);
    const transfer = history([row('chk', '2026-09-12', -30000, 'MARCUS SAVINGS TRANSFER', 'transfer')]);
    expect(transfer.uncounted).toEqual([]);
  });
});

describe('the words', () => {
  const lead = (putInCents: number, takenOutCents: number, fromMonth = '2026-01') =>
    depositLead({ hasInvestmentAccounts: true, recordsFromMonth: '2025-02', months: [], thisYear: { fromMonth, putInCents, takenOutCents }, destinations: [], uncounted: [] });

  it('the lead names which zero, and every mix of in and out', () => {
    expect(lead(0, 0)).toBe('Nothing moved between your linked checking or savings and your investment accounts so far this year.');
    expect(lead(50000, 0)).toBe('$500.00 put in so far this year.');
    expect(lead(0, 30000)).toBe('$300.00 taken out so far this year, nothing put in.');
    expect(lead(50000, 30000)).toBe('$500.00 put in and $300.00 taken out so far this year — $200.00 more in than out.');
    expect(lead(30000, 50000)).toBe('$300.00 put in and $500.00 taken out so far this year — $200.00 more out than in.');
    expect(lead(30000, 30000)).toBe('$300.00 put in and $300.00 taken out so far this year — as much in as out.');
    expect(lead(123456789, 0, '2026-05')).toBe('$1,234,567.89 put in since May 2026.');
  });

  it('several uncounted rows are counted in the lead', () => {
    const h = history([row('chk', '2026-09-12', -10000, 'ROBINHOOD FUNDS', 'investment'), row('chk', '2026-09-13', -10000, 'ACORNS INVEST', 'investment')]);
    expect(depositLead(h)).toBe('Nothing counted so far this year. 2 movements that name an investment account are listed below under “Not counted”.');
  });

  it('an uncounted row before this year does not change the zero', () => {
    const h = history([row('chk', '2025-11-12', -10000, 'ROBINHOOD FUNDS', 'investment')]);
    expect(depositLead(h)).toBe('Nothing moved between your linked checking or savings and your investment accounts so far this year.');
  });

  it('month figures, phrases and spans', () => {
    expect(monthFigure(0, 0)).toBe('None');
    expect(monthFigure(75000, 0)).toBe('$750.00 put in');
    expect(monthFigure(0, 200000)).toBe('$2,000.00 taken out');
    expect(monthFigure(75000, 200000)).toBe('$750.00 put in · $2,000.00 taken out');
    expect(movementPhrase('in', 'Brokerage')).toBe('into Brokerage');
    expect(movementPhrase('out', 'Brokerage')).toBe('out of Brokerage');
    expect(thisYearSpan('2026-01')).toBe('so far this year');
    expect(thisYearSpan('2026-04')).toBe('since Apr 2026');
  });

  it('every reason a row is not counted', () => {
    const base = { rowId: 'x', date: isoDate('2026-09-01'), month: '2026-09', sourceAccountId: 'chk', sourceLabel: 'Everyday Checking', descriptor: 'D', direction: 'in' as const, cents: 100, destinationAccountIds: [], counterpartLabel: null };
    expect(uncountedReason({ ...base, reason: 'not-linked', brokerageName: 'Robinhood' })).toBe(
      'No Robinhood investment account is linked here, so it isn\'t counted. Link it on Accounts to count it.',
    );
    expect(uncountedReason({ ...base, reason: 'unclear-account', brokerageName: 'Charles Schwab' })).toBe(
      'It could have gone to more than one of your Charles Schwab accounts, and we can\'t tell which — so it isn\'t counted.',
    );
    expect(uncountedReason({ ...base, reason: 'unclear-account', brokerageName: null })).toBe(
      "The description could mean more than one of your accounts, so it isn't counted.",
    );
    expect(uncountedReason({ ...base, reason: 'too-new', brokerageName: 'Charles Schwab' })).toBe(
      'It\'s less than a week old, and your Charles Schwab bank account may still show the other half. We\'ll check again after a week.',
    );
    expect(uncountedReason({ ...base, reason: 'landed-in-your-account', brokerageName: null, counterpartLabel: 'Rainy Day Savings' })).toBe(
      'The same amount arrived in Rainy Day Savings within a week, so it looks like a move between your own accounts.',
    );
    expect(uncountedReason({ ...base, reason: 'no-account-named', brokerageName: null })).toBe(
      "It's filed Investment & Savings, but the description doesn't name an investment account or a brokerage we know, so it isn't counted.",
    );
  });

  it('the rule note names every brokerage, the limits, and where the records start', () => {
    const note = depositRuleNote('2025-02');
    expect(note).toContain('Vanguard, Fidelity, Charles Schwab, Coinbase, Robinhood, E*TRADE, Wealthfront, Betterment, Acorns or Merrill');
    expect(note).toContain('Not counted: retirement contributions taken out of your paycheck, money moved from banks you haven’t linked, and market gains or losses.');
    expect(note).toContain('Your linked checking and savings records start in Feb 2025.');
    expect(depositRuleNote(null)).not.toContain('records start');
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
      feedDroppedAt: null,
    }));
    const rows: DepositRow[] = seed.transactions
      .filter((t) => ['CHECKING', 'SAVINGS', 'CREDIT'].includes(accounts.find((a) => a.id === t.accountId)!.type))
      .map((t) => ({ ...t, categoryId: t.isTransfer ? 'transfer' : 'uncategorized' }));
    const h = computeDepositHistory({ today: asOf, rows, accounts });
    expect(h.months.map((m) => m.month)[0]).toBe('2025-06');
    expect(h.months).toHaveLength(13);
    expect(h.months.every((m) => m.putInCents === 75000)).toBe(true);
    expect(month(h, '2026-03').takenOutCents).toBe(200000);
    expect(h.thisYear).toEqual({ fromMonth: '2026-01', putInCents: 450000, takenOutCents: 200000 });
    expect(h.destinations).toEqual([
      { destination: { key: 'acct-brokerage', accountIds: ['acct-brokerage'], accountLabels: ['Brokerage'], brokerageName: null }, putInCents: 975000, takenOutCents: 200000 },
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
        { userId: USER, itemId: `${USER}-item-bank`, accessToken: 'x', institution: 'First Example Bank' },
        { userId: USER, itemId: `${USER}-item-vg`, accessToken: 'x', institution: 'Vanguard' },
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
        r(ids.old, '2026-08-05', -50000, 'VANGUARD BUY INVESTMENT', 'investment'),
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
    // Aug: the old copy's row, read as the live checking. Sep: the live row only.
    expect(h.months.find((m) => m.month === '2026-08')!.events).toMatchObject([{ sourceAccountId: ids.chk, destinationKey: ids.vg, cents: 50000 }]);
    expect(h.months.find((m) => m.month === '2026-09')!.events.map((e) => [e.destinationKey, e.cents, e.via])).toEqual([
      [ids.vg, 60000, 'name'],
      [ids.rh, 20000, 'name'],
    ]);
    expect(h.thisYear).toEqual({ fromMonth: '2026-01', putInCents: 130000, takenOutCents: 0 });
    expect(h.uncounted).toEqual([]);
  });

  it('narrowed to one account, only that account’s money', async () => {
    vi.stubEnv('DEMO_TODAY', '2026-10-17');
    const h = await getDepositHistory(USER, ids.rh);
    expect(h.destinations.map((d) => [d.destination.key, d.putInCents])).toEqual([[ids.rh, 20000]]);
  });

  it('the shared demo: $750 a month into the Brokerage, $2,000 back out in March', async () => {
    vi.stubEnv('DEMO_TODAY', '2026-06-10');
    const h = await getDepositHistory('user-demo');
    expect(h.thisYear).toEqual({ fromMonth: '2026-01', putInCents: 450000, takenOutCents: 200000 });
    expect(h.destinations.map((d) => [d.destination.key, d.putInCents, d.takenOutCents])).toEqual([['acct-brokerage', 975000, 200000]]);
    expect(h.uncounted).toEqual([]);
  });
});
