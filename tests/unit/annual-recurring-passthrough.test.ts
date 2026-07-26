/**
 * L.23 — a DETECTED annual bill reaches the money (the L.22 money-critic P1-2
 * residual). Before this slice `toScheduledTransactions` projected only
 * WEEKLY/BIWEEKLY/MONTHLY, and `src/server/recurring.ts` is the ONLY writer of
 * the ScheduledTransaction table in the app, so the spending plan's `/12` rule —
 * written for exactly an annual bill — was dead for every row in production: a
 * detected $1,200/yr premium overstated guilt-free spending by $100 every month,
 * while the /recurring page's own headline already normalized the same series at
 * 1/12. Two surfaces, one fact, $100 apart.
 *
 * What this file locks, in the order the money travels:
 *  1. THE FILTER, BOTH DIRECTIONS: an annual EXPENSE series is projected; an
 *     annual INCOME series is NOT. The asymmetry is the L.14 failure-direction
 *     rule applied per ROLE — an annual bill can only ask the reader to hold
 *     more cash, while an annual bonus projected on a date inferred from one
 *     365-day gap offsets a dip and can silence a warning.
 *  2. ONLY WHILE IT IS STILL CHARGING: a lapsed annual series is projected
 *     nowhere, by the SAME predicate /recurring files it under "no longer
 *     charging" with. Both L.23 critics found this independently and executed
 *     it — unguarded, a policy last charged in 2021 read $0/month on /recurring
 *     and $100/month inside the plan, forever.
 *  3. THE THREE EXPANDERS: cash-needed, forecast and calendar each project an
 *     ANNUAL row exactly ONCE inside a window shorter than a year, and zero
 *     times when its date falls outside — the behaviour their catch-all `else`
 *     already had, now locked — plus, for all three, the multi-year window where
 *     the explicit 12-month step is the only thing that produces the later
 *     occurrences. The cash-needed multi-year assertion exists because mutation
 *     testing proved the 90/60-day pair alone could not catch reverting that
 *     expander at all (money critic P2-1).
 *  4. THE REAL SERVER PATH: detector → ScheduledTransaction → snapshot →
 *     `getSpendingPlan`, because a pure-builder test cannot catch a wiring bug
 *     (the L.15 lesson). Fail-old: `fixedExpensesCents` was 0 here.
 *  5. THE RENDERED CLAIMS, in both directions: the glass-box basis may no longer
 *     say a detected annual bill is unprojected, may no longer offer a capability
 *     ("entered by you") no code path has, may not claim money is "set aside"
 *     when nothing is carried forward, and speaks about yearly bills ONLY when
 *     one is in the figure. Plus the annual-INCOME exclusion, disclosed on the
 *     one basis that reads detected series as income.
 *
 * NOT fixed, deliberately (recorded in docs/STATUS.md): every rhythm
 * `cadenceFromGap` does not recognize — quarterly, semiannual, bi-monthly,
 * six-weekly, three-weekly, ten-day — counts zero times, because those gaps
 * classify as IRREGULAR and `detectRecurring` drops them. That is a new
 * detection class, not a passthrough. The tests at the bottom pin the whole
 * dropped set, and the ~2-year/steady-price precondition an annual series needs,
 * so the day either changes this file says so.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { addDays, addMonthsClamped, daysBetween, holidayTable, isoDate } from '@/lib/dates';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import {
  detectRecurring,
  isSeriesActive,
  toScheduledTransactions,
  type RecurringTxn,
} from '@/lib/engine/recurring/detect';
import { summarizeRecurring } from '@/lib/engine/recurring/summary';
import { expandScheduled as expandForecast } from '@/lib/engine/forecast/forecast';
import { expandScheduled as expandCalendar } from '@/lib/engine/calendar/build';
import { assembleCashNeededInput } from '@/lib/engine/cash-needed/assemble';
import { computeSpendingPlan, monthlyRateCents } from '@/lib/engine/spending-plan/plan';
import { buildSeedData } from '@/lib/seed/build';
import { traceSafeToSpend } from '@/lib/engine/glass-box/trace';
import { refreshRecurringForUser } from '@/server/recurring';
import { getSpendingPlan } from '@/server/spending-plan';
import { prisma } from '@/lib/db';

const TODAY = '2026-06-10';
const PREMIUM_DESC = 'ALLSTATE INSURANCE PREMIUM';
const BONUS_DESC = 'ACME ANALYTICS ANNUAL BONUS';

/** Three same-amount charges one clamped year apart — the shape `cadenceFromGap`
 *  reads as ANNUAL (median gap 366 days, inside the 350–380 window). */
function annualSeriesTxns(descriptor: string, amountCents: number, firstDate: string): RecurringTxn[] {
  return [0, 1, 2].map((i) => ({
    id: `${descriptor}-${i}`,
    accountId: 'acct-checking',
    date: addMonthsClamped(isoDate(firstDate), i * 12),
    amountCents,
    rawDescriptor: descriptor,
  }));
}

describe('toScheduledTransactions — the ANNUAL passthrough, both directions (L.23)', () => {
  it('projects a detected annual EXPENSE with cadence ANNUAL on its own dated occurrence', () => {
    const series = detectRecurring(annualSeriesTxns(PREMIUM_DESC, -120000, '2023-08-15'), isoDate(TODAY));
    expect(series).toHaveLength(1);
    expect(series[0].cadence).toBe('ANNUAL');
    expect(series[0].isIncome).toBe(false);
    // Stepped from the last sighting (2025-08-15) to the first date not in the past.
    expect(series[0].nextExpectedAt).toBe('2026-08-15');

    // FAIL-OLD: the pre-L.23 filter kept only W/B/M, so this array was empty.
    const rows = toScheduledTransactions(series, 'acct-checking', isoDate(TODAY));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountId: 'acct-checking',
      amountCents: -120000,
      nextDate: '2026-08-15',
      cadence: 'ANNUAL',
      source: 'recurring',
    });
  });

  it('does NOT project a detected annual INCOME series — the failure direction differs by role', () => {
    const series = detectRecurring(annualSeriesTxns(BONUS_DESC, 500000, '2023-12-15'), isoDate(TODAY));
    expect(series).toHaveLength(1);
    expect(series[0].cadence).toBe('ANNUAL');
    expect(series[0].isIncome).toBe(true);
    // An annual bonus dated from one 365-day gap would offset a projected dip and
    // could silence a warning the reader would act on. Held out on purpose.
    expect(toScheduledTransactions(series, 'acct-checking', isoDate(TODAY))).toEqual([]);
  });

  it('still projects the monthly and biweekly cadences it always did, income included', () => {
    const seed = buildSeedData(TODAY);
    const detected = detectRecurring(
      seed.transactions.filter((t) => t.status === 'POSTED'),
      isoDate(TODAY),
    );
    const rows = toScheduledTransactions(detected, 'acct-checking', isoDate(TODAY));
    expect(rows.some((r) => r.cadence === 'BIWEEKLY' && r.source === 'payroll-detected')).toBe(true);
    expect(rows.some((r) => r.cadence === 'MONTHLY' && r.source === 'recurring')).toBe(true);
    // The demo's own detected set carries NO annual series, so no demo figure
    // moves with this slice — the reason the locks here are synthetic.
    expect(detected.some((s) => s.cadence === 'ANNUAL')).toBe(false);
  });
});

describe('monthlyRateCents — the hand-verified rates of docs/EDGE_CASES.md §Recurring cadence A', () => {
  // GOLDEN LITERALS on purpose. The existing assertions in spending-plan.test.ts
  // write the expectation as `Math.round((10000 * 52) / 12)` — the formula under
  // test, so they cannot fail if the formula changes (the dedup lesson's
  // "f(x,[]) === f(x)" trap). These are the numbers a human checked.
  it('weekly $120.00 → $520.00, biweekly → $260.00, monthly $250.00 → $250.00, annual $1,200.00 → $100.00', () => {
    expect(monthlyRateCents(12000, 'WEEKLY')).toBe(52000);
    expect(monthlyRateCents(12000, 'BIWEEKLY')).toBe(26000);
    expect(monthlyRateCents(25000, 'MONTHLY')).toBe(25000);
    expect(monthlyRateCents(120000, 'ANNUAL')).toBe(10000);
    expect(monthlyRateCents(9999, 'IRREGULAR')).toBe(9999);
    expect(monthlyRateCents(9999, null)).toBe(9999);
  });
});

describe('the three expanders project an ANNUAL row once per sub-year window (L.23)', () => {
  const annualRow = {
    accountId: 'acct-checking',
    description: 'Allstate Insurance Premium',
    amountCents: -120000,
    nextDate: '2026-08-15',
    cadence: 'ANNUAL' as const,
  };

  it('forecast: once inside a 90-day horizon, never inside a 60-day one', () => {
    expect(expandForecast([annualRow], TODAY, 90)).toEqual([
      { date: '2026-08-15', amountCents: -120000, label: 'Allstate Insurance Premium' },
    ]);
    expect(expandForecast([annualRow], TODAY, 60)).toEqual([]);
  });

  it('forecast: once per year across a window longer than a year (fail-old: one occurrence total)', () => {
    // 800 days from 2026-06-10 reaches 2028-08-18, so three August premiums fall inside.
    const events = expandForecast([annualRow], TODAY, 800);
    expect(events.map((e) => e.date)).toEqual(['2026-08-15', '2027-08-15', '2028-08-15']);
  });

  it('calendar: present in its own month, absent from the months around it', () => {
    expect(expandCalendar([annualRow], isoDate('2026-08-01'), isoDate('2026-08-31'))).toEqual([
      { date: '2026-08-15', kind: 'outflow', label: 'Allstate Insurance Premium', amountCents: -120000 },
    ]);
    expect(expandCalendar([annualRow], isoDate('2026-07-01'), isoDate('2026-07-31'))).toEqual([]);
    expect(expandCalendar([annualRow], isoDate('2027-08-01'), isoDate('2027-08-31'))).toHaveLength(1);
  });

  it('calendar: one occurrence per year across a multi-year window (fail-old: one total)', () => {
    const events = expandCalendar([annualRow], isoDate('2026-06-01'), isoDate('2028-12-31'));
    expect(events.map((e) => e.date)).toEqual(['2026-08-15', '2027-08-15', '2028-08-15']);
  });

  it('cash-needed: inside a 90-day horizon once, outside the 60-day default never', () => {
    const seed = buildSeedData(TODAY);
    const params = {
      today: isoDate(TODAY),
      scenario: 'PAY_IN_FULL' as const,
      paymentAccountId: 'acct-checking',
      accounts: seed.accounts,
      autopays: seed.autopays,
      statements: seed.statements,
      cardPayments: seed.cardPayments,
      transactions: seed.transactions,
      scheduled: [{ ...annualRow, id: 'sched-annual', source: 'recurring' }],
      holidayTable: holidayTable(2024, 2029),
    };
    const wide = assembleCashNeededInput({ ...params, horizonDays: 90 });
    expect(wide.scheduled.filter((s) => s.description === annualRow.description)).toHaveLength(1);
    const narrow = assembleCashNeededInput(params);
    expect(narrow.scheduled.filter((s) => s.description === annualRow.description)).toHaveLength(0);

    // The mutation the 90/60-day pair could NOT catch (money critic P2-1,
    // executed: reverting assemble.ts entirely left this file green, because the
    // old catch-all `else` produces both of the assertions above identically).
    // Only a window longer than a year distinguishes the explicit 12-month step,
    // and this is the one of the three expanders that feeds the dashboard hero.
    const multiYear = assembleCashNeededInput({ ...params, horizonDays: 800 });
    expect(
      multiYear.scheduled.filter((s) => s.description === annualRow.description).map((s) => s.date),
    ).toEqual(['2026-08-15', '2027-08-15', '2028-08-15']);
  });
});

describe('a LAPSED annual series is projected nowhere — the two surfaces agree by construction (L.23)', () => {
  // Found independently by BOTH L.23 critics and executed by both: detectRecurring
  // reads all of history with no staleness gate and `nextExpectedAt` steps a
  // dormant anchor forward, so a policy last charged in 2021 detects today with
  // nextExpectedAt next August. Unguarded, /recurring filed it under "no longer
  // charging" at $0/month while the plan counted $100/month forever and the
  // calendar printed a dated −$1,200 for a cancelled policy.
  const lapsed = () => detectRecurring(annualSeriesTxns('LAPSED POLICY', -120000, '2019-08-15'), isoDate(TODAY));

  it('detects, but is filed as no-longer-charging and projected zero times', () => {
    const series = lapsed();
    expect(series).toHaveLength(1);
    expect(series[0].cadence).toBe('ANNUAL');
    expect(series[0].lastSeenAt).toBe('2021-08-15');
    // It still steps its anchor into the future — which is exactly why the gate
    // cannot be "is nextExpectedAt in the future".
    expect(series[0].nextExpectedAt).toBe('2026-08-15');

    const summary = summarizeRecurring(series, TODAY);
    expect(summary.inactive).toHaveLength(1);
    expect(summary.monthlyRecurringSpendCents).toBe(0);
    // FAIL-OLD (of the fix, not of the slice): without the lapse gate this was
    // one row worth $100/month.
    expect(toScheduledTransactions(series, 'acct-checking', isoDate(TODAY))).toEqual([]);
  });

  it('is exactly the /recurring rule, at the cadence-scaled boundary', () => {
    // 365 × 1.5 = 548 days of silence. One day inside it still charges; one day
    // outside it does not — and the same predicate answers for both surfaces.
    const s = { cadence: 'ANNUAL' as const, lastSeenAt: isoDate('2025-01-01') };
    expect(isSeriesActive(s, isoDate('2026-07-03'))).toBe(true); // 548 days
    expect(isSeriesActive(s, isoDate('2026-07-04'))).toBe(false); // 549
    // A monthly bill's silence becomes evidence in ~45 days, not ~18 months —
    // the reason the gate is cadence-scaled rather than one constant.
    expect(isSeriesActive({ cadence: 'MONTHLY', lastSeenAt: isoDate('2026-04-26') }, isoDate('2026-06-10'))).toBe(true);
    expect(isSeriesActive({ cadence: 'MONTHLY', lastSeenAt: isoDate('2026-04-25') }, isoDate('2026-06-10'))).toBe(false);
  });

  it('leaves the WEEKLY/BIWEEKLY/MONTHLY cadences ungated, as they were', () => {
    // The gate is ANNUAL-only on purpose: widening it would change what is
    // projected for every existing user (recorded in docs/STATUS.md). A monthly
    // series silent for a year is still projected — pre-existing, unchanged here.
    const stale: RecurringTxn[] = [0, 1, 2].map((i) => ({
      id: `m${i}`,
      accountId: 'acct-checking',
      date: addMonthsClamped(isoDate('2025-01-15'), i),
      amountCents: -1599,
      rawDescriptor: 'STALE MONTHLY THING',
    }));
    const series = detectRecurring(stale, isoDate(TODAY));
    expect(series[0].cadence).toBe('MONTHLY');
    expect(summarizeRecurring(series, TODAY).inactive).toHaveLength(1);
    expect(toScheduledTransactions(series, 'acct-checking', isoDate(TODAY))).toHaveLength(1);
  });
});

describe('the annual clause speaks only when an annual bill is IN the figure (L.23)', () => {
  // Copy critic P1-2: unconditional, "an annual bill counts 1/12" told every
  // reader their yearly premium was handled — when the detector needs three
  // sightings at a steady price (~2 years) to see one, and never sees a premium
  // that rises each year. This function's own convention, 35 lines above the
  // clause: "a $0 row would name a mechanism that did not act".
  const planWith = (scheduledFixed: { amountCents: number; cadence: string | null }[]) =>
    computeSpendingPlan({
      today: isoDate(TODAY),
      trailingMonthlyIncomeCents: [600000, 600000, 600000],
      scheduledIncome: [],
      scheduledFixed,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
    });

  it('speaks when the term holds an ANNUAL row', () => {
    const basis = traceSafeToSpend(planWith([{ amountCents: -120000, cadence: 'ANNUAL' }])).basis.join(' ');
    expect(basis).toContain('A yearly bill is spread across the year');
    expect(basis).toContain('Nothing is actually moved or set aside for you');
  });

  it('says nothing about yearly bills when the term holds none', () => {
    const basis = traceSafeToSpend(
      planWith([
        { amountCents: -180000, cadence: 'MONTHLY' },
        { amountCents: -12000, cadence: 'WEEKLY' },
      ]),
    ).basis.join(' ');
    expect(basis).not.toContain('yearly');
    expect(basis).not.toContain('twelfth');
    // The rates it DOES explain are the ones in the figure — including biweekly,
    // the largest multiplier in the table and the one the line used to omit (P2-4).
    expect(basis).toContain('a weekly bill counts 52/12 each month, a biweekly one 26/12');
  });

  it('discloses the annual-INCOME exclusion on the one basis that reads detected series', () => {
    // /recurring counts an annual deposit at a twelfth a month; this figure counts
    // $0. Both were described as "detected recurring income at a monthly rate".
    const detectedBasis = traceSafeToSpend(
      computeSpendingPlan({
        today: isoDate(TODAY),
        trailingMonthlyIncomeCents: [],
        scheduledIncome: [{ amountCents: 245000, cadence: 'BIWEEKLY' }],
        scheduledFixed: [],
        cardObligationsCents: 0,
        cardObligationsEstimated: false,
        goalContributionsCents: 0,
        savingsTargetBps: null,
        obligationsBeyondMonthCents: 0,
        obligationsBeyondMonthThroughDate: null,
        obligationsBeyondMonthEstimated: false,
      }),
    ).basis.join(' ');
    expect(detectedBasis).toContain('A deposit that arrives once a year is not counted here');
    // The trailing median needs no such clause — it counted the bonus in the month
    // it actually arrived, so claiming an exclusion there would be false.
    const medianBasis = traceSafeToSpend(planWith([])).basis.join(' ');
    expect(medianBasis).not.toContain('arrives once a year');
  });
});

describe('the cadences that reach nothing at all — pinned, not assumed (L.23)', () => {
  // Pure functions, deliberately outside the server describe below so they do not
  // pay its database setup (copy critic P2-5).
  const everyNDays = (label: string, gapDays: number): RecurringTxn[] =>
    [0, 1, 2, 3].map((i) => ({
      id: `${label}-${i}`,
      accountId: 'acct-checking',
      date: addDays(isoDate('2025-01-15'), i * gapDays),
      amountCents: -30000,
      rawDescriptor: label,
    }));

  it('quarterly, semiannual, bi-monthly, six-weekly and three-weekly bills are all dropped as IRREGULAR', () => {
    // cadenceFromGap recognizes ONLY 5–9, 12–16, 26–35 and 350–380 day gaps, so
    // the reader-facing copy may not enumerate two shapes as if they were the
    // whole set (copy critic P1-3). Every one of these counts $0 everywhere.
    for (const [label, gap] of [
      ['QUARTERLY WATER', 91],
      ['SEMIANNUAL PREMIUM', 182],
      ['BI-MONTHLY BILL', 61],
      ['SIX WEEKLY LAWN', 42],
      ['THREE WEEKLY THING', 21],
      ['TEN DAY THING', 10],
    ] as const) {
      expect(detectRecurring(everyNDays(label, gap), isoDate(TODAY))).toEqual([]);
    }
  });

  it('an annual series needs THREE sightings at a stable amount — two, or a rising price, is nothing', () => {
    // Why the copy may not promise a reader their yearly premium is handled:
    // a premium that rises every year is never detected at all (3 distinct
    // amounts), and three sightings span ~2 years of history.
    const twoSightings = annualSeriesTxns('TWO ONLY', -120000, '2024-08-15').slice(0, 2);
    expect(detectRecurring(twoSightings, isoDate(TODAY))).toEqual([]);
    const rising = annualSeriesTxns('RISING PREMIUM', -110000, '2023-08-15').map((t, i) => ({
      ...t,
      amountCents: [-110000, -115000, -120000][i],
    }));
    expect(detectRecurring(rising, isoDate(TODAY))).toEqual([]);
    // And the span three sightings need, stated as the number it is.
    const three = annualSeriesTxns('STABLE PREMIUM', -120000, '2023-08-15');
    expect(daysBetween(isoDate(three[0].date), isoDate(three[2].date))).toBe(731);
  });
});

describe('the real server path: a detected annual bill reaches the spending plan (L.23)', () => {
  const uid = `annual-${Date.now()}-${process.pid}`;
  let checkingId = '';

  const wipe = async () => {
    await prisma.account.deleteMany({ where: { userId: uid } });
    await prisma.recurringSeries.deleteMany({ where: { userId: uid } });
    await prisma.user.deleteMany({ where: { id: uid } });
  };

  beforeAll(async () => {
    vi.stubEnv('DEMO_TODAY', TODAY);
    await wipe();
    await prisma.user.create({ data: { id: uid, email: `${uid}@test.local` } });
    const chk = await prisma.account.create({
      data: {
        userId: uid,
        provider: 'manual',
        providerRef: `${uid}-chk`,
        name: 'Everyday Checking',
        type: 'CHECKING',
        currentBalanceCents: 800000,
        currency: 'USD',
      },
    });
    checkingId = chk.id;
    await prisma.user.update({ where: { id: uid }, data: { paymentAccountId: checkingId } });

    // A $1,200/yr premium and a $5,000 annual bonus, three sightings each.
    for (const [descriptor, amountCents, first] of [
      [PREMIUM_DESC, -120000, '2023-08-15'],
      [BONUS_DESC, 500000, '2023-12-15'],
    ] as const) {
      const canonical = normalizeMerchant(descriptor).canonical;
      const merchant = await prisma.merchant.upsert({
        where: { canonical },
        create: { canonical, defaultCategoryId: null },
        update: {},
      });
      for (let i = 0; i < 3; i++) {
        await prisma.transaction.create({
          data: {
            accountId: checkingId,
            date: addMonthsClamped(isoDate(first), i * 12),
            amountCents,
            rawDescriptor: descriptor,
            merchantId: merchant.id,
            categoryId: null,
            status: 'POSTED',
          },
        });
      }
    }
    await refreshRecurringForUser(uid, isoDate(TODAY));
  });

  afterAll(async () => {
    await wipe();
    vi.unstubAllEnvs();
  });

  it('persists the annual EXPENSE as a scheduled row and the annual INCOME as none', async () => {
    const rows = await prisma.scheduledTransaction.findMany({
      where: { account: { userId: uid } },
      select: { description: true, amountCents: true, cadence: true, nextDate: true, source: true },
    });
    // FAIL-OLD: no row at all was written for either series.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountCents: -120000, cadence: 'ANNUAL', nextDate: '2026-08-15', source: 'recurring' });
    expect(rows.some((r) => r.source === 'payroll-detected')).toBe(false);
  });

  it("counts it at 1/12 in the plan's fixed-expense term — $100.00 of a $1,200.00 premium", async () => {
    const plan = await getSpendingPlan(uid);
    // FAIL-OLD: 0. The premium reached no surface that projects money.
    expect(plan.fixedExpensesCents).toBe(10000);
    // And it is a real subtraction, not a display: the guilt-free figure moved by it.
    expect(plan.leftToSpendCents).toBe(
      plan.patternIncomeCents -
        (10000 + plan.cardObligationsCents + plan.obligationsBeyondMonthCents + plan.plannedSavingsCents),
    );
  });

  it("the audit panel's basis describes the coverage the figure now has, and no longer claims a user can enter one", async () => {
    const plan = await getSpendingPlan(uid);
    const basis = traceSafeToSpend(plan).basis.join(' ');
    // FAIL-OLD: the shipped line read "An annual bill entered by you counts 1/12;
    // a DETECTED annual bill is not projected yet" — one clause describing a
    // capability no code path offers, one describing a gap now closed.
    expect(basis).not.toContain('entered by you');
    expect(basis).not.toContain('not projected yet');
    // This reader HAS an annual bill in the term, so the clause speaks — and it
    // discloses the direction the smoothing misleads in.
    expect(basis).toContain('this figure subtracts a twelfth of it every month');
    expect(basis).toContain('the whole amount goes out while this figure only ever counted a twelfth');
    // It may NOT claim the money was set aside: nothing is carried forward, and
    // "set aside" already names the L.11(D) reservation on this same page.
    expect(basis).not.toContain('is set aside every month');
  });

  it('leaves a QUARTERLY bill counted zero times — the recorded remaining gap', async () => {
    // ~91-day gaps classify as IRREGULAR in cadenceFromGap, and detectRecurring
    // drops IRREGULAR before the projection filter is reached. If this ever
    // starts detecting, the gap in docs/STATUS.md is closed and this test says so.
    const quarterly: RecurringTxn[] = [0, 1, 2, 3].map((i) => ({
      id: `q${i}`,
      accountId: 'acct-checking',
      date: addMonthsClamped(isoDate('2025-06-15'), i * 3),
      amountCents: -30000,
      rawDescriptor: 'CITY WATER QUARTERLY',
    }));
    expect(detectRecurring(quarterly, isoDate(TODAY))).toEqual([]);
  });
});
