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
import { EARNINGS_CATEGORY_IDS, debtPaydownContributionsCents, measureSavings, savingsPlanLine, type MeasuredSavings, type SavingsPlanLine } from '@/lib/engine/savings/measured';
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
import { prisma } from '@/lib/db';

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
    expect(lead(-30_000, 100_000)).toBe('So far this month you’ve taken out $300.00 more than you set aside — your plan sets aside $1,000.00.');
    expect(lead(-30_000, 0)).toBe('So far this month you’ve taken out $300.00 more than you set aside.');
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
      'Over the 12 complete months with full records (Oct 2025 – Sep 2026), you took out an average of $100.00 a month more than you set aside.',
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

  it('test_regression__790_more_taken_out_says_counted_money_only: a tax refund we could not trace, then a withdrawal, never reads as "more came out than went in" (critic cycle 4, P1-1)', () => {
    const ms = measure([row('sav', '2026-10-02', 300_000, 'IRS TREAS 310 TAX REF', 'tax-refund'), row('sav', '2026-10-06', -100_000, 'TRANSFER TO CHECKING')], 100_000, [CHK, SAV]);
    expect(ms.thisMonth!.totalCents).toBe(-100_000);
    expect(ms.thisMonth!.untracedInCents).toBe(300_000);
    expect(measuredLead(ms)).toBe(
      'So far this month you’ve taken out $1,000.00 more than you set aside (not counting $3,000.00 that came in that we couldn’t trace) — your plan sets aside $1,000.00.',
    );
    // A month like it inside the average: the average names what it left out.
    const avg = measure([row('sav', '2026-09-02', 300_000, 'IRS TREAS 310 TAX REF', 'tax-refund'), row('sav', '2026-09-06', -120_000, 'TRANSFER TO CHECKING')], 0, [CHK, SAV]);
    expect(measuredAverageSentence(avg)).toBe(
      'Over the 12 complete months with full records (Oct 2025 – Sep 2026), you took out an average of $100.00 a month more than you set aside. Not counted: $3,000.00 that came into your savings over those months that we couldn’t trace.',
    );
    // One complete month, more taken out.
    const one = measureSavings({
      deposit: { today: TODAY, rows: [row('chk', '2026-09-01', -1000, 'BLUE DOOR COFFEE', 'coffee'), row('sav', '2026-09-01', -100, 'MONTHLY FEE', 'fees')], accounts: BASE },
      plan: 0,
    });
    expect(measuredAverageSentence(one)).toBe('In Sep 2026, the one complete month with full records, you took out $1.00 more than you set aside.');
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
      'it can overstate only when your filings say a coincidence was a move',
      'money in on a row you excluded from totals is left out too',
      'a brokerage the app doesn’t recognise',
      'a deposit your bank words as a return',
      'filed as pay (Paycheck, Bonus or Side Gig',
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

  it('test_regression__790_the_server_takes_debt_free_goals_out_of_the_line: a reader with a $900.00 debt-free goal and a $200.00 savings goal compares with $200.00', async () => {
    const uid = `measured-790-${Date.now()}-${process.pid}`;
    try {
      await prisma.user.create({ data: { id: uid, email: `${uid}@test.local` } });
      await prisma.account.create({
        data: { userId: uid, provider: 'manual', providerRef: `${uid}-chk`, name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 500_000, currency: 'USD' },
      });
      await prisma.goal.createMany({
        data: [
          { userId: uid, name: 'Rainy day', targetCents: 1_000_000, monthlyContributionCents: 20_000 },
          { userId: uid, name: 'Debt-free by Dec 2027', targetCents: 2_000_000, monthlyContributionCents: 90_000, kind: 'debt_free' },
        ],
      });
      const p = await getSpendingPlan(uid);
      expect(p.plannedSavingsCents).toBe(110_000);
      expect(p.measuredSavingsLine).toEqual({ plannedSavingsCents: 110_000, debtPaydownCents: 90_000, comparedCents: 20_000 });
    } finally {
      await prisma.goal.deleteMany({ where: { userId: uid } });
      await prisma.account.deleteMany({ where: { userId: uid } });
      await prisma.user.deleteMany({ where: { id: uid } });
    }
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
      '$36,300.00 came into your savings that we couldn’t match to a transfer from your linked checking or savings, a linked investment account, money returned to the same account, or pay — so it isn’t counted.',
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
    expect(measuredLead(ms)).toBe('So far this month you’ve taken out $4,500.00 more than you set aside — your plan sets aside $1,000.00.');
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

describe('#790 critic cycles 1–2, P1-3 / P1-B — the plan line less its extra debt payments', () => {
  it('savingsPlanLine: planned − debt, whichever side of the plan’s max() won; never below zero', () => {
    // Goals won: $200.00 of savings goals + $900.00 debt-free → $1,100.00; $200.00 reaches savings.
    expect(savingsPlanLine({ plannedSavingsCents: 110_000, debtPaydownCents: 90_000 })).toEqual({ plannedSavingsCents: 110_000, debtPaydownCents: 90_000, comparedCents: 20_000 });
    // The $1,000.00 target won over $900.00 debt-free: the debt payment comes out of that pool.
    expect(savingsPlanLine({ plannedSavingsCents: 100_000, debtPaydownCents: 90_000 }).comparedCents).toBe(10_000);
    // All debt.
    expect(savingsPlanLine({ plannedSavingsCents: 90_000, debtPaydownCents: 90_000 }).comparedCents).toBe(0);
    expect(savingsPlanLine({ plannedSavingsCents: 35_000, debtPaydownCents: 0 }).comparedCents).toBe(35_000);
  });

  it('debt-free goals are the only extra debt payments in the line', () => {
    expect(
      debtPaydownContributionsCents([
        { kind: null, monthlyContributionCents: 20_000 },
        { kind: 'debt_free', monthlyContributionCents: 90_000 },
        { kind: 'reserve', monthlyContributionCents: 5_000 },
        { kind: 'debt_free', monthlyContributionCents: null },
      ]),
    ).toBe(90_000);
  });

  it('test_regression__790_extra_debt_payments_are_not_to_go: every comparison says what the plan sets aside apart from them, and the arithmetic adds up', () => {
    const targetWon = measure(fromChecking('2026-10-02', 10_000), savingsPlanLine({ plannedSavingsCents: 100_000, debtPaydownCents: 90_000 }));
    expect(targetWon.plannedSavingsCents).toBe(10_000);
    expect(measuredLead(targetWon)).toBe(
      'So far this month you’ve set aside $100.00 — exactly what your plan sets aside apart from extra debt payments. Your plan’s savings line of $1,000.00 includes $900.00 a month of extra debt payments, which no savings or investment account shows.',
    );
    const goalsWon = measure(fromChecking('2026-10-02', 5_000), savingsPlanLine({ plannedSavingsCents: 110_000, debtPaydownCents: 90_000 }));
    expect(measuredLead(goalsWon)).toBe(
      'So far this month you’ve set aside $50.00 of the $200.00 your plan sets aside apart from extra debt payments — $150.00 to go. Your plan’s savings line of $1,100.00 includes $900.00 a month of extra debt payments, which no savings or investment account shows.',
    );
    const allDebt = savingsPlanLine({ plannedSavingsCents: 90_000, debtPaydownCents: 90_000 });
    expect(measuredLead(measure(fromChecking('2026-10-02', 20_000), allDebt))).toBe(
      'So far this month you’ve set aside $200.00. Your plan’s savings line of $900.00 is all extra debt payments, which no savings or investment account shows.',
    );
    // Zero and more taken out, beside a debt-free goal: the figure, then the qualifier (critic cycle 5, P2-3).
    const goalsLine = savingsPlanLine({ plannedSavingsCents: 110_000, debtPaydownCents: 90_000 });
    expect(measuredLead(measure([], goalsLine))).toBe(
      'Nothing counted as set aside so far this month — your plan sets aside $200.00 apart from extra debt payments. Your plan’s savings line of $1,100.00 includes $900.00 a month of extra debt payments, which no savings or investment account shows.',
    );
    expect(measuredLead(measure([row('sav', '2026-10-02', -30_000, 'TRANSFER TO CHECKING')], goalsLine))).toBe(
      'So far this month you’ve taken out $300.00 more than you set aside — your plan sets aside $200.00 apart from extra debt payments. Your plan’s savings line of $1,100.00 includes $900.00 a month of extra debt payments, which no savings or investment account shows.',
    );
    expect(measuredLead(measure([], allDebt))).toBe(
      'Nothing counted as set aside so far this month. Your plan’s savings line of $900.00 is all extra debt payments, which no savings or investment account shows.',
    );
    const avg = measure([...fromChecking('2026-09-01', 120_000), ...fromChecking('2026-08-01', 60_000)], savingsPlanLine({ plannedSavingsCents: 100_000, debtPaydownCents: 90_000 }));
    expect(measuredAverageSentence(avg)).toBe(
      'Over the 12 complete months with full records (Oct 2025 – Sep 2026), you set aside an average of $150.00 a month. Your plan today sets aside $100.00 a month apart from extra debt payments.',
    );
    // No debt-free goal: the line is the plan's, said as before.
    expect(measuredLead(measure(fromChecking('2026-10-02', 20_000), 110_000))).not.toMatch(/debt/);
  });
});

describe('#790 critic cycle 2, P1-A — a transfer is a transfer by its filing, the app’s window, and one count', () => {
  it('test_regression__790_a_daycare_payment_never_vouches_for_a_zelle: halves filed to anything but a move never pair', () => {
    const ms = measure([
      row('chk', '2026-09-01', -50_000, 'BRIGHT START DAYCARE', 'childcare'),
      row('sav', '2026-09-02', 50_000, 'ZELLE FROM JORDAN LEE', null),
      // A flagged half filed to spending is not a move either (the sweep's flag is not the filing).
      row('chk', '2026-09-10', -123_456, 'ZELLE TO JORDAN LEE', 'gifts', { isTransfer: true }),
      row('sav', '2026-09-11', 123_456, 'ONLINE TRANSFER', 'transfer'),
      // Rule level: neither half filed nor flagged — no evidence either moved between the
      // reader's accounts. (In production the transfer sweep files both halves Transfer when
      // the amounts coincide; that bound is the next test.)
      row('chk', '2026-09-20', -7_000, 'CHECK 1042', null),
      row('sav', '2026-09-20', 7_000, 'MOBILE DEPOSIT', null),
    ]);
    const sep = month(ms, '2026-09');
    expect(sep.savingsNetCents).toBe(0);
    expect(sep.untracedInCents).toBe(180_456);
  });

  it('flagged halves filed nothing else pair; within a week, "Money you put in"’s own window (cycle 3, P2-4)', () => {
    const ms = measure([
      row('chk', '2026-09-01', -30_000, 'ONLINE TRANSFER', null, { isTransfer: true }),
      row('sav', '2026-09-03', 30_000, 'ONLINE TRANSFER', 'uncategorized', { isTransfer: true }),
      row('chk', '2026-09-10', -20_000, 'TRANSFER TO SAVINGS', 'transfer'),
      row('sav', '2026-09-13', 20_000, 'TRANSFER FROM CHECKING', 'transfer'), // 3 days: in
      row('chk', '2026-09-20', -11_000, 'TRANSFER TO MARCUS', 'transfer'),
      row('sav', '2026-09-24', 11_000, 'TRANSFER FROM CHASE', 'transfer'), // 4 days: a transfer between banks, in
      row('chk', '2026-09-01', -9_000, 'TRANSFER TO SAVINGS', 'transfer'),
      row('sav', '2026-09-09', 9_000, 'TRANSFER FROM CHECKING', 'transfer'), // 8 days: out
    ]);
    const sep = month(ms, '2026-09');
    expect(sep.savingsNetCents).toBe(61_000);
    expect(sep.untracedInCents).toBe(9_000);
  });

  it('recorded bound (cycle 3, P2-2): halves the app itself files Transfer pair, whatever they really were', () => {
    // The categorizer files a card payment Transfer and the sweep files a coincident deposit
    // Transfer + flagged: the app's one verdict for each row says "a move", so this counts.
    const ms = measure([
      row('chk', '2026-09-03', -50_000, 'CHASE CREDIT CRD EPAY', 'transfer', { isTransfer: true }),
      row('sav', '2026-09-05', 50_000, 'MOBILE DEPOSIT', 'transfer', { isTransfer: true }),
    ]);
    expect(month(ms, '2026-09').savingsNetCents).toBe(50_000);
  });

  it('test_regression__790_one_checking_row_is_counted_once: a deposit "Money you put in" counts and a loan arriving in savings are not one move', () => {
    const ms = measure([
      row('chk', '2026-09-03', -500_000, 'ONLINE TRANSFER TO BROKERAGE XXXXXX5521', 'transfer'),
      row('sav', '2026-09-05', 500_000, 'LENDINGCLUB LOAN DISBURSEMENT', 'loan-payment'),
    ]);
    const sep = month(ms, '2026-09');
    expect(sep.putInCents).toBe(500_000);
    expect(sep.savingsNetCents).toBe(0);
    expect(sep.untracedInCents).toBe(500_000);
    expect(sep.totalCents).toBe(500_000); // was $10,000.00 at cycle 2
  });

  it('one checking row pairs with one arrival, closest first; a row never pairs with itself', () => {
    const one = measure([
      row('chk', '2026-09-10', -50_000, 'TRANSFER TO SAVINGS', 'transfer'),
      row('sav', '2026-09-10', 50_000, 'TRANSFER FROM CHECKING', 'transfer'),
      row('sav', '2026-09-11', 50_000, 'TRANSFER FROM CHECKING', 'transfer'),
    ]);
    expect(month(one, '2026-09').savingsNetCents).toBe(50_000);
    expect(month(one, '2026-09').untracedInCents).toBe(50_000);
    // Out on the 5th and the 10th; in on the 10th and the 14th: the 10th pairs with the 10th
    // first, and the 5th is nine days from the 14th — past the week.
    const closest = measure([
      row('chk', '2026-09-05', -40_000, 'TRANSFER TO SAVINGS', 'transfer'),
      row('chk', '2026-09-10', -40_000, 'TRANSFER TO SAVINGS', 'transfer'),
      row('sav', '2026-09-10', 40_000, 'TRANSFER FROM CHECKING', 'transfer'),
      row('sav', '2026-09-14', 40_000, 'TRANSFER FROM CHECKING', 'transfer'),
    ]);
    expect(month(closest, '2026-09').savingsNetCents).toBe(40_000);
    expect(month(closest, '2026-09').untracedInCents).toBe(40_000);
    const self = measure([row('sav', '2026-09-03', -40_000, 'TRANSFER TO CHECKING', 'transfer'), row('sav', '2026-09-04', 40_000, 'TRANSFER FROM CHECKING', 'transfer')]);
    expect(month(self, '2026-09').savingsNetCents).toBe(-40_000);
    expect(month(self, '2026-09').untracedInCents).toBe(40_000);
  });
});

describe('#790 critic cycle 2 — returns, earnings words, income kinds, and the rows read', () => {
  it('money returned to the savings account it left counts back (P2-A)', () => {
    const ms = measure([
      row('sav', '2026-09-02', -50_000, 'TRANSFER TO VANGUARD X5521', 'transfer'),
      row('sav', '2026-09-08', 50_000, 'TRANSFER TO VANGUARD X5521 RETURNED', null),
      row('sav', '2026-09-12', -1_000, 'EXCESS WITHDRAWAL FEE', 'fees'),
      row('sav', '2026-09-14', 1_000, 'FEE REVERSAL', null),
    ]);
    const sep = month(ms, '2026-09');
    expect(sep.untracedInCents).toBe(0);
    expect(sep.totalCents).toBe(0);
  });

  it('a transfer worded with INTEREST is a move, not earnings (P3-A); a retirement withdrawal is not new saving (P3-F)', () => {
    const ms = measure([
      row('chk', '2026-09-05', -25_000, 'TRANSFER TO SAVINGS', 'transfer'),
      row('sav', '2026-09-05', 25_000, 'TRANSFER FROM INTEREST CHECKING X7712', null, { isTransfer: true }),
      row('sav', '2026-09-15', 400_000, 'FIDELITY IRA DISTRIBUTION', 'retirement-income'),
    ]);
    const sep = month(ms, '2026-09');
    expect(sep.earningsCents).toBe(0);
    expect(sep.savingsNetCents).toBe(25_000);
    expect(sep.untracedInCents).toBe(400_000);
  });

  it('a row after today, a split parent and a $0 row are never read', () => {
    const ms = measure([
      row('sav', '2026-10-20', -6_000, 'SCHEDULED TRANSFER', 'transfer'),
      row('sav', '2026-10-06', -8_000, 'SPLIT PARENT', 'shopping', { isSplitParent: true }),
      row('sav', '2026-10-07', 0, 'ZERO ADJUSTMENT', null),
      row('sav', '2026-10-08', -2_000, 'COUNTED', 'fees'),
    ]);
    expect(ms.thisMonth!.savingsNetCents).toBe(-2_000);
    expect(ms.thisMonth!.savingsRows.map((r) => r.descriptor)).toEqual(['COUNTED']);
  });
});

describe('#790 critic cycle 3 — a brokerage’s movement is never half of a move; returns are the bank’s; pay is pay', () => {
  it('test_regression__790_a_counted_deposit_never_vouches_for_a_brokerage_arrival: Schwab → savings and checking → Vanguard are two movements (P1-1)', () => {
    const ms = measure([
      row('sav', '2026-09-03', 500_000, 'SCHWAB BROKERAGE MONEYLINK TRANSFER', 'investment', { isTransfer: true }),
      row('chk', '2026-09-04', -500_000, 'VANGUARD BUY INVESTMENT', 'investment', { isTransfer: true }),
    ]);
    const sep = month(ms, '2026-09');
    expect(sep.putInCents).toBe(500_000); // the Vanguard deposit, counted once
    expect(sep.savingsNetCents).toBe(0);
    expect(sep.untracedInCents).toBe(500_000); // Schwab is not linked
    expect(sep.totalCents).toBe(500_000); // was $10,000.00 at cycle 3
    expect(sep.uncountedInvestmentRows).toBe(1); // Investments still lists the Schwab row
  });

  it('two unlinked brokerages are not one move: checking → Fidelity and Schwab → savings', () => {
    const ms = measure([
      row('chk', '2026-09-03', -200_000, 'FIDELITY INVESTMENTS MONEYLINE', 'investment', { isTransfer: true }),
      row('sav', '2026-09-04', 200_000, 'SCHWAB BROKERAGE MONEYLINK TRANSFER', 'investment', { isTransfer: true }),
    ]);
    const sep = month(ms, '2026-09');
    expect(sep.savingsNetCents).toBe(0);
    expect(sep.untracedInCents).toBe(200_000);
  });

  it('a return is the bank’s wording, on the same account, after the money left, for the same amount, never a row already paired (P2-1)', () => {
    const SAV2 = acct('sav2', 'SAVINGS', 'Vacation Savings', '6604', 'Second Example Bank');
    const ms = measure(
      [
        row('sav2', '2025-01-02', -100, 'MONTHLY FEE', 'fees'),
        // A deposit Investments counts; "ACH CREDIT RETURN" is not a bank's return wording, and
        // #788 did not un-count it — so the arrival is not this deposit coming back.
        row('sav', '2026-09-02', -100_000, 'TRANSFER TO VANGUARD X5521', 'transfer'),
        row('sav', '2026-09-07', 100_000, 'ACH CREDIT RETURN', null),
        // A trust distribution is not a return of an insurance payment.
        row('sav', '2026-09-10', -80_000, 'NORTHWIND INSURANCE PREMIUM', 'insurance'),
        row('sav', '2026-09-12', 80_000, 'SMITH FAMILY REV TRUST DIST', null),
        // Before the money left; another account; another amount.
        row('sav', '2026-09-15', 30_000, 'ACH RETURN', null),
        row('sav', '2026-09-18', -30_000, 'EXAMPLE GYM', 'fitness'),
        row('sav', '2026-09-20', -20_000, 'EXAMPLE CLINIC', 'medical'),
        row('sav2', '2026-09-22', 20_000, 'ACH RETURN', null),
        row('sav', '2026-09-23', -12_000, 'EXAMPLE PHARMACY', 'medical'),
        row('sav', '2026-09-24', 11_900, 'ACH RETURN', null),
        // An outflow already paired as a move to checking is not returned again.
        row('sav', '2026-09-25', -5_000, 'TRANSFER TO CHECKING', 'transfer'),
        row('chk', '2026-09-25', 5_000, 'TRANSFER FROM SAVINGS', 'transfer'),
        row('sav', '2026-09-27', 5_000, 'ACH RETURN', null),
      ],
      100_000,
      [...BASE, SAV2],
    );
    const sep = month(ms, '2026-09');
    expect(sep.putInCents).toBe(100_000);
    expect(sep.untracedInCents).toBe(100_000 + 80_000 + 30_000 + 20_000 + 11_900 + 5_000);
    // −1,000 − 800 − 300 − 200 − 120 − 50 out of savings; +1,000 into Vanguard.
    expect(sep.totalCents).toBe(-100_000 - 80_000 - 30_000 - 20_000 - 12_000 - 5_000 + 100_000);
  });

  it('test_regression__790_a_counted_deposit_is_not_returned_here: a return Investments refused (the reader filed it Refund) leaves the deposit counted there and the arrival untraced here', () => {
    const ms = measure([
      row('sav', '2026-09-02', -100_000, 'TRANSFER TO VANGUARD X5521', 'transfer'),
      row('sav', '2026-09-07', 100_000, 'ACH RETURN', 'refund'),
    ]);
    const sep = month(ms, '2026-09');
    expect(sep.putInCents).toBe(100_000);
    expect(sep.untracedInCents).toBe(100_000);
    expect(sep.totalCents).toBe(0); // never +$1,000.00: one deposit, counted once
  });

  it('only pay is new money: a pension filed Income, benefits and a refund are not counted (P3-1)', () => {
    const ms = measure([
      row('sav', '2026-09-01', 150_000, 'ACME CORP PAYROLL', 'paycheck'),
      row('sav', '2026-09-02', 50_000, 'ACME ANNUAL BONUS', 'bonus'),
      row('sav', '2026-09-03', 38_000, 'STRIPE PAYOUT', 'side-income'),
      row('sav', '2026-09-04', 210_000, 'NORTHWIND PENSION PAYMENT', 'income'),
      row('sav', '2026-09-05', 90_000, 'SSA TREAS 310', 'govt-benefits'),
      row('sav', '2026-09-06', 4_500, 'EXAMPLE STORE REFUND', 'refund'),
    ]);
    const sep = month(ms, '2026-09');
    expect(sep.savingsNetCents).toBe(238_000);
    expect(sep.untracedInCents).toBe(304_500);
  });

  it('a flagged row worded INT is a move, not interest; ZELLE and WIRE words are never earnings (P2-3)', () => {
    const ms = measure([
      row('chk', '2026-09-05', -25_000, 'TRANSFER', 'transfer'),
      row('sav', '2026-09-05', 25_000, 'FROM INT CHECKING 7712', null, { isTransfer: true }),
      row('sav', '2026-09-09', 4_000, 'ZELLE FROM DIV SMITH', null),
      row('sav', '2026-09-10', 6_000, 'INTL WIRE IN INT', null),
    ]);
    const sep = month(ms, '2026-09');
    expect(sep.earningsCents).toBe(0);
    expect(sep.savingsNetCents).toBe(25_000);
    expect(sep.untracedInCents).toBe(10_000);
  });
});

describe('#790 critic cycle 4 — the guards and the edges, each locked', () => {
  it('test_regression__790_a_counted_deposit_never_pairs_even_when_its_own_counterpart_went_elsewhere (P2-3, M8)', () => {
    // #788 pairs the arrival with an unfiled Zelle out of checking (two rows naming no
    // destination pair first), so it counts the Vanguard deposit. That counted row must not
    // vouch for the arrival here too.
    const ms = measure([
      row('chk', '2026-09-03', -100_000, 'VANGUARD BUY INVESTMENT', 'investment', { isTransfer: true }),
      row('sav', '2026-09-05', 100_000, 'ONLINE TRANSFER FROM SAV 9999', 'transfer', { isTransfer: true }),
      row('chk', '2026-09-10', -100_000, 'ZELLE TO SOMEONE', null),
    ]);
    const sep = month(ms, '2026-09');
    expect(sep.putInCents).toBe(100_000);
    expect(sep.untracedInCents).toBe(100_000);
    expect(sep.totalCents).toBe(100_000); // never $2,000.00
  });

  it('test_regression__790_landed_in_your_account_is_a_move_on_both_pages: a deposit Investments reads as landed in the reader’s own savings counts here once (P2-3, M1)', () => {
    const rows = [
      row('chk', '2026-09-03', -60_000, 'VANGUARD BUY INVESTMENT', 'investment', { isTransfer: true }),
      row('sav', '2026-09-08', 60_000, 'TRANSFER FROM CHECKING', 'transfer', { isTransfer: true }),
    ];
    const dep = computeDepositHistory({ today: TODAY, rows: [...ANCHORS(), ...rows], accounts: BASE });
    expect(dep.uncounted.filter((u) => u.month === '2026-09').map((u) => u.reason)).toEqual(['landed-in-your-account']);
    const sep = month(measure(rows), '2026-09');
    expect(sep.putInCents).toBe(0);
    expect(sep.savingsNetCents).toBe(60_000);
    expect(sep.untracedInCents).toBe(0);
    expect(sep.uncountedInvestmentRows).toBe(0); // counted here, so not "couldn't count"
  });

  it('the edges: a move exactly a week apart pairs; a bank return exactly two weeks later counts, a day later does not; money out worded INTEREST is money out (P3-1)', () => {
    const ms = measure([
      row('chk', '2026-09-01', -70_000, 'TRANSFER TO SAVINGS', 'transfer'),
      row('sav', '2026-09-08', 70_000, 'TRANSFER FROM CHECKING', 'transfer'), // 7 days
      row('sav', '2026-09-02', -15_000, 'EXAMPLE CLINIC', 'medical'),
      row('sav', '2026-09-16', 15_000, 'ACH RETURN', null), // 14 days
      row('sav', '2026-09-03', -16_000, 'EXAMPLE PHARMACY', 'medical'),
      row('sav', '2026-09-18', 16_000, 'ACH RETURN', null), // 15 days
      row('sav', '2026-09-20', -500, 'INTEREST ADJUSTMENT', null),
    ]);
    const sep = month(ms, '2026-09');
    expect(sep.untracedInCents).toBe(16_000);
    expect(sep.earningsCents).toBe(0);
    // +700 (paired) −150 +150 (returned) −160 −5
    expect(sep.savingsNetCents).toBe(70_000 - 16_000 - 500);
  });
});
