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
import { EARNINGS_CATEGORY_IDS, measureSavings, savingsPlanLine, type MeasuredSavings, type SavingsPlanLine } from '@/lib/engine/savings/measured';
import {
  MEASURED_NO_RECORDS,
  MEASURED_NO_SAVING_ACCOUNTS,
  MEASURED_NO_SOURCE_ACCOUNTS,
  MEASURED_RULE_NOTE,
  measuredAverageSentence,
  measuredLead,
  signedMoney,
  uncountedInvestmentsNote,
  untracedNote,
} from '@/lib/engine/savings/measured-copy';
import { loadDepositInputs } from '@/server/investment-deposits';
import { getSpendingPlan } from '@/server/spending-plan';

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

function measure(rows: DepositRow[], plan: number | SavingsPlanLine = 100_000, accounts: DepositAccount[] = BASE, extra: { terminalOf?: Map<string, string>; handoverDates?: Set<string> } = {}): MeasuredSavings {
  return measureSavings({ deposit: { today: TODAY, rows: [...ANCHORS(), ...rows], accounts, ...extra }, plan });
}

/** A move from checking into savings: both halves, the same day. */
const fromChecking = (date: string, cents: number, to = 'sav') => [row('chk', date, -cents, `ONLINE TRANSFER TO SAVINGS X3390`), row(to, date, cents, 'ONLINE TRANSFER FROM CHECKING X7712')];

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

  it('pending, split-parent, future-dated and excluded money IN is not counted', () => {
    const ms = measure([
      row('sav', '2026-10-05', 9_000, 'PENDING DEPOSIT', 'transfer', { status: 'PENDING' }),
      row('sav', '2026-10-06', 8_000, 'SPLIT PARENT', 'transfer', { isSplitParent: true }),
      row('sav', '2026-10-07', 7_000, 'EXCLUDED', 'transfer', { excludeFromTotals: true }),
      row('chk', '2026-10-07', -7_000, 'TRANSFER TO SAVINGS', 'transfer'), // traceable, and still left out: the reader excluded it
      row('sav', '2026-10-20', 6_000, 'FUTURE', 'transfer'),
      row('sav', '2026-10-08', 5_000, 'COUNTED', 'transfer'),
      row('chk', '2026-10-08', -5_000, 'TRANSFER TO SAVINGS', 'transfer'),
    ]);
    expect(ms.thisMonth!.savingsNetCents).toBe(5_000);
    expect(ms.thisMonth!.savingsRows.map((r) => r.descriptor)).toEqual(['COUNTED']);
  });

  it('a combined savings account is read through its live successor, a handover day once', () => {
    const rows = [
      row('chk', '2026-09-01', -40_000, 'TRANSFER TO SAVINGS'),
      row('chk', '2026-09-15', -40_000, 'TRANSFER TO SAVINGS'),
      row('sav-old', '2026-09-01', 40_000, 'TRANSFER FROM CHECKING'),
      row('sav', '2026-09-15', 40_000, 'TRANSFER FROM CHECKING'),
      row('sav-old', '2026-09-15', 40_000, 'TRANSFER FROM CHECKING'),
    ];
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
    const rows = [...fromChecking('2026-07-01', 60_000), ...fromChecking('2026-08-20', 30_000)];
    const ms = measure(rows, 100_000, [CHK, SAV_STOPPED, VG]);
    expect(ms.monthsMissingRecords).toEqual(['2026-08', '2026-09']);
    // 2025-10 … 2026-07 = 10 months; total +600.00 → average 60.00.
    expect(ms.average).toEqual({ fromMonth: '2025-10', toMonth: '2026-07', months: 10, totalCents: 60_000, averageCents: 6_000 });
    // The sentence says how many months it left out (critic cycle 1, P2-4).
    expect(measuredAverageSentence(ms)).toBe(
      'Over the 10 complete months with full records (Oct 2025 – Jul 2026), you set aside an average of $60.00 a month. Your plan today sets aside $1,000.00 a month. 2 months with missing records are left out.',
    );
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
    const rows = total > 0 ? fromChecking('2026-10-02', total) : [row('sav', '2026-10-02', total, 'TRANSFER TO CHECKING')];
    const ms = measure(rows, planned, missing ? [CHK, acct('sav', 'SAVINGS', 'Rainy Day Savings', '3390', 'First Example Bank', { completeThrough: null }), VG] : BASE);
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
    const ms = measure([...fromChecking('2026-09-01', 120_000), ...fromChecking('2026-08-01', 60_000)], 100_000);
    expect(measuredAverageSentence(ms)).toBe(
      'Over the 12 complete months with full records (Oct 2025 – Sep 2026), you set aside an average of $150.00 a month. Your plan today sets aside $1,000.00 a month.',
    );
    const out = measure([row('sav', '2026-09-01', -120_000, 'TRANSFER TO CHECKING')], 0);
    expect(measuredAverageSentence(out)).toBe(
      'Over the 12 complete months with full records (Oct 2025 – Sep 2026), an average of $100.00 a month more came out of your savings and investment accounts than went in.',
    );
    // Only the kinds the reader links are named (critic cycle 1, P3-3).
    const savingsOnly = measure([row('sav', '2026-09-01', -120_000, 'TRANSFER TO CHECKING')], 0, [CHK, SAV]);
    expect(measuredAverageSentence(savingsOnly)).toBe(
      'Over the 12 complete months with full records (Oct 2025 – Sep 2026), an average of $100.00 a month more came out of your savings accounts than went in.',
    );
  });

  it('one complete month with full records is named as one (critic cycle 1, P2-4)', () => {
    const rows = [row('chk', '2026-09-01', -1000, 'BLUE DOOR COFFEE', 'coffee'), row('sav', '2026-09-01', -100, 'MONTHLY FEE', 'fees'), ...fromChecking('2026-09-10', 25_000)];
    const one = measureSavings({ deposit: { today: TODAY, rows, accounts: BASE }, plan: 0 });
    expect(one.average!.months).toBe(1);
    expect(measuredAverageSentence(one)).toBe('In Sep 2026, the one complete month with full records, you set aside $249.00.');
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

  it('the lead names the kinds linked when more came out (critic cycle 1, P3-3)', () => {
    expect(measuredLead(measure([row('sav', '2026-10-02', -30_000, 'TRANSFER TO CHECKING')], 100_000, [CHK, SAV]))).toBe(
      'So far this month $300.00 more has come out of your savings accounts than gone in — your plan sets aside $1,000.00.',
    );
  });

  it('the empty states name which zero', () => {
    expect(measure([], 100_000, [VG]).hasSourceAccounts).toBe(false);
    expect(MEASURED_NO_SOURCE_ACCOUNTS).toMatch(/^Link the checking and savings accounts/);
    expect(measure([], 100_000, [CHK]).hasSavingsAccounts).toBe(false);
    expect(MEASURED_NO_SAVING_ACCOUNTS).toMatch(/^Link the savings or investment accounts/);
    expect(MEASURED_NO_RECORDS).toMatch(/don’t cover a whole month yet/);
    for (const claim of [
      'Interest and dividends are left out',
      'is listed and not counted',
      'even a row you excluded from totals',
      'never overstate it',
      'a cash-management account your provider reports as checking',
      'extra debt payments',
    ])
      expect(MEASURED_RULE_NOTE, claim).toContain(claim);
  });
});

describe('#790 — the real loader on the demo seed', () => {
  it('the demo sets aside $500.00 into savings and $750.00 into the Brokerage each month', async () => {
    const ms = measureSavings({ deposit: await loadDepositInputs('user-demo'), plan: 100_000 });
    const june = ms.thisMonth!;
    expect(june.month).toBe('2026-06');
    expect(june.savingsNetCents).toBe(50_000);
    expect(june.investmentsNetCents).toBe(75_000);
    expect(june.totalCents).toBe(125_000);
    // The edge-case table's demo figures (critic cycle 1, P2-4): March −$370.00, a $1,210.00 average.
    expect(ms.months.find((m) => m.month === '2026-03')!.totalCents).toBe(-37_000);
    expect(ms.average).toMatchObject({ fromMonth: '2025-06', toMonth: '2026-05', months: 12, averageCents: 121_000 });
    expect(ms.months.every((m) => m.untracedInCents === 0)).toBe(true);
  });

  it('the plan the page compares with: the demo has no debt-free goal, so it is the whole savings line', async () => {
    const p = await getSpendingPlan('user-demo');
    expect(p.measuredSavingsLine.debtPaydownCents).toBe(0);
    expect(p.measuredSavingsLine.comparedCents).toBe(p.plannedSavingsCents);
  });
});

describe('#790 critic cycle 1 — money in must be traceable; money out always counts', () => {
  it('test_regression__790_money_from_an_unlinked_account_is_not_set_aside: a transfer from another bank, a loan, a card advance, and a move too far apart are listed, not counted', () => {
    const CARD = acct('card', 'CREDIT', 'Example Card', '4410', 'First Example Bank');
    const ms = measure(
      [
        row('card', '2025-01-02', -500, 'BLUE DOOR COFFEE', 'coffee'),
        row('sav', '2026-09-03', 2_000_000, 'TRANSFER FROM MARCUS SAVINGS X9981', null),
        row('sav', '2026-09-08', 1_500_000, 'LOAN DISBURSEMENT UPSTART', 'transfer'),
        row('card', '2026-09-12', -100_000, 'CASH ADVANCE', 'transfer'),
        row('sav', '2026-09-12', 100_000, 'TRANSFER FROM CARD', 'transfer'),
        row('chk', '2026-09-15', -30_000, 'TRANSFER TO SAVINGS', 'transfer'),
        row('sav', '2026-09-23', 30_000, 'TRANSFER FROM CHECKING', 'transfer'), // 8 days: past the window
        ...fromChecking('2026-09-25', 10_000),
      ],
      100_000,
      [...BASE, CARD],
    );
    const sep = month(ms, '2026-09');
    expect(sep.savingsNetCents).toBe(10_000);
    expect(sep.untracedInCents).toBe(3_630_000);
    expect(sep.untracedRows.map((r) => r.descriptor)).toEqual(['TRANSFER FROM MARCUS SAVINGS X9981', 'LOAN DISBURSEMENT UPSTART', 'TRANSFER FROM CARD', 'TRANSFER FROM CHECKING']);
    expect(sep.totalCents).toBe(10_000);
    expect(untracedNote(sep)).toBe(
      '$36,300.00 came into your savings from an account we can’t see — a bank you haven’t linked, a loan or a card — so it isn’t counted: it may be money you saved before. Money filed as income counts.',
    );
    // The average never reads it either: 10,000 / 12 = 833.33 → 833.
    expect(ms.average!.averageCents).toBe(833);
  });

  it('money in that is traceable counts: from a linked savings account (and out of it), back from a linked investment account, or filed as income', () => {
    const SAV2 = acct('sav2', 'SAVINGS', 'Vacation Savings', '6604', 'Second Example Bank');
    const ms = measure(
      [
        row('sav2', '2025-01-02', -100, 'MONTHLY FEE', 'fees'),
        row('sav', '2026-09-02', -20_000, 'TRANSFER TO VACATION SAVINGS', 'transfer'),
        row('sav2', '2026-09-04', 20_000, 'TRANSFER FROM RAINY DAY', 'transfer'),
        row('sav', '2026-09-10', 45_000, 'TRANSFER FROM VANGUARD X5521', 'investment'),
        row('sav', '2026-09-15', 120_000, 'ACME CORP PAYROLL', 'paycheck'),
        row('sav', '2026-09-20', 38_000, 'STRIPE PAYOUT', 'side-income'),
      ],
      100_000,
      [...BASE, SAV2],
    );
    const sep = month(ms, '2026-09');
    // −200.00 + 200.00 (counted once, net 0) + 450.00 + 1,200.00 + 380.00
    expect(sep.savingsNetCents).toBe(203_000);
    expect(sep.takenOutCents).toBe(45_000);
    expect(sep.totalCents).toBe(158_000); // the brokerage withdrawal nets against Investments
    expect(sep.untracedInCents).toBe(0);
  });

  it('test_regression__790_an_excluded_withdrawal_still_leaves_savings: money out counts even when the reader excluded the row from totals', () => {
    const ms = measure([...fromChecking('2026-10-02', 50_000), row('sav', '2026-10-09', -500_000, 'HONDA OF EXAMPLE SERVICE', 'auto-maintenance', { excludeFromTotals: true })]);
    expect(ms.thisMonth!.savingsNetCents).toBe(-450_000);
    expect(measuredLead(ms)).toBe('So far this month $4,500.00 more has come out of your savings and investment accounts than gone in — your plan sets aside $1,000.00.');
  });

  it('interest a bank words its own way is earnings, not money set aside (critic cycle 1, P2-1)', () => {
    const ms = measure([
      row('sav', '2026-09-30', 4_321, 'INTEREST', null),
      row('sav', '2026-09-30', 210, 'MONTHLY INTEREST', 'income'),
      row('sav', '2026-09-30', 105, 'INT PAID', 'uncategorized'),
      row('sav', '2026-09-30', 99, 'DIV CREDIT', null),
      row('sav', '2026-09-30', 150_000, "ACME INT'L PAYROLL", 'paycheck'),
    ]);
    const sep = month(ms, '2026-09');
    expect(sep.earningsCents).toBe(4_735);
    expect(sep.savingsNetCents).toBe(150_000); // a paycheck filed as pay is never read as interest
  });

  it('a move between checking and savings filed Investment & Savings is not "couldn’t count" (critic cycle 1, P2-5)', () => {
    const ms = measure([row('chk', '2026-10-03', -50_000, 'ONLINE TRANSFER TO SAVINGS X3390', 'investment'), row('sav', '2026-10-03', 50_000, 'ONLINE TRANSFER FROM CHECKING X7712', 'investment')]);
    const dep = computeDepositHistory({ today: TODAY, rows: [...ANCHORS(), row('chk', '2026-10-03', -50_000, 'ONLINE TRANSFER TO SAVINGS X3390', 'investment'), row('sav', '2026-10-03', 50_000, 'ONLINE TRANSFER FROM CHECKING X7712', 'investment')], accounts: BASE });
    expect(dep.months.at(-1)!.uncountedCount).toBeGreaterThan(0); // Investments lists them …
    expect(ms.thisMonth!.uncountedInvestmentRows).toBe(0); // … this measure counted them
    expect(ms.thisMonth!.savingsNetCents).toBe(50_000);
    expect(uncountedInvestmentsNote(ms.thisMonth!)).toBeNull();
  });
});

describe('#790 critic cycle 1 — only moves that touch savings are read as moves', () => {
  it('a move between two checking accounts filed Investment & Savings stays in "couldn’t count": this measure never read it', () => {
    const CHK2 = acct('chk2', 'CHECKING', 'Bills Checking', '8820', 'Second Example Bank');
    const rows = [
      row('chk2', '2025-01-02', -100, 'BLUE DOOR COFFEE', 'coffee'),
      row('chk', '2026-10-03', -50_000, 'ONLINE TRANSFER TO X8820', 'investment'),
      row('chk2', '2026-10-03', 50_000, 'ONLINE TRANSFER FROM X7712', 'investment'),
    ];
    const ms = measure(rows, 100_000, [...BASE, CHK2]);
    const dep = computeDepositHistory({ today: TODAY, rows: [...ANCHORS(), ...rows], accounts: [...BASE, CHK2] });
    expect(dep.months.at(-1)!.uncountedCount).toBeGreaterThan(0);
    expect(ms.thisMonth!.uncountedInvestmentRows).toBe(dep.months.at(-1)!.uncountedCount);
    expect(ms.thisMonth!.totalCents).toBe(0);
  });
});

describe('#790 critic cycle 1, P1-3 — the plan line holds extra debt payments this can’t see', () => {
  it('savingsPlanLine: the line without debt-free goals is max(other goals, target), never above the whole line', () => {
    expect(savingsPlanLine({ plannedSavingsCents: 110_000, goalContributionsCents: 110_000, debtPaydownCents: 90_000, savingsTargetCents: 0 })).toEqual({
      plannedSavingsCents: 110_000,
      debtPaydownCents: 90_000,
      comparedCents: 20_000,
    });
    expect(savingsPlanLine({ plannedSavingsCents: 110_000, goalContributionsCents: 110_000, debtPaydownCents: 90_000, savingsTargetCents: 50_000 }).comparedCents).toBe(50_000);
    // The target won the plan's max(): the debt goals were never in the line.
    expect(savingsPlanLine({ plannedSavingsCents: 50_000, goalContributionsCents: 30_000, debtPaydownCents: 10_000, savingsTargetCents: 50_000 }).comparedCents).toBe(50_000);
    expect(savingsPlanLine({ plannedSavingsCents: 35_000, goalContributionsCents: 35_000, debtPaydownCents: 0, savingsTargetCents: 0 }).comparedCents).toBe(35_000);
  });

  it('test_regression__790_extra_debt_payments_are_not_to_go: the lead compares with the line without them and says why', () => {
    const plan = savingsPlanLine({ plannedSavingsCents: 110_000, goalContributionsCents: 110_000, debtPaydownCents: 90_000, savingsTargetCents: 0 });
    const ms = measure(fromChecking('2026-10-02', 20_000), plan);
    expect(ms.plannedSavingsCents).toBe(20_000);
    expect(measuredLead(ms)).toBe(
      'So far this month you’ve set aside $200.00 — exactly what your plan sets aside. Your plan’s savings line of $1,100.00 includes $900.00 a month of extra debt payments, which no savings or investment account shows, so this compares with $200.00 — the line without them.',
    );
    // No debt-free goal, or one the target outweighs: no note.
    expect(measuredLead(measure(fromChecking('2026-10-02', 20_000), 110_000))).not.toMatch(/debt/);
    expect(measuredLead(measure(fromChecking('2026-10-02', 20_000), savingsPlanLine({ plannedSavingsCents: 50_000, goalContributionsCents: 30_000, debtPaydownCents: 10_000, savingsTargetCents: 50_000 })))).not.toMatch(/debt/);
  });
});
