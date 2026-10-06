/**
 * DECISIONS #789, critic cycle 2 — the filing decides, payments to the firm itself stay
 * spending, money coming back from a brokerage is a move, and the surfaces the first two
 * cycles did not reach (calendar, /recurring, Ask's price line, the merchant lens, the
 * household digest).
 *
 * P1-1 the bank's text overrode the reader's own Investment & Savings filing; P1-2 a
 * payment TO a brokerage-named firm (a premium, an advisory fee, a membership) left
 * spending; P2-1 a brokerage's money coming back read as income; P2-2 a day holding only a
 * deposit printed an unexplained zero; P2-3 a rising auto-invest was a "price increase";
 * P3-1 the merchant lens counted deposits as charges; P3 the household digest and the
 * register disagreed. Every amount and name below is invented.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import {
  BANK_RETURN_RE,
  INVESTING_MOVE_WORD_RE,
  PAYS_THE_FIRM_RE,
  paysTheFirmWord,
  readsAsBrokerageMove,
} from '@/lib/engine/categorize/brokerage-move';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { isSpendRow } from '@/lib/engine/reports/reports';
import { countsInFlows } from '@/lib/engine/fi/insights';
import { summarizeTransactions } from '@/lib/engine/transactions/query';
import { buildPostedCalendarMonth } from '@/lib/engine/calendar/posted';
import { detectRecurring, type RecurringTxn } from '@/lib/engine/recurring/detect';
import { priceChangeBadge, summarizeRecurring } from '@/lib/engine/recurring/summary';
import { buildMerchantProfile } from '@/lib/engine/merchant/profile';
import { summarizeSharedMovement } from '@/lib/engine/household/digest';
import { notADepositWord } from '@/lib/engine/investments/deposits';

const filed = (rawDescriptor: string, amountCents = -50000) =>
  categorize({ rawDescriptor, amountCents, date: '2026-05-04', accountId: 'chk', isTransfer: false } as never).categoryId;
const MAY = { fromYm: '2026-05', toYm: '2026-05' };

describe('P1-2 — a payment to the firm itself is spending, never Investment & Savings', () => {
  it('fees, premiums, memberships, loans and margin interest at a brokerage are not filed there', () => {
    for (const d of [
      'COINBASE ONE',
      'COINBASE ONE SUBSCRIPTION',
      'FIDELITY INVESTMENTS LIFE INS PREMIUM',
      'MERRILL LYNCH ADVISORY FEE',
      'WEALTHFRONT ADVISORY FEE',
      'E*TRADE MARGIN INTEREST',
      'SCHWAB BANK TRANSFER LOAN PAYMENT',
      'ROBINHOOD GOLD MEMBERSHIP',
    ]) {
      expect(filed(d), d).not.toBe('investment');
      expect(readsAsBrokerageMove(d), d).toBe(false);
      // Whatever it is filed instead, it is not a money move, so it is spending.
      expect(isSpendRow({ date: '2026-05-04', amountCents: -18500, categoryId: filed(d), isTransfer: false }, MAY), d).toBe(true);
    }
  });

  it('…while the brokerage’s own money movement, and a debit-card buy behind a bank prefix, still are', () => {
    for (const d of ['COINBASE.COM', 'DEBIT CARD PMT COINBASE', 'MERRILL LYNCH MARGIN DEPOSIT', 'FIDELITY INVESTMENTS MONEYLINE', 'SCHWAB BROKERAGE MONEYLINK TRANSFER']) {
      expect(filed(d), d).toBe('investment');
    }
    // The categorizer and "Money you put in" read one word, one way.
    expect(paysTheFirmWord('MERRILL LYNCH ADVISORY FEE')).toBe('ADVISORY');
    expect(notADepositWord('DEBIT CARD PMT COINBASE')).toBeNull();
    expect(notADepositWord('FIDELITY INVESTMENTS LIFE INS PREMIUM')).toBe(paysTheFirmWord('FIDELITY INVESTMENTS LIFE INS PREMIUM'));
    expect(PAYS_THE_FIRM_RE.test('VANGUARD BUY INVESTMENT')).toBe(false);
  });
});

describe('P2-1 — money coming back from a brokerage is a move, not income', () => {
  it('a return, a withdrawal and a sale’s credit name the brokerage’s own movement', () => {
    for (const d of ['VANGUARD ACH RTN', 'VANGUARD RETURNED ITEM', 'ROBINHOOD CREDITS', 'ACORNS WITHDRAW', 'BETTERMENT WITHDRAWAL']) {
      expect(filed(d, 500000), d).toBe('investment');
    }
    expect(INVESTING_MOVE_WORD_RE.test('ACH RTN')).toBe(true);
    expect(BANK_RETURN_RE.test('TAX RETURN')).toBe(false);
    // The investing word may come anywhere after the name (the lookahead scans the whole text).
    expect(filed('ONLINE VANGUARD ACH RTN', 500000)).toBe('investment');
  });

  it('the deposit and the money back cancel: neither is spending nor income', () => {
    const rows = [
      { date: '2026-05-01', amountCents: 500000, isTransfer: false, categoryId: 'paycheck' },
      { date: '2026-05-03', amountCents: -40000, isTransfer: false, categoryId: 'groceries' },
      { date: '2026-05-04', amountCents: -500000, isTransfer: false, categoryId: filed('VANGUARD BUY INVESTMENT') },
      { date: '2026-05-09', amountCents: 500000, isTransfer: false, categoryId: filed('VANGUARD ACH RTN', 500000) },
    ];
    const s = summarizeTransactions(rows);
    expect([s.inflowCents, s.outflowCents]).toEqual([500000, 40000]);
    expect(rows.filter((r) => countsInFlows({ ...r, accountId: 'chk', status: 'POSTED', rawDescriptor: 'X' })).length).toBe(2);
  });
});

describe('P2-2 — the calendar names a day that holds only money moved into investing', () => {
  it('in $0, out $0, and one investing move counted beside the transfers', () => {
    const cal = buildPostedCalendarMonth({
      month: '2026-05',
      today: isoDate('2026-05-20'),
      rows: [
        { date: '2026-05-04', amountCents: -500000, isTransfer: false, categoryId: 'investment', excludeFromTotals: false, onHandoverDay: false },
        { date: '2026-05-05', amountCents: -500000, isTransfer: true, categoryId: 'transfer', excludeFromTotals: false, onHandoverDay: false },
        { date: '2026-05-06', amountCents: -20000, isTransfer: false, categoryId: 'transfer', excludeFromTotals: false, onHandoverDay: false },
        // Flagged a transfer AND filed Investment & Savings: one row, named once — as a transfer.
        { date: '2026-05-07', amountCents: -30000, isTransfer: true, categoryId: 'investment', excludeFromTotals: false, onHandoverDay: false },
      ],
      oldestPostedDate: isoDate('2026-05-01'),
      newestPostedDate: isoDate('2026-05-06'),
    });
    const day = (d: string) => cal.days.find((x) => x.date === d)!;
    const d4 = day('2026-05-04');
    expect([d4.inCents, d4.outCents, d4.investingCount, d4.transferCount]).toEqual([0, 0, 1, 0]);
    expect([day('2026-05-05').investingCount, day('2026-05-05').transferCount]).toEqual([0, 1]);
    // Filed Transfer without the flag: a transfer the surface names, never an unexplained zero.
    expect([day('2026-05-06').outCents, day('2026-05-06').transferCount]).toEqual([0, 1]);
    expect([day('2026-05-07').transferCount, day('2026-05-07').investingCount]).toEqual([1, 0]);
  });
});

describe('P2-3 — a rising contribution is more saving, not a price that rose', () => {
  const T = (date: string, amountCents: number, rawDescriptor: string): RecurringTxn => ({ id: `${date}:${rawDescriptor}`, accountId: 'chk', date, amountCents, rawDescriptor });
  const rows: RecurringTxn[] = [
    ...['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15'].map((d) => T(d, -50000, 'VANGUARD BUY INVESTMENT')),
    T('2026-05-15', -60000, 'VANGUARD BUY INVESTMENT'),
    ...['2026-01-20', '2026-02-20', '2026-03-20', '2026-04-20'].map((d) => T(d, -20000, 'NY 529 COLLEGE SAVINGS PLAN')),
    T('2026-05-20', -25000, 'NY 529 COLLEGE SAVINGS PLAN'),
    ...['2026-01-08', '2026-02-08', '2026-03-08', '2026-04-08'].map((d) => T(d, -1599, 'NETFLIX.COM')),
    T('2026-05-08', -1799, 'NETFLIX.COM'),
  ];
  const series = detectRecurring(rows, isoDate('2026-06-01'), []);
  const plan529 = series.find((s) => /529/i.test(s.merchantCanonical))!.merchantCanonical;

  it('by its default filing, or by the reader’s filing of its rows; Netflix still is', () => {
    const s = summarizeRecurring(series, '2026-06-01', new Set([plan529]));
    expect(s.priceIncreases.some((i) => /vanguard|529/i.test(i.merchantCanonical))).toBe(false);
    expect(s.priceIncreases.some((i) => /netflix/i.test(i.merchantCanonical))).toBe(true);
    const vg = s.items.find((i) => /vanguard/i.test(i.merchantCanonical))!;
    expect(vg.movesMoney).toBe(true);
    expect(priceChangeBadge(vg)?.tone).toBe('favorable');
    // Anti-vacuity: without the reader's filing the 529's rise is still read as a price.
    expect(summarizeRecurring(series, '2026-06-01').priceIncreases.some((i) => /529/i.test(i.merchantCanonical))).toBe(true);
  });
});

describe('P3-1 / P3 — the merchant lens and the household digest read the filing too', () => {
  it('a deposit is not a "charge" at its merchant', () => {
    const lens = (categoryId: string) =>
      buildMerchantProfile(
        ['2026-02-15', '2026-03-15', '2026-04-15'].map((date) => ({ date, amountCents: -50000, merchant: 'Vanguard', status: 'POSTED', isTransfer: false, categoryId })),
        'Vanguard',
        isoDate('2026-05-01'),
      );
    expect(lens('investment')).toBeNull();
    expect(lens('shopping')?.chargeCount).toBe(3);
  });

  it('a shared account’s deposit leaves the digest’s money out, as it leaves the register’s', () => {
    const m = summarizeSharedMovement({
      rows: [
        { date: isoDate('2026-05-03'), amountCents: -40000, isTransfer: false, status: 'POSTED', isSplitParent: false, categoryId: 'groceries' },
        { date: isoDate('2026-05-04'), amountCents: -500000, isTransfer: false, status: 'POSTED', isSplitParent: false, categoryId: 'investment' },
      ],
      accountCount: 1,
      since: isoDate('2026-05-01'),
      today: isoDate('2026-05-20'),
    });
    expect([m.transactionCount, m.outflowCents]).toEqual([1, 40000]);
  });
});
