/**
 * Money Signature known answers (AI plan §Later #11 reworked / DECISIONS #252).
 * Every expected value is hand-verified in docs/EDGE_CASES.md §Money Signature
 * (cases S1–S5, H1–H5, D1–D6, W1–W10) — the test names carry the case ids.
 */
import { describe, expect, it } from 'vitest';
import {
  computeMoneySignature,
  resolveConfirmedLabel,
  type AxisLabel,
} from '@/lib/engine/fi/signature';
import { isIncomeFlowRow, monthlyFlows, type MonthlyFlow } from '@/lib/engine/fi/insights';
import { buildSeedData } from '@/lib/seed/build';
import { isoDate } from '@/lib/dates';
import { cents } from '@/lib/money';

function flow(
  month: string,
  income: number,
  expenses: number,
  savingsRateBps: number | null,
): MonthlyFlow {
  return { month, incomeCents: cents(income), expensesCents: cents(expenses), savingsRateBps };
}

/** Months of identical income/expenses whose RATES are the series under test. */
function rateSeries(rates: (number | null)[], startYm = '2025-01'): MonthlyFlow[] {
  const [y0, m0] = startYm.split('-').map(Number) as [number, number];
  return rates.map((r, i) => {
    const total = y0 * 12 + (m0 - 1) + i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    // income 0 ⇒ rate null (matches monthlyFlows semantics for null months)
    return flow(`${y}-${String(m).padStart(2, '0')}`, r === null ? 0 : 500000, 400000, r);
  });
}

/** Months of fixed positive rate whose EXPENSES are the series under test. */
function expenseSeries(expenses: number[], startYm = '2025-01'): MonthlyFlow[] {
  const flows = rateSeries(expenses.map(() => 100), startYm);
  return flows.map((f, i) => ({ ...f, expensesCents: cents(expenses[i]!) }));
}

/**
 * Default today = the 15th of the month AFTER the last flow, so every provided
 * month is FULL and there are no trailing gap months (trailing gaps are real
 * $0/null months since the critic P2-2 fix — tested explicitly below).
 */
function afterSeries(flows: MonthlyFlow[]): ReturnType<typeof isoDate> {
  const last = flows[flows.length - 1]!.month;
  const [y, m] = last.split('-').map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return isoDate(`${ny}-${String(nm).padStart(2, '0')}-15`);
}
const sig = (flows: MonthlyFlow[], runwayMonths = 6) =>
  computeMoneySignature(flows, {
    runwayMonths,
    today: flows.length ? afterSeries(flows) : isoDate('2026-12-15'),
  });

// ── Axis 1: saving habit ────────────────────────────────────────────────────

describe('saving habit axis', () => {
  it('S1: six saved months initialize steady with share 10000', () => {
    const s = sig(rateSeries([500, 300, 1200, 800, 100, 900]));
    expect(s.savingHabit).toEqual({
      label: 'steady',
      sinceMonth: '2025-06',
      savedMonths: 6,
      eligibleMonths: 6,
      shareBps: 10000,
      latestContrary: false,
    });
  });

  it('S2: dead-zone hover never flips (share 10000 → 6666, zero flips)', () => {
    const rates = [
      ...Array.from({ length: 8 }, () => 100),
      ...[-100, 100, -100, 100, -100, 100, -100, 100],
    ];
    const s = sig(rateSeries(rates));
    expect(s.savingHabit.label).toBe('steady');
    expect(s.savingHabit.sinceMonth).toBe('2025-06'); // never re-established
    expect(s.savingHabit.shareBps).toBe(6666); // m16 window: 8/12
    expect(s.savingHabit.savedMonths).toBe(8);
    expect(s.savingHabit.eligibleMonths).toBe(12);
  });

  it('S3: a real regime change flips exactly once, at the 3rd contrary month', () => {
    const rates = [
      ...Array.from({ length: 8 }, () => 100),
      ...Array.from({ length: 12 }, () => -100),
    ];
    const s = sig(rateSeries(rates));
    expect(s.savingHabit.label).toBe('variable');
    // m14 (5000) run 1, m15 (4166) run 2, m16 (3333) run 3 → flip at m16 = 2026-04
    expect(s.savingHabit.sinceMonth).toBe('2026-04');
  });

  it('S4: null-rate months are invisible to the window (init at 6th ELIGIBLE month)', () => {
    const s = sig(rateSeries([100, null, 100, null, 100, 100, 100, 100]));
    expect(s.savingHabit.label).toBe('steady');
    expect(s.savingHabit.sinceMonth).toBe('2025-08'); // m8 is the 6th eligible
    expect(s.savingHabit.eligibleMonths).toBe(6);
  });

  it('S5: five eligible months stay forming (facts still reported)', () => {
    const s = sig(rateSeries([100, 100, 100, 100, 100]));
    expect(s.savingHabit).toEqual({
      label: null,
      sinceMonth: null,
      savedMonths: 5,
      eligibleMonths: 5,
      shareBps: null,
      latestContrary: false,
    });
  });

  it('test_regression__signature-lag-contrary (critic P1-1): a contrary latest band is flagged', () => {
    // 8 saved months then 7 unsaved: the confirmed label is still steady (the
    // S3 flip lands at the 3rd contrary RAW, which needs one more month), but
    // the latest window is 5/12 = 4166 bps — INSIDE the variable band. The
    // unqualified "steady" copy would be false; latestContrary must be true so
    // the card renders the lag-honest variant.
    const s = sig(rateSeries([...Array.from({ length: 8 }, () => 100), ...Array.from({ length: 7 }, () => -100)]));
    expect(s.savingHabit.label).toBe('steady');
    expect(s.savingHabit.shareBps).toBe(4166);
    expect(s.savingHabit.latestContrary).toBe(true);
    // S2's dead-zone hover must NOT flag: mid-band is not a contrary signal.
    const hover = sig(
      rateSeries([...Array.from({ length: 8 }, () => 100), ...[-100, 100, -100, 100, -100, 100, -100, 100]]),
    );
    expect(hover.savingHabit.latestContrary).toBe(false);
  });
});

// ── Hysteresis walk ─────────────────────────────────────────────────────────

describe('resolveConfirmedLabel', () => {
  const L = (raws: (AxisLabel | null)[]) => resolveConfirmedLabel(raws);

  it('H1: first non-null raw initializes immediately', () => {
    expect(L(['steady', 'steady', 'steady'])).toEqual({ label: 'steady', sinceIndex: 0 });
  });

  it('H2: leading nulls stay forming until first signal', () => {
    expect(L([null, null, 'variable'])).toEqual({ label: 'variable', sinceIndex: 2 });
  });

  it('H3: a dead-zone month resets the contrary run', () => {
    const raws: (AxisLabel | null)[] = [
      'steady', 'variable', 'variable', null, 'variable', 'variable', 'variable',
    ];
    expect(L(raws)).toEqual({ label: 'variable', sinceIndex: 6 });
    expect(L(raws.slice(0, 6))).toEqual({ label: 'steady', sinceIndex: 0 });
  });

  it('H4: a same-label raw resets the contrary run', () => {
    const raws: (AxisLabel | null)[] = [
      'steady', 'variable', 'variable', 'steady', 'variable', 'variable', 'variable',
    ];
    expect(L(raws)).toEqual({ label: 'variable', sinceIndex: 6 });
  });

  it('H5: all null stays forming', () => {
    expect(L([null, null, null])).toEqual({ label: null, sinceIndex: null });
  });
});

// ── Axis 2: spending steadiness ─────────────────────────────────────────────

describe('spending steadiness axis', () => {
  it('D1: constant expenses → spread 0, steady', () => {
    const s = sig(expenseSeries(Array.from({ length: 6 }, () => 300000)));
    expect(s.spendingSteadiness).toEqual({
      label: 'steady',
      sinceMonth: '2025-06',
      spreadBps: 0,
      latestContrary: false,
      hasFullWindow: true,
    });
  });

  it('D2: alternating 2000/4000 → med 300000, mad 100000, spread 3333, variable', () => {
    const s = sig(expenseSeries([200000, 400000, 200000, 400000, 200000, 400000]));
    expect(s.spendingSteadiness.label).toBe('variable');
    expect(s.spendingSteadiness.spreadBps).toBe(3333);
  });

  it('D3: mild wiggle → mad 5000 on med 300000 → spread 166, steady', () => {
    const s = sig(expenseSeries([300000, 310000, 290000, 305000, 295000, 300000]));
    expect(s.spendingSteadiness.label).toBe('steady');
    expect(s.spendingSteadiness.spreadBps).toBe(166);
  });

  it('D4: mad 60000 on med 300000 → spread 2000, dead zone (no signal, label null)', () => {
    const s = sig(expenseSeries([300000, 360000, 240000, 370000, 230000, 300000]));
    expect(s.spendingSteadiness).toEqual({
      label: null,
      sinceMonth: null,
      spreadBps: 2000,
      latestContrary: false,
      hasFullWindow: true,
    });
  });

  it('D5: zero-median window produces no signal', () => {
    const s = sig(expenseSeries([0, 0, 0, 0, 0, 0]));
    expect(s.spendingSteadiness).toEqual({
      label: null,
      sinceMonth: null,
      spreadBps: null,
      latestContrary: false,
      hasFullWindow: true,
    });
  });

  it('D6: five full months stay forming (hasFullWindow false)', () => {
    const s = sig(expenseSeries([300000, 300000, 300000, 300000, 300000]));
    expect(s.spendingSteadiness).toEqual({
      label: null,
      sinceMonth: null,
      spreadBps: null,
      latestContrary: false,
      hasFullWindow: false,
    });
  });

  it('test_regression__signature-lag-contrary-steadiness (critic P1-1): steady label, variable latest band', () => {
    // 8 constant months (steady confirmed at m6), then 900k/300k alternating.
    // Windows m9–m12 keep median 300000 with ≤2 spike months → mad 0 → steady
    // raws; m13 and m14 windows are 3×300000/3×900000 → med 600000, mad 300000
    // → spread 5000 (variable band) — contrary run 2 of 3, label still steady.
    const s = sig(
      expenseSeries([
        ...Array.from({ length: 8 }, () => 300000),
        900000, 300000, 900000, 300000, 900000, 300000,
      ]),
    );
    expect(s.spendingSteadiness.label).toBe('steady');
    expect(s.spendingSteadiness.spreadBps).toBe(5000);
    expect(s.spendingSteadiness.latestContrary).toBe(true);
  });

  it('test_regression__signature-unreadable-window (critic P2-1): null spread with abundant history', () => {
    // 12 real constant months, then today jumps 6 months ahead: the trailing
    // gap materializes as $0 months, the latest window's median is 0 → no
    // spread — but hasFullWindow must be TRUE so the UI never claims "needs 6
    // full months of history" at a user with 17 full months on record.
    const s = computeMoneySignature(expenseSeries(Array.from({ length: 12 }, () => 300000)), {
      runwayMonths: 6,
      today: isoDate('2026-06-15'),
    });
    expect(s.spendingSteadiness.spreadBps).toBeNull();
    expect(s.spendingSteadiness.hasFullWindow).toBe(true);
    expect(s.spendingSteadiness.label).toBe('steady'); // confirmed label persists
  });
});

// ── Weather ─────────────────────────────────────────────────────────────────

describe('weather', () => {
  const sixCalm = rateSeries([100, 200, 300, 250, 150, 200]); // latest 200 < best 300

  it('W1: runway 0.9 is strained regardless of the rate', () => {
    expect(sig(rateSeries([100, 200, 300, 250, 150, 3000]), 0.9).weather.state).toBe('strained');
  });

  it('W2: runway 2.9 is tight', () => {
    expect(sig(sixCalm, 2.9).weather.state).toBe('tight');
  });

  it('W3: a negative latest month with a big cushion is tight, not strained', () => {
    expect(sig(rateSeries([100, 200, 300, 250, 150, -500]), 12).weather.state).toBe('tight');
  });

  it('W4: a personal-best latest month with cushion is bright', () => {
    const s = sig(rateSeries([100, 200, 300, 250, 150, 900]), 6);
    expect(s.weather.state).toBe('bright');
    expect(s.weather.latestMonth).toBe('2025-06');
    expect(s.weather.latestRateBps).toBe(900);
  });

  it('W5: an ordinary positive month is calm', () => {
    expect(sig(sixCalm, 6).weather.state).toBe('calm');
  });

  it('W6: a trivial early "personal best" (3 eligible months) is calm, axes forming', () => {
    const s = sig(rateSeries([100, 200, 800]), 5);
    expect(s.weather.state).toBe('calm');
    expect(s.savingHabit.label).toBeNull();
  });

  it('W7: a null latest rate reads on runway alone → calm at runway 4', () => {
    const s = sig(rateSeries([100, 200, 300, 250, 150, 200, null]), 4);
    expect(s.weather.state).toBe('calm');
    expect(s.weather.latestRateBps).toBeNull();
  });

  it('W8: infinite runway (no expenses on average) can be calm', () => {
    expect(sig(sixCalm, Infinity).weather.state).toBe('calm');
  });

  it('W9: the partial current month is excluded everywhere', () => {
    const flows = [...rateSeries([100, 200, 300, 250, 150, 200]), flow('2025-07', 100000, 0, 10000)];
    const s = computeMoneySignature(flows, { runwayMonths: 6, today: isoDate('2025-07-15') });
    expect(s.weather.latestMonth).toBe('2025-06');
    expect(s.weather.latestRateBps).toBe(200);
  });

  it('test_regression__signature-trailing-gap-weather (critic P2-2): weather never cites a stale month', () => {
    // Data ends 2025-06 but today is 2026-05-15: the ten completed months in
    // between are REAL $0/no-income months (creep's grid convention, anchored
    // to today). Weather must read 2026-04 (rate null → runway arm), never
    // present an 11-month-old month as "this month".
    const s = computeMoneySignature(rateSeries([100, 200, 300, 250, 150, 200]), {
      runwayMonths: 6,
      today: isoDate('2026-05-15'),
    });
    expect(s.weather.latestMonth).toBe('2026-04');
    expect(s.weather.latestRateBps).toBeNull();
    expect(s.weather.state).toBe('calm'); // null rate reads on runway alone
    // the habit axis window skips the null-rate months (facts qualified as
    // "full months with income" in copy — critic P1-2), label persists
    expect(s.savingHabit.label).toBe('steady');
    expect(s.savingHabit.eligibleMonths).toBe(6);
    // steadiness sees the $0 months: latest window median 0 → unreadable
    expect(s.spendingSteadiness.spreadBps).toBeNull();
    expect(s.spendingSteadiness.hasFullWindow).toBe(true);
  });

  it('W10: boundaries are strict (runway 1 not strained; 3 not tight; rate 0 not negative)', () => {
    expect(sig(sixCalm, 1).weather.state).toBe('tight'); // 1 < 3 still tight
    expect(sig(sixCalm, 3).weather.state).toBe('calm');
    expect(sig(rateSeries([100, 200, 300, 250, 150, 0]), 6).weather.state).toBe('calm');
  });

  it('empty flows: forming axes, weather from runway alone', () => {
    const s = sig([], 2);
    expect(s.savingHabit.label).toBeNull();
    expect(s.spendingSteadiness.label).toBeNull();
    expect(s.weather).toEqual({ state: 'tight', latestMonth: null, latestRateBps: null, runwayMonths: 2 });
  });

  it('demo-seed lock (default asOf 2026-06-10): steady/steady/calm with hand-verified facts', () => {
    // NOTE (#249 lesson): these literals depend on the DEFAULT asOf — the seed's
    // engineered narrative is anchored to 2026-06-10, and a different asOf shifts
    // every window.
    //
    // Hand math (probed flows, independently re-verified below):
    // • Saving habit: every one of the 18 full months 2024-12..2026-05 has a
    //   positive savings rate (minimum 820 bps in 2025-11), so the trailing-12
    //   window is 12/12 saved → shareBps 10000 → steady; the label initializes at
    //   the 6th eligible month, 2025-05, and never flips.
    // • Steadiness latest window = 2025-12..2026-05 expenses
    //   [376515, 392649, 380716, 387684, 444915, 463700]:
    //   sorted → med = floor((387684+392649)/2) = 390166;
    //   |devs| sorted [2482, 2483, 9450, 13651, 54749, 73534] →
    //   mad = floor((9450+13651)/2) = 11550;
    //   spreadBps = floor(11550×10000/390166) = 296 → steady (≤ 1000).
    // • Weather: latest full month 2026-05 rate 3734 is NOT a personal best
    //   (2025-10 was 5317), runway ≥ 3 → calm.
    const seed = buildSeedData('2026-06-10');
    const flows = monthlyFlows(seed.transactions);
    const s = computeMoneySignature(flows, { runwayMonths: 5.7, today: isoDate('2026-06-10') });
    expect(s.savingHabit).toEqual({
      label: 'steady',
      sinceMonth: '2025-05',
      savedMonths: 12,
      eligibleMonths: 12,
      shareBps: 10000,
      latestContrary: false,
    });
    expect(s.spendingSteadiness).toEqual({
      label: 'steady',
      sinceMonth: '2025-05',
      spreadBps: 296,
      latestContrary: false,
      hasFullWindow: true,
    });
    expect(s.weather.state).toBe('calm');
    expect(s.weather.latestMonth).toBe('2026-05');
    expect(s.weather.latestRateBps).toBe(3734);

    // Independent cross-check of the steadiness window (no engine code): re-derive
    // the six expense totals from raw seed rows and recompute med/MAD by hand rules.
    // The naive `amountCents < 0` aggregation is LICENSED by the two assertions
    // below (critic P2-3): it matches monthlyFlows only while the window holds no
    // split-parent rows and no positive rows that would net against spend — if the
    // seed ever gains either in these months, fix the predicate, don't relax the lock.
    const months = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
    const windowRows = seed.transactions.filter(
      (t) => months.some((m) => t.date.startsWith(m)) && !t.isTransfer && t.status === 'POSTED',
    );
    // (Seed rows can't be split parents — SeedTransaction has no such field; splits
    // are user-created. So only the refund-netting arm needs licensing:)
    // every positive row in the window is a true income row (nothing nets spend down)
    expect(windowRows.filter((t) => t.amountCents > 0 && !isIncomeFlowRow(t)).length).toBe(0);
    const expenses = months.map((m) =>
      seed.transactions
        .filter((t) => t.date.startsWith(m) && !t.isTransfer && t.status === 'POSTED' && t.amountCents < 0)
        .reduce((sum, t) => sum - t.amountCents, 0),
    );
    const sorted = [...expenses].sort((a, b) => a - b);
    const med = Math.floor((sorted[2]! + sorted[3]!) / 2);
    const devs = expenses.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
    const mad = Math.floor((devs[2]! + devs[3]!) / 2);
    expect(Math.floor((mad * 10000) / med)).toBe(296);
  });

  it('calendar gap months materialize as $0 / null-rate (creep convention)', () => {
    // 2025-01..03 present, 2025-04 missing, 2025-05..08 present
    const flows = [
      ...rateSeries([100, 100, 100], '2025-01'),
      ...rateSeries([100, 100, 100, 100], '2025-05'),
    ];
    const s = sig(flows);
    // gap month is ineligible for the habit axis: 7 eligible, all saved
    expect(s.savingHabit.label).toBe('steady');
    expect(s.savingHabit.eligibleMonths).toBe(7);
    // gap month IS a $0 month for steadiness: window (2025-03..08) =
    // [400000, 0, 400000, 400000, 400000, 400000] → sorted [0,4,4,4,4,4]e5 →
    // med floor((4e5+4e5)/2) = 400000; devs sorted [0,0,0,0,0,4e5] →
    // mad floor((0+0)/2) = 0 → spread 0 → steady
    expect(s.spendingSteadiness.spreadBps).toBe(0);
  });
});
