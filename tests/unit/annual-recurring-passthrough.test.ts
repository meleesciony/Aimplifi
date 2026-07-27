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
 * L.24 CLOSED HALF OF WHAT THIS FILE PINNED AS OPEN. Quarterly (84–98 days) and
 * semiannual (175–190) are now recognized cadences, projected under the same two
 * conditions as annual — expenses only, and only while still charging. The pins
 * below were written so that "the day either changes this file says so", and
 * that day was L.24: the two tests that asserted `[]` for a quarterly and a
 * semiannual series now assert the cadence, the projected row and the monthly
 * rate instead. STILL open and still pinned here (docs/STATUS.md): bi-monthly
 * (~61 days), six-weekly, three-weekly and ten-day rhythms, plus everything from
 * 99–174, 191–349 and 381+ days, all still IRREGULAR and all still counted zero
 * times; and the ~2-year/steady-price precondition an annual series needs.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { addDays, addMonthsClamped, daysBetween, holidayTable, isoDate } from '@/lib/dates';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import {
  detectRecurring,
  isSeriesActive,
  toScheduledTransactions,
  type RecurringSeriesResult,
  type RecurringTxn,
} from '@/lib/engine/recurring/detect';
import { summarizeRecurring } from '@/lib/engine/recurring/summary';
import { expandScheduled as expandForecast } from '@/lib/engine/forecast/forecast';
import { expandScheduled as expandCalendar } from '@/lib/engine/calendar/build';
import { assembleCashNeededInput } from '@/lib/engine/cash-needed/assemble';
import {
  LONG_CADENCE_WORDS,
  computeSpendingPlan,
  longCadencesInTerm,
  monthlyRateCents,
  type LongCadence,
} from '@/lib/engine/spending-plan/plan';
import { buildSeedData } from '@/lib/seed/build';
import { traceSafeToSpend } from '@/lib/engine/glass-box/trace';
import { refreshRecurringForUser } from '@/server/recurring';
import { getSpendingPlan } from '@/server/spending-plan';
import { prisma } from '@/lib/db';

const TODAY = '2026-06-10';
const PREMIUM_DESC = 'ALLSTATE INSURANCE PREMIUM';
const BONUS_DESC = 'ACME ANALYTICS ANNUAL BONUS';

/** A detected-series shape whose non-cadence fields are irrelevant to the rate
 *  under test — every rate assertion overrides cadence, amount and lastSeenAt. */
const seriesShape = {
  merchantCanonical: 'Anything',
  categoryId: 'utilities',
  cadence: 'MONTHLY',
  typicalAmountCents: -1000,
  lastAmountCents: -1000,
  previousAmountCents: null,
  priceChangedAt: null,
  lastSeenAt: isoDate(TODAY),
  nextExpectedAt: isoDate(TODAY),
  occurrences: 3,
  isSubscription: false,
  isIncome: false,
  possiblyUnused: false,
  accountId: 'acct-checking',
} satisfies RecurringSeriesResult;

/** Three same-amount charges one clamped year apart — the shape `cadenceFromGaps`
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
    const rows = toScheduledTransactions(series, { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking']) }, isoDate(TODAY));
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
    expect(toScheduledTransactions(series, { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking']) }, isoDate(TODAY))).toEqual([]);
  });

  it('still projects the monthly and biweekly cadences it always did, income included', () => {
    const seed = buildSeedData(TODAY);
    const detected = detectRecurring(
      seed.transactions.filter((t) => t.status === 'POSTED'),
      isoDate(TODAY),
    );
    const rows = toScheduledTransactions(detected, { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking']) }, isoDate(TODAY));
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

  it('L.24 rates: quarterly $300.00 → $100.00, semiannual $600.00 → $100.00', () => {
    expect(monthlyRateCents(30000, 'QUARTERLY')).toBe(10000);
    expect(monthlyRateCents(60000, 'SEMIANNUAL')).toBe(10000);
    // Half-up rounding, named at the call site, on a figure that does not divide.
    expect(monthlyRateCents(10000, 'QUARTERLY')).toBe(3333);
    expect(monthlyRateCents(10001, 'SEMIANNUAL')).toBe(1667);
  });

  it('the plan and /recurring agree on every recognized cadence — two tables, one fact', () => {
    // The L.23 defect in miniature: `monthlyRateCents` (the plan) and PER_MONTH
    // (summarizeRecurring, /recurring's headline) encode the same per-month
    // factors in two files. They are deliberately NOT shared — they disagree
    // about IRREGULAR and the plan keeps an exact integer form — so this lock is
    // what stops them drifting the way the two annual surfaces once did.
    // FUZZED over residues, not spot-checked on divisible amounts (L.24 money
    // critic P2-2): the first version of this lock used -12000/-25000/-30000/
    // -60000/-120000, every one of which divides its factor exactly, so it
    // asserted a property that was FALSE for BIWEEKLY at 120,989 amounts under
    // $20k and passed regardless. $999.99 biweekly was $2,166.65 in the plan and
    // $2,166.64 on /recurring; $2,307.69 — a $60k salary — was a cent apart too.
    const amounts = [1, 3, 27, 99, 999, 4501, 99999, 100001, 216665, 230769, 999999, 1234567];
    for (const cadence of ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'] as const) {
      for (const magnitude of amounts) {
        const viaPlan = monthlyRateCents(magnitude, cadence);
        const [item] = summarizeRecurring(
          [{ ...seriesShape, cadence, typicalAmountCents: -magnitude, lastSeenAt: isoDate(TODAY) }],
          isoDate(TODAY),
        ).items;
        expect(`${cadence}@${magnitude}:${item?.monthlyEquivalentCents}`).toBe(
          `${cadence}@${magnitude}:${viaPlan}`,
        );
      }
    }
    // The two exact cases the critic executed, as literals.
    expect(monthlyRateCents(99999, 'BIWEEKLY')).toBe(216665);
    expect(monthlyRateCents(230769, 'BIWEEKLY')).toBe(500000);
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

describe('L.24 — the every-gap licence a QUARTERLY/SEMIANNUAL classification must earn', () => {
  const gapsToTxns = (label: string, gaps: readonly number[]): RecurringTxn[] => {
    let date = isoDate('2024-01-10');
    const out: RecurringTxn[] = [
      { id: `${label}-0`, accountId: 'acct-checking', date, amountCents: -30000, rawDescriptor: label },
    ];
    gaps.forEach((g, i) => {
      date = addDays(date, g);
      out.push({ id: `${label}-${i + 1}`, accountId: 'acct-checking', date, amountCents: -30000, rawDescriptor: label });
    });
    return out;
  };
  const cadenceOf = (label: string, gaps: readonly number[]) =>
    detectRecurring(gapsToTxns(label, gaps), isoDate(TODAY))[0]?.cadence ?? null;

  it('a real quarterly rhythm is QUARTERLY; a real semiannual one is SEMIANNUAL', () => {
    // Calendar-quarter billing drifts 89–92 days by month length alone.
    expect(cadenceOf('CITY WATER', [91, 89, 92])).toBe('QUARTERLY');
    // Band-edge gaps are fine INDIVIDUALLY; what they may not do is disagree
    // with each other by more than a week (see the spread-cap test below —
    // [84, 98, 91] was accepted before the money critic broke it).
    expect(cadenceOf('CITY WATER EDGE', [84, 90, 91])).toBe('QUARTERLY');
    expect(cadenceOf('CITY WATER EDGE 2', [84, 98, 91])).toBe(null);
    expect(cadenceOf('TERM LIFE', [182, 181, 184])).toBe('SEMIANNUAL');
  });

  it('two wild gaps whose MEDIAN lands in the band are NOT a quarterly bill (fail-old: median-only said they were)', () => {
    // The whole reason the licence exists. With three sightings there are two
    // gaps and their median is their mean, so 30 and 150 days average to 90.
    // Same amount every time, so the amount-stability filter does not save us.
    expect(cadenceOf('COINCIDENCE', [30, 150])).toBe(null);
    expect(cadenceOf('COINCIDENCE 2', [10, 172])).toBe(null);
    expect(cadenceOf('HALF YEAR COINCIDENCE', [90, 274])).toBe(null);
  });

  it('two gaps that merely sit INSIDE the band are not a rhythm (fail-old: the money critic broke this)', () => {
    // The smallest counterexample to band-membership-alone, and the one that
    // matters: the quarterly band is 15 days wide, so three haircuts 84 and 98
    // days apart put BOTH gaps inside it. Every-gap passed them; a discretionary
    // purchase became a projected bill with a date on the calendar.
    expect(cadenceOf('BARBER SHOP', [84, 98])).toBe(null);
    expect(cadenceOf('BARBER SHOP REVERSED', [98, 84])).toBe(null);
    expect(cadenceOf('TERM LIFE WIDE', [175, 190])).toBe(null);
    // …including through the two-plateau price-change path, which admits a,a,b
    // at exactly three sightings (the critic's vet-visit repro).
    const vet: RecurringTxn[] = [
      ['2025-06-15', -10000],
      ['2025-09-07', -10000],
      ['2025-12-14', -25000],
    ].map(([date, amountCents], i) => ({
      id: `vet${i}`,
      accountId: 'acct-checking',
      date: isoDate(date as string),
      amountCents: amountCents as number,
      rawDescriptor: 'VET CLINIC',
    }));
    expect(detectRecurring(vet, isoDate(TODAY))).toEqual([]);
  });

  it('real-world quarterly anchors still detect — the spread cap costs no genuine bill', () => {
    // Every one of these was executed against a real calendar by the money
    // critic: their gaps cluster within 3 days, far inside the 7-day cap.
    expect(cadenceOf('CALENDAR QUARTER', [90, 91, 92])).toBe('QUARTERLY');
    expect(cadenceOf('MONTH END WATER', [89, 92, 92, 92])).toBe('QUARTERLY');
    expect(cadenceOf('FIRST BUSINESS DAY', [90, 92, 91])).toBe('QUARTERLY');
    expect(cadenceOf('SEMI REAL', [181, 184, 182])).toBe('SEMIANNUAL');
  });

  it('one late cycle drops the series rather than inventing a rhythm — strictness is the safe direction', () => {
    // A gap outside the band means the reader gets the STATUS QUO (an uncounted
    // bill), where a false positive would put a dated outflow on /calendar and
    // could raise a radar "move $X by <date>" for a bill that does not exist.
    expect(cadenceOf('LATE ONCE', [91, 91, 120])).toBe(null);
  });

  it('the four existing cadences keep the median-only rule — this slice does not re-detect anybody', () => {
    // Deliberate asymmetry: raising the bar for WEEKLY/BIWEEKLY/MONTHLY/ANNUAL
    // would change what is detected for every existing user. A monthly series
    // with one skipped month still reads MONTHLY, exactly as it did before L.24.
    expect(cadenceOf('MONTHLY WITH A SKIP', [30, 61, 30])).toBe('MONTHLY');
    expect(cadenceOf('WEEKLY WITH A SKIP', [7, 14, 7])).toBe('WEEKLY');
  });
});

describe('L.24 — a QUARTERLY row recurs inside the windows the app actually uses', () => {
  const quarterlyRow = {
    accountId: 'acct-checking',
    description: 'City Water',
    amountCents: -30000,
    nextDate: '2026-06-15',
    cadence: 'QUARTERLY' as const,
  };

  // WHERE THE EXPLICIT STEP ACTUALLY DIFFERS, measured rather than assumed. A
  // quarterly PERIOD is 91–92 days, which is LONGER than the 90-day horizon that
  // is the widest this app forecasts — so inside forecast/cash-needed a
  // quarterly row still has at most one occurrence, exactly like annual, and the
  // 90-day assertions alone would pass on the pre-L.24 code. (The first draft of
  // this file claimed the opposite in three source comments; the executed test
  // is what corrected them.) The two reachable differences are the calendar's
  // multi-month windows and a stale anchor self-healing forward.
  const cashNeeded = (horizonDays: number, row: typeof quarterlyRow) => {
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
      scheduled: [{ ...row, id: 'sched-quarterly', source: 'recurring' }],
      holidayTable: holidayTable(2024, 2029),
      horizonDays,
    };
    return assembleCashNeededInput(params)
      .scheduled.filter((s) => s.description === 'City Water')
      .map((s) => s.date);
  };

  it('calendar: on the grid three months later, absent from the two months between (fail-old: absent from both later months)', () => {
    // The sharpest of the three: `month` is a URL query param with prev/next
    // links, so this is three clicks away, not a hypothetical window.
    expect(expandCalendar([quarterlyRow], isoDate('2026-07-01'), isoDate('2026-08-31'))).toEqual([]);
    expect(expandCalendar([quarterlyRow], isoDate('2026-09-01'), isoDate('2026-09-30')).map((e) => e.date)).toEqual([
      '2026-09-15',
    ]);
    expect(expandCalendar([quarterlyRow], isoDate('2026-12-01'), isoDate('2026-12-31'))).toHaveLength(1);
  });

  it('forecast and cash-needed: every quarter across a window longer than one (fail-old: one occurrence total)', () => {
    const expected = ['2026-06-15', '2026-09-15', '2026-12-15', '2027-03-15', '2027-06-15'];
    expect(expandForecast([quarterlyRow], TODAY, 400).map((e) => e.date)).toEqual(expected);
    expect(cashNeeded(400, quarterlyRow)).toEqual(expected);
  });

  it('a stale anchor self-heals forward into a 90-day window (fail-old: dropped entirely)', () => {
    // The difference that IS reachable at the horizons the app really uses, and
    // the realistic one: the row is written once and `today` moves past it.
    const stale = { ...quarterlyRow, nextDate: '2026-01-15' };
    expect(expandForecast([stale], TODAY, 90).map((e) => e.date)).toEqual(['2026-07-15']);
    expect(cashNeeded(90, stale)).toEqual(['2026-07-15']);
  });

  it('inside a 90-day horizon a quarterly row appears ONCE — the honest bound', () => {
    expect(expandForecast([quarterlyRow], TODAY, 90).map((e) => e.date)).toEqual(['2026-06-15']);
    expect(cashNeeded(90, quarterlyRow)).toEqual(['2026-06-15']);
  });
});

describe('L.24 — the long-cadence rules apply to the two new cadences, not just to ANNUAL', () => {
  const base = { ...seriesShape, accountId: 'acct-checking' };

  it('a quarterly/semiannual INCOME series is projected nowhere (the L.14 role asymmetry)', () => {
    for (const cadence of ['QUARTERLY', 'SEMIANNUAL', 'ANNUAL'] as const) {
      const income = { ...base, cadence, isIncome: true, typicalAmountCents: 500000 };
      expect(toScheduledTransactions([income], { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking']) }, isoDate(TODAY))).toEqual([]);
    }
  });

  it('a LAPSED quarterly/semiannual expense is projected nowhere, at each cadence’s own cutoff', () => {
    // isSeriesActive scales with the cadence: ~137 days for quarterly, ~273 for
    // semiannual. Silence long enough to be evidence at one rhythm is routine at
    // another, which is why the cutoff cannot be a single constant.
    const lapsedQuarterly = { ...base, cadence: 'QUARTERLY' as const, lastSeenAt: isoDate('2025-06-10') };
    expect(toScheduledTransactions([lapsedQuarterly], { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking']) }, isoDate(TODAY))).toEqual([]);
    expect(isSeriesActive(lapsedQuarterly, isoDate(TODAY))).toBe(false);
    // …while the SAME 365-day silence leaves a semiannual series still charging.
    const quietSemiannual = { ...base, cadence: 'SEMIANNUAL' as const, lastSeenAt: isoDate('2026-03-10') };
    expect(isSeriesActive(quietSemiannual, isoDate(TODAY))).toBe(true);
    expect(toScheduledTransactions([quietSemiannual], { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking']) }, isoDate(TODAY))).toHaveLength(1);
  });

  it('the fraction the copy names is the fraction the engine divides by', () => {
    // A wrong word here is a false claim about the reader's money, and it is the
    // kind that no arithmetic test catches: the plan could take a twelfth while
    // the sentence says "a third" and every money assertion would still pass.
    for (const [cadence, share, whole] of [
      ['QUARTERLY', 'a third', 3],
      ['SEMIANNUAL', 'a sixth', 6],
      ['ANNUAL', 'a twelfth', 12],
    ] as const) {
      expect(LONG_CADENCE_WORDS[cadence].share).toBe(share);
      // $1,200.00 at this cadence must be exactly 1/whole per month.
      expect(monthlyRateCents(120000, cadence)).toBe(120000 / whole);
    }
  });

  it('the rendered smoothing sentences are plural-safe and keep the ANNUAL wording byte-identical', () => {
    // L.24 copy critic P1-4 + P2-1: the generalization lifted ANNUAL's "in THE
    // MONTH the bill leaves your account", which is right once a year and wrong
    // four times a year — and NOTHING in the suite bound these strings, so the
    // whole family could drift silently. It is bound here now.
    const sentence = (c: LongCadence) =>
      `A ${LONG_CADENCE_WORDS[c].adjective} bill is spread across the ${LONG_CADENCE_WORDS[c].period}: this figure subtracts ${LONG_CADENCE_WORDS[c].share} of it every month. Nothing is actually moved or set aside for you — ${LONG_CADENCE_WORDS[c].landing} the whole amount goes out while this figure only ever counted ${LONG_CADENCE_WORDS[c].share}, so ${LONG_CADENCE_WORDS[c].planLine}.`;

    // The L.23 copy critic's exact wording, as a literal, not as the template.
    expect(sentence('ANNUAL')).toBe(
      'A yearly bill is spread across the year: this figure subtracts a twelfth of it every month. Nothing is actually moved or set aside for you — in the month the bill leaves your account the whole amount goes out while this figure only ever counted a twelfth, so that month needs its own plan.',
    );
    // A quarterly bill lands FOUR times a year; the sentence must not say "the month".
    expect(sentence('QUARTERLY')).toContain('in each of the four months a year the bill actually lands');
    expect(sentence('QUARTERLY')).toContain('those four months need their own plan');
    expect(sentence('SEMIANNUAL')).toContain('in each of the two months a year the bill actually lands');
    for (const c of ['QUARTERLY', 'SEMIANNUAL'] as const) {
      expect(LONG_CADENCE_WORDS[c].cardLanding).toContain('months a year');
      // The singular that was wrong may not survive anywhere on the short surfaces.
      expect(LONG_CADENCE_WORDS[c].cardLanding.startsWith('the month')).toBe(false);
    }
    expect(LONG_CADENCE_WORDS.ANNUAL.cardLanding).toBe('the month it actually leaves your account');
  });

  it('the disclosure speaks only for the rhythms actually in the term', () => {
    const rows = [{ cadence: 'MONTHLY' }, { cadence: 'QUARTERLY' }, { cadence: null }];
    expect(longCadencesInTerm(rows)).toEqual(['QUARTERLY']);
    expect(longCadencesInTerm([{ cadence: 'MONTHLY' }])).toEqual([]);
    // Shortest first, so a reader with several reads them in a sensible order.
    expect(
      longCadencesInTerm([{ cadence: 'ANNUAL' }, { cadence: 'SEMIANNUAL' }, { cadence: 'QUARTERLY' }]),
    ).toEqual(['QUARTERLY', 'SEMIANNUAL', 'ANNUAL']);
  });

  it('the demo seed detects NO quarterly or semiannual series, so no demo golden moves', () => {
    // The probe that gated this slice, kept as a lock. Four seed merchants have a
    // median gap inside the new bands (Costco Gas 89, Zelle Payment 91, Etsy 86,
    // Kroger 97) and all four are variable-amount spending killed by the existing
    // amount-stability filter — the exact shape the false-positive risk takes.
    const seed = buildSeedData(TODAY);
    const detected = detectRecurring(
      seed.transactions.map((t) => ({
        id: t.id,
        accountId: t.accountId,
        date: t.date,
        amountCents: t.amountCents,
        rawDescriptor: t.rawDescriptor ?? '',
      })),
      isoDate(TODAY),
    );
    expect(detected.filter((s) => s.cadence === 'QUARTERLY' || s.cadence === 'SEMIANNUAL')).toEqual([]);
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
    expect(toScheduledTransactions(series, { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking']) }, isoDate(TODAY))).toEqual([]);
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
    expect(toScheduledTransactions(series, { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking']) }, isoDate(TODAY))).toHaveLength(1);
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
    // L.24 widened this from "arrives once a year" to the whole long-cadence
    // family: `LONG_CADENCES` excludes quarterly and semiannual INCOME too, and
    // /recurring renders those at 1/3 and 1/6 a month, so a clause naming only
    // the yearly case left the two new asymmetries undisclosed (copy critic P1-3).
    expect(detectedBasis).toContain(
      'A deposit on a rhythm longer than monthly — quarterly, twice a year, or yearly — is not counted here',
    );
    expect(detectedBasis).toContain('Your recurring list shows such a deposit at a share of a month');
    // The trailing median needs no such clause — it counted the bonus in the month
    // it actually arrived, so claiming an exclusion there would be false.
    const medianBasis = traceSafeToSpend(planWith([])).basis.join(' ');
    expect(medianBasis).not.toContain('rhythm longer than monthly');
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

  it('quarterly and semiannual are now RECOGNIZED (L.24); bi-monthly, six-weekly, three-weekly and ten-day are still dropped', () => {
    // L.24 added two bands: 84–98 → QUARTERLY, 175–190 → SEMIANNUAL. The rest of
    // the dropped set is unchanged and still counts $0 everywhere, so the
    // reader-facing copy may not enumerate the gap as closed (copy critic P1-3
    // was written about exactly this list).
    for (const [label, gap, expected] of [
      ['QUARTERLY WATER', 91, 'QUARTERLY'],
      ['SEMIANNUAL PREMIUM', 182, 'SEMIANNUAL'],
    ] as const) {
      const [series] = detectRecurring(everyNDays(label, gap), isoDate(TODAY));
      expect(series?.cadence).toBe(expected);
    }
    for (const [label, gap] of [
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

  it('a QUARTERLY bill is detected and projected at a third a month (L.24 closed the recorded gap)', async () => {
    // Was: counted zero times, because ~91-day gaps classified as IRREGULAR and
    // detectRecurring dropped them before the projection filter. L.24 added the
    // band, so the same fixture that asserted `[]` now has to state the money.
    const quarterly: RecurringTxn[] = [0, 1, 2, 3].map((i) => ({
      id: `q${i}`,
      accountId: 'acct-checking',
      date: addMonthsClamped(isoDate('2025-06-15'), i * 3),
      amountCents: -30000,
      rawDescriptor: 'CITY WATER QUARTERLY',
    }));
    const [series] = detectRecurring(quarterly, isoDate(TODAY));
    expect(series?.cadence).toBe('QUARTERLY');
    // It reaches the projection as an EXPENSE on a cash account (here the payment
    // account; since L.25 any CHECKING/SAVINGS would do)…
    const rows = toScheduledTransactions([series!], { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking']) }, isoDate(TODAY));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cadence).toBe('QUARTERLY');
    // …and the plan charges a third of it every month: $300.00 / 3 = $100.00.
    expect(monthlyRateCents(30000, 'QUARTERLY')).toBe(10000);
    // /recurring normalizes the SAME series to the same figure — the agreement
    // by construction that L.23 was built to guarantee for annual.
    const summary = summarizeRecurring([series!], isoDate(TODAY));
    expect(summary.items[0]?.monthlyEquivalentCents).toBe(10000);
  });
});
describe('the real server path: a detected QUARTERLY bill reaches the spending plan (L.24)', () => {
  // L.24 money critic P2-4: the slice asserted the quarterly passthrough with
  // PURE functions only, inside a describe whose name promised the server path.
  // A pure test cannot catch a wiring bug (the L.15 lesson), and this cadence
  // travels the same four hops the annual one does: detectRecurring ->
  // refreshRecurringForUser -> ScheduledTransaction -> snapshot -> getSpendingPlan.
  const uid = `quarterly-${Date.now()}-${process.pid}`;
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

    // A $300/quarter water bill (four sightings, 3 clamped months apart) and a
    // $600 twice-a-year term-life premium (three sightings, 6 months apart).
    for (const [descriptor, amountCents, first, stepMonths, count] of [
      ['CITY WATER QUARTERLY', -30000, '2025-06-15', 3, 4],
      ['TERM LIFE SEMIANNUAL', -60000, '2024-09-20', 6, 3],
    ] as const) {
      const canonical = normalizeMerchant(descriptor).canonical;
      const merchant = await prisma.merchant.upsert({
        where: { canonical },
        create: { canonical, defaultCategoryId: null },
        update: {},
      });
      for (let i = 0; i < count; i++) {
        await prisma.transaction.create({
          data: {
            accountId: checkingId,
            date: addMonthsClamped(isoDate(first), i * stepMonths),
            amountCents,
            rawDescriptor: descriptor,
            merchantId: merchant.id,
            status: 'POSTED',
          },
        });
      }
    }
    await refreshRecurringForUser(uid, isoDate(TODAY));
  }, 60_000);

  afterAll(async () => {
    await wipe();
    vi.unstubAllEnvs();
  });

  it('persists both as ScheduledTransaction rows with their own cadences', async () => {
    const rows = await prisma.scheduledTransaction.findMany({
      where: { accountId: checkingId },
      select: { description: true, amountCents: true, cadence: true, nextDate: true, source: true },
      orderBy: { description: 'asc' },
    });
    expect(rows).toEqual([
      {
        description: 'City Water Quarterly',
        amountCents: -30000,
        cadence: 'QUARTERLY',
        nextDate: '2026-06-15',
        source: 'recurring',
      },
      {
        description: 'Term Life Semiannual',
        amountCents: -60000,
        cadence: 'SEMIANNUAL',
        nextDate: '2026-09-20',
        source: 'recurring',
      },
    ]);
  });

  it('the plan charges a third and a sixth a month — FAIL-OLD: fixedExpensesCents was 0', async () => {
    const plan = await getSpendingPlan(uid);
    // $300/3 = $100.00, $600/6 = $100.00.
    expect(plan.fixedExpensesCents).toBe(20000);
    expect(plan.scheduledFixed.map((s) => s.cadence).sort()).toEqual(['QUARTERLY', 'SEMIANNUAL']);
  });
});
