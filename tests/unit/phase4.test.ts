/**
 * Phase 4 unit suite: cash-flow calendar, goal→FI impact, CSV/PDF export,
 * token encryption.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildSeedData } from '@/lib/seed/build';
import { buildCashFlowCalendar, expandScheduled } from '@/lib/engine/calendar/build';
import { selectLoanObligations } from '@/lib/engine/loans/obligations';
import { goalFIImpact } from '@/lib/engine/goals';
import { assembleCashNeededInput } from '@/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import { netWorthReportPdf, netWorthToCsv, transactionsToCsv } from '@/lib/export';
import { decryptToken, encryptToken } from '@/lib/crypto';
import { holidayTable, isoDate } from '@/lib/dates';
import { cents } from '@/lib/money';

const seed = buildSeedData('2026-06-10');

function seedObligations() {
  const input = assembleCashNeededInput({
    today: isoDate('2026-06-10'),
    scenario: 'PAY_IN_FULL',
    paymentAccountId: 'acct-checking',
    accounts: seed.accounts,
    autopays: seed.autopays,
    statements: seed.statements,
    cardPayments: seed.cardPayments,
    transactions: seed.transactions,
    scheduled: seed.scheduled,
    holidayTable: holidayTable(2024, 2027),
  });
  const result = computeCashNeeded(input);
  // `cards` already contains every obligation (estimates included); `upcoming` is a SUBSET of it.
  // Spreading both double-counted, and after C.8 a duplicated card synthesizes every future month
  // twice (critic F-5). Hand the builder the one complete list.
  return result.cards;
}

describe('cash-flow calendar (June 2026 from seed)', () => {
  const calendar = buildCashFlowCalendar({
    month: '2026-06',
    scheduled: seed.scheduled,
    cardObligations: seedObligations(),
    today: isoDate('2026-06-10'),
    holidays: holidayTable(2025, 2027),
  });

  it('lays out all 30 June days', () => {
    expect(calendar.days).toHaveLength(30);
    expect(calendar.days[0].date).toBe('2026-06-01');
    expect(calendar.days[29].date).toBe('2026-06-30');
  });

  it('shows both payroll Fridays (+$2,450) and the 06-24 rent (−$1,800)', () => {
    const d12 = calendar.days.find((d) => d.date === '2026-06-12')!;
    expect(d12.events.some((e) => e.kind === 'inflow' && e.amountCents === 245000)).toBe(true);
    const d26 = calendar.days.find((d) => d.date === '2026-06-26')!;
    expect(d26.events.some((e) => e.kind === 'inflow')).toBe(true);
    const d24 = calendar.days.find((d) => d.date === '2026-06-24')!;
    expect(d24.events.some((e) => e.kind === 'outflow' && e.amountCents === -180000)).toBe(true);
  });

  it('shows card due dates on their EFFECTIVE dates: both 15th cards, Freedom on Fri 06-26', () => {
    const d15 = calendar.days.find((d) => d.date === '2026-06-15')!;
    expect(d15.events.filter((e) => e.kind === 'card-due')).toHaveLength(2);
    const d26 = calendar.days.find((d) => d.date === '2026-06-26')!;
    expect(d26.events.some((e) => e.kind === 'card-due' && e.amountCents === -60000)).toBe(true);
    // weekend issuer date 06-28 must NOT carry the due event
    const d28 = calendar.days.find((d) => d.date === '2026-06-28')!;
    expect(d28.events.filter((e) => e.kind === 'card-due')).toHaveLength(0);
  });

  it('reminder dates cover every card-due day', () => {
    expect(calendar.reminderDates).toEqual(['2026-06-15', '2026-06-26']);
  });

  it('expandScheduled clamps to the window and respects cadence', () => {
    const events = expandScheduled(
      [{ accountId: 'a', description: 'Payroll', amountCents: 245000, nextDate: '2026-06-12', cadence: 'BIWEEKLY' }],
      isoDate('2026-06-01'),
      isoDate('2026-06-30'),
    );
    expect(events.map((e) => e.date)).toEqual(['2026-06-12', '2026-06-26']);
  });
});

describe('loan payments surface on the calendar + reminders, not the cash headline (#134)', () => {
  // The seed Auto Loan (acct-autoloan: minimumPaymentCents 38500, dueDayOfMonth 5) is no
  // longer a hand-authored checking outflow — it drives a first-class loan-due obligation,
  // exactly as a real Plaid mortgage/student loan would. This locks the wiring against a
  // silent-drop regression (loan ingested but never surfaced).
  const today = isoDate('2026-06-10');
  const loanObligations = selectLoanObligations({
    accounts: seed.accounts,
    today,
    holidays: holidayTable(2025, 2027),
  });

  it('derives exactly one loan obligation from the seed Auto Loan (weekend+holiday adjusted)', () => {
    expect(loanObligations).toEqual([
      {
        accountId: 'acct-autoloan',
        accountName: 'Auto Loan',
        accountType: 'LOAN',
        dueDate: '2026-07-05', // a Sunday
        effectiveDueDate: '2026-07-02', // Sun→Sat→Fri(observed Jul-4 holiday)→Thu
        paymentCents: 38500,
        isEstimated: false,
        frozenSince: null,
      },
    ]);
  });

  it('the stand-in scheduled outflow is gone (no double-display)', () => {
    expect(seed.scheduled.some((s) => s.id === 'sched-autoloan')).toBe(false);
  });

  it('shows the loan as a badged loan-due event on its effective date, counted as outflow + reminder', () => {
    const july = buildCashFlowCalendar({
      month: '2026-07',
      scheduled: seed.scheduled,
      cardObligations: [],
      loanObligations,
      today,
      holidays: holidayTable(2025, 2027),
    });
    const d = july.days.find((x) => x.date === '2026-07-02')!;
    expect(d.events.some((e) => e.kind === 'loan-due' && e.label === 'Auto Loan due' && e.amountCents === -38500)).toBe(true);
    expect(july.reminderDates).toContain('2026-07-02');
    // The loan adds exactly its payment to the month's outflow total (vs the same month
    // without it) — July also carries the recurring rent/savings scheduled outflows.
    const julyNoLoan = buildCashFlowCalendar({
      month: '2026-07',
      scheduled: seed.scheduled,
      cardObligations: [],
      today,
      holidays: holidayTable(2025, 2027),
    });
    expect(july.totalOutCents - julyNoLoan.totalOutCents).toBe(38500);
  });
});

describe('goal → FI date impact (Phase 4 acceptance #3)', () => {
  // Hand math (zero return for exactness): portfolio 0, savings $1,000/mo,
  // FI $120,000 → baseline 120 months. Goal: $6,000 at $500/mo → 12 months of
  // half savings → after 12 months portfolio = $6,000; remaining $114,000 at
  // $1,000/mo = 114 months → total 126 → delay 6 months.
  it('a $6,000 goal at $500/mo delays a 120-month FI plan by exactly 6 months (0% return)', () => {
    const impact = goalFIImpact({
      portfolioCents: cents(0),
      monthlySavingsCents: cents(100_000),
      annualReturnBps: 0,
      fiTargetCents: cents(12_000_000),
      goalRemainingCents: cents(600_000),
      goalMonthlyContributionCents: cents(50_000),
    });
    expect(impact.monthsToGoal).toBe(12);
    expect(impact.monthsToFIBaseline).toBe(120);
    expect(impact.monthsToFIWithGoal).toBe(126);
    expect(impact.fiDelayMonths).toBe(6);
  });

  it('a fully funded goal has zero FI impact', () => {
    const impact = goalFIImpact({
      portfolioCents: cents(0),
      monthlySavingsCents: cents(100_000),
      annualReturnBps: 0,
      fiTargetCents: cents(12_000_000),
      goalRemainingCents: cents(0),
      goalMonthlyContributionCents: cents(50_000),
    });
    expect(impact.monthsToGoal).toBe(0);
    expect(impact.fiDelayMonths).toBe(0);
  });

  it('a goal with no contribution never completes and reports null impact', () => {
    const impact = goalFIImpact({
      portfolioCents: cents(0),
      monthlySavingsCents: cents(100_000),
      annualReturnBps: 0,
      fiTargetCents: cents(12_000_000),
      goalRemainingCents: cents(600_000),
      goalMonthlyContributionCents: cents(0),
    });
    expect(impact.monthsToGoal).toBeNull();
    expect(impact.fiDelayMonths).toBeNull();
  });
});

describe('CSV export', () => {
  it('quotes RFC-4180 style and formats cents at the boundary', () => {
    const csv = transactionsToCsv([
      {
        date: '2026-06-10',
        account: 'Everyday Checking',
        rawDescriptor: 'SQ *BLUE BOTTLE, "OAK"',
        merchant: 'Blue Bottle Coffee',
        category: 'Dining Out',
        amountCents: -675,
        status: 'POSTED',
      },
    ]);
    expect(csv).toContain('"SQ *BLUE BOTTLE, ""OAK"""');
    expect(csv).toContain('-6.75');
    expect(csv.startsWith('date,account,description,merchant,category,amount,status\r\n')).toBe(true);
  });

  it('net-worth CSV round-trips the seed trend', () => {
    const csv = netWorthToCsv([{ date: '2026-06-10', netWorthCents: 14480474 }]);
    expect(csv).toContain('2026-06-10,144804.74');
  });
});

describe('PDF export', () => {
  it('produces a valid PDF for the seed fixture (magic bytes + non-trivial size)', async () => {
    const bytes = await netWorthReportPdf({
      generatedFor: 'demo@pulse.finance',
      asOf: '2026-06-10',
      netWorthCents: cents(14480474),
      accounts: seed.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currentBalanceCents: a.currentBalanceCents,
        feedDroppedAt: null,
      })),
      supersededAccountIds: [],
      trend: [{ date: '2026-05-31', netWorthCents: 14300000 }, { date: '2026-06-10', netWorthCents: 14480474 }],
    });
    const header = String.fromCharCode(...bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1500);
  });
});

describe('token encryption (AES-256-GCM)', () => {
  const key = randomBytes(32);
  it('round-trips and never stores plaintext', () => {
    const token = 'access-sandbox-abc-123';
    const encrypted = encryptToken(token, key);
    expect(encrypted).not.toContain(token);
    expect(decryptToken(encrypted, key)).toBe(token);
  });
  it('tampering fails authentication', () => {
    const encrypted = encryptToken('secret', key);
    const [iv, data, tag] = encrypted.split('.');
    const tampered = `${iv}.${Buffer.from('xxxx' + Buffer.from(data, 'base64').toString('latin1').slice(4), 'latin1').toString('base64')}.${tag}`;
    expect(() => decryptToken(tampered, key)).toThrow();
  });
  it('unique IV per encryption (no ciphertext reuse)', () => {
    expect(encryptToken('same', key)).not.toBe(encryptToken('same', key));
  });
});
