/**
 * Money you set aside — measured savings against the plan's savings line (DECISIONS #790).
 * The engine's rule (savings accounts' own rows + "Money you put in"'s counted deposits,
 * earnings left out, moves between the two counted once), its months and average, every
 * sentence it prints, and the real loader on the demo seed. Every account, amount and
 * date is invented (keep-live-figures-out-of-repo). Hand-verified values:
 * tests/edge-cases/measured-savings.md.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { isoDate } from '@/lib/dates';
import { computeDepositHistory, type DepositAccount, type DepositRow } from '@/lib/engine/investments/deposits';
import { EARNINGS_CATEGORY_IDS, measureSavings, type MeasuredSavings } from '@/lib/engine/savings/measured';
import {
  MEASURED_NO_RECORDS,
  MEASURED_NO_SAVING_ACCOUNTS,
  MEASURED_NO_SOURCE_ACCOUNTS,
  MEASURED_RULE_NOTE,
  measuredAverageSentence,
  measuredLead,
  signedMoney,
  uncountedInvestmentsNote,
} from '@/lib/engine/savings/measured-copy';
import { getMeasuredSavings } from '@/server/measured-savings';

const TODAY = isoDate('2026-10-17');
const YESTERDAY = '2026-10-16';

function acct(id: string, type: string, label: string, mask: string | null, institutionName: string | null, extra: Partial<DepositAccount> = {}): DepositAccount {
  const bank = type === 'CHECKING' || type === 'SAVINGS' || type === 'CREDIT';
  return { id, type, label, mask, institutionName, feedName: label, completeThrough: bank ? YESTERDAY : null, ...extra };
}

const CHK = acct('chk', 'CHECKING', 'Everyday Checking', '7712', 'First Example Bank');
const SAV = acct('sav', 'SAVINGS', 'Rainy Day Savings', '3390', 'First Example Bank');
const VG = acct('vg', 'INVESTMENT', 'Vanguard Brokerage', '5521', 'Vanguard');
const BASE = [CHK, SAV, VG];

let n = 0;
function row(accountId: string, date: string, amountCents: number, rawDescriptor: string, categoryId: string | null = 'transfer', extra: Partial<DepositRow> = {}): DepositRow {
  return { id: `m${String(++n).padStart(4, '0')}`, accountId, date, amountCents, rawDescriptor, status: 'POSTED', categoryId, ...extra };
}

/** Records start 2025-01-02 on checking and savings → months 2025-10 … 2026-10, every one covered. */
const ANCHORS = () => [row('chk', '2025-01-02', -1000, 'BLUE DOOR COFFEE', 'coffee'), row('sav', '2025-01-02', 100, 'INTEREST PAYMENT', 'interest-income')];

function measure(rows: DepositRow[], plannedSavingsCents = 100_000, accounts: DepositAccount[] = BASE, extra: { terminalOf?: Map<string, string>; handoverDates?: Set<string> } = {}): MeasuredSavings {
  return measureSavings({ deposit: { today: TODAY, rows: [...ANCHORS(), ...rows], accounts, ...extra }, plannedSavingsCents });
}

const month = (ms: MeasuredSavings, m: string) => ms.months.find((x) => x.month === m)!;

describe('#790 — what counts as set aside', () => {
  it('checking → savings counts once, on the savings side; the checking row is never read', () => {
    const ms = measure([row('chk', '2026-10-01', -50_000, 'ONLINE TRANSFER TO SAVINGS X3390'), row('sav', '2026-10-01', 50_000, 'ONLINE TRANSFER FROM CHECKING X7712')]);
    const oct = ms.thisMonth!;
    expect(oct.month).toBe('2026-10');
    expect(oct.savingsNetCents).toBe(50_000);
    expect(oct.investmentsNetCents).toBe(0);
    expect(oct.totalCents).toBe(50_000);
    expect(oct.savingsRows.map((r) => r.cents)).toEqual([50_000]);
  });

  it('checking → a linked investment account counts as "Money you put in" counts it', () => {
    const rows = [row('chk', '2026-10-03', -75_000, 'ONLINE TRANSFER TO BROKERAGE XXXXXX5521')];
    const ms = measure(rows);
    const dep = computeDepositHistory({ today: TODAY, rows: [...ANCHORS(), ...rows], accounts: BASE });
    expect(dep.months.at(-1)!.putInCents).toBe(75_000);
    expect(ms.thisMonth!.putInCents).toBe(75_000);
    expect(ms.thisMonth!.investmentsNetCents).toBe(75_000);
    expect(ms.thisMonth!.investmentMovements).toBe(1);
    expect(ms.thisMonth!.totalCents).toBe(75_000);
  });

  it('savings → investment account and back count once: each leaves one side and arrives on the other', () => {
    const ms = measure([
      row('sav', '2026-09-08', -100_000, 'TRANSFER TO VANGUARD X5521'),
      row('sav', '2026-09-22', 30_000, 'TRANSFER FROM VANGUARD X5521'),
    ]);
    const sep = month(ms, '2026-09');
    expect(sep.savingsNetCents).toBe(-70_000); // −1,000.00 + 300.00
    expect(sep.putInCents).toBe(100_000);
    expect(sep.takenOutCents).toBe(30_000);
    expect(sep.investmentsNetCents).toBe(70_000);
    expect(sep.totalCents).toBe(0);
  });

  it('interest and dividends on savings are left out of every figure, and listed', () => {
    expect([...EARNINGS_CATEGORY_IDS].sort()).toEqual(['interest-income', 'investment-income']);
    const ms = measure([row('sav', '2026-09-30', 321, 'INTEREST PAYMENT', 'interest-income'), row('sav', '2026-09-30', 120, 'DIVIDEND', 'investment-income')]);
    const sep = month(ms, '2026-09');
    expect(sep.earningsCents).toBe(441);
    expect(sep.savingsNetCents).toBe(0);
    expect(sep.totalCents).toBe(0);
    expect(sep.earningsRows).toHaveLength(2);
  });

  it('money out of savings — a purchase, a card payment, a move to checking, or to an account not linked — counts as money out', () => {
    const ms = measure([
      row('sav', '2026-08-02', 200_000, 'PAYROLL ACME', 'paycheck'),
      row('sav', '2026-08-05', -2_000, 'DEBIT CARD PURCHASE HARDWARE', 'shopping'),
      row('sav', '2026-08-09', -10_000, 'TRANSFER TO CHECKING X7712'),
      row('sav', '2026-08-12', -50_000, 'TRANSFER TO BETTERMENT', 'investment'),
    ]);
    const aug = month(ms, '2026-08');
    // +2,000.00 − 20.00 − 100.00 − 500.00 = +1,380.00
    expect(aug.savingsNetCents).toBe(138_000);
    expect(aug.investmentsNetCents).toBe(0); // Betterment isn't linked: #788 lists it, never counts it
    expect(aug.uncountedInvestmentRows).toBe(1);
    expect(aug.totalCents).toBe(138_000);
  });

  it('pending, split-parent, excluded and future-dated savings rows are not counted', () => {
    const ms = measure([
      row('sav', '2026-10-05', 9_000, 'PENDING DEPOSIT', 'transfer', { status: 'PENDING' }),
      row('sav', '2026-10-06', 8_000, 'SPLIT PARENT', 'transfer', { isSplitParent: true }),
      row('sav', '2026-10-07', 7_000, 'EXCLUDED', 'transfer', { excludeFromTotals: true }),
      row('sav', '2026-10-20', 6_000, 'FUTURE', 'transfer'),
      row('sav', '2026-10-08', 5_000, 'COUNTED', 'transfer'),
    ]);
    expect(ms.thisMonth!.savingsNetCents).toBe(5_000);
    expect(ms.thisMonth!.savingsRows.map((r) => r.descriptor)).toEqual(['COUNTED']);
  });

  it('a combined savings account is read through its live successor, a handover day once', () => {
    const rows = [row('sav-old', '2026-09-01', 40_000, 'TRANSFER FROM CHECKING'), row('sav', '2026-09-15', 40_000, 'TRANSFER FROM CHECKING'), row('sav-old', '2026-09-15', 40_000, 'TRANSFER FROM CHECKING')];
    const ms = measure(rows, 100_000, BASE, { terminalOf: new Map([['sav-old', 'sav']]), handoverDates: new Set(['2026-09-15']) });
    // Sep 1 (read as Rainy Day Savings) + one copy of Sep 15.
    expect(month(ms, '2026-09').savingsNetCents).toBe(80_000);
    expect(month(ms, '2026-09').savingsRows.map((r) => r.accountLabel)).toEqual(['Rainy Day Savings', 'Rainy Day Savings']);
  });
});

describe('#790 — months and the average', () => {
  it('months are "Money you put in"\'s: the last 12 complete months and this month so far', () => {
    const ms = measure([]);
    expect(ms.months.map((m) => m.month)).toEqual([
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
    ]);
    expect(ms.thisMonth!.partial).toBe(true);
  });

  it('the average reads only complete months whose records are complete', () => {
    // Savings records stop on 2026-08-20 (no live feed): Aug, Sep and Oct are missing records.
    const SAV_STOPPED = acct('sav', 'SAVINGS', 'Rainy Day Savings', '3390', 'First Example Bank', { completeThrough: null });
    const rows = [row('sav', '2026-07-01', 60_000, 'TRANSFER FROM CHECKING'), row('sav', '2026-08-20', 30_000, 'TRANSFER FROM CHECKING')];
    const ms = measure(rows, 100_000, [CHK, SAV_STOPPED, VG]);
    expect(ms.monthsMissingRecords).toEqual(['2026-08', '2026-09']);
    // 2025-10 … 2026-07 = 10 months; total +600.00 → average 60.00.
    expect(ms.average).toEqual({ fromMonth: '2025-10', toMonth: '2026-07', months: 10, totalCents: 60_000, averageCents: 6_000 });
  });

  it('an average rounds half away from zero, in either direction', () => {
    const ms = measure([row('sav', '2026-09-01', -5, 'FEE', 'fees')]); // −0.05 over 12 months
    expect(ms.average!.months).toBe(12);
    expect(ms.average!.averageCents).toBe(0);
    const ms2 = measure([row('sav', '2026-09-01', -6, 'FEE', 'fees'), row('sav', '2026-08-01', -12, 'FEE', 'fees')]); // −0.18 / 12 = −0.015 → −0.02
    expect(ms2.average!.averageCents).toBe(-2);
  });
});

describe('#790 — the words', () => {
  const lead = (total: number, planned: number, missing = false) => {
    const ms = measure([row('sav', '2026-10-02', total, 'TRANSFER FROM CHECKING')], planned, missing ? [CHK, acct('sav', 'SAVINGS', 'Rainy Day Savings', '3390', 'First Example Bank', { completeThrough: null }), VG] : BASE);
    return measuredLead(ms);
  };
  it('every state of the lead', () => {
    expect(lead(125_000, 100_000)).toBe('So far this month you’ve set aside $1,250.00 — $250.00 more than the $1,000.00 your plan sets aside.');
    expect(lead(100_000, 100_000)).toBe('So far this month you’ve set aside $1,000.00 — exactly what your plan sets aside.');
    expect(lead(40_000, 100_000)).toBe('So far this month you’ve set aside $400.00 of the $1,000.00 your plan sets aside — $600.00 to go.');
    expect(lead(40_000, 0)).toBe('So far this month you’ve set aside $400.00. Your plan doesn’t set any savings aside yet.');
    expect(lead(-30_000, 100_000)).toBe('So far this month $300.00 more has come out of your savings and investment accounts than gone in — your plan sets aside $1,000.00.');
    expect(lead(-30_000, 0)).toBe('So far this month $300.00 more has come out of your savings and investment accounts than gone in.');
    expect(lead(40_000, 100_000, true)).toBe(
      'So far this month you’ve set aside $400.00 of the $1,000.00 your plan sets aside — $600.00 to go. Records for part of this month are missing, so this figure may be incomplete.',
    );
    expect(measuredLead(measure([], 100_000))).toBe('Nothing counted as set aside so far this month — your plan sets aside $1,000.00.');
    expect(measuredLead(measure([], 0))).toBe('Nothing counted as set aside so far this month, and your plan doesn’t set any savings aside yet.');
  });

  it('the average sentence', () => {
    const ms = measure([row('sav', '2026-09-01', 120_000, 'TRANSFER FROM CHECKING'), row('sav', '2026-08-01', 60_000, 'TRANSFER FROM CHECKING')], 100_000);
    expect(measuredAverageSentence(ms)).toBe(
      'Over the 12 complete months with full records (Oct 2025 – Sep 2026), you set aside an average of $150.00 a month. Your plan today sets aside $1,000.00 a month.',
    );
    const out = measure([row('sav', '2026-09-01', -120_000, 'TRANSFER TO CHECKING')], 0);
    expect(measuredAverageSentence(out)).toBe(
      'Over the 12 complete months with full records (Oct 2025 – Sep 2026), an average of $100.00 a month more came out of your savings and investment accounts than went in.',
    );
  });

  it('signed money spells out the sign; the uncounted note points at Investments', () => {
    expect(signedMoney(50_000)).toBe('+$500.00');
    expect(signedMoney(-50_000)).toBe('−$500.00');
    expect(signedMoney(0)).toBe('$0.00');
    const ms = measure([row('chk', '2026-10-04', -50_000, 'TRANSFER TO BETTERMENT', 'investment')]);
    expect(uncountedInvestmentsNote(ms.thisMonth!)).toBe('Investments lists 1 movement this month it couldn’t count.');
    const two = measure([
      row('chk', '2026-09-04', -50_000, 'TRANSFER TO BETTERMENT', 'investment'),
      row('chk', '2026-09-11', -20_000, 'TRANSFER TO WEALTHFRONT', 'investment'),
    ]);
    expect(uncountedInvestmentsNote(month(two, '2026-09'))).toBe('Investments lists 2 movements in Sep 2026 it couldn’t count.');
    expect(uncountedInvestmentsNote(two.thisMonth!)).toBeNull();
    expect(two.thisMonth!.partial).toBe(true);
  });

  it('the empty states name which zero', () => {
    expect(measure([], 100_000, [VG]).hasSourceAccounts).toBe(false);
    expect(MEASURED_NO_SOURCE_ACCOUNTS).toMatch(/^Link the checking and savings accounts/);
    expect(measure([], 100_000, [CHK]).hasSavingsAccounts).toBe(false);
    expect(MEASURED_NO_SAVING_ACCOUNTS).toMatch(/^Link the savings or investment accounts/);
    expect(MEASURED_NO_RECORDS).toMatch(/don’t cover a whole month yet/);
    expect(MEASURED_RULE_NOTE).toContain('interest and dividends left out');
  });
});

describe('#790 — the real loader on the demo seed', () => {
  it('the demo sets aside $500.00 into savings and $750.00 into the Brokerage each month', async () => {
    const ms = await getMeasuredSavings('user-demo', 100_000);
    const june = ms.thisMonth!;
    expect(june.month).toBe('2026-06');
    expect(june.savingsNetCents).toBe(50_000);
    expect(june.investmentsNetCents).toBe(75_000);
    expect(june.totalCents).toBe(125_000);
  });
});
