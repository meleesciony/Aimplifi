/**
 * Regular pay plans the month — ONLY when steady paychecks clearly explain the
 * household's recent pay; otherwise the plan keeps the old median (DECISIONS
 * #784/#785, owner's simplification 2026-10-04 after five critic cycles; cycle
 * 6 added "held one level" and "paid without a break"). Every amount and payer
 * is invented (keep-live-figures-out-of-repo). Hand-verified values:
 * tests/edge-cases/regular-pay-plans-the-month.md.
 */
import { describe, expect, it } from 'vitest';
import { addDays, isoDate, type ISODate } from '@/lib/dates';
import type { TxnLike } from '@/lib/engine/fi/insights';
import {
  payFrequencyFromDates,
  regularPayFromRows,
} from '@/lib/engine/spending-plan/regular-pay';

// Window on 2026-10-03: Jul, Aug, Sep 2026 (starts Jul 1).
const TODAY = isoDate('2026-10-03');
const PAYROLL = 'NORTHWIND HEALTH PAYROLL PPD';

function dep(date: string, dollars: number, over: Partial<TxnLike> = {}): TxnLike {
  return {
    id: `${date}-${dollars}-${over.rawDescriptor ?? PAYROLL}-${over.categoryId ?? 'paycheck'}`,
    date,
    amountCents: Math.round(dollars * 100),
    rawDescriptor: PAYROLL,
    categoryId: 'paycheck',
    status: 'POSTED',
    isTransfer: false,
    isSplitParent: false,
    ...over,
  } as TxnLike;
}

const FRIDAYS = ['2026-06-12', '2026-06-26', '2026-07-10', '2026-07-24', '2026-08-07', '2026-08-21', '2026-09-04', '2026-09-18', '2026-10-02'];
// Biweekly Fridays since June: one paycheck before a raise (outside the last
// eight), then eight at the new level drifting by a cent.
const BIWEEKLY: TxnLike[] = [4210.55, 4512.3, 4512.31, 4512.3, 4512.31, 4512.3, 4512.3, 4512.31, 4512.3].map((x, i) =>
  dep(FRIDAYS[i]!, x),
);
const SEMIMONTHLY_DATES = ['2026-06-15', '2026-06-30', '2026-07-15', '2026-07-31', '2026-08-14', '2026-08-31', '2026-09-15', '2026-09-30'];
const d = (...xs: string[]) => xs.map((x) => isoDate(x)) as ISODate[];
/** `n` paydays every `step` days from `first`. */
const run = (first: string, n: number, step: number) => Array.from({ length: n }, (_, i) => addDays(isoDate(first), step * i) as string);

describe('payFrequencyFromDates', () => {
  it('reads each rhythm', () => {
    expect(payFrequencyFromDates(d('2026-09-11', '2026-09-18', '2026-09-25', '2026-10-02'))).toBe('weekly');
    expect(payFrequencyFromDates(d(...run('2026-07-10', 9, 14)))).toBe('biweekly');
    expect(payFrequencyFromDates(d(...SEMIMONTHLY_DATES))).toBe('semimonthly');
    expect(payFrequencyFromDates(d('2026-07-01', '2026-07-31', '2026-09-01', '2026-10-01'))).toBe('monthly');
  });

  it('test_regression__twice_a_month_pay_is_not_read_as_every_two_weeks', () => {
    // Critic cycles 1–3 (executed): mean interval, then weekday share, then six
    // deposits each let a twice-a-month payroll read as 26 a year.
    expect(
      payFrequencyFromDates(d('2025-12-01', '2025-12-15', '2026-01-01', '2026-01-15', '2026-01-30', '2026-02-13', '2026-02-27', '2026-03-13')),
    ).toBe('semimonthly');
    expect(
      payFrequencyFromDates(d('2024-08-30', '2024-09-13', '2024-10-01', '2024-10-15', '2024-11-01', '2024-11-15', '2024-11-29', '2024-12-13')),
    ).toBe('semimonthly');
    expect(payFrequencyFromDates(d('2025-12-31', '2026-01-15', '2026-01-30', '2026-02-13', '2026-02-27', '2026-03-13'))).toBe('semimonthly');
    expect(payFrequencyFromDates(d('2026-08-21', '2026-09-04', '2026-09-18', '2026-10-02', '2026-10-16', '2026-10-30'))).toBe('semimonthly');
  });

  it('test_regression__a_2nd_and_4th_friday_payroll_is_not_read_as_every_two_weeks', () => {
    // Critic cycle 7, P2-2 (executed: read 26 a year, +8.3%): the 2nd and 4th
    // Fridays of Jan–May 2026. Its last eight paydays (Feb 13 … May 22) sit on an
    // exact 14-day grid; only the ninth and tenth (Jan 9, Jan 23 → Feb 13 is 21
    // days) show it is twice a month. Nine paydays on the grid are required.
    const fridays = d('2026-01-09', '2026-01-23', '2026-02-13', '2026-02-27', '2026-03-13', '2026-03-27', '2026-04-10', '2026-04-24', '2026-05-08', '2026-05-22');
    expect(payFrequencyFromDates(fridays.slice(-8))).toBe('semimonthly');
    expect(payFrequencyFromDates(fridays)).toBe('semimonthly');
    const pay = regularPayFromRows(fridays.map((x) => dep(x, 3000)), isoDate('2026-06-01'));
    expect(pay.streams[0]).toMatchObject({ frequency: 'semimonthly', monthlyCents: 600000 });
  });

  it('a biweekly payroll with one holiday shift is still biweekly; broken runs have no rhythm', () => {
    expect(
      payFrequencyFromDates(d('2026-05-29', '2026-06-12', '2026-06-26', '2026-07-10', '2026-07-24', '2026-08-07', '2026-08-21', '2026-09-03', '2026-09-18')),
    ).toBe('biweekly');
    expect(payFrequencyFromDates(d('2026-09-18', '2026-10-02'))).toBeNull();
    expect(payFrequencyFromDates(d('2026-07-02', '2026-07-29', '2026-08-05', '2026-09-19'))).toBeNull();
    expect(payFrequencyFromDates(d('2026-08-07', '2026-08-21', '2026-09-18', '2026-10-02'))).toBeNull();
  });
});

describe('the clean case — steady paychecks explain the household', () => {
  it('test_regression__a_biweekly_paycheck_that_drifts_by_a_cent_is_regular_pay', () => {
    // The shipped recurring detector requires identical income amounts and finds
    // NO series here; the plan fell back to a median that drops 3-paycheck months.
    const pay = regularPayFromRows(BIWEEKLY, TODAY);
    expect(pay).toMatchObject({ clean: true, fallback: null, streamsMonthlyCents: 977665, otherMonthlyCents: 0, monthlyCents: 977665 });
    expect(pay.streams[0]).toMatchObject({ frequency: 'biweekly', paycheckCents: 451230, firstPaidOn: '2026-06-12', lastPaidOn: '2026-10-02' });
  });

  it('inside the 2% band a raise reaches the figure late and a cut at once', () => {
    // $3,000.00 then $3,050.00 (+1.67%) on the last three paydays: median of the
    // eight $3,000.00, newest $3,050.00 → $3,000.00 → $6,500.00.
    const raise = FRIDAYS.map((x, i) => dep(x, i < 6 ? 3000 : 3050));
    expect(regularPayFromRows(raise, TODAY)).toMatchObject({ clean: true, monthlyCents: 650000 });
    // $3,000.00 then $2,950.00 (−1.67%) on Oct 2 only: never more than the newest
    // → $2,950.00 × 26 ÷ 12 = $6,391.67.
    const cut = FRIDAYS.map((x, i) => dep(x, i < 8 ? 3000 : 2950));
    expect(regularPayFromRows(cut, TODAY)).toMatchObject({ clean: true, monthlyCents: 639167 });
  });

  it('twice a month is 24 a year; weekly 52; monthly 12', () => {
    expect(regularPayFromRows(SEMIMONTHLY_DATES.map((x) => dep(x, 3000)), TODAY).monthlyCents).toBe(600000);
    // $812.40 × 52 ÷ 12 = $3,520.40.
    expect(regularPayFromRows(run('2026-06-05', 18, 7).map((x) => dep(x, 812.4)), TODAY).monthlyCents).toBe(352040);
    const monthly = ['2026-06-01', '2026-07-01', '2026-07-31', '2026-09-01', '2026-10-01'];
    expect(regularPayFromRows(monthly.map((x) => dep(x, 5200)), TODAY).monthlyCents).toBe(520000);
  });

  it('a small usual remainder rides along: fund distributions filed Income', () => {
    const fund = ['2026-06-15', '2026-07-15', '2026-08-14', '2026-09-15'].map((x) =>
      dep(x, 268.4, { rawDescriptor: 'GREYSTONE REALTY FUND DIST PPD', categoryId: 'income' }),
    );
    // $268.40 ≤ 10% of two paychecks ($902.46) → $9,776.65 + $268.40 = $10,045.05.
    expect(regularPayFromRows([...BIWEEKLY, ...fund], TODAY)).toMatchObject({ clean: true, otherMonthlyCents: 26840, monthlyCents: 1004505 });
    // Alone — no paycheck payer at all — there is no regular pay.
    expect(regularPayFromRows(fund, TODAY)).toMatchObject({ clean: false, fallback: 'no-steady-paycheck', monthlyCents: 0 });
  });

  it('a bonus never plans the month — filed Bonus, folded into a payday, or paid off-cycle through payroll', () => {
    const filed = ['2026-08-14', '2026-09-11'].map((x) => dep(x, 20000, { rawDescriptor: 'NORTHWIND HEALTH BONUS', categoryId: 'bonus' }));
    expect(regularPayFromRows([...BIWEEKLY, ...filed], TODAY)).toMatchObject({ clean: true, monthlyCents: 977665 });
    // Folded into the Sep 4 payday (one deposit of $13,512.30): the date keeps the
    // rhythm (critic cycle 5, P2-B), the amount is not a paycheck; that month's
    // extra is "other" for one month of three, so the median is $0.00.
    const folded = BIWEEKLY.map((t) => (t.date === '2026-09-04' ? { ...t, amountCents: 1351230 } : t));
    expect(regularPayFromRows(folded, TODAY)).toMatchObject({ clean: true, otherMonthlyCents: 0, monthlyCents: 977665 });
    // Paid off-cycle on Sep 30 through the same payroll.
    expect(regularPayFromRows([...BIWEEKLY, dep('2026-09-30', 13500)], TODAY)).toMatchObject({ clean: true, monthlyCents: 977665 });
  });

  it('two deposits on one payday from one payer are one paycheck', () => {
    // Critic cycle 5, P1-A(e): a paycheck split across two accounts, or two earners
    // at one employer — the median gap was 0 and the payer flipped in and out.
    const split = FRIDAYS.flatMap((x) => [dep(x, 1500), dep(x, 1000)]);
    // $2,500 × 26 ÷ 12 = $5,416.67.
    expect(regularPayFromRows(split, TODAY)).toMatchObject({ clean: true, monthlyCents: 541667 });
  });

  it('a payroll deposit still filed under generic Income counts with its payer (#385)', () => {
    const mixed = BIWEEKLY.map((t, i) => (i % 2 === 0 ? t : { ...t, categoryId: 'income' }));
    expect(regularPayFromRows(mixed, TODAY)).toMatchObject({ clean: true, monthlyCents: 977665 });
  });

  it('a bonus on the newest payday holds the median for one pay period, then regular pay returns', () => {
    const bonusLast = BIWEEKLY.map((t) => (t.date === '2026-10-02' ? { ...t, amountCents: 1351230 } : t));
    expect(regularPayFromRows(bonusLast, TODAY)).toMatchObject({ clean: false, fallback: 'pay-changed' });
    // Oct 16 brings an ordinary paycheck: the Oct 2 payday is now in the middle
    // and outside the Jul–Sep window → $9,776.65 again.
    expect(regularPayFromRows([...bonusLast, dep('2026-10-16', 4512.3)], isoDate('2026-10-17'))).toMatchObject({ clean: true, monthlyCents: 977665 });
  });

  it('pending, transfer-flagged, excluded and outflow rows never count', () => {
    const noise = [
      dep('2026-09-25', 4512.3, { status: 'PENDING' }),
      dep('2026-09-26', 4512.3, { isTransfer: true }),
      dep('2026-09-27', 4512.3, { excludeFromTotals: true } as Partial<TxnLike>),
      dep('2026-09-28', -4512.3),
    ];
    expect(regularPayFromRows([...BIWEEKLY, ...noise], TODAY).monthlyCents).toBe(977665);
  });

  it('a mobile-banking deposit is money moved in, never pay — even when one was filed Paycheck', () => {
    // Critic cycle 6, P3-4. Filed Income, the descriptor marks it untouchable;
    // the one filed Paycheck is a single date (no rhythm) and July's "other"
    // only → median $0.00.
    const mobile = ['2026-06-15', '2026-07-15', '2026-08-14', '2026-09-15'].map((x) =>
      dep(x, 3000, { rawDescriptor: 'DEPOSIT MOBILE BANKING', categoryId: x === '2026-07-15' ? 'paycheck' : 'income' }),
    );
    expect(regularPayFromRows([...BIWEEKLY, ...mobile], TODAY)).toMatchObject({ clean: true, streams: [{ payerCanonical: expect.any(String) }], monthlyCents: 977665 });
  });

  it('a small payroll row on an off day (a reimbursement) is not a payday and does not break the rhythm', () => {
    // $45.00 on Sep 10 is under half the typical payday; as a payday it would put a
    // 6-day gap in the rhythm. It is "other" for September only → median $0.00.
    expect(regularPayFromRows([...BIWEEKLY, dep('2026-09-10', 45)], TODAY)).toMatchObject({ clean: true, monthlyCents: 977665 });
  });

  it('a paycheck that doubled recently is not yet the payer’s typical payday — no steady paycheck', () => {
    // Ten biweekly $1,000.00 then seven $2,000.00 (to Oct 2): the typical payday is
    // still $1,000.00, so only one of the last eight is a paycheck-sized day.
    const doubled = run('2026-02-20', 17, 14).map((x, i) => dep(x, i < 10 ? 1000 : 2000));
    expect(doubled[16]!.date).toBe('2026-10-02');
    expect(regularPayFromRows(doubled, TODAY)).toMatchObject({ clean: false, fallback: 'no-steady-paycheck', monthlyCents: 0 });
  });
});

describe('every messy case keeps the old median — fail closed', () => {
  const OLD = 'OLDCO INDUSTRIES PAYROLL';
  const NEW = 'NEWCO LABS PAYROLL';

  it('test_regression__a_job_change_keeps_the_median_until_the_new_job_fills_the_window', () => {
    // Critic cycles 1–5 found a new way for a modelled job change to double-count
    // each time. Now: a new paycheck inside the window is not yet "clear".
    const old = ['2026-03-31', '2026-04-30', '2026-05-29', '2026-06-30'].map((x) => dep(x, 7000, { rawDescriptor: OLD }));
    const fresh = run('2026-06-26', 8, 14).map((x) => dep(x, 3500, { rawDescriptor: NEW }));
    const at = (today: string) => regularPayFromRows([...old, ...fresh].filter((t) => t.date <= today), isoDate(today));
    // Aug 21 (window May–Jul): the new job began inside it.
    expect(at('2026-08-21')).toMatchObject({ clean: false, fallback: 'new-paycheck', monthlyCents: 0 });
    // Oct 3 (window Jul–Sep): the new job paid since before Jul 1, the old one
    // stopped before it — clear. Eight paydays are not yet nine on the grid, so
    // it counts 24 a year (low): $3,500 × 24 ÷ 12 = $7,000.00, nothing else.
    expect(at('2026-10-03')).toMatchObject({ clean: true, otherMonthlyCents: 0, monthlyCents: 700000 });
  });

  it('test_regression__a_seasonal_job_that_restarted_inside_the_window_is_new', () => {
    // Critic cycle 6, P2-1 (executed: clean against a median near $2,700): weekly
    // last season Nov 7 – Mar 27, again from Jul 3 (fourteen paydays — the last
    // ten show a clean weekly rhythm). The unbroken run starts Jul 3, inside the
    // window; its first-ever payday does not count.
    const season = [...run('2025-11-07', 21, 7), ...run('2026-07-03', 14, 7)].map((x) => dep(x, 975));
    const pay = regularPayFromRows(season, TODAY);
    expect(pay).toMatchObject({ clean: false, fallback: 'new-paycheck', monthlyCents: 0 });
    expect(pay.streams[0]).toMatchObject({ frequency: 'weekly', firstPaidOn: '2026-07-03' });
  });

  it('test_regression__a_second_steady_paycheck_keeps_the_median', () => {
    // Critic cycle 7, P1-1 (executed: clean at $18,383.33 against a true
    // $17,983.33): $8,000.00 biweekly + a monthly stipend raised $400.00 → $650.00
    // in June. The stipend's raised paydays sat above 1.5× its typical one, so its
    // old $400.00 stayed a "stream" AND each $650.00 counted whole as other income.
    // One steady paycheck only: a second one keeps the median.
    const main = run('2025-06-06', 35, 14).map((x) => dep(x, 8000));
    const stipend = Array.from({ length: 17 }, (_, i) => {
      const date = `${i < 7 ? 2025 : 2026}-${String(((5 + i) % 12) + 1).padStart(2, '0')}-01`;
      return dep(date, date < '2026-06-01' ? 400 : 650, { rawDescriptor: 'CITY PARKS STIPEND' });
    });
    expect(stipend[0]!.date).toBe('2025-06-01');
    expect(stipend[16]!.date).toBe('2026-10-01');
    expect(main[34]!.date).toBe('2026-09-25');
    expect(regularPayFromRows([...main, ...stipend], TODAY)).toMatchObject({ clean: false, fallback: 'second-paycheck', monthlyCents: 0 });
    // Two steady payrolls that both predate the window: the same.
    const second = SEMIMONTHLY_DATES.map((x) => dep(x, 3000, { rawDescriptor: 'LAKESIDE SCHOOLS DIR DEP' }));
    const two = regularPayFromRows([...second, ...BIWEEKLY], TODAY);
    expect(two.streams.map((s) => s.monthlyCents)).toEqual([977665, 600000]);
    expect(two).toMatchObject({ clean: false, fallback: 'second-paycheck', monthlyCents: 0 });
  });

  it('test_regression__a_newest_payday_far_from_the_usual_paycheck_is_a_pay_change', () => {
    // Critic cycle 7, P1-1 D: $2,000.00 biweekly, then a 55% raise on the newest
    // payday — above 1.5× the usual one, so the 2% test never saw it and the plan
    // read the old level beside a sentence promising the median.
    const raised = run('2025-10-03', 27, 14).map((x, i) => dep(x, i < 26 ? 2000 : 3100));
    expect(raised[26]!.date).toBe('2026-10-02');
    expect(regularPayFromRows(raised, TODAY)).toMatchObject({ clean: false, fallback: 'pay-changed', monthlyCents: 0 });
    // Critic cycle 7, P2-1 (executed: clean at $8,666.67 until the payroll went
    // stale): $4,000.00 biweekly, then $1,800.00 on Oct 2 — under half a paycheck,
    // so not a payday, arriving when one was due.
    const cut = [...run('2025-10-03', 26, 14).map((x) => dep(x, 4000)), dep('2026-10-02', 1800)];
    expect(regularPayFromRows(cut, TODAY)).toMatchObject({ clean: false, fallback: 'pay-changed', monthlyCents: 0 });
  });

  it('test_regression__a_paycheck_that_moved_more_than_2_percent_keeps_the_median', () => {
    // Critic cycle 6, P1-1 / P1-2 (executed): the lower of two medians planned a
    // paycheck that had stepped back down at its overtime level, and a raise read
    // clean beside a sentence promising the median.
    const atBase = (amounts: number[]) => regularPayFromRows(FRIDAYS.map((x, i) => dep(x, amounts[i]!)), TODAY);
    // Five $3,700.00 overtime checks of eight, then $3,000.00 again (was $8,016.67).
    expect(atBase([3000, 3000, 3000, 3700, 3700, 3700, 3700, 3700, 3000])).toMatchObject({ clean: false, fallback: 'pay-changed', monthlyCents: 0 });
    // Overtime still running.
    expect(atBase([3000, 3000, 3000, 3000, 3000, 3000, 3700, 3700, 3700]).fallback).toBe('pay-changed');
    // A cut to $2,500.00 on Oct 2 (was $6,500.00).
    expect(atBase([3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 2500]).fallback).toBe('pay-changed');
    // A 3% raise from Aug 7, and the raise with transition amounts.
    expect(atBase([3000, 3000, 3000, 3000, 3090, 3090, 3090, 3090, 3090]).fallback).toBe('pay-changed');
    expect(atBase([4210.55, 4233.1, 4486.2, 4501.75, 4512.31, 4512.3, 4512.3, 4512.31, 4512.3]).fallback).toBe('pay-changed');
    // Weekly hourly pay: six $980.00 overtime weeks then $800.00 (was $4,246.67).
    const weekly = run('2026-08-14', 8, 7).map((x, i) => dep(x, i >= 1 && i <= 6 ? 980 : 800));
    expect(regularPayFromRows([...run('2026-06-05', 10, 7).map((x) => dep(x, 800)), ...weekly], TODAY).fallback).toBe('pay-changed');
    // An alternating paycheck (benefits taken from one check a month) is not one
    // level either — for twice-a-month pay the median is exact.
    expect(regularPayFromRows(SEMIMONTHLY_DATES.map((x, i) => dep(x, i % 2 === 0 ? 2800 : 3200)), TODAY).fallback).toBe('pay-changed');
  });

  it('a steady payroll that stopped inside the window keeps the median', () => {
    const old = FRIDAYS.slice(0, 5).map((x) => dep(x, 3000, { rawDescriptor: OLD })); // last Aug 7
    const still = SEMIMONTHLY_DATES.map((x) => dep(x, 3000, { rawDescriptor: 'LAKESIDE SCHOOLS DIR DEP' }));
    expect(regularPayFromRows([...old, ...still], TODAY)).toMatchObject({ clean: false, fallback: 'paycheck-stopped', monthlyCents: 0 });
    // A single payroll that stopped: no steady paycheck at all.
    expect(regularPayFromRows(BIWEEKLY.slice(0, 7), TODAY)).toMatchObject({ clean: false, fallback: 'no-steady-paycheck' });
  });

  it('a pension, a spouse’s salary or an hourly second job beside a paycheck keeps the median', () => {
    // Critic cycle 1, P1-1 / cycle 3, P2-C / cycle 5, P1-A(d): composition modelled
    // these and kept getting them wrong. Each is more than 10% of the paychecks.
    const pension = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'].map((x) =>
      dep(x, 3000, { rawDescriptor: 'STATE RETIREMENT SYSTEM PENSION', categoryId: 'income' }),
    );
    expect(regularPayFromRows([...BIWEEKLY, ...pension], TODAY)).toMatchObject({ clean: false, fallback: 'other-income', monthlyCents: 0 });
    const hourly = run('2026-06-05', 9, 14).map((x, i) =>
      dep(x, [1800, 2600, 2100, 2500, 1900, 2400, 2200, 2000, 2300][i]!, { rawDescriptor: 'HARBORVIEW HOURLY PAYROLL' }),
    );
    expect(regularPayFromRows([...BIWEEKLY, ...hourly], TODAY)).toMatchObject({ clean: false, fallback: 'other-income' });
  });

  it('the 10% is of a usual month’s paychecks, not the yearly average', () => {
    // Critic cycle 6, P3-1: $3,000.00 biweekly — two paychecks $6,000.00 (10% =
    // $600.00), yearly average $6,500.00. Other income $640.00 → keeps the median.
    const pay = FRIDAYS.map((x) => dep(x, 3000));
    const other = ['2026-07-15', '2026-08-14', '2026-09-15'].map((x) => dep(x, 640, { rawDescriptor: 'CEDAR LANE RENTAL', categoryId: 'income' }));
    expect(regularPayFromRows([...pay, ...other], TODAY)).toMatchObject({ clean: false, fallback: 'other-income', otherMonthlyCents: 64000 });
  });

  it('extra pay riding on a payday every month (a commission) is not a paycheck — the median plans it', () => {
    // A payroll's own out-of-band paydays are "everything else" (condition 5):
    // +$9,000.00 on Jul 24, Aug 21 and Sep 18 → other income median $13,512.30.
    const extra = new Set(['2026-07-24', '2026-08-21', '2026-09-18']);
    const commission = BIWEEKLY.map((t) => (extra.has(t.date) ? { ...t, amountCents: t.amountCents + 900000 } : t));
    expect(regularPayFromRows(commission, TODAY)).toMatchObject({
      clean: false,
      fallback: 'other-income',
      streamsMonthlyCents: 977665,
      otherMonthlyCents: 1351230,
      monthlyCents: 0,
    });
  });

  it('a new second job or side gig keeps the median', () => {
    const gig = run('2026-09-04', 5, 7).map((x) => dep(x, 400, { rawDescriptor: 'TASKRABBIT PAYOUT', categoryId: 'side-income' }));
    expect(regularPayFromRows([...BIWEEKLY, ...gig], TODAY)).toMatchObject({ clean: false, fallback: 'second-paycheck', monthlyCents: 0 });
  });

  it('two earners alternating weeks on one payroll name, or a big raise mid-window, keep the median', () => {
    const alternating = run('2026-06-05', 18, 7).map((x, i) => dep(x, i % 2 === 0 ? 3000 : 1800, { rawDescriptor: 'DIRECT DEPOSIT PAYROLL' }));
    expect(regularPayFromRows(alternating, TODAY)).toMatchObject({ clean: false, monthlyCents: 0 });
    // Part-time $1,000 → full-time $2,400 from Jul 10 (critic cycle 5, P1-A(b)).
    const raise = FRIDAYS.map((x) => dep(x, x < '2026-07-10' ? 1000 : 2400));
    expect(regularPayFromRows(raise, TODAY).monthlyCents).toBe(0);
  });
});

describe('boundaries pinned (critic cycle 8)', () => {
  /** Pay on the given days of every month from March through September, plus Oct 1. */
  const monthDays = (days: number[]) => [
    ...['03', '04', '05', '06', '07', '08', '09'].flatMap((m) => days.map((x) => `2026-${m}-${String(x).padStart(2, '0')}`)),
    '2026-10-01',
  ];

  it('test_regression__four_fixed_dates_a_month_is_not_weekly_pay', () => {
    // P2-1 (executed: clean at $4,333.33 against a true $4,000.00): $1,000.00 on
    // the 1st, 8th, 15th and 22nd is 48 a year, not 52 — off a 7-day grid at every
    // month boundary.
    const fourDates = monthDays([1, 8, 15, 22]).map((x) => dep(x, 1000, { rawDescriptor: 'BRIGHTPATH STAFFING PAYROLL' }));
    expect(payFrequencyFromDates(d(...fourDates.slice(-10).map((t) => t.date)))).toBeNull();
    expect(regularPayFromRows(fourDates, TODAY)).toMatchObject({ clean: false, fallback: 'no-steady-paycheck', monthlyCents: 0 });
    // Two earners under one generic payroll name, one paid the 1st/15th and one
    // the 7th/22nd (executed: clean at $8,666.67 against a true $8,000.00).
    const interleaved = monthDays([1, 7, 15, 22]).map((x) => dep(x, 2000, { rawDescriptor: 'DIRECT DEPOSIT PAYROLL' }));
    expect(regularPayFromRows(interleaved, TODAY)).toMatchObject({ clean: false, monthlyCents: 0 });
    // A true weekly payroll a holiday moved by one day stays weekly; by two, it
    // has no rhythm (fail closed).
    const weekly = run('2026-07-31', 10, 7);
    expect(payFrequencyFromDates(d(...weekly.map((x) => (x === '2026-09-04' ? '2026-09-03' : x))))).toBe('weekly');
    expect(payFrequencyFromDates(d(...weekly.map((x) => (x === '2026-09-04' ? '2026-09-02' : x))))).toBeNull();
  });

  it('the 10% is of a usual month: four weekly paychecks, one monthly — and exactly 10% still reads clean', () => {
    const weekly = run('2026-05-01', 23, 7).map((x) => dep(x, 1000));
    const other = (dollars: number) =>
      ['2026-07-15', '2026-08-14', '2026-09-15'].map((x) => dep(x, dollars, { rawDescriptor: 'CEDAR LANE RENTAL', categoryId: 'income' }));
    // Four $1,000.00 paychecks → 10% = $400.00: $450.00 keeps the median.
    expect(regularPayFromRows([...weekly, ...other(450)], TODAY)).toMatchObject({ clean: false, fallback: 'other-income' });
    // Exactly $400.00 is not MORE than 10% → $1,000 × 52 ÷ 12 = $4,333.33 + $400.00.
    expect(regularPayFromRows([...weekly, ...other(400)], TODAY)).toMatchObject({ clean: true, monthlyCents: 473333 });
    // One $5,000.00 monthly paycheck → 10% = $500.00: $550.00 keeps the median.
    const monthly = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-07-31', '2026-09-01', '2026-10-01'].map((x) => dep(x, 5000));
    expect(regularPayFromRows([...monthly, ...other(550)], TODAY)).toMatchObject({ clean: false, fallback: 'other-income' });
    // Biweekly $3,000.00 → two paychecks, 10% = $600.00: exactly $600.00 is clean,
    // $600.01 is not.
    const biweekly = FRIDAYS.map((x) => dep(x, 3000));
    expect(regularPayFromRows([...biweekly, ...other(600)], TODAY)).toMatchObject({ clean: true, monthlyCents: 710000 });
    expect(regularPayFromRows([...biweekly, ...other(600.01)], TODAY)).toMatchObject({ clean: false, fallback: 'other-income' });
  });

  it('exactly 2% is one level; a cent more is a pay change', () => {
    // Last eight: four $3,060.00 then four $3,000.00 → 306,000 × 100 = 300,000 ×
    // 102 → held; median $3,030.00, newest $3,000.00 → $3,000.00 → $6,500.00.
    const at = (high: number) => regularPayFromRows(FRIDAYS.map((x, i) => dep(x, i >= 1 && i <= 4 ? high : 3000)), TODAY);
    expect(at(3060)).toMatchObject({ clean: true, monthlyCents: 650000 });
    expect(at(3060.01)).toMatchObject({ clean: false, fallback: 'pay-changed' });
  });

  it('a first payday ON the window start is new; the day before is not', () => {
    // Seven paydays → read 24 a year: $3,000 × 24 ÷ 12 = $6,000.00.
    expect(regularPayFromRows(run('2026-07-01', 7, 14).map((x) => dep(x, 3000)), TODAY)).toMatchObject({ clean: false, fallback: 'new-paycheck' });
    expect(regularPayFromRows(run('2026-06-30', 7, 14).map((x) => dep(x, 3000)), TODAY)).toMatchObject({ clean: true, monthlyCents: 600000 });
  });

  it('a biweekly payroll is still arriving 19 days after its newest payday, not 20', () => {
    expect(regularPayFromRows(run('2026-01-19', 18, 14).map((x) => dep(x, 3000)), TODAY)).toMatchObject({ clean: true, monthlyCents: 650000 });
    expect(regularPayFromRows(run('2026-01-18', 18, 14).map((x) => dep(x, 3000)), TODAY)).toMatchObject({ clean: false, fallback: 'no-steady-paycheck' });
  });

  it('a three-week pause inside the window breaks the run', () => {
    // Weekly $975.00 Mar 6 … Jul 10, then Jul 31 … Oct 2: the 21-day gap is more
    // than 1.5 periods → the run starts Jul 31, inside the window.
    const paused = [...run('2026-03-06', 19, 7), ...run('2026-07-31', 10, 7)].map((x) => dep(x, 975));
    expect(regularPayFromRows(paused, TODAY)).toMatchObject({ clean: false, fallback: 'new-paycheck' });
  });

  it('test_regression__a_partial_final_check_off_cycle_is_a_pay_change', () => {
    // P3-1 (executed: clean at $8,666.67 until the payroll went stale): $4,000.00
    // biweekly through Sep 4, then $1,800.00 on Sep 10 — six days later, under
    // half a paycheck. Any deposit from the payroll after its newest payday that
    // is not a payday holds the median.
    const lastCheck = [...run('2025-10-03', 25, 14).map((x) => dep(x, 4000)), dep('2026-09-10', 1800)];
    expect(lastCheck[24]!.date).toBe('2026-09-04');
    expect(regularPayFromRows(lastCheck, isoDate('2026-09-11'))).toMatchObject({ clean: false, fallback: 'pay-changed', monthlyCents: 0 });
  });
});
